/**
 * Shared sovereign governor singleton. The fallback engine and the UI
 * panels both read/write the same instance so changing RAM/CPU/precision
 * from the panel immediately rebuilds the field.
 */
import { probeHardware, type HardwareEnvelope } from './HardwareEnvelope';
import { ResourceGovernor } from './ResourceGovernor';

let cached: { hw: HardwareEnvelope; gov: ResourceGovernor } | null = null;
let pending: Promise<{ hw: HardwareEnvelope; gov: ResourceGovernor }> | null = null;

export async function getGovernor(): Promise<{ hw: HardwareEnvelope; gov: ResourceGovernor }> {
  if (cached) return cached;
  if (!pending) {
    pending = probeHardware().then((hw) => {
      cached = { hw, gov: new ResourceGovernor(hw) };
      return cached;
    });
  }
  return pending;
}

export function getGovernorSync(): { hw: HardwareEnvelope; gov: ResourceGovernor } | null {
  return cached;
}
