import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import ThreeViewer from '../components/ThreeViewer';
import { remeshAndSmoothGeometry } from '../optimization/remeshAndSmooth';
import { fakeReverseEngineer } from '../optimization/reverseEngineering';
import './ReverseEngineeringPage.css';

/** Serialises a BufferGeometry to a binary little-endian PLY ArrayBuffer. */
const geometryToPLY = (geometry) => {
    const geo = geometry.clone();
    geo.computeVertexNormals();

    const position = geo.getAttribute('position');
    const normal = geo.getAttribute('normal');
    const index = geo.getIndex();
    const vertexCount = position?.count ?? 0;
    const faceCount = index ? Math.floor(index.count / 3) : Math.floor(vertexCount / 3);

    const header = [
        'ply',
        'format binary_little_endian 1.0',
        'comment Exported from PrintOptimizer',
        `element vertex ${vertexCount}`,
        'property float x',
        'property float y',
        'property float z',
        'property float nx',
        'property float ny',
        'property float nz',
        `element face ${faceCount}`,
        'property list uchar uint vertex_indices',
        'end_header',
    ];

    const encoder = new TextEncoder();
    const headerBytes = encoder.encode(`${header.join('\n')}\n`);
    const vertexStride = 24;
    const faceStride = 13;
    const buffer = new ArrayBuffer(headerBytes.length + vertexCount * vertexStride + faceCount * faceStride);
    const uint8 = new Uint8Array(buffer);
    const view = new DataView(buffer);

    uint8.set(headerBytes, 0);

    let offset = headerBytes.length;

    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
        view.setFloat32(offset, position.getX(vertexIndex), true);
        offset += 4;
        view.setFloat32(offset, position.getY(vertexIndex), true);
        offset += 4;
        view.setFloat32(offset, position.getZ(vertexIndex), true);
        offset += 4;
        view.setFloat32(offset, normal?.getX(vertexIndex) ?? 0, true);
        offset += 4;
        view.setFloat32(offset, normal?.getY(vertexIndex) ?? 0, true);
        offset += 4;
        view.setFloat32(offset, normal?.getZ(vertexIndex) ?? 0, true);
        offset += 4;
    }

    for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
        const base = faceIndex * 3;
        const a = index ? index.getX(base) : base;
        const b = index ? index.getX(base + 1) : base + 1;
        const c = index ? index.getX(base + 2) : base + 2;

        view.setUint8(offset, 3);
        offset += 1;
        view.setUint32(offset, a, true);
        offset += 4;
        view.setUint32(offset, b, true);
        offset += 4;
        view.setUint32(offset, c, true);
        offset += 4;
    }

    return buffer;
};

