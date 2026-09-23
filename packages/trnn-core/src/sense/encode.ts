/**
 * Ω-P6 — sensory encoders.
 *
 * Every encoder maps raw modality data onto a torus field of `nodes` complex
 * cells and obeys one hard law (BRAINMAP 6.2):
 *
 *   ‖v‖_inf ≤ φ            — the injection bound
 *
 * The bound is enforced by *scaling down only*. An encoder never inflates a
 * weak signal to reach the bound: a quiet input stays quiet, so the cell's
 * ξ-term contribution is proportional to real sensory energy rather than to a
 * normalisation artefact.
 *
 * Determinism (Law L2): no RNG, no clock. Text hashing runs through the same
 * SplitMix64 stream used by the seed path, so an identical string always
 * produces an identical field on every machine.
 */

import { PHI, PHI_INV } from '../core/constants';
import { createField, maxNorm, scaleField, type CField } from '../core/complex';
import { SeedStream } from '../core/determinism';
import { dcos, dsin } from '../core/dmath';

/** [DEFINED] hard injection bound on any sensory field (Law: |v| ≤ φ). */
export const SENSE_BOUND = PHI;

export type Modality = 'scalar' | 'text' | 'grid' | 'audio';

export interface EncodeReport {
  readonly modality: Modality;
  readonly nodes: number;
  /** Max-norm before the bound was applied. */
  readonly rawPeak: number;
  /** Max-norm after the bound. */
  readonly peak: number;
  /** Scale factor applied (1 when the raw field was already inside the bound). */
  readonly scale: number;
  /** Σ|v_i|² of the bounded field. */
  readonly energy: number;
  /** Elements that carry any amplitude at all. */
  readonly support: number;
}

/**
 * Clamp a field into the injection bound by uniform down-scaling.
 * Shape preserving: relative amplitudes and all phases survive exactly.
 */
export function boundField(f: CField, bound = SENSE_BOUND): { rawPeak: number; peak: number; scale: number } {
  const rawPeak = maxNorm(f);
  if (!(rawPeak > bound)) return { rawPeak, peak: rawPeak, scale: 1 };
  const scale = bound / rawPeak;
  scaleField(f, scale);
  return { rawPeak, peak: bound, scale };
}

function finishReport(modality: Modality, f: CField, b: { rawPeak: number; peak: number; scale: number }): EncodeReport {
  let energy = 0;
  let support = 0;
  for (let i = 0; i < f.n; i++) {
    const e = f.re[i] * f.re[i] + f.im[i] * f.im[i];
    energy += e;
    if (e > 0) support++;
  }
  return { modality, nodes: f.n, rawPeak: b.rawPeak, peak: b.peak, scale: b.scale, energy, support };
}

/**
 * Deterministic two-draw hash for a text token, memoised.
 *
 * SplitMix64 through the shared Digest gives the same pair on every engine;
 * the cache keeps a long passage O(1) per repeated (codepoint, slot) pair
 * instead of rebuilding the stream for every character.
 */
const TOKEN_CACHE = new Map<number, readonly [number, number]>();
function tokenDraw(codePoint: number, slot: number): readonly [number, number] {
  const key = codePoint * 16 + slot;
  const hit = TOKEN_CACHE.get(key);
  if (hit) return hit;
  const rng = new SeedStream(`t:${codePoint}:${slot}`);
  const pair = [rng.next(), rng.next()] as const;
  if (TOKEN_CACHE.size < 65536) TOKEN_CACHE.set(key, pair);
  return pair;
}

/** Golden-angle phase for node i — the same phyllotaxis the seed path uses. */
export function goldenPhase(i: number): number {
  return 2 * Math.PI * ((i * PHI_INV) % 1);
}

/**
 * Scalar series → field.
 *
 * The series is resampled onto the node ring by circular linear interpolation
 * (a series shorter than the ring is interpolated, a longer one is decimated
 * with area weights so no sample is silently dropped), then each node is given
 * the golden-angle phase. Amplitude is the raw sample value: callers that want
 * a normalised channel scale their input, not the encoder.
 */
export function encodeScalars(values: ArrayLike<number>, out: CField): EncodeReport {
  const n = out.n;
  const L = values.length;
  if (L === 0) {
    out.re.fill(0);
    out.im.fill(0);
    return finishReport('scalar', out, { rawPeak: 0, peak: 0, scale: 1 });
  }
  const step = L / n;
  for (let k = 0; k < n; k++) {
    let a: number;
    if (step <= 1) {
      // upsample — circular linear interpolation
      const x = k * step;
      const i0 = Math.floor(x);
      const t = x - i0;
      const v0 = values[i0 % L] ?? 0;
      const v1 = values[(i0 + 1) % L] ?? 0;
      a = v0 * (1 - t) + v1 * t;
    } else {
      // downsample — area-weighted mean over the arc
      const lo = k * step;
      const hi = lo + step;
      let acc = 0;
      let w = 0;
      for (let i = Math.floor(lo); i < Math.ceil(hi); i++) {
        const wgt = Math.min(hi, i + 1) - Math.max(lo, i);
        if (wgt <= 0) continue;
        acc += wgt * (values[((i % L) + L) % L] ?? 0);
        w += wgt;
      }
      a = w > 0 ? acc / w : 0;
    }
    if (!Number.isFinite(a)) a = 0;
    const th = goldenPhase(k);
    out.re[k] = a * dcos(th);
    out.im[k] = a * dsin(th);
  }
  return finishReport('scalar', out, boundField(out));
}

