import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import ThreeViewer from '../components/ThreeViewer';
import useAppStore from '../store/useAppStore';
import { uploadSTL, saveOptimizationRecord } from '../firebase/storageService';
import { optimizeSupportReduction } from '../optimization/optimizeSupportReduction';
import './SupportOptimizerPage.css';

const SupportOptimizerPage = () => {
    const navigate = useNavigate();
    const fileInputRef = useRef(null);

    const user = useAppStore((s) => s.user);
    const modelBuffer = useAppStore((s) => s.modelBuffer);
    const optimizedBuffer = useAppStore((s) => s.optimizedBuffer);
    const currentGeometry = useAppStore((s) => s.currentGeometry);
    const setModelBuffer = useAppStore((s) => s.setModelBuffer);
    const setOptimizedBuffer = useAppStore((s) => s.setOptimizedBuffer);
    const setCurrentGeometry = useAppStore((s) => s.setCurrentGeometry);
    const clearModel = useAppStore((s) => s.clearModel);
    const setOriginalFileURL = useAppStore((s) => s.setOriginalFileURL);
    const setOptimizedFileURL = useAppStore((s) => s.setOptimizedFileURL);
    const originalFileURL = useAppStore((s) => s.originalFileURL);
    const optimizationStatus = useAppStore((s) => s.optimizationStatus);
    const setOptimizationStatus = useAppStore((s) => s.setOptimizationStatus);

    const [originalFile, setOriginalFile] = useState(null);
    const [statusMsg, setStatusMsg] = useState('');
    const [isLoadingFile, setIsLoadingFile] = useState(false);
    const [isUploadingOriginal, setIsUploadingOriginal] = useState(false);

    const placeGeometryOnBed = (geometry) => {
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        if (!box) return geometry;

        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const lift = maxDim * 0.002;

        geometry.translate(-center.x, -box.min.y + lift, -center.z);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        return geometry;
    };

    const handleFileChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const isStl = file.name.toLowerCase().endsWith('.stl');
        if (!isStl) {
            setStatusMsg('Please select a .stl file.');
            return;
        }

        clearModel();
        setOptimizationStatus('idle');
        setOriginalFileURL(null);
        setOptimizedFileURL(null);
        setStatusMsg('Loading STL…');
        setOriginalFile(file);

        try {
            setIsLoadingFile(true);
            const arrayBuffer = await file.arrayBuffer();

            // Keep the raw buffer for optimization/download.
            setModelBuffer(arrayBuffer);

            // Parse STL to geometry for viewer.
            const loader = new STLLoader();
            const geometry = placeGeometryOnBed(loader.parse(arrayBuffer));
            setCurrentGeometry(geometry);

            // Upload original file immediately.
            if (user?.uid) {
                setIsUploadingOriginal(true);
                setStatusMsg('Uploading original STL…');
                const url = await uploadSTL(user.uid, file, 'original');
                setOriginalFileURL(url);
            }

            setStatusMsg('');
        } catch (err) {
            console.error(err);
            setStatusMsg('Failed to load STL.');
        } finally {
            setIsLoadingFile(false);
            setIsUploadingOriginal(false);
        }
    };

    const handleOptimize = async () => {
        if (!modelBuffer || !currentGeometry) return;
        setOptimizationStatus('loading');
        setStatusMsg('Optimizing geometry…');

        try {
            const optimizedGeometry = optimizeSupportReduction(currentGeometry);
            setCurrentGeometry(optimizedGeometry);

            // Keep the existing buffer-based download/upload flow for now.
            const result = modelBuffer.slice(0);
            setOptimizedBuffer(result);

            setOptimizationStatus('success');
            setStatusMsg('Optimization complete!');

            if (user && originalFile) {
                const optimizedFile = new File([result], `optimized_${originalFile.name}`,
                    { type: 'application/octet-stream' }
                );
                const [maybeOriginalURL, optimizedURL] = await Promise.all([
                    originalFileURL
                        ? Promise.resolve(originalFileURL)
                        : uploadSTL(user.uid, originalFile, 'original'),
                    uploadSTL(user.uid, optimizedFile, 'optimized'),
                ]);

                setOriginalFileURL(maybeOriginalURL);
                setOptimizedFileURL(optimizedURL);
                await saveOptimizationRecord({
                    userId: user.uid,
                    originalFileURL: maybeOriginalURL,
                    optimizedFileURL: optimizedURL,
                    tool: 'support-reduction',
                });
            }
        } catch (err) {
            console.error(err);
            setOptimizationStatus('error');
            setStatusMsg('Optimization failed. Please try again.');
        }
    };

    const handleDownload = () => {
        if (!optimizedBuffer) return;
        const blob = new Blob([optimizedBuffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = originalFile ? `optimized_${originalFile.name}` : 'optimized.stl';
        a.click();
        URL.revokeObjectURL(url);
    };

    const isBusy = isLoadingFile || isUploadingOriginal || optimizationStatus === 'loading';

    return (
        <main className="sr-page">
            <div className="sr-header">
                <button className="btn btn-outline btn-sm" onClick={() => navigate('/')}
                >
                    ← Back
                </button>
                <h2>Support Optimizer</h2>
            </div>

            <div className="sr-layout">
                <div className="sr-viewer">
                    {currentGeometry ? (
                        <ThreeViewer geometry={currentGeometry} />
                    ) : (
                        <div className="sr-viewer-placeholder">
                            <span>🗂️</span>
                            <p>Upload an STL file to preview it here</p>
                        </div>
                    )}
                </div>

                <aside className="sr-controls">
                    <h3>Controls</h3>

                    <button
                        className="btn btn-primary"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        📂 Upload STL
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".stl"
                        style={{ display: 'none' }}
                        onChange={handleFileChange}
                    />

                    {originalFile && <p className="file-name">📄 {originalFile.name}</p>}

                    <button
                        className="btn btn-accent"
                        onClick={handleOptimize}
                        disabled={!modelBuffer || isBusy}
                    >
                        {isBusy ? '⏳ Working…' : '⚙️ Optimize Geometry'}
                    </button>

                    {optimizationStatus === 'success' && (
                        <button className="btn btn-success" onClick={handleDownload}>
                            ⬇️ Download Optimized STL
                        </button>
                    )}

                    {statusMsg && (
                        <p
                            className={`status-msg ${optimizationStatus === 'error' ? 'status-error' : ''}`}
                        >
                            {statusMsg}
                        </p>
                    )}

                    <div className="sr-hints">
                        <h4>Viewer controls</h4>
                        <ul>
                            <li>🖱️ Left drag — rotate</li>
                            <li>🖱️ Right drag — pan</li>
                            <li>🖱️ Scroll — zoom</li>
                        </ul>
                    </div>
                </aside>
            </div>
        </main>
    );
};

export default SupportOptimizerPage;