const ReverseEngineeringPage = () => {
    const navigate = useNavigate();
    const fileInputRef = useRef(null);

    const [originalFile, setOriginalFile] = useState(null);
    const [currentGeometry, setCurrentGeometry] = useState(null);
    const [geometryHistory, setGeometryHistory] = useState([]);
    const [statusMsg, setStatusMsg] = useState('');
    const [statusTone, setStatusTone] = useState('info');
    const [analysis, setAnalysis] = useState(null);
    const [isLoadingFile, setIsLoadingFile] = useState(false);
    const [isPreprocessing, setIsPreprocessing] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [remeshStats, setRemeshStats] = useState(null);
    const [remeshProgressPct, setRemeshProgressPct] = useState(null);
    const [remeshProgressStage, setRemeshProgressStage] = useState('');
    const [showWireframe, setShowWireframe] = useState(false);
    // Track which action is in progress: null | 'undo' | 'wireframe'
    const [inProgressAction, setInProgressAction] = useState(null);

    const updateStatus = (message, tone = 'info') => {
        setStatusMsg(message);
        setStatusTone(tone);
    };

    // Push previous geometry to history before replacing
    const replaceGeometry = (nextGeometry, { pushHistory = false } = {}) => {
        setCurrentGeometry((previousGeometry) => {
            if (previousGeometry && previousGeometry !== nextGeometry) {
                if (pushHistory) {
                    setGeometryHistory((history) => [previousGeometry.clone(), ...history]);
                } else {
                    previousGeometry.dispose();
                }
            }
            return nextGeometry;
        });
    };

    // Undo: restore previous geometry from history
    const handleUndo = async () => {
        setInProgressAction('undo');
        await new Promise((resolve) => setTimeout(resolve, 10)); // allow spinner to show
        setGeometryHistory((history) => {
            if (history.length === 0) return history;
            const [prev, ...rest] = history;
            setCurrentGeometry((current) => {
                if (current) current.dispose();
                return prev;
            });
            return rest;
        });
        setRemeshStats(null);
        setAnalysis(null);
        updateStatus('Undid last operation.', 'info');
        setInProgressAction(null);
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
            updateStatus('Please select an .stl or .ply file.', 'error');
            return;
        }

        setOriginalFile(file);
        setAnalysis(null);
        setRemeshStats(null);
        setShowWireframe(false);
        updateStatus('Loading model…', 'info');
        setIsLoadingFile(true);

        try {
            const arrayBuffer = await file.arrayBuffer();
            const parsedGeometry = parseGeometry(arrayBuffer, extension);
            const geometry = placeGeometryOnBed(parsedGeometry);
            replaceGeometry(geometry);
            updateStatus('Model loaded. Ready to remesh, smooth, or reverse engineer.', 'success');
        } catch (error) {
            console.error(error);
            replaceGeometry(null);
            updateStatus('Failed to load model. Please try another file.', 'error');
        } finally {
            setIsLoadingFile(false);
            event.target.value = '';
        }
    };

    const handleRemeshAndSmooth = async () => {
        if (!currentGeometry || isPreprocessing) return;

        setAnalysis(null);
        setRemeshProgressPct(0);
        setRemeshProgressStage('Preparing…');
        setIsPreprocessing(true);
        updateStatus('Remeshing and smoothing model…', 'info');

        try {
            await waitForNextPaint();

            let lastReportedPct = -1;
            const result = await remeshAndSmoothGeometry(currentGeometry, {
                onProgress: ({ stage, progress }) => {
                    if (stage === 'preparing') {
                        setRemeshProgressStage('Preparing input…');
                        setRemeshProgressPct(0);
                        lastReportedPct = 0;
                        return true;
                    }

                    if (stage === 'native') {
                        const normalized = Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0;
                        const nextPct = Math.round(5 + normalized * 87);

                        if (nextPct >= lastReportedPct + 2 || nextPct === 92 || nextPct === 5) {
                            lastReportedPct = nextPct;
                            setRemeshProgressPct(nextPct);
                        }

                        setRemeshProgressStage('Native remeshing…');
                        return true;
                    }

                    if (stage === 'fallback') {
                        setRemeshProgressStage('Fallback remeshing…');
                        setRemeshProgressPct(null);
                        return true;
                    }

                    if (stage === 'done') {
                        setRemeshProgressStage('Applying remesh result…');
                        setRemeshProgressPct(94);
                        return true;
                    }

                    return true;
                },
            });

            setRemeshProgressStage('Preparing final geometry…');
            setRemeshProgressPct(96);
            await waitForNextPaint();

            const geometry = placeGeometryOnBed(result.geometry);

            setRemeshProgressStage('Updating viewer…');
            setRemeshProgressPct(98);
            await waitForNextPaint();

            replaceGeometry(geometry, { pushHistory: true });
            setRemeshStats(result.stats);

            setRemeshProgressStage('Complete');
            setRemeshProgressPct(100);
            await waitForNextPaint();

            updateStatus('Mesh pre-processing complete.', 'success');
        } catch (error) {
            console.error(error);
            updateStatus('Remesh and smooth failed. Please try again.', 'error');
        } finally {
            setRemeshProgressPct(null);
            setRemeshProgressStage('');
            setIsPreprocessing(false);
        }
    };

    const handleReverseEngineer = async () => {
        if (!currentGeometry || isAnalyzing) return;

        setIsAnalyzing(true);
        updateStatus('Analyzing geometry…', 'info');

        try {
            const result = await fakeReverseEngineer();
            setAnalysis(result);
            updateStatus('Reverse engineering complete.', 'success');
        } catch (error) {
            console.error(error);
            updateStatus('Reverse engineering failed. Please try again.', 'error');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const isBusy = isLoadingFile || isPreprocessing || isAnalyzing;

    const handleDownloadPLY = () => {
        if (!currentGeometry) return;
        const plyBuffer = geometryToPLY(currentGeometry);
        const blob = new Blob([plyBuffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const stem = originalFile ? originalFile.name.replace(/\.[^.]+$/, '') : 'model';
        const a = document.createElement('a');
        a.href = url;
        a.download = `${stem}_processed.ply`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const waitForNextPaint = () =>
        new Promise((resolve) => {
            requestAnimationFrame(() => {
                requestAnimationFrame(resolve);
            });
        });

    // Handle wireframe toggle with spinner for large meshes.
    // We wait for paint first so the spinner is visible before heavy wireframe work starts.
    const handleWireframeToggle = async (event) => {
        const nextChecked = event.target.checked;
        if (!currentGeometry || isBusy || inProgressAction === 'wireframe') return;

        setInProgressAction('wireframe');
        await waitForNextPaint();

        setShowWireframe(nextChecked);

        await waitForNextPaint();
        setInProgressAction(null);
    };

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
                        <ThreeViewer geometry={currentGeometry} showWireframe={showWireframe} />
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

                    <label className="re-toggle" htmlFor="toggle-wireframe">
                        <input
                            id="toggle-wireframe"
                            type="checkbox"
                            checked={showWireframe}
                            onChange={handleWireframeToggle}
                            disabled={!currentGeometry || isBusy || inProgressAction === 'wireframe'}
                        />
                        <span>
                            Show Wireframe
                            {inProgressAction === 'wireframe' && (
                                <span className="inline-spinner" style={{ marginLeft: 6 }} aria-hidden="true" />
                            )}
                        </span>
                    </label>


                    <button
                        className="btn btn-outline"
                        onClick={handleRemeshAndSmooth}
                        disabled={!currentGeometry || isBusy}
                    >
                        {isPreprocessing ? (
                            <>
                                <span className="inline-spinner" aria-hidden="true" />
                                <span>Remeshing…</span>
                            </>
                        ) : '🧼 Remesh and Smooth'}
                    </button>

                    <button
                        className="btn btn-secondary"
                        onClick={handleUndo}
                        disabled={geometryHistory.length === 0 || isBusy || inProgressAction === 'undo'}
                        style={{ marginBottom: '0.5rem', position: 'relative' }}
                    >
                        {inProgressAction === 'undo' ? (
                            <>
                                <span className="inline-spinner" aria-hidden="true" style={{ marginRight: 6 }} />
                                Undoing…
                            </>
                        ) : (
                            '↩ Undo'
                        )}
                    </button>

                    <button
                        className="btn btn-accent"
                        onClick={handleReverseEngineer}
                        disabled={!currentGeometry || isBusy}
                    >
                        {isAnalyzing ? '⏳ Working…' : '🧩 Reverse Engineer'}
                    </button>

                    <button
                        className="btn btn-download"
                        onClick={handleDownloadPLY}
                        disabled={!currentGeometry || isBusy}
                    >
                        ⬇ Download PLY
                    </button>

                    {statusMsg && (
                        <p className={`status-msg status-${statusTone}`}>
                            {isPreprocessing && <span className="inline-spinner status-spinner" aria-hidden="true" />}
                            <span>{statusMsg}</span>
                        </p>
                    )}

                    {isPreprocessing && (
                        <div className="remesh-progress" role="status" aria-live="polite">
                            <div className="remesh-progress-header">
                                <span>Progress</span>
                                <span>{remeshProgressPct !== null ? `${remeshProgressPct}%` : 'Working…'}</span>
                            </div>
                            <div className="remesh-progress-track" aria-hidden="true">
                                <div
                                    className="remesh-progress-fill"
                                    style={{ width: `${remeshProgressPct !== null ? remeshProgressPct : 100}%` }}
                                />
                            </div>
                            {remeshProgressStage && <div className="remesh-progress-stage">{remeshProgressStage}</div>}
                        </div>
                    )}

                    {remeshStats && (
                        <div className="re-stats">
                            <h4>Remesh Stats</h4>
                            <ul>
                                <li className="remesh-stat-row">
                                    <span className="remesh-stat-label">Vertices</span>
                                    <span className="remesh-stat-before">{remeshStats.before.vertices.toLocaleString()}</span>
                                    <span className="remesh-stat-arrow">→</span>
                                    <span className="remesh-stat-after">{remeshStats.after.vertices.toLocaleString()}</span>
                                </li>
                                <li className="remesh-stat-row">
                                    <span className="remesh-stat-label">Faces</span>
                                    <span className="remesh-stat-before">{remeshStats.before.faces.toLocaleString()}</span>
                                    <span className="remesh-stat-arrow">→</span>
                                    <span className="remesh-stat-after">{remeshStats.after.faces.toLocaleString()}</span>
                                </li>
                                <li className="remesh-stat-row">
                                    <span className="remesh-stat-label">Avg edge</span>
                                    <span className="remesh-stat-before">{remeshStats.before.avgEdgeLength.toFixed(3)}</span>
                                    <span className="remesh-stat-arrow">→</span>
                                    <span className="remesh-stat-after">{remeshStats.after.avgEdgeLength.toFixed(3)}</span>
                                </li>
                                <li className="remesh-stat-row remesh-stat-target">
                                    <span className="remesh-stat-label">Target edge</span>
                                    <span className="remesh-stat-target-val">{remeshStats.targetEdgeLength.toFixed(3)}</span>
                                </li>
                                {remeshStats.tessellationMaxEdgeLength && (
                                    <li className="remesh-stat-row remesh-stat-target">
                                        <span className="remesh-stat-label">Split threshold</span>
                                        <span className="remesh-stat-target-val">{remeshStats.tessellationMaxEdgeLength.toFixed(3)}</span>
                                    </li>
                                )}
                            </ul>
                        </div>
                    )}

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
