import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { createAuthSlice } from './slices/authSlice';
import { createModelSlice } from './slices/modelSlice';
import { createOptimizationSlice } from './slices/optimizationSlice';

const useAppStore = create(
  devtools(
    (set, get, api) => ({
      ...createAuthSlice(set, get, api),
      ...createModelSlice(set, get, api),
      ...createOptimizationSlice(set, get, api),
    }),
    { name: 'PrintOptimizerStore' }
  )
);

export default useAppStore;
