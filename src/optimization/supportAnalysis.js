import * as THREE from 'three';

/**
 * Creates a vertex-colored clone of `sourceGeometry` highlighting faces that
 * need support for a given overhang angle.
 *
 * Rule (MVP):
 * - Compute face normal for each triangle
 * - If normal.y < -cos(angleDeg), treat as needing support
 *
 * Angle interpretation:
 * - angleDeg is measured from the +Y axis (vertical).
 * - 45° means faces more "downward" than 45° from vertical are highlighted.
 *
 * @param {THREE.BufferGeometry} sourceGeometry
 * @param {number} angleDeg
 */
export function computeSupportHighlightGeometry(sourceGeometry, angleDeg = 45) {
    if (!sourceGeometry || sourceGeometry.isBufferGeometry !== true) {
        throw new Error(
            'computeSupportHighlightGeometry: sourceGeometry must be a THREE.BufferGeometry'
        );
    }

    const clampedAngle = Number.isFinite(angleDeg)
        ? THREE.MathUtils.clamp(angleDeg, 0, 89)
        : 45;
    const thresholdY = -Math.cos(THREE.MathUtils.degToRad(clampedAngle));

    // Work on a non-indexed clone so each face can be colored independently.
    let geometry = sourceGeometry.clone();
    if (geometry.index) {
        geometry = geometry.toNonIndexed();
    }

    // If the geometry has been placed on the bed (as our viewer does), the
    // triangles lying on the model's bottom plane (min-Y) are already supported
    // by the bed and should not be counted as needing support.
    geometry.computeBoundingBox();
    const bbox = geometry.boundingBox;
    const bboxSize = new THREE.Vector3();
    if (bbox) bbox.getSize(bboxSize);
    const maxDim = Math.max(bboxSize.x || 0, bboxSize.y || 0, bboxSize.z || 0);
    const bedY = bbox ? bbox.min.y : null;
    const bedEpsilon = Number.isFinite(maxDim) && maxDim > 0 ? maxDim * 1e-4 : 1e-6;

    const position = geometry.getAttribute('position');
    if (!position) {
        return {
            geometry,
            angleDeg: clampedAngle,
            totalFaces: 0,
            supportFaces: 0,
            supportPercent: 0,
        };
    }

    const totalFaces = Math.floor(position.count / 3);
    const colors = new Float32Array(position.count * 3);

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const normal = new THREE.Vector3();

    let supportFaces = 0;

    const normalColor = { r: 1, g: 1, b: 1 };
    const supportColor = { r: 1, g: 0.25, b: 0.25 };

    for (let face = 0; face < totalFaces; face += 1) {
        const i = face * 3;

        a.fromBufferAttribute(position, i);
        b.fromBufferAttribute(position, i + 1);
        c.fromBufferAttribute(position, i + 2);

        ab.subVectors(b, a);
        ac.subVectors(c, a);
        normal.crossVectors(ab, ac);
        const len = normal.length();
        if (len !== 0) {
            normal.multiplyScalar(1 / len);
        }

        const maxVertexY = Math.max(a.y, b.y, c.y);
        const isBedContactFace = bedY !== null && maxVertexY <= bedY + bedEpsilon;

        let needsSupport = len !== 0 && normal.y < thresholdY;
        if (needsSupport && isBedContactFace) needsSupport = false;

        if (needsSupport) supportFaces += 1;

        const chosen = needsSupport ? supportColor : normalColor;
        for (let v = 0; v < 3; v += 1) {
            const vi = (i + v) * 3;
            colors[vi] = chosen.r;
            colors[vi + 1] = chosen.g;
            colors[vi + 2] = chosen.b;
        }
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const supportPercent = totalFaces
        ? (supportFaces / totalFaces) * 100
        : 0;

    return {
        geometry,
        angleDeg: clampedAngle,
        totalFaces,
        supportFaces,
        supportPercent,
    };
}
