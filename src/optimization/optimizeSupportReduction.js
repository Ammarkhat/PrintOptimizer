import * as THREE from 'three';

const DEFAULT_THRESHOLD = -0.5;

/**
 * MVP support reduction modifier.
 *
 * - Detect downward-facing triangles via face normals
 * - If normal.y < threshold, lift triangle vertices slightly along +Y
 *   to reduce overhang severity (nudges surface toward a more printable angle).
 *
 * Notes:
 * - Works on BufferGeometry
 * - Clones before modifying
 * - Updates position attribute
 * - Recomputes normals
 *
 * @param {THREE.BufferGeometry} geometry
 * @returns {THREE.BufferGeometry}
 */
export function optimizeSupportReduction(geometry) {
    if (!geometry || geometry.isBufferGeometry !== true) {
        throw new Error('optimizeSupportReduction: geometry must be a THREE.BufferGeometry');
    }

    // Clone first (requirement) and work on a non-indexed copy so we can modify
    // per-face vertices without affecting unrelated faces.
    let optimized = geometry.clone();
    if (optimized.index) {
        optimized = optimized.toNonIndexed();
    }

    const positionAttr = optimized.getAttribute('position');
    if (!positionAttr) {
        return optimized;
    }

    // Scale the adjustment to the model size so it behaves reasonably across models.
    optimized.computeBoundingBox();
    const bbox = optimized.boundingBox;
    const size = bbox
        ? bbox.getSize(new THREE.Vector3())
        : new THREE.Vector3(1, 1, 1);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const baseLift = maxDim * 0.01; // 1% of max dimension

    const threshold = DEFAULT_THRESHOLD;

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const normal = new THREE.Vector3();

    // position is a flat list of vertices: [ax,ay,az, bx,by,bz, cx,cy,cz, ...]
    for (let i = 0; i < positionAttr.count; i += 3) {
        a.fromBufferAttribute(positionAttr, i);
        b.fromBufferAttribute(positionAttr, i + 1);
        c.fromBufferAttribute(positionAttr, i + 2);

        ab.subVectors(b, a);
        ac.subVectors(c, a);
        normal.crossVectors(ab, ac);
        const len = normal.length();
        if (len === 0) continue;
        normal.multiplyScalar(1 / len);

        if (normal.y < threshold) {
            // Lift amount scales with how "downward" the face is.
            const severity = Math.min(1, Math.max(0, (threshold - normal.y) / (1 - threshold)));
            const lift = baseLift * (0.25 + 1.25 * severity);

            positionAttr.setY(i, a.y + lift);
            positionAttr.setY(i + 1, b.y + lift);
            positionAttr.setY(i + 2, c.y + lift);
        }
    }

    positionAttr.needsUpdate = true;
    optimized.computeVertexNormals();
    optimized.computeBoundingBox();
    optimized.computeBoundingSphere();
    return optimized;
}

export default optimizeSupportReduction;
