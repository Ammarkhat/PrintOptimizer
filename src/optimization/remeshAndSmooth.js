import * as THREE from 'three';
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

let remeshModulePromise = null;
let remeshScriptPromise = null;
const REMESH_SCRIPT_PATH = '/remesh/Remesh.js';
const REMESH_WASM_PATH = '/remesh/Remesh.wasm';

const SMOOTHING_ITERATIONS = 50;
const TARGET_EDGE_SCALE = 1;
const TESSELLATION_MAX_EDGE_SCALE = 2;
const MERGE_TOLERANCE_SCALE = 0.02;
const MAX_EDGE_SAMPLES = 120000;
const MAX_NATIVE_TRIANGLES = 900000;
const MIN_NATIVE_TARGET_EDGE = 1e-6;
const MIN_NATIVE_TARGET_EDGE_BBOX_SCALE = 1e-6;
const MAX_NATIVE_TARGET_EDGE_BBOX_SCALE = 0.25;
const MIN_NATIVE_TRIANGLE_AREA_SQUARED = 1e-24;
const TAUBIN_LAMBDA = 0.5;
const TAUBIN_MU = -0.53;

const getNowMs = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

const createTimingLogger = (traceId, stage, metadata = '') => {
    const startedAt = getNowMs();
    let lastAt = startedAt;
    console.info(`[RemeshTiming:${traceId}][${stage}] start${metadata ? ` | ${metadata}` : ''}`);

    return {
        mark: (step, info = '') => {
            const now = getNowMs();
            const delta = now - lastAt;
            lastAt = now;
            console.info(
                `[RemeshTiming:${traceId}][${stage}] ${step}: ${delta.toFixed(2)}ms${info ? ` | ${info}` : ''}`
            );
        },
        end: (info = '') => {
            const total = getNowMs() - startedAt;
            console.info(
                `[RemeshTiming:${traceId}][${stage}] total: ${total.toFixed(2)}ms${info ? ` | ${info}` : ''}`
            );
        },
    };
};

