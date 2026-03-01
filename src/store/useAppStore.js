import { create } from 'zustand';

const useAppStore = create((set) => ({
  // ── Auth ──────────────────────────────────────────────
  user: null,
  setUser: (user) => set({ user }),

  // ── 3D Model ─────────────────────────────────────────
  /** Raw ArrayBuffer of the currently loaded STL */
  modelBuffer: null,
  /** Raw ArrayBuffer of the optimized STL */
  optimizedBuffer: null,
  setModelBuffer: (buffer) => set({ modelBuffer: buffer }),
  setOptimizedBuffer: (buffer) => set({ optimizedBuffer: buffer }),
  clearModel: () => set({ modelBuffer: null, optimizedBuffer: null }),

  // ── Optimization state ────────────────────────────────
  /** 'idle' | 'loading' | 'success' | 'error' */
  optimizationStatus: 'idle',
  setOptimizationStatus: (status) => set({ optimizationStatus: status }),
}));

export default useAppStore;
