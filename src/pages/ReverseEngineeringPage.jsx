import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import ThreeViewer from '../components/ThreeViewer';
import { fakeReverseEngineer } from '../optimization/reverseEngineering';
import './ReverseEngineeringPage.css';

const ReverseEngineeringPage = () => {
    const navigate = useNavigate();
    const fileInputRef = useRef(null);

    const [originalFile, setOriginalFile] = useState(null);
    const [currentGeometry, setCurrentGeometry] = useState(null);
    const [statusMsg, setStatusMsg] = useState('');
    const [analysis, setAnalysis] = useState(null);
    const [isLoadingFile, setIsLoadingFile] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const replaceGeometry = (nextGeometry) => {
        setCurrentGeometry((previousGeometry) => {
            if (previousGeometry && previousGeometry !== nextGeometry) {
                previousGeometry.dispose();
            }
            return nextGeometry;
        });
    };

    useEffect(() => {
        return () => {
            setCurrentGeometry((geometry) => {
                if (geometry) {
                    geometry.dispose();
                }
                return null;
            });
        };
    }, []);

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
        geometry.computeVertexNormals();
        return geometry;
    };

    const parseGeometry = (arrayBuffer, extension) => {
        if (extension === 'stl') {
            const loader = new STLLoader();
            return loader.parse(arrayBuffer);
        }

        const loader = new PLYLoader();
        return loader.parse(arrayBuffer);
    };

    const handleFileChange = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const extension = file.name.toLowerCase().split('.').pop();
        if (extension !== 'stl' && extension !== 'ply') {
            setStatusMsg('Please select an .stl or .ply file.');
            return;
        }

        setOriginalFile(file);
        setAnalysis(null);
        setStatusMsg('Loading model…');
        setIsLoadingFile(true);

        try {
            const arrayBuffer = await file.arrayBuffer();
            const parsedGeometry = parseGeometry(arrayBuffer, extension);
            const geometry = placeGeometryOnBed(parsedGeometry);
            replaceGeometry(geometry);
            setStatusMsg('Model loaded. Ready to reverse engineer.');
        } catch (error) {
            console.error(error);
            replaceGeometry(null);
            setStatusMsg('Failed to load model. Please try another file.');
        } finally {
            setIsLoadingFile(false);
            event.target.value = '';
        }
    };

    const handleReverseEngineer = async () => {
        if (!currentGeometry || isAnalyzing) return;

        setIsAnalyzing(true);
        setStatusMsg('Analyzing geometry…');

        try {
            const result = await fakeReverseEngineer();
            setAnalysis(result);
            setStatusMsg('Reverse engineering complete.');
        } catch (error) {
            console.error(error);
            setStatusMsg('Reverse engineering failed. Please try again.');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const isBusy = isLoadingFile || isAnalyzing;

    return (
        <main className="re-page">
            <div className="re-header">
                <button className="btn btn-outline btn-sm" onClick={() => navigate('/')}>
                    ← Back
                </button>
                <h2>Reverse Engineering</h2>
            </div>

            <div className="re-layout">
                <div className="re-viewer">
                    {currentGeometry ? (
                        <ThreeViewer geometry={currentGeometry} />
                    ) : (
                        <div className="re-viewer-placeholder">
                            <span>📐</span>
                            <p>Upload an STL or PLY file to preview it here</p>
                        </div>
                    )}
                </div>

                <aside className="re-controls">
                    <h3>Controls</h3>

                    <button
                        className="btn btn-primary"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isBusy}
                    >
                        📂 Upload STL/PLY
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".stl,.ply"
                        style={{ display: 'none' }}
                        onChange={handleFileChange}
                    />

                    {originalFile && <p className="file-name">📄 {originalFile.name}</p>}

                    <button
                        className="btn btn-accent"
                        onClick={handleReverseEngineer}
                        disabled={!currentGeometry || isBusy}
                    >
                        {isAnalyzing ? '⏳ Working…' : '🧩 Reverse Engineer'}
                    </button>

                    {statusMsg && <p className="status-msg">{statusMsg}</p>}

                    {analysis && (
                        <div className="re-stats">
                            <h4>Analysis Stats</h4>
                            <ul>
                                <li>Primitives detected: {analysis.primitivesDetected}</li>
                                <li>Min curvature: {analysis.minCurvature}</li>
                                <li>Max curvature: {analysis.maxCurvature}</li>
                                <li>Average curvature: {analysis.averageCurvature}</li>
                                <li>Avg wall thickness (mm): {analysis.averageWallThicknessMm}</li>
                                <li>Estimated holes: {analysis.estimatedHoleCount}</li>
                                <li>Symmetry axes: {analysis.dominantSymmetryAxes}</li>
                                <li>Confidence score: {analysis.confidenceScore}</li>
                            </ul>
                        </div>
                    )}

                    <div className="re-hints">
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

export default ReverseEngineeringPage;