const createRemeshTraceId = () => `r${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const loadRemeshScript = async () => {
    if (typeof globalThis.RemeshModule === 'function') {
        return;
    }

    if (!remeshScriptPromise) {
        remeshScriptPromise = new Promise((resolve, reject) => {
            if (typeof document === 'undefined') {
                reject(new Error('Document is unavailable; cannot load Remesh.js in this environment.'));
                return;
            }

            const existingScript = document.querySelector(`script[data-remesh-runtime="1"]`);
            if (existingScript) {
                if (typeof globalThis.RemeshModule === 'function') {
                    resolve();
                    return;
                }

                existingScript.addEventListener('load', () => resolve(), { once: true });
                existingScript.addEventListener(
                    'error',
                    () => reject(new Error('Failed to load Remesh.js runtime script.')),
                    { once: true }
                );
                return;
            }

            const script = document.createElement('script');
            script.src = REMESH_SCRIPT_PATH;
            script.async = true;
            script.dataset.remeshRuntime = '1';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load Remesh.js runtime script.'));
            document.head.appendChild(script);
        }).catch((error) => {
            remeshScriptPromise = null;
            throw error;
        });
    }

    await remeshScriptPromise;
};

const getRemeshModule = async () => {
    if (!remeshModulePromise) {
        remeshModulePromise = loadRemeshScript()
            .then(() => {
                const createRemeshModule = globalThis.RemeshModule;
                if (typeof createRemeshModule !== 'function') {
                    throw new Error('Remesh.js loaded, but RemeshModule factory was not found on global scope.');
                }

                return createRemeshModule({
                    locateFile: (path) => (path.endsWith('.wasm') ? REMESH_WASM_PATH : path),
                });
            })
            .catch((error) => {
                remeshModulePromise = null;
                throw error;
            });
    }

    return remeshModulePromise;
};

const createIndexedGeometry = (geometry) => {
    const workingGeometry = geometry.clone();
    workingGeometry.deleteAttribute('normal');

    const indexedGeometry = workingGeometry.index
        ? workingGeometry
        : mergeVertices(workingGeometry, 1e-6);

    if (!indexedGeometry.index) {
        const vertexCount = indexedGeometry.getAttribute('position')?.count ?? 0;
        indexedGeometry.setIndex(Array.from({ length: vertexCount }, (_, index) => index));
    }

    return indexedGeometry;
};

const computeAverageEdgeLength = (geometry) => {
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();

    if (!position || !index || index.count < 3) {
        return 1;
    }

    const seenEdges = new Set();
    const vertexA = new THREE.Vector3();
    const vertexB = new THREE.Vector3();
    let totalLength = 0;
    let edgeCount = 0;

    outerLoop:
    for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i);
        const b = index.getX(i + 1);
        const c = index.getX(i + 2);
        const edges = [
            [a, b],
            [b, c],
            [c, a],
        ];

        for (const [start, end] of edges) {
            const key = start < end ? `${start}:${end}` : `${end}:${start}`;
            if (seenEdges.has(key)) {
                continue;
            }

            seenEdges.add(key);
            vertexA.fromBufferAttribute(position, start);
            vertexB.fromBufferAttribute(position, end);
            totalLength += vertexA.distanceTo(vertexB);
            edgeCount += 1;

            if (edgeCount >= MAX_EDGE_SAMPLES) {
                break outerLoop;
            }
        }
    }

    return edgeCount > 0 ? totalLength / edgeCount : 1;
};

const geometryToNativeArrays = (geometry) => {
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();

    if (!position || !index || index.count < 3) {
        throw new Error('Geometry must contain indexed triangle data.');
    }

    const canCopyPositionDirectly =
        position.itemSize === 3 &&
        !position.isInterleavedBufferAttribute &&
        position.array &&
        position.array.length >= position.count * 3;

    const positionArray = canCopyPositionDirectly
        ? new Float32Array(position.array)
        : (() => {
            const buffer = new Float32Array(position.count * 3);
            for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
                const offset = vertexIndex * 3;
                buffer[offset] = position.getX(vertexIndex);
                buffer[offset + 1] = position.getY(vertexIndex);
                buffer[offset + 2] = position.getZ(vertexIndex);
            }
            return buffer;
        })();

    const indexArray =
        index.array instanceof Uint32Array
            ? new Uint32Array(index.array)
            : Uint32Array.from(index.array);

    return { positionArray, indexArray };
};

const sanitizeNativeInput = (positionArray, indexArray) => {
    if (!positionArray?.length || !indexArray?.length) {
        return { ok: false, reason: 'Native remesh input arrays were empty.' };
    }

    if (positionArray.length % 3 !== 0 || indexArray.length % 3 !== 0) {
        return { ok: false, reason: 'Native remesh input arrays are not triangle-aligned.' };
    }

    const vertexCount = positionArray.length / 3;
    const faceCount = indexArray.length / 3;

    if (faceCount > MAX_NATIVE_TRIANGLES) {
        return {
            ok: false,
            reason: `Mesh has ${faceCount} faces, exceeding native remesh safety limit (${MAX_NATIVE_TRIANGLES}).`,
        };
    }

    for (let i = 0; i < positionArray.length; i += 1) {
        if (!Number.isFinite(positionArray[i])) {
            return { ok: false, reason: 'Mesh positions contain non-finite values.' };
        }
    }

    const filtered = [];

    for (let i = 0; i < indexArray.length; i += 3) {
        const a = indexArray[i];
        const b = indexArray[i + 1];
        const c = indexArray[i + 2];

        if (
            !Number.isInteger(a) ||
            !Number.isInteger(b) ||
            !Number.isInteger(c) ||
            a < 0 ||
            b < 0 ||
            c < 0 ||
            a >= vertexCount ||
            b >= vertexCount ||
            c >= vertexCount ||
            a === b ||
            b === c ||
            c === a
        ) {
            continue;
        }

        const ax = positionArray[a * 3];
        const ay = positionArray[a * 3 + 1];
        const az = positionArray[a * 3 + 2];
        const bx = positionArray[b * 3];
        const by = positionArray[b * 3 + 1];
        const bz = positionArray[b * 3 + 2];
        const cx = positionArray[c * 3];
        const cy = positionArray[c * 3 + 1];
        const cz = positionArray[c * 3 + 2];

        const abx = bx - ax;
        const aby = by - ay;
        const abz = bz - az;
        const acx = cx - ax;
        const acy = cy - ay;
        const acz = cz - az;

        const crossX = aby * acz - abz * acy;
        const crossY = abz * acx - abx * acz;
        const crossZ = abx * acy - aby * acx;
        const areaSquared = crossX * crossX + crossY * crossY + crossZ * crossZ;

        if (areaSquared <= MIN_NATIVE_TRIANGLE_AREA_SQUARED || !Number.isFinite(areaSquared)) {
            continue;
        }

        filtered.push(a, b, c);
    }

    if (!filtered.length) {
        return { ok: false, reason: 'No valid non-degenerate triangles remained for native remeshing.' };
    }

    return {
        ok: true,
        positionArray,
        indexArray: filtered.length === indexArray.length ? indexArray : Uint32Array.from(filtered),
    };
};

const clampNativeTargetEdgeLength = (geometry, requestedTargetEdgeLength) => {
    const boundingBox = geometry.boundingBox ?? geometry.computeBoundingBox?.() ?? geometry.boundingBox;
    const min = boundingBox?.min;
    const max = boundingBox?.max;

    if (!min || !max) {
        return Math.max(Number.isFinite(requestedTargetEdgeLength) ? requestedTargetEdgeLength : 0, MIN_NATIVE_TARGET_EDGE);
    }

    const dx = max.x - min.x;
    const dy = max.y - min.y;
    const dz = max.z - min.z;
    const diagonal = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (!Number.isFinite(diagonal) || diagonal <= 0) {
        return Math.max(Number.isFinite(requestedTargetEdgeLength) ? requestedTargetEdgeLength : 0, MIN_NATIVE_TARGET_EDGE);
    }

    const safeMin = Math.max(diagonal * MIN_NATIVE_TARGET_EDGE_BBOX_SCALE, MIN_NATIVE_TARGET_EDGE);
    const safeMax = Math.max(diagonal * MAX_NATIVE_TARGET_EDGE_BBOX_SCALE, safeMin);
    const requested = Number.isFinite(requestedTargetEdgeLength) ? requestedTargetEdgeLength : safeMin;
    return Math.min(Math.max(requested, safeMin), safeMax);
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

const nativeOutputToGeometry = (positionArray, indexArray) => {
    const normalizedPositionArray = toFloat32Array(positionArray);
    const normalizedIndexArray = toUint32Array(indexArray);

    if (!normalizedPositionArray?.length || !normalizedIndexArray?.length || normalizedIndexArray.length < 3) {
        return null;
    }

    if (normalizedPositionArray.length % 3 !== 0 || normalizedIndexArray.length % 3 !== 0) {
        return null;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(normalizedPositionArray, 3));
    geometry.setIndex(new THREE.BufferAttribute(normalizedIndexArray, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
};

const tryNativeRemesh = async (geometry, targetEdgeLength, traceId = 'native', onProgress = null) => {
    const timer = createTimingLogger(traceId, 'native', `requestedTarget=${targetEdgeLength}`);
    const nativeModule = await getRemeshModule();
    timer.mark('getRemeshModule');

    const nativeTargetEdgeLength = clampNativeTargetEdgeLength(geometry, targetEdgeLength);
    timer.mark('clampNativeTargetEdgeLength', `clampedTarget=${nativeTargetEdgeLength}`);

    const { positionArray, indexArray } = geometryToNativeArrays(geometry);
    timer.mark('geometryToNativeArrays', `vertices=${positionArray.length / 3}, faces=${indexArray.length / 3}`);

    const sanitizedInput = sanitizeNativeInput(positionArray, indexArray);
    timer.mark('sanitizeNativeInput', sanitizedInput.ok ? `faces=${sanitizedInput.indexArray.length / 3}` : `rejected=${sanitizedInput.reason}`);

    if (!sanitizedInput.ok) {
        timer.end('supported=false');
        return {
            supported: false,
            reason: sanitizedInput.reason,
        };
    }

    if (
        typeof nativeModule.vectorFloatFromTypedArray !== 'function' ||
        typeof nativeModule.vectorUInt32FromTypedArray !== 'function' ||
        typeof nativeModule.typedArrayFromVectorFloat !== 'function' ||
        typeof nativeModule.typedArrayFromVectorUInt32 !== 'function' ||
        typeof nativeModule.remesh !== 'function'
    ) {
        timer.end('supported=false | missingBindings=true');
        return {
            supported: false,
            reason: 'Remesh.js loaded, but the required native bindings were not found.',
        };
    }

    let positionVector = null;
    let indexVector = null;
    let remeshOutput = null;

    let progressCallbackInstalled = false;

    try {
        if (typeof nativeModule.setRemeshProgressCallback === 'function') {
            nativeModule.setRemeshProgressCallback((progress) => {
                const normalized = Number.isFinite(progress)
                    ? Math.min(Math.max(progress, 0), 1)
                    : 0;

                try {
                    return onProgress?.(normalized) !== false;
                } catch (callbackError) {
                    console.warn('Remesh progress callback threw an error:', callbackError);
                    return true;
                }
            });
            progressCallbackInstalled = true;
        }

        positionVector = nativeModule.vectorFloatFromTypedArray(sanitizedInput.positionArray);
        indexVector = nativeModule.vectorUInt32FromTypedArray(sanitizedInput.indexArray);
        timer.mark('vectorFromTypedArray');

        remeshOutput = nativeModule.remesh(positionVector, indexVector, nativeTargetEdgeLength, true);
        timer.mark('nativeModule.remesh');

        const remeshSucceeded = Boolean(remeshOutput?.success);
        if (!remeshSucceeded || !remeshOutput?.coords || !remeshOutput?.tris) {
            timer.end('supported=false | invalidNativeOutput=true');
            return {
                supported: false,
                reason: 'Native remesh failed to produce valid output buffers.',
            };
        }

        const newPositionArray = nativeModule.typedArrayFromVectorFloat(remeshOutput.coords);
        const newIndexArray = nativeModule.typedArrayFromVectorUInt32(remeshOutput.tris);
        timer.mark('typedArrayFromVector');

        const remeshedGeometry = nativeOutputToGeometry(newPositionArray, newIndexArray);
        timer.mark(
            'nativeOutputToGeometry',
            remeshedGeometry
                ? `vertices=${remeshedGeometry.getAttribute('position')?.count ?? 0}, faces=${Math.round((remeshedGeometry.getIndex()?.count ?? 0) / 3)}`
                : 'geometry=null'
        );

        if (!remeshedGeometry) {
            timer.end('supported=false | geometryInvalid=true');
            return {
                supported: false,
                reason: 'Native remesh completed, but output geometry was invalid.',
            };
        }

        timer.end('supported=true');

        return {
            supported: true,
            geometry: remeshedGeometry,
        };
    } catch (error) {
        timer.end(`supported=false | error=${error instanceof Error ? error.message : 'unknown'}`);
        return {
            supported: false,
            reason: error instanceof Error ? error.message : 'Native remesh threw an unexpected error.',
        };
    } finally {
        if (progressCallbackInstalled && typeof nativeModule.setRemeshProgressCallback === 'function') {
            try {
                nativeModule.setRemeshProgressCallback(null);
            } catch {
                // Best-effort cleanup; ignore failures.
            }
        }

        remeshOutput?.coords?.delete?.();
        remeshOutput?.tris?.delete?.();
        positionVector?.delete?.();
        indexVector?.delete?.();
    }
};

const buildAdjacencyData = (geometry) => {
    const index = geometry.getIndex();
    const position = geometry.getAttribute('position');
    const vertexCount = position?.count ?? 0;
    const adjacency = Array.from({ length: vertexCount }, () => new Set());
    const edgeUsage = new Map();

    for (let i = 0; i < (index?.count ?? 0); i += 3) {
        const a = index.getX(i);
        const b = index.getX(i + 1);
        const c = index.getX(i + 2);
        const edges = [
            [a, b],
            [b, c],
            [c, a],
        ];

        for (const [start, end] of edges) {
            adjacency[start].add(end);
            adjacency[end].add(start);

            const key = start < end ? `${start}:${end}` : `${end}:${start}`;
            edgeUsage.set(key, (edgeUsage.get(key) ?? 0) + 1);
        }
    }

    const boundaryVertices = new Set();
    for (const [edgeKey, count] of edgeUsage.entries()) {
        if (count !== 1) {
            continue;
        }

        const [start, end] = edgeKey.split(':').map(Number);
        boundaryVertices.add(start);
        boundaryVertices.add(end);
    }

    return {
        adjacency: adjacency.map((neighbors) => Array.from(neighbors)),
        boundaryVertices,
    };
};

const laplacianPass = (sourceVertices, targetVertices, adjacency, boundaryVertices, factor) => {
    const average = new THREE.Vector3();
    const delta = new THREE.Vector3();

    for (let vertexIndex = 0; vertexIndex < sourceVertices.length; vertexIndex += 1) {
        const neighbors = adjacency[vertexIndex];
        const sourceVertex = sourceVertices[vertexIndex];
        const targetVertex = targetVertices[vertexIndex];

        if (!neighbors.length || boundaryVertices.has(vertexIndex)) {
            targetVertex.copy(sourceVertex);
            continue;
        }

        average.set(0, 0, 0);
        for (const neighborIndex of neighbors) {
            average.add(sourceVertices[neighborIndex]);
        }
        average.multiplyScalar(1 / neighbors.length);

        delta.copy(average).sub(sourceVertex).multiplyScalar(factor);
        targetVertex.copy(sourceVertex).add(delta);
    }
};

const applyTaubinSmoothing = (geometry, iterations = SMOOTHING_ITERATIONS) => {
    const position = geometry.getAttribute('position');
    if (!position) {
        return geometry;
    }

    const { adjacency, boundaryVertices } = buildAdjacencyData(geometry);
    const sourceVertices = Array.from({ length: position.count }, (_, index) =>
        new THREE.Vector3().fromBufferAttribute(position, index)
    );
    const targetVertices = sourceVertices.map((vertex) => vertex.clone());

    for (let iteration = 0; iteration < iterations; iteration += 1) {
        laplacianPass(sourceVertices, targetVertices, adjacency, boundaryVertices, TAUBIN_LAMBDA);
        laplacianPass(targetVertices, sourceVertices, adjacency, boundaryVertices, TAUBIN_MU);
    }

    sourceVertices.forEach((vertex, index) => {
        position.setXYZ(index, vertex.x, vertex.y, vertex.z);
    });

    position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
};

const getMeshStats = (geometry) => {
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const vertices = position?.count ?? 0;
    const faces = index ? Math.round(index.count / 3) : Math.round(vertices / 3);
    return { vertices, faces, avgEdgeLength: computeAverageEdgeLength(geometry) };
};

const runFallbackRemeshAndSmooth = (geometry, targetEdgeLength, traceId = 'fallback') => {
    const timer = createTimingLogger(traceId, 'fallback', `targetEdge=${targetEdgeLength}`);

    const clampedTargetEdgeLength = Math.max(targetEdgeLength, 1e-5);
    const tessellationMaxEdgeLength = clampedTargetEdgeLength * TESSELLATION_MAX_EDGE_SCALE;
    const mergeTolerance = Math.max(clampedTargetEdgeLength * MERGE_TOLERANCE_SCALE, 1e-6);
    const tessellator = new TessellateModifier(tessellationMaxEdgeLength, 3);
    timer.mark('prepareFallbackParams', `tessellationMax=${tessellationMaxEdgeLength}, mergeTol=${mergeTolerance}`);

    let workingGeometry = geometry.clone();
    workingGeometry.deleteAttribute('normal');
    workingGeometry = tessellator.modify(workingGeometry);
    timer.mark('tessellator.modify');

    workingGeometry = mergeVertices(workingGeometry, mergeTolerance);
    timer.mark('mergeVertices');

    if (!workingGeometry.index) {
        const vertexCount = workingGeometry.getAttribute('position')?.count ?? 0;
        workingGeometry.setIndex(Array.from({ length: vertexCount }, (_, index) => index));
    }

    timer.mark('ensureIndex');

    const smoothedGeometry = applyTaubinSmoothing(workingGeometry);
    timer.mark('applyTaubinSmoothing');
    timer.end(
        `vertices=${smoothedGeometry.getAttribute('position')?.count ?? 0}, faces=${Math.round((smoothedGeometry.getIndex()?.count ?? 0) / 3)}`
    );

    return {
        geometry: smoothedGeometry,
        tessellationMaxEdgeLength,
    };
};

export const remeshAndSmoothGeometry = async (geometry, options = {}) => {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const traceId = createRemeshTraceId();
    const timer = createTimingLogger(traceId, 'pipeline');

    onProgress?.({ stage: 'preparing', progress: 0 });

    const indexedGeometry = createIndexedGeometry(geometry);
    timer.mark('createIndexedGeometry');

    const before = getMeshStats(indexedGeometry);
    timer.mark('getMeshStats(before)', `vertices=${before.vertices}, faces=${before.faces}, avgEdge=${before.avgEdgeLength}`);

    const targetEdgeLength = before.avgEdgeLength * TARGET_EDGE_SCALE;
    timer.mark('computeTargetEdge', `targetEdge=${targetEdgeLength}`);

    const buildResult = (outputGeometry, engine, warning = '', extraStats = {}) => ({
        geometry: outputGeometry,
        engine,
        stats: { before, after: getMeshStats(outputGeometry), targetEdgeLength, ...extraStats },
        warning,
    });

    try {
        const nativeResult = await tryNativeRemesh(indexedGeometry, targetEdgeLength, traceId, (nativeProgress) => {
            return onProgress?.({ stage: 'native', progress: nativeProgress }) !== false;
        });
        timer.mark('tryNativeRemesh', `supported=${nativeResult.supported}`);

        if (nativeResult.supported) {
            const result = buildResult(nativeResult.geometry, 'native');
            timer.mark('buildResult(native)');
            timer.end('engine=native');
            onProgress?.({ stage: 'done', progress: 1 });
            return result;
        }

        // If native remeshing isn't supported or fails, we fall back to the JS tessellation + smoothing approach.
        console.warn(`Native remeshing is not available: ${nativeResult.reason}. Falling back to JS tessellation and smoothing.`);

        onProgress?.({ stage: 'fallback', progress: 0 });

        const fallbackResult = runFallbackRemeshAndSmooth(indexedGeometry, targetEdgeLength, traceId);
        timer.mark('runFallbackRemeshAndSmooth');

        const result = buildResult(
            fallbackResult.geometry,
            'fallback',
            nativeResult.reason,
            { tessellationMaxEdgeLength: fallbackResult.tessellationMaxEdgeLength }
        );
        timer.mark('buildResult(fallback)');
        timer.end('engine=fallback');
        onProgress?.({ stage: 'done', progress: 1 });
        return result;
    } catch (error) {
        console.warn(`Native remeshing failed: ${error instanceof Error ? error.message : 'Unknown error'}. Falling back to JS tessellation and smoothing.`);
        timer.mark('nativeException', error instanceof Error ? error.message : 'Unknown error');

        onProgress?.({ stage: 'fallback', progress: 0 });

        const fallbackResult = runFallbackRemeshAndSmooth(indexedGeometry, targetEdgeLength, traceId);
        timer.mark('runFallbackRemeshAndSmooth');

        const result = buildResult(
            fallbackResult.geometry,
            'fallback',
            error instanceof Error ? error.message : 'Native remesh module could not be initialized.',
            { tessellationMaxEdgeLength: fallbackResult.tessellationMaxEdgeLength }
        );
        timer.mark('buildResult(fallback)');
        timer.end('engine=fallback-exception');
        onProgress?.({ stage: 'done', progress: 1 });
        return result;
    }
};