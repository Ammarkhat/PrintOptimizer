import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

const isBufferGeometry = (value) =>
    value && typeof value === 'object' && value.isBufferGeometry === true;

const resolveGeometry = (geometryInput) => {
    if (!geometryInput) {
        return { geometry: null, ownsGeometry: false };
    }

    if (isBufferGeometry(geometryInput)) {
        return { geometry: geometryInput, ownsGeometry: false };
    }

    if (geometryInput instanceof ArrayBuffer) {
        const loader = new STLLoader();
        const parsedGeometry = loader.parse(geometryInput);
        return { geometry: parsedGeometry, ownsGeometry: true };
    }

    throw new Error(
        'ThreeViewer: `geometry` must be a THREE.BufferGeometry or an ArrayBuffer (raw STL).'
    );
};

const fitCameraToObject = ({
    camera,
    controls,
    object,
    offset = 1.6,
}) => {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(maxDim) || maxDim <= 0) return;

    const fov = (camera.fov * Math.PI) / 180;
    const cameraDistance = Math.abs((maxDim / 2) / Math.tan(fov / 2)) * offset;

    // A slightly angled view is more "printer-like" than straight-on Z.
    const viewDir = new THREE.Vector3(1, 0.65, 1).normalize();
    camera.position.copy(center).addScaledVector(viewDir, cameraDistance);
    camera.near = maxDim / 100;
    camera.far = maxDim * 100;
    camera.updateProjectionMatrix();

    controls.target.copy(center);
    controls.update();
};

const createBedTexture = ({ sizePx = 1024 } = {}) => {
    const canvas = document.createElement('canvas');
    canvas.width = sizePx;
    canvas.height = sizePx;
    const ctx = canvas.getContext('2d');

    // Plate base
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, sizePx, sizePx);

    // Border
    ctx.strokeStyle = '#0f3460';
    ctx.lineWidth = Math.max(2, Math.floor(sizePx * 0.006));
    ctx.strokeRect(
        ctx.lineWidth / 2,
        ctx.lineWidth / 2,
        sizePx - ctx.lineWidth,
        sizePx - ctx.lineWidth
    );

    // Grid lines
    const minorStep = Math.floor(sizePx / 40); // ~40 cells across
    const majorEvery = 5;
    for (let i = 0; i <= sizePx; i += minorStep) {
        const isMajor = (i / minorStep) % majorEvery === 0;
        ctx.strokeStyle = isMajor ? 'rgba(148, 163, 184, 0.35)' : 'rgba(51, 65, 85, 0.45)';
        ctx.lineWidth = isMajor ? 2 : 1;

        // vertical
        ctx.beginPath();
        ctx.moveTo(i + 0.5, 0);
        ctx.lineTo(i + 0.5, sizePx);
        ctx.stroke();

        // horizontal
        ctx.beginPath();
        ctx.moveTo(0, i + 0.5);
        ctx.lineTo(sizePx, i + 0.5);
        ctx.stroke();
    }

    // Corner markers (subtle)
    ctx.fillStyle = 'rgba(233, 69, 96, 0.9)';
    const mark = Math.floor(sizePx * 0.018);
    ctx.fillRect(mark, sizePx - mark * 2, mark, mark);
    ctx.fillRect(mark, sizePx - mark, mark, mark);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
};

const createPrinterBed = (renderer, { width = 256, depth = 256 } = {}) => {
    const group = new THREE.Group();
    group.name = 'printer-bed';

    const texture = createBedTexture();
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() ?? 1);

    const topGeo = new THREE.PlaneGeometry(width, depth, 1, 1);
    topGeo.rotateX(-Math.PI / 2);
    const topMat = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.9,
        metalness: 0.05,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
    });
    const top = new THREE.Mesh(topGeo, topMat);
    // Lift the textured top slightly above the base to avoid z-fighting.
    const thickness = Math.max(2, Math.min(width, depth) * 0.015);
    const topLift = Math.max(0.01, thickness * 0.002);
    top.position.y = topLift;
    group.add(top);

    const baseGeo = new THREE.BoxGeometry(width, thickness, depth);
    const baseMat = new THREE.MeshStandardMaterial({
        color: 0x16213e,
        roughness: 0.95,
        metalness: 0.05,
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = -thickness / 2;
    group.add(base);

    const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(width, thickness, depth));
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x0f3460, transparent: true, opacity: 0.9 });
    const edges = new THREE.LineSegments(edgeGeo, edgeMat);
    edges.position.copy(base.position);
    group.add(edges);

    // Keep disposal references on the group.
    group.userData.dispose = () => {
        topGeo.dispose();
        topMat.dispose();
        texture.dispose();
        baseGeo.dispose();
        baseMat.dispose();
        edgeGeo.dispose();
        edgeMat.dispose();
    };

    return group;
};

