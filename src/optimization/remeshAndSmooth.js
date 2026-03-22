import * as THREE from 'three';
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import meshLibWasmUrl from '@alpinebuster/meshlib/lib/web/MRJavaScript.wasm?url';
import meshLibWorkerUrl from '@alpinebuster/meshlib/lib/web/MRJavaScript.js?url';

let meshLibPromise = null;

const SMOOTHING_ITERATIONS = 50;
const TARGET_EDGE_SCALE = 1;
const TESSELLATION_MAX_EDGE_SCALE = 2;
const MERGE_TOLERANCE_SCALE = 0.02;
const TAUBIN_LAMBDA = 0.5;
const TAUBIN_MU = -0.53;

const getMeshLib = async () => {
    if (!meshLibPromise) {
        meshLibPromise = import('@alpinebuster/meshlib')
            .then(({ createMeshLib }) =>
                createMeshLib({
                    locateFile: (path) => {
                        if (path.endsWith('.wasm')) {
                            return meshLibWasmUrl;
                        }

                        return path;
                    },
                    mainScriptUrlOrBlob: meshLibWorkerUrl,
                })
            )
            .catch((error) => {
                meshLibPromise = null;
                throw error;
            });
    }

    return meshLibPromise;
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
        }
    }

    return edgeCount > 0 ? totalLength / edgeCount : 1;
};

const extractTriangleData = (geometry) => {
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();

    if (!position || !index || index.count < 3) {
        throw new Error('Geometry must contain indexed triangle data.');
    }

    const vertices = Array.from({ length: position.count }, (_, vertexIndex) => [
        position.getX(vertexIndex),
        position.getY(vertexIndex),
        position.getZ(vertexIndex),
    ]);

    const faces = Array.from({ length: index.count / 3 }, (_, faceIndex) => {
        const base = faceIndex * 3;
        return [
            index.getX(base),
            index.getX(base + 1),
            index.getX(base + 2),
        ];
    });

    return { vertices, faces };
};

const meshWrapperToGeometry = (meshWrapper) => {
    const vertexCount = meshWrapper?.getVertexCount?.() ?? 0;
    const faceCount = meshWrapper?.getFaceCount?.() ?? 0;

    if (!vertexCount || !faceCount) {
        return null;
    }

    const positions = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array(faceCount * 3);

    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
        const vertex = meshWrapper.getVertexPosition(vertexIndex);
        if (!Array.isArray(vertex) || vertex.length !== 3) {
            return null;
        }

        const offset = vertexIndex * 3;
        positions[offset] = vertex[0];
        positions[offset + 1] = vertex[1];
        positions[offset + 2] = vertex[2];
    }

    for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
        const face = meshWrapper.getFaceVertices(faceIndex);
        if (!Array.isArray(face) || face.length !== 3) {
            return null;
        }

        if (face[0] === face[1] || face[1] === face[2] || face[0] === face[2]) {
            return null;
        }

        const offset = faceIndex * 3;
        indices[offset] = face[0];
        indices[offset + 1] = face[1];
        indices[offset + 2] = face[2];
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
};

