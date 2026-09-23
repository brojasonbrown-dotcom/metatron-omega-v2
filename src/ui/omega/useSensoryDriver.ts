/**
 * useSensoryState — external-store binding for the Layer A sensory driver.
 *
 * The driver publishes a new snapshot only on a channel state change or an
 * explicit refresh, so panels re-render on sensory *events*, never at the
 * 233–377 Hz ingest rate. The 2 Hz refresh below exists purely to keep the
 * atom counters moving; it is a poll of already-computed gateway stats.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { getSensoryDriver, type SensorySnapshot } from './sensoryDriver';

export function useSensoryState(): SensorySnapshot {
  const driver = getSensoryDriver();
  const snap = useSyncExternalStore(driver.subscribe, driver.getSnapshot, driver.getSnapshot);
  useEffect(() => {
    const id = window.setInterval(() => driver.refresh(), 500);
    return () => window.clearInterval(id);
  }, [driver]);
  return snap;
}
