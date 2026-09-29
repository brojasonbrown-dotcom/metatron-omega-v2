/**
 * SensoryAtom — one content-addressed sensory percept.
 *
 * Stored in SensoryGateway. The same audio/video/IMU frame (within
 * SimHash bucketing) maps to the same atom, so identical input is
 * reinforced (`reinforcements++`) instead of re-stored.
 *
 * Hash is a 16-char lowercase hex string (see SimHashPhi). We use a
 * string instead of bigint because Map<string> is ~10–50× faster.
 */

export type SensoryModality = 'audio' | 'video' | 'imu' | 'synthetic' | 'vision-embed';

export interface SensoryAtom {
  hash: string;
  modality: SensoryModality;
  firstSeen: number;
  lastSeen: number;
  reinforcements: number;
  /** Compact feature signature (top-K projection indices + amplitudes). */
  topIndices: Int32Array;
  topAmps: Float32Array;
  /** Energy ‖x‖² for ΔΨ amplitude scaling. */
  energy: number;
}

const BYTES_PER_ATOM_HEADER = 56; // hash (16 utf-16 chars = 32B) + scalars
export function atomBytes(topK: number): number {
  return BYTES_PER_ATOM_HEADER + 8 * topK;
}