/**
 * Text → field (distributed trigram code).
 *
 * A one-node-per-character code is far too sparse to survive dropout: a short
 * string touches a handful of nodes and losing a few of them erases identity.
 * So each position contributes a *rolling trigram* token — the previous two
 * codepoints folded with the current one — spread over three nodes with
 * weights (1, φ⁻¹, φ⁻²).
 *
 * Two consequences, both wanted:
 *   • support grows to ≈3·len nodes, so 40% node dropout still leaves a cue
 *     whose cosine against its own pattern dominates every neighbour;
 *   • the trigram makes the code order sensitive at the sub-word level, so
 *     "ab" and "ba" separate while a shared prefix still reinforces.
 *
 * The φ-comb weights are the same ladder the rest of the engine uses, so a
 * partially-corrupted token degrades smoothly rather than flipping.
 */
export function encodeText(text: string, out: CField): EncodeReport {
  const n = out.n;
  out.re.fill(0);
  out.im.fill(0);
  const cps = Array.from(text);
  if (cps.length === 0) return finishReport('text', out, { rawPeak: 0, peak: 0, scale: 1 });
  const combWeights = [1, PHI_INV, PHI_INV * PHI_INV];
  let prev1 = 0;
  let prev2 = 0;
  for (let p = 0; p < cps.length; p++) {
    const cp = cps[p].codePointAt(0) ?? 0;
    // rolling trigram token, folded into a single integer
    const token = ((cp * 131071 + prev1 * 8191 + prev2 * 127) >>> 0) % 2147483647;
    prev2 = prev1;
    prev1 = cp;
    for (let c = 0; c < 3; c++) {
      const [u0, u1] = tokenDraw(token, c);
      const idx = Math.min(n - 1, Math.floor(u0 * n));
      const th = 2 * Math.PI * u1 + goldenPhase(p);
      out.re[idx] += combWeights[c] * dcos(th);
      out.im[idx] += combWeights[c] * dsin(th);
    }
  }
  const k = 1 / Math.sqrt(cps.length);
  scaleField(out, k);
  return finishReport('text', out, boundField(out));
}

/**
 * 2-D grid (image / spectrogram tile) → field.
 *
 * Pixel (x, y) lands on node ⌊(x·φ⁻¹ + y·φ⁻²)·n⌋ mod n — a two-axis golden
 * mapping whose discrepancy is the Hurwitz optimum, so neighbouring pixels
 * spread across the ring instead of piling into one arc. Amplitude is the mean
 * of the pixels that share a node; phase encodes the pixel's position, which is
 * what lets the braid distinguish two images with identical histograms.
 */
export function encodeGrid(data: ArrayLike<number>, width: number, height: number, out: CField): EncodeReport {
  const n = out.n;
  out.re.fill(0);
  out.im.fill(0);
  if (width <= 0 || height <= 0 || data.length === 0) {
    return finishReport('grid', out, { rawPeak: 0, peak: 0, scale: 1 });
  }
  const counts = new Float64Array(n);
  const phi2 = PHI_INV * PHI_INV;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = data[y * width + x] ?? 0;
      if (!Number.isFinite(v)) continue;
      const u = (x * PHI_INV + y * phi2) % 1;
      const idx = Math.min(n - 1, Math.floor(u * n));
      const th = 2 * Math.PI * (((x / width) * PHI_INV + (y / height) * phi2) % 1);
      out.re[idx] += v * dcos(th);
      out.im[idx] += v * dsin(th);
      counts[idx] += 1;
    }
  }
  for (let i = 0; i < n; i++) {
    if (counts[i] > 0) {
      out.re[i] /= counts[i];
      out.im[i] /= counts[i];
    }
  }
  return finishReport('grid', out, boundField(out));
}

/**
 * Audio frame → field.
 *
 * A real PCM frame is first folded into `nodes` phase bins by the same circular
 * area weighting as `encodeScalars`, but the phase carries the *sign pattern*
 * of the waveform (the analytic-signal stand-in): amplitude from |x|, phase
 * advanced by the golden angle per zero crossing. This keeps the encoder O(L)
 * with no FFT while still separating two frames of equal RMS but different
 * pitch.
 */
export function encodeAudio(pcm: ArrayLike<number>, out: CField): EncodeReport {
  const n = out.n;
  const L = pcm.length;
  out.re.fill(0);
  out.im.fill(0);
  if (L === 0) return finishReport('audio', out, { rawPeak: 0, peak: 0, scale: 1 });
  const step = L / n;
  let crossings = 0;
  let prev = pcm[0] ?? 0;
  for (let k = 0; k < n; k++) {
    const lo = k * step;
    const hi = lo + step;
    let acc = 0;
    let w = 0;
    for (let i = Math.floor(lo); i < Math.max(Math.floor(lo) + 1, Math.ceil(hi)); i++) {
      const wgt = Math.max(0, Math.min(hi, i + 1) - Math.max(lo, i)) || (step < 1 ? 1 : 0);
      const s = pcm[((i % L) + L) % L] ?? 0;
      if (prev < 0 !== s < 0) crossings++;
      prev = s;
      acc += wgt * Math.abs(s);
      w += wgt;
    }
    const a = w > 0 ? acc / w : 0;
    const th = goldenPhase(crossings) + goldenPhase(k);
    out.re[k] = a * dcos(th);
    out.im[k] = a * dsin(th);
  }
  return finishReport('audio', out, boundField(out));
}

/** Allocate a field sized for an encoder target. */
export function senseField(nodes: number): CField {
  return createField(nodes);
}
