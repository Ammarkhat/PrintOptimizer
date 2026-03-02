export const createModelSlice = (set) => ({
    /** @type {import('three').Mesh | null} */
    currentModel: null,
    setCurrentModel: (currentModel) =>
        set({ currentModel }, false, 'model/setCurrentModel'),

    /** @type {import('three').BufferGeometry | null} */
    currentGeometry: null,
    setCurrentGeometry: (currentGeometry) =>
        set(
            (state) => {
                if (
                    state.currentGeometry &&
                    state.currentGeometry !== currentGeometry
                ) {
                    state.currentGeometry.dispose();
                }
                return { currentGeometry };
            },
            false,
            'model/setCurrentGeometry'
        ),

    /** Raw ArrayBuffer of the currently loaded STL */
    modelBuffer: null,
    /** Raw ArrayBuffer of the optimized STL */
    optimizedBuffer: null,
    setModelBuffer: (modelBuffer) =>
        set({ modelBuffer }, false, 'model/setModelBuffer'),
    setOptimizedBuffer: (optimizedBuffer) =>
        set({ optimizedBuffer }, false, 'model/setOptimizedBuffer'),
    clearModel: () =>
        set(
            (state) => {
                if (state.currentGeometry) {
                    state.currentGeometry.dispose();
                }
                return {
                    currentModel: null,
                    currentGeometry: null,
                    modelBuffer: null,
                    optimizedBuffer: null,
                };
            },
            false,
            'model/clearModel'
        ),
});