const tryMeshLibNativeRemesh = async (geometry, averageEdgeLength) => {
    const meshLib = await getMeshLib();
    const { vertices, faces } = extractTriangleData(geometry);
    const meshResult = meshLib.MeshWrapper?.fromTriangles?.(vertices, faces);

    if (!meshResult?.success || !meshResult.mesh) {
        return {
            supported: false,
            reason: 'MeshLib could not construct a browser-side mesh wrapper.',
        };
    }

    meshResult.mesh.pack?.();

    const remesh = meshLib.remesh ?? meshLib.mrRemesh;
    const denoise = meshLib.meshDenoiseViaNormals ?? meshLib.mrMeshDenoiseViaNormals;
    const RemeshSettings = meshLib.RemeshSettings;
    const DenoiseViaNormalsSettings = meshLib.DenoiseViaNormalsSettings;
    const rawMesh = meshResult.mesh.getMesh?.() ?? meshResult.mesh.mesh ?? null;

    if (!remesh || !denoise || !RemeshSettings || !DenoiseViaNormalsSettings || !rawMesh) {
        return {
            supported: false,
            reason: 'The published MeshLib browser build is missing native remesh/denoise exports.',
        };
    }

    const remeshSettings = new RemeshSettings();
    remeshSettings.targetEdgeLen = averageEdgeLength * TARGET_EDGE_SCALE;
    remeshSettings.finalRelaxIters = 50;
    remeshSettings.finalRelaxNoShrinkage = true;
    remeshSettings.projectOnOriginalMesh = true;

    const remeshSucceeded = remesh(rawMesh, remeshSettings);
    if (!remeshSucceeded) {
        return {
            supported: false,
            reason: 'MeshLib reported that remeshing did not complete successfully.',
        };
    }

    const denoiseSettings = new DenoiseViaNormalsSettings();
    denoiseSettings.fastIndicatorComputation = true;
    denoiseSettings.beta = 0.1;
    denoise(rawMesh, denoiseSettings);

    const remeshedGeometry = meshWrapperToGeometry(meshResult.mesh);
    if (!remeshedGeometry) {
        return {
            supported: false,
            reason: 'MeshLib processed the mesh, but the browser wrapper could not expose the updated topology.',
        };
    }

    return {
        supported: true,
        geometry: remeshedGeometry,
    };
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

const runFallbackRemeshAndSmooth = (geometry, targetEdgeLength) => {
    const clampedTargetEdgeLength = Math.max(targetEdgeLength, 1e-5);
    const tessellationMaxEdgeLength = clampedTargetEdgeLength * TESSELLATION_MAX_EDGE_SCALE;
    const mergeTolerance = Math.max(clampedTargetEdgeLength * MERGE_TOLERANCE_SCALE, 1e-6);
    const tessellator = new TessellateModifier(tessellationMaxEdgeLength, 3);

    let workingGeometry = geometry.clone();
    workingGeometry.deleteAttribute('normal');
    workingGeometry = tessellator.modify(workingGeometry);
    workingGeometry = mergeVertices(workingGeometry, mergeTolerance);

    if (!workingGeometry.index) {
        const vertexCount = workingGeometry.getAttribute('position')?.count ?? 0;
        workingGeometry.setIndex(Array.from({ length: vertexCount }, (_, index) => index));
    }

    return {
        geometry: applyTaubinSmoothing(workingGeometry),
        tessellationMaxEdgeLength,
    };
};

export const remeshAndSmoothGeometry = async (geometry) => {
    const indexedGeometry = createIndexedGeometry(geometry);
    const before = getMeshStats(indexedGeometry);
    const targetEdgeLength = before.avgEdgeLength * TARGET_EDGE_SCALE;

    const buildResult = (outputGeometry, engine, warning = '', extraStats = {}) => ({
        geometry: outputGeometry,
        engine,
        stats: { before, after: getMeshStats(outputGeometry), targetEdgeLength, ...extraStats },
        warning,
    });

    try {
        const nativeResult = await tryMeshLibNativeRemesh(indexedGeometry, before.avgEdgeLength);
        if (nativeResult.supported) {
            return buildResult(nativeResult.geometry, 'meshlib');
        }

        const fallbackResult = runFallbackRemeshAndSmooth(indexedGeometry, targetEdgeLength);
        return buildResult(
            fallbackResult.geometry,
            'fallback',
            nativeResult.reason,
            { tessellationMaxEdgeLength: fallbackResult.tessellationMaxEdgeLength }
        );
    } catch (error) {
        const fallbackResult = runFallbackRemeshAndSmooth(indexedGeometry, targetEdgeLength);
        return buildResult(
            fallbackResult.geometry,
            'fallback',
            error instanceof Error ? error.message : 'MeshLib could not be initialized.',
            { tessellationMaxEdgeLength: fallbackResult.tessellationMaxEdgeLength }
        );
    }
};