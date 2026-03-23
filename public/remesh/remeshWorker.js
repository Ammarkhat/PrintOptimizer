let remeshModulePromise = null;

const REMESH_RUNTIME_PATH = '/remesh/Remesh.js';
const REMESH_WASM_PATH = '/remesh/Remesh.wasm';
const REMESH_WORKER_MODULE_INIT_TIMEOUT_MS = 15000;

const withTimeout = (promise, timeoutMs, timeoutMessage) => {
    let timeoutId = null;

    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(timeoutMessage));
        }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }
    });
};

const getRemeshModule = async () => {
    if (remeshModulePromise) {
        return remeshModulePromise;
    }

    remeshModulePromise = (async () => {
        if (typeof self.RemeshModule !== 'function') {
            self.importScripts(REMESH_RUNTIME_PATH);
        }

        if (typeof self.RemeshModule !== 'function') {
            throw new Error('RemeshModule factory was not found in worker scope.');
        }

        return withTimeout(
            Promise.resolve(
                self.RemeshModule({
                    locateFile: (path) => (path.endsWith('.wasm') ? REMESH_WASM_PATH : path),
                })
            ),
            REMESH_WORKER_MODULE_INIT_TIMEOUT_MS,
            `Worker RemeshModule initialization timed out after ${Math.round(REMESH_WORKER_MODULE_INIT_TIMEOUT_MS / 1000)}s.`
        );
    })().catch((error) => {
        remeshModulePromise = null;
        throw error;
    });

    return remeshModulePromise;
};

const toFloat32Array = (value) => {
    if (value instanceof Float32Array) {
        return value;
    }

    if (ArrayBuffer.isView(value)) {
        return new Float32Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    }

    if (Array.isArray(value)) {
        return Float32Array.from(value);
    }

    return null;
};

const toUint32Array = (value) => {
    if (value instanceof Uint32Array) {
        return value;
    }

    if (ArrayBuffer.isView(value)) {
        return new Uint32Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    }

    if (Array.isArray(value)) {
        return Uint32Array.from(value);
    }

    return null;
};

self.onmessage = async (event) => {
    const message = event?.data;
    if (!message || message.type !== 'remesh') {
        return;
    }

    const { requestId, positionArray, indexArray, targetEdgeLength, preserveSharp = true } = message;

    let positionVector = null;
    let indexVector = null;
    let remeshOutput = null;
    let progressCallbackInstalled = false;
    let lastProgressSent = 0;
    let lastProgressPostAt = 0;
    const progressMinDelta = 0.01;
    const progressMinIntervalMs = 120;

    const postProgress = (progress, force = false) => {
        const normalized = Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0;

        const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
        if (!force) {
            const progressDelta = normalized - lastProgressSent;
            const elapsedSinceLastPost = now - lastProgressPostAt;
            if (progressDelta < progressMinDelta && elapsedSinceLastPost < progressMinIntervalMs && normalized < 1) {
                return;
            }
        }

        lastProgressSent = Math.max(lastProgressSent, normalized);
        lastProgressPostAt = now;

        self.postMessage({
            type: 'progress',
            requestId,
            progress: lastProgressSent,
        });
    };

    try {
        postProgress(0.02, true);
        const remeshModule = await getRemeshModule();
        postProgress(0.08, true);

        if (
            typeof remeshModule.vectorFloatFromTypedArray !== 'function' ||
            typeof remeshModule.vectorUInt32FromTypedArray !== 'function' ||
            typeof remeshModule.typedArrayFromVectorFloat !== 'function' ||
            typeof remeshModule.typedArrayFromVectorUInt32 !== 'function' ||
            typeof remeshModule.remesh !== 'function'
        ) {
            throw new Error('Remesh module in worker is missing required bindings.');
        }

        if (typeof remeshModule.setRemeshProgressCallback === 'function') {
            remeshModule.setRemeshProgressCallback((progress) => {
                const normalized = Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0;
                postProgress(normalized);
                return true;
            });
            progressCallbackInstalled = true;
        }

        const normalizedPositionArray = toFloat32Array(positionArray);
        const normalizedIndexArray = toUint32Array(indexArray);

        if (!normalizedPositionArray?.length || !normalizedIndexArray?.length) {
            throw new Error('Worker received empty remesh arrays.');
        }

        positionVector = remeshModule.vectorFloatFromTypedArray(normalizedPositionArray);
        indexVector = remeshModule.vectorUInt32FromTypedArray(normalizedIndexArray);
        postProgress(0.15, true);

        remeshOutput = remeshModule.remesh(positionVector, indexVector, targetEdgeLength, preserveSharp);
        postProgress(0.9, true);

        if (!remeshOutput?.success || !remeshOutput?.coords || !remeshOutput?.tris) {
            self.postMessage({
                type: 'result',
                requestId,
                success: false,
                reason: 'Native worker remesh failed to produce valid output buffers.',
            });
            return;
        }

        const remeshedPositions = toFloat32Array(remeshModule.typedArrayFromVectorFloat(remeshOutput.coords));
        const remeshedIndices = toUint32Array(remeshModule.typedArrayFromVectorUInt32(remeshOutput.tris));
        postProgress(0.97, true);

        if (!remeshedPositions?.length || !remeshedIndices?.length) {
            self.postMessage({
                type: 'result',
                requestId,
                success: false,
                reason: 'Worker remesh produced empty output arrays.',
            });
            return;
        }

        postProgress(1, true);
        self.postMessage(
            {
                type: 'result',
                requestId,
                success: true,
                positionArray: remeshedPositions,
                indexArray: remeshedIndices,
            },
            [remeshedPositions.buffer, remeshedIndices.buffer]
        );
    } catch (error) {
        self.postMessage({
            type: 'error',
            requestId,
            reason: error instanceof Error ? error.message : 'Worker remesh failed unexpectedly.',
        });
    } finally {
        try {
            const remeshModule = await getRemeshModule();
            if (progressCallbackInstalled && typeof remeshModule.setRemeshProgressCallback === 'function') {
                remeshModule.setRemeshProgressCallback(null);
            }
        } catch {
            // Ignore worker cleanup failures.
        }

        remeshOutput?.coords?.delete?.();
        remeshOutput?.tris?.delete?.();
        positionVector?.delete?.();
        indexVector?.delete?.();
    }
};
