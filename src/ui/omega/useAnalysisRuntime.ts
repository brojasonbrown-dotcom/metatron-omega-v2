import { useSyncExternalStore } from 'react';
import { getAnalysisRuntime, type AnalysisState } from './analysisRuntime';

/** Live analysis state. SSR reads the same inert snapshot the runtime starts with. */
export function useAnalysisState(): AnalysisState {
  const rt = getAnalysisRuntime();
  return useSyncExternalStore(rt.subscribe, rt.getSnapshot, rt.getSnapshot);
}
