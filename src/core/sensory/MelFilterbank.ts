/**
 * MelFilterbank — precomputed triangular mel filters.
 *
 * Standard HTK-style mel: m = 2595·log10(1 + f/700). Filters are
 * triangular, peak-normalised, with overlapping half-bandwidth so the
 * sum across bands is ~unity for a flat spectrum.
 *
 * Cached by (sampleRate, fftSize, nBands).
 */

export interface MelBank {
  nBands: number;
  fftBins: number;
  /** Sparse per-band weights — index/weight pairs for nonzero bins only. */
  bands: { start: number; weights: Float32Array }[];
}

const cache = new Map<string, MelBank>();

const hzToMel = (f: number) => 2595 * Math.log10(1 + f / 700);
const melToHz = (m: number) => 700 * (Math.pow(10, m / 2595) - 1);

export function getMelBank(sampleRate: number, fftSize: number, nBands = 64, fMin = 50, fMax?: number): MelBank {
  const top = fMax ?? sampleRate / 2;
  const key = `${sampleRate}|${fftSize}|${nBands}|${fMin}|${top}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const fftBins = fftSize / 2;
  const mLo = hzToMel(fMin);
  const mHi = hzToMel(top);
  const points = new Float32Array(nBands + 2);
  for (let i = 0; i < nBands + 2; i++) {
    const m = mLo + ((mHi - mLo) * i) / (nBands + 1);
    const hz = melToHz(m);
    points[i] = (hz / (sampleRate / 2)) * fftBins;
  }
  const bands: MelBank['bands'] = [];
  for (let b = 0; b < nBands; b++) {
    const l = points[b], c = points[b + 1], r = points[b + 2];
    const start = Math.max(0, Math.floor(l));
    const end = Math.min(fftBins - 1, Math.ceil(r));
    const w = new Float32Array(Math.max(1, end - start + 1));
    for (let k = start; k <= end; k++) {
      const x = k;
      let v = 0;
      if (x >= l && x <= c) v = (x - l) / Math.max(1e-9, c - l);
      else if (x > c && x <= r) v = (r - x) / Math.max(1e-9, r - c);
      w[k - start] = v;
    }
    bands.push({ start, weights: w });
  }
  const bank = { nBands, fftBins, bands };
  cache.set(key, bank);
  return bank;
}

/** Apply bank to a magnitude spectrum, returning log1p(power+ε). */
export function applyMel(bank: MelBank, mag: Float32Array, out: Float32Array): void {
  for (let b = 0; b < bank.nBands; b++) {
    const { start, weights } = bank.bands[b];
    let acc = 0;
    for (let i = 0; i < weights.length; i++) {
      const m = mag[start + i] || 0;
      acc += m * m * weights[i];
    }
    out[b] = Math.log1p(acc);
  }
}

/**
 * DCT-II basis cache. Keyed by `${N}|${nCoef}`. Stored as a single
 * Float32Array of length nCoef*N in row-major (k, n) order so the inner
 * loop is contiguous-stride and branch-free.
 */
const dctCache = new Map<string, Float32Array>();

function getDctBasis(N: number, nCoef: number): Float32Array {
  const key = `${N}|${nCoef}`;
  const hit = dctCache.get(key);
  if (hit) return hit;
  const basis = new Float32Array(nCoef * N);
  for (let k = 0; k < nCoef; k++) {
    const a = (Math.PI * k) / N;
    const row = k * N;
    for (let n = 0; n < N; n++) basis[row + n] = Math.cos(a * (n + 0.5));
  }
  dctCache.set(key, basis);
  return basis;
}

/** DCT-II type, retains first nCoef coefficients (typical MFCC: drop c0, keep 1..13). */
export function dct2(input: Float32Array, nCoef: number, out: Float32Array): void {
  const N = input.length;
  const norm = Math.sqrt(2 / N);
  const basis = getDctBasis(N, nCoef);
  for (let k = 0; k < nCoef; k++) {
    const row = k * N;
    let s = 0;
    for (let n = 0; n < N; n++) s += input[n] * basis[row + n];
    out[k] = s * norm;
  }
}
