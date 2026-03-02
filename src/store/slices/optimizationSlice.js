export const createOptimizationSlice = (set) => ({
    /** @type {string | null} */
    originalFileURL: null,
    /** @type {string | null} */
    optimizedFileURL: null,
    setOriginalFileURL: (originalFileURL) =>
        set({ originalFileURL }, false, 'optimization/setOriginalFileURL'),
    setOptimizedFileURL: (optimizedFileURL) =>
        set({ optimizedFileURL }, false, 'optimization/setOptimizedFileURL'),

    /** @type {'idle' | 'loading' | 'success' | 'error'} */
    optimizationStatus: 'idle',
    setOptimizationStatus: (optimizationStatus) =>
        set(
            { optimizationStatus },
            false,
            'optimization/setOptimizationStatus'
        ),
});
