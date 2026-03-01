import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import STLViewer from '../components/STLViewer';
import useAppStore from '../store/useAppStore';
import { uploadSTL, saveOptimizationRecord } from '../firebase/storageService';
import './SupportReductionPage.css';

/**
 * Simulates geometry optimization by returning a modified copy of the
 * original buffer.  In a real implementation this would call a
 * server-side algorithm or WASM module.
 *
 * The current placeholder simply returns the same buffer so we can
 * exercise the full upload/download flow without a real algorithm.
 */
const simulateOptimization = (buffer) =>
  new Promise((resolve) => {
    setTimeout(() => resolve(buffer.slice(0)), 1200);
  });

const SupportReductionPage = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const user = useAppStore((s) => s.user);
  const modelBuffer = useAppStore((s) => s.modelBuffer);
  const optimizedBuffer = useAppStore((s) => s.optimizedBuffer);
  const setModelBuffer = useAppStore((s) => s.setModelBuffer);
  const setOptimizedBuffer = useAppStore((s) => s.setOptimizedBuffer);
  const clearModel = useAppStore((s) => s.clearModel);
  const optimizationStatus = useAppStore((s) => s.optimizationStatus);
  const setOptimizationStatus = useAppStore((s) => s.setOptimizationStatus);

  const [originalFile, setOriginalFile] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');

  // ── File upload ────────────────────────────────────────────────────────────
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    clearModel();
    setOptimizationStatus('idle');
    setStatusMsg('');
    setOriginalFile(file);

    const reader = new FileReader();
    reader.onload = (evt) => setModelBuffer(evt.target.result);
    reader.readAsArrayBuffer(file);
  };

  // ── Optimization ───────────────────────────────────────────────────────────
  const handleOptimize = async () => {
    if (!modelBuffer) return;
    setOptimizationStatus('loading');
    setStatusMsg('Optimizing geometry…');

    try {
      const result = await simulateOptimization(modelBuffer);
      setOptimizedBuffer(result);
      setOptimizationStatus('success');
      setStatusMsg('Optimization complete!');

      // Persist to Firebase if user is logged in
      if (user && originalFile) {
        const optimizedFile = new File(
          [result],
          `optimized_${originalFile.name}`,
          { type: 'application/octet-stream' }
        );
        const [originalURL, optimizedURL] = await Promise.all([
          uploadSTL(user.uid, originalFile, 'original'),
          uploadSTL(user.uid, optimizedFile, 'optimized'),
        ]);
        await saveOptimizationRecord({
          userId: user.uid,
          originalFileURL: originalURL,
          optimizedFileURL: optimizedURL,
        });
      }
    } catch (err) {
      console.error(err);
      setOptimizationStatus('error');
      setStatusMsg('Optimization failed. Please try again.');
    }
  };

  // ── Download ───────────────────────────────────────────────────────────────
  const handleDownload = () => {
    if (!optimizedBuffer) return;
    const blob = new Blob([optimizedBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = originalFile
      ? `optimized_${originalFile.name}`
      : 'optimized.stl';
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeBuffer = optimizedBuffer ?? modelBuffer;

  return (
    <>
      <Navbar />
      <main className="sr-page">
        <div className="sr-header">
          <button className="btn btn-outline btn-sm" onClick={() => navigate('/')}>
            ← Back
          </button>
          <h2>Support Reduction Optimizer</h2>
        </div>

        <div className="sr-layout">
          {/* ── Viewer ── */}
          <div className="sr-viewer">
            {activeBuffer ? (
              <STLViewer buffer={activeBuffer} />
            ) : (
              <div className="sr-viewer-placeholder">
                <span>🗂️</span>
                <p>Upload an STL file to preview it here</p>
              </div>
            )}
          </div>

          {/* ── Controls ── */}
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

            {originalFile && (
              <p className="file-name">📄 {originalFile.name}</p>
            )}

            <button
              className="btn btn-accent"
              onClick={handleOptimize}
              disabled={!modelBuffer || optimizationStatus === 'loading'}
            >
              {optimizationStatus === 'loading'
                ? '⏳ Optimizing…'
                : '⚙️ Optimize Geometry'}
            </button>

            {optimizationStatus === 'success' && (
              <button className="btn btn-success" onClick={handleDownload}>
                ⬇️ Download Optimized STL
              </button>
            )}

            {statusMsg && (
              <p
                className={`status-msg ${
                  optimizationStatus === 'error' ? 'status-error' : ''
                }`}
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
    </>
  );
};

export default SupportReductionPage;
