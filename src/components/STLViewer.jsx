import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

/**
 * Renders an STL file (provided as an ArrayBuffer) inside a THREE.js canvas.
 * The canvas fills its parent container.
 */
const STLViewer = ({ buffer }) => {
  const mountRef = useRef(null);

  useEffect(() => {
    if (!buffer || !mountRef.current) return;

    const mount = mountRef.current;
    const width = mount.clientWidth;
    const height = mount.clientHeight;

    // ── Renderer ──────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    renderer.setClearColor(0x1a1a2e);
    mount.appendChild(renderer.domElement);

    // ── Scene ─────────────────────────────────────────────
    const scene = new THREE.Scene();

    // ── Camera ────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);

    // ── Lighting ──────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(5, 10, 7.5);
    scene.add(dirLight);

    // ── Load geometry ──────────────────────────────────────
    const loader = new STLLoader();
    const geometry = loader.parse(buffer);
    geometry.computeVertexNormals();

    const material = new THREE.MeshPhongMaterial({
      color: 0x4a90d9,
      specular: 0x111111,
      shininess: 50,
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // Center and scale
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    mesh.position.sub(center);
    camera.position.set(0, 0, maxDim * 2);
    camera.near = maxDim * 0.01;
    camera.far = maxDim * 100;
    camera.updateProjectionMatrix();

    // ── Controls ──────────────────────────────────────────
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // ── Resize observer ───────────────────────────────────
    const resizeObserver = new ResizeObserver(() => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(mount);

    // ── Animation loop ────────────────────────────────────
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
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [buffer]);

  return (
    <div
      ref={mountRef}
      style={{ width: '100%', height: '100%', minHeight: '400px' }}
    />
  );
};

export default STLViewer;