/**
 * Reusable THREE.js viewer.
 *
 * Usage:
 *   <ThreeViewer geometry={geometry} />
 *
 * `geometry` can be either:
 * - THREE.BufferGeometry
 * - ArrayBuffer containing STL data (parsed with STLLoader)
 */
const ThreeViewer = ({
    geometry,
    style,
    className,
    onFaceClick,
    disposeGeometryOnUnmount = false,
}) => {
    const mountRef = useRef(null);

    const resolved = useMemo(() => resolveGeometry(geometry), [geometry]);

    useEffect(() => {
        if (!mountRef.current || !resolved.geometry) return;

        const mount = mountRef.current;
        const width = mount.clientWidth || 1;
        const height = mount.clientHeight || 1;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(width, height);
        mount.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0f172a);

        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);

        const ambient = new THREE.AmbientLight(0xffffff, 0.45);
        scene.add(ambient);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(6, 10, 8);
        scene.add(dirLight);

        const bed = createPrinterBed(renderer, { width: 256, depth: 256 });
        scene.add(bed);

        const material = new THREE.MeshStandardMaterial({
            color: 0x93c5fd,
            metalness: 0.1,
            roughness: 0.75,
            vertexColors: Boolean(resolved.geometry.getAttribute?.('color')),
        });

        const mesh = new THREE.Mesh(resolved.geometry, material);
        resolved.geometry.computeVertexNormals();
        scene.add(mesh);

        const raycaster = new THREE.Raycaster();
        const ndc = new THREE.Vector2();
        let pointerDown = null;
        let hoveredFaceIndex = null;
        let highlightMesh = null;
        let normalArrow = null;

        // Create a material for highlighting hovered faces
        const highlightMaterial = new THREE.MeshStandardMaterial({
            color: 0xff6b35,
            metalness: 0.3,
            roughness: 0.5,
            emissive: 0xff6b35,
            emissiveIntensity: 0.7,
            wireframe: false,
        });

        const pickFaceAtPointer = (clientX, clientY) => {
            const rect = renderer.domElement.getBoundingClientRect();
            const x = ((clientX - rect.left) / rect.width) * 2 - 1;
            const y = -(((clientY - rect.top) / rect.height) * 2 - 1);
            ndc.set(x, y);
            raycaster.setFromCamera(ndc, camera);

            const hits = raycaster.intersectObject(mesh, false);
            const hit = hits[0];
            if (!hit) return null;

            const geom = mesh.geometry;
            const pos = geom.getAttribute('position');
            if (!pos) return null;

            // Determine triangle vertex indices
            const faceIndex =
                typeof hit.faceIndex === 'number' ? hit.faceIndex : null;
            if (faceIndex === null) return null;

            let ia;
            let ib;
            let ic;

            if (geom.index) {
                const idx = geom.index;
                const tri = faceIndex * 3;
                ia = idx.getX(tri);
                ib = idx.getX(tri + 1);
                ic = idx.getX(tri + 2);
            } else {
                ia = faceIndex * 3;
                ib = ia + 1;
                ic = ia + 2;
            }

            const a = new THREE.Vector3().fromBufferAttribute(pos, ia);
            const b = new THREE.Vector3().fromBufferAttribute(pos, ib);
            const c = new THREE.Vector3().fromBufferAttribute(pos, ic);

            const normal = new THREE.Vector3()
                .subVectors(b, a)
                .cross(new THREE.Vector3().subVectors(c, a))
                .normalize();

            if (!Number.isFinite(normal.x) || !Number.isFinite(normal.y) || !Number.isFinite(normal.z)) {
                return null;
            }

            return { normal, faceIndex, vertices: [a, b, c] };
        };

        const updateHoverHighlight = (clientX, clientY) => {
            const faceData = pickFaceAtPointer(clientX, clientY);
            const newFaceIndex = faceData ? faceData.faceIndex : null;

            // Only update if face changed
            if (newFaceIndex === hoveredFaceIndex) return;

            // Clear previous highlight mesh and arrow
            if (highlightMesh !== null) {
                scene.remove(highlightMesh);
                highlightMesh.geometry.dispose();
                highlightMesh = null;
            }
            if (normalArrow !== null) {
                scene.remove(normalArrow);
                normalArrow = null;
            }

            // Create new highlight mesh and arrow for hovered face
            if (newFaceIndex !== null && faceData) {
                const faceGeo = new THREE.BufferGeometry();
                faceGeo.setFromPoints(faceData.vertices);
                highlightMesh = new THREE.Mesh(faceGeo, highlightMaterial);
                scene.add(highlightMesh);

                // Calculate the center of the face
                const faceCenter = new THREE.Vector3()
                    .add(faceData.vertices[0])
                    .add(faceData.vertices[1])
                    .add(faceData.vertices[2])
                    .divideScalar(3);

                // Calculate the arrow length based on the mesh size
                const box = new THREE.Box3().setFromObject(mesh);
                const size = box.getSize(new THREE.Vector3());
                const arrowLength = Math.max(size.x, size.y, size.z) * 0.1;

                // Create arrow pointing outward along the normal
                const arrowColor = 0xffaa00;
                normalArrow = new THREE.ArrowHelper(
                    faceData.normal.normalize(),
                    faceCenter,
                    arrowLength,
                    arrowColor,
                    arrowLength * 0.3,
                    arrowLength * 0.2
                );
                scene.add(normalArrow);
            }

            hoveredFaceIndex = newFaceIndex;
        };

        const pickFaceNormal = (clientX, clientY) => {
            if (typeof onFaceClick !== 'function') return;

            const faceData = pickFaceAtPointer(clientX, clientY);
            if (faceData) {
                onFaceClick(faceData);
            }
        };

        const onPointerDown = (e) => {
            if (e.button !== 0) return;
            pointerDown = { x: e.clientX, y: e.clientY };
        };

        const onPointerUp = (e) => {
            if (e.button !== 0 || !pointerDown) return;
            const dx = e.clientX - pointerDown.x;
            const dy = e.clientY - pointerDown.y;
            pointerDown = null;

            // Treat as click only if not a drag.
            if (dx * dx + dy * dy <= 16) {
                pickFaceNormal(e.clientX, e.clientY);
            }
        };

        const onPointerMove = (e) => {
            updateHoverHighlight(e.clientX, e.clientY);
        };

        const onPointerLeave = () => {
            // Clear highlight when pointer leaves canvas
            if (highlightMesh !== null) {
                scene.remove(highlightMesh);
                highlightMesh.geometry.dispose();
                highlightMesh = null;
            }
            if (normalArrow !== null) {
                scene.remove(normalArrow);
                normalArrow = null;
            }
            hoveredFaceIndex = null;
        };

        renderer.domElement.addEventListener('pointerdown', onPointerDown);
        renderer.domElement.addEventListener('pointerup', onPointerUp);
        renderer.domElement.addEventListener('pointermove', onPointerMove);
        renderer.domElement.addEventListener('pointerleave', onPointerLeave);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.rotateSpeed = 0.8;
        // Allow orbiting below the model to inspect underside highlights.
        controls.maxPolarAngle = Math.PI;

        fitCameraToObject({ camera, controls, object: mesh });

        const resizeObserver = new ResizeObserver(() => {
            const w = mount.clientWidth || 1;
            const h = mount.clientHeight || 1;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        });
        resizeObserver.observe(mount);

        let animId;
        const animate = () => {
            animId = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();

        return () => {
            cancelAnimationFrame(animId);
            resizeObserver.disconnect();

            controls.dispose();

            renderer.domElement.removeEventListener('pointerdown', onPointerDown);
            renderer.domElement.removeEventListener('pointerup', onPointerUp);
            renderer.domElement.removeEventListener('pointermove', onPointerMove);
            renderer.domElement.removeEventListener('pointerleave', onPointerLeave);

            scene.remove(bed);
            bed.userData.dispose?.();

            scene.remove(mesh);
            material.dispose();

            if (highlightMesh !== null) {
                scene.remove(highlightMesh);
                highlightMesh.geometry.dispose();
            }
            highlightMaterial.dispose();

            if (normalArrow !== null) {
                scene.remove(normalArrow);
            }

            if (resolved.ownsGeometry) {
                resolved.geometry.dispose();
            } else if (disposeGeometryOnUnmount) {
                resolved.geometry.dispose();
            }

            renderer.dispose();
            if (mount.contains(renderer.domElement)) {
                mount.removeChild(renderer.domElement);
            }
        };
    }, [disposeGeometryOnUnmount, onFaceClick, resolved]);

    return (
        <div
            ref={mountRef}
            className={className}
            style={{ width: '100%', height: '100%', minHeight: 520, ...style }}
        />
    );
};

export default ThreeViewer;
