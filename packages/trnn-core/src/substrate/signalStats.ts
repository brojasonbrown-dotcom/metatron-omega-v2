/**
 * Ω-REAL · P2 — Level-1 signal statistics.
 *
 * These operate on RAW STREAMING WINDOWS at intake rate (377/233/89 Hz) and
 * answer three questions the field cannot answer about itself:
 *
 *   MSC(f)   — how much of channel y at frequency f is linearly explained by x
 *   PLV      — how phase-locked two narrow bands are, independent of amplitude
 *   GCC-PHAT — the delay between two channels, amplitude-whitened
 *
 * DESIGN RULES (identical to the rest of the substrate):
 *  • every transcendental goes through `dmath` — no raw `Math.sin/exp/pow` on
 *    any path that can reach state or a digest;
 *  • an estimator that cannot be computed honestly returns `null`, never 0.
 *    A single Welch segment gives MSC ≡ 1 by construction; reporting that as
 *    "perfect coherence" is precisely the false reading class this programme
 *    exists to remove, so <3 segments abstains;
 *  • zero allocation is NOT claimed here — Level-1 runs off the tick path on
 *    windowed batches, so clarity beats micro-optimisation.
 */

import { dcos, dsin, dlog, datan2, dpow } from '../core/dmath';
import { fft, type Split } from '../spectral/fft';

/** Minimum Welch segments before magnitude-squared coherence may speak. */
export const MSC_MIN_SEGMENTS = 3;

export interface MscResult {
  /** Per-bin magnitude-squared coherence in [0,1], or null when abstaining. */
  readonly msc: Float64Array | null;
  /** Bin centre frequencies in Hz. */
  readonly freqs: Float64Array;
  /** Number of Welch segments averaged. */
  readonly segments: number;
  /** Coherence averaged over the requested band, or null when abstaining. */
  readonly bandMean: number | null;
  readonly abstained: boolean;
  readonly reason?: string;
}

/** Periodic Hann window (correct for Welch overlap-add statistics). */
export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * dcos((2 * Math.PI * i) / n);
  return w;
}

function zeros(n: number): Float64Array {
  return new Float64Array(n);
}

function mean(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return x.length ? s / x.length : 0;
}

/**
 * Welch magnitude-squared coherence.
 *
 * MSC(f) = |E[X Y*]|² / (E[|X|²] · E[|Y|²]) — the expectation is what makes it
 * meaningful, hence the hard segment floor. Segments are detrended (mean
 * removed) and Hann-windowed with 50 % overlap.
 */
export function welchMSC(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  opts: { fs?: number; nperseg?: number; overlap?: number; band?: [number, number] } = {},
): MscResult {
  const n = Math.min(x.length, y.length);
  const fs = opts.fs ?? 1;
  const nperseg = Math.max(8, Math.min(opts.nperseg ?? 64, n));
  const overlap = opts.overlap ?? 0.5;
  const step = Math.max(1, Math.round(nperseg * (1 - overlap)));
  const nBins = Math.floor(nperseg / 2) + 1;

  const freqs = zeros(nBins);
  for (let k = 0; k < nBins; k++) freqs[k] = (k * fs) / nperseg;

  const segments = n >= nperseg ? Math.floor((n - nperseg) / step) + 1 : 0;
  if (segments < MSC_MIN_SEGMENTS) {
    return {
      msc: null,
      freqs,
      segments,
      bandMean: null,
      abstained: true,
      reason: `need ${MSC_MIN_SEGMENTS} Welch segments, have ${segments}`,
    };
  }

  const w = hann(nperseg);
  const sxxR = zeros(nBins);
  const syyR = zeros(nBins);
  const sxyR = zeros(nBins);
  const sxyI = zeros(nBins);

  const bufR = zeros(nperseg);
  const bufI = zeros(nperseg);

  for (let s = 0; s < segments; s++) {
    const off = s * step;
    // detrend + window x
    let mx = 0;
    let my = 0;
    for (let i = 0; i < nperseg; i++) {
      mx += x[off + i];
      my += y[off + i];
    }
    mx /= nperseg;
    my /= nperseg;

    for (let i = 0; i < nperseg; i++) bufR[i] = (x[off + i] - mx) * w[i];
    bufI.fill(0);
    const X = fft(bufR, bufI, false);

    for (let i = 0; i < nperseg; i++) bufR[i] = (y[off + i] - my) * w[i];
    bufI.fill(0);
    const Y = fft(bufR, bufI, false);

    for (let k = 0; k < nBins; k++) {
      const xr = X.re[k];
      const xi = X.im[k];
      const yr = Y.re[k];
      const yi = Y.im[k];
      sxxR[k] += xr * xr + xi * xi;
      syyR[k] += yr * yr + yi * yi;
      // X · conj(Y)
      sxyR[k] += xr * yr + xi * yi;
      sxyI[k] += xi * yr - xr * yi;
    }
  }

  const msc = zeros(nBins);
  for (let k = 0; k < nBins; k++) {
    const den = sxxR[k] * syyR[k];
    const num = sxyR[k] * sxyR[k] + sxyI[k] * sxyI[k];
    msc[k] = den > 0 ? Math.min(1, num / den) : 0;
  }

  const band = opts.band;
  let bandMean: number | null = null;
  {
    let acc = 0;
    let cnt = 0;
    for (let k = 0; k < nBins; k++) {
      if (band && (freqs[k] < band[0] || freqs[k] > band[1])) continue;
      acc += msc[k];
      cnt++;
    }
    bandMean = cnt > 0 ? acc / cnt : null;
  }

  return { msc, freqs, segments, bandMean, abstained: false };
}

/* ── Butterworth band-pass (SOS) ──────────────────────────────────────────── */

export interface Biquad {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

type C = { re: number; im: number };
const cmul = (p: C, q: C): C => ({ re: p.re * q.re - p.im * q.im, im: p.re * q.im + p.im * q.re });
const cdiv = (p: C, q: C): C => {
  const d = q.re * q.re + q.im * q.im;
  return { re: (p.re * q.re + p.im * q.im) / d, im: (p.im * q.re - p.re * q.im) / d };
};
const csqrt = (z: C): C => {
  const m = Math.sqrt(Math.sqrt(z.re * z.re + z.im * z.im));
  const a = 0.5 * datan2(z.im, z.re);
  return { re: m * dcos(a), im: m * dsin(a) };
};

/**
 * Butterworth band-pass as a cascade of biquads.
 *
 * `order` is the LOW-PASS prototype order; the resulting band-pass is order 2N
 * (N biquads). Analog prototype poles → LP→BP transform s ↦ (s²+ω₀²)/(B s) →
 * bilinear with pre-warping. Each BP biquad has zeros at z=±1, so DC and
 * Nyquist are exactly nulled — a property we assert in the battery.
 */
export function butterBandpass(f1: number, f2: number, fs: number, order = 2): Biquad[] {
  if (!(f1 > 0 && f2 > f1 && f2 < fs / 2)) {
    throw new RangeError(`butterBandpass: need 0 < f1 < f2 < fs/2, got ${f1}, ${f2}, fs=${fs}`);
  }
  const t = 2 * fs;
  const warp = (f: number) => t * (dsin(Math.PI * (f / fs)) / dcos(Math.PI * (f / fs)));
  const wl = warp(f1);
  const wh = warp(f2);
  const w0sq = wl * wh;
  const B = wh - wl;

  const sos: Biquad[] = [];
  const pushPole = (sPole: C) => {
    // bilinear: z = (2fs + s) / (2fs − s); the biquad realises {zp, conj zp}
    const zp = cdiv({ re: t + sPole.re, im: sPole.im }, { re: t - sPole.re, im: -sPole.im });
    sos.push({ b0: 1, b1: 0, b2: -1, a1: -2 * zp.re, a2: zp.re * zp.re + zp.im * zp.im });
  };

  // Only the UPPER-HALF analog LP poles are iterated. Each contributes TWO
  // band-pass poles (the low- and high-side images), and each biquad below
  // already carries the conjugate of the pole it is given. Iterating all N LP
  // poles and taking one root each would duplicate the low-side pair and drop
  // the high-side one entirely — a filter that still looks plausible on a
  // magnitude plot but has the wrong bandwidth. Caught by the passband gate.
  for (let k = 0; k < order; k++) {
    const ang = (Math.PI * (2 * k + 1 + order)) / (2 * order);
    const p: C = { re: dcos(ang), im: dsin(ang) };
    if (p.im < -1e-12) continue; // conjugate partner, already covered

    // s² − B·p·s + ω₀² = 0
    const Bp: C = { re: B * p.re, im: B * p.im };
    const disc = csqrt({ re: Bp.re * Bp.re - Bp.im * Bp.im - 4 * w0sq, im: 2 * Bp.re * Bp.im });
    const r0: C = { re: (Bp.re + disc.re) / 2, im: (Bp.im + disc.im) / 2 };
    const r1: C = { re: (Bp.re - disc.re) / 2, im: (Bp.im - disc.im) / 2 };

    if (Math.abs(p.im) <= 1e-12) {
      // real LP pole (odd order): its two BP roots are already a conjugate pair
      pushPole(r0);
    } else {
      pushPole(r0);
      pushPole(r1);
    }
  }


  // normalise the cascade to unit gain at the geometric centre frequency
  const fc = Math.sqrt(f1 * f2);
  const w = (2 * Math.PI * fc) / fs;
  const ejw: C = { re: dcos(-w), im: dsin(-w) };
  const ej2w: C = cmul(ejw, ejw);
  let g: C = { re: 1, im: 0 };
  for (const s of sos) {
    const num: C = {
      re: s.b0 + s.b1 * ejw.re + s.b2 * ej2w.re,
      im: s.b1 * ejw.im + s.b2 * ej2w.im,
    };
    const den: C = { re: 1 + s.a1 * ejw.re + s.a2 * ej2w.re, im: s.a1 * ejw.im + s.a2 * ej2w.im };
    g = cmul(g, cdiv(num, den));
  }
  const mag = Math.sqrt(g.re * g.re + g.im * g.im) || 1;
  const scale = dpow(1 / mag, 1 / sos.length);
  return sos.map((s) => ({ ...s, b0: s.b0 * scale, b1: s.b1 * scale, b2: s.b2 * scale }));
}

/** Direct-form-II transposed cascade, single pass. */
export function sosFilt(sos: readonly Biquad[], x: ArrayLike<number>): Float64Array {
  const out = Float64Array.from(x as ArrayLike<number>);
  for (const s of sos) {
    let z1 = 0;
    let z2 = 0;
    for (let i = 0; i < out.length; i++) {
      const v = out[i];
      const y = s.b0 * v + z1;
      z1 = s.b1 * v - s.a1 * y + z2;
      z2 = s.b2 * v - s.a2 * y;
      out[i] = y;
    }
  }
  return out;
}

/** Zero-phase filtering (forward then reverse). Phase distortion would corrupt PLV. */
export function sosFiltFilt(sos: readonly Biquad[], x: ArrayLike<number>): Float64Array {
  const fwd = sosFilt(sos, x);
  const rev = Float64Array.from(fwd).reverse();
  const back = sosFilt(sos, rev);
  return Float64Array.from(back).reverse();
}

/* ── Hilbert / PLV ────────────────────────────────────────────────────────── */

/** Analytic signal via FFT: zero the negative frequencies, double the positive. */
export function hilbertAnalytic(x: ArrayLike<number>): Split {
  const n = x.length;
  const re = Float64Array.from(x as ArrayLike<number>);
  const im = new Float64Array(n);
  const X = fft(re, im, false);
  const half = Math.floor(n / 2);
  for (let k = 0; k < n; k++) {
    let h: number;
    if (k === 0 || (n % 2 === 0 && k === half)) h = 1;
    else if (k < half + (n % 2)) h = 2;
    else h = 0;
    X.re[k] *= h;
    X.im[k] *= h;
  }
  const inv = fft(X.re, X.im, true);
  for (let i = 0; i < n; i++) {
    inv.re[i] /= n;
    inv.im[i] /= n;
  }
  return inv;
}

export interface PlvResult {
  /** Phase-locking value in [0,1], or null when abstaining. */
  readonly plv: number | null;
  /** Mean phase difference in radians (only meaningful when plv is high). */
  readonly meanPhase: number | null;
  readonly n: number;
  readonly abstained: boolean;
  readonly reason?: string;
}

/** Samples discarded at each end after band-pass + Hilbert (edge transients). */
export const PLV_EDGE_FRACTION = 0.1;
/** Minimum usable samples for a PLV reading (F9 paired-sample floor). */
export const PLV_MIN_SAMPLES = 34;

/**
 * Phase-locking value between two channels in a band.
 *
 * PLV = |⟨e^{i(φx−φy)}⟩|. Band-pass is zero-phase Butterworth; edges are
 * trimmed because filtfilt + Hilbert both ring at the boundaries and an
 * untrimmed PLV reads high for purely numerical reasons.
 */
export function bandPLV(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  band: [number, number],
  fs: number,
  order = 2,
): PlvResult {
  const n = Math.min(x.length, y.length);
  const trim = Math.floor(n * PLV_EDGE_FRACTION);
  const usable = n - 2 * trim;
  if (usable < PLV_MIN_SAMPLES) {
    return {
      plv: null,
      meanPhase: null,
      n: Math.max(0, usable),
      abstained: true,
      reason: `need ${PLV_MIN_SAMPLES} usable samples, have ${Math.max(0, usable)}`,
    };
  }
  const sos = butterBandpass(band[0], band[1], fs, order);
  const xf = sosFiltFilt(sos, Array.prototype.slice.call(x, 0, n));
  const yf = sosFiltFilt(sos, Array.prototype.slice.call(y, 0, n));
  const ax = hilbertAnalytic(xf);
  const ay = hilbertAnalytic(yf);

  let sr = 0;
  let si = 0;
  for (let i = trim; i < n - trim; i++) {
    // e^{i(φx−φy)} = (ax · conj(ay)) / |ax||ay|
    const r = ax.re[i] * ay.re[i] + ax.im[i] * ay.im[i];
    const m = ax.im[i] * ay.re[i] - ax.re[i] * ay.im[i];
    const mag = Math.sqrt(r * r + m * m);
    if (mag <= 0) continue;
    sr += r / mag;
    si += m / mag;
  }
  const plv = Math.min(1, Math.sqrt(sr * sr + si * si) / usable);
  return { plv, meanPhase: datan2(si, sr), n: usable, abstained: false };
}

/* ── GCC-PHAT ─────────────────────────────────────────────────────────────── */

export interface GccResult {
  /** Delay of y relative to x in samples (positive ⇒ y lags x), or null. */
  readonly lag: number | null;
  /** Normalised correlation peak height. */
  readonly peak: number;
  readonly abstained: boolean;
  readonly reason?: string;
}

/**
 * Generalised cross-correlation with phase transform.
 *
 * PHAT whitens magnitude and keeps only phase, which makes the delay estimate
 * immune to spectral colouring — the right choice for heterogeneous sensors.
 * The peak is refined by parabolic interpolation for sub-sample resolution.
 */
export function gccPhat(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  maxLag?: number,
  eps = 1e-12,
): GccResult {
  const n = Math.min(x.length, y.length);
  if (n < 8) return { lag: null, peak: 0, abstained: true, reason: `need 8 samples, have ${n}` };
  const m = 2 * n;
  const mx = mean(Array.prototype.slice.call(x, 0, n));
  const my = mean(Array.prototype.slice.call(y, 0, n));

  const xr = new Float64Array(m);
  const xi = new Float64Array(m);
  const yr = new Float64Array(m);
  const yi = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    xr[i] = x[i] - mx;
    yr[i] = y[i] - my;
  }
  const X = fft(xr, xi, false);
  const Y = fft(yr, yi, false);
  const cr = new Float64Array(m);
  const ci = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    const rr = X.re[k] * Y.re[k] + X.im[k] * Y.im[k];
    const ii = X.im[k] * Y.re[k] - X.re[k] * Y.im[k];
    const mag = Math.sqrt(rr * rr + ii * ii);
    const d = mag > eps ? mag : eps;
    cr[k] = rr / d;
    ci[k] = ii / d;
  }
  const c = fft(cr, ci, true);
  for (let k = 0; k < m; k++) c.re[k] /= m;

  const lim = Math.min(maxLag ?? n - 1, n - 1);
  let best = -Infinity;
  let bestLag = 0;
  for (let l = -lim; l <= lim; l++) {
    const idx = l >= 0 ? l : m + l;
    const v = c.re[idx];
    if (v > best) {
      best = v;
      bestLag = l;
    }
  }
  // parabolic refinement on the discrete peak
  const at = (l: number) => c.re[l >= 0 ? l % m : m + (l % m)];
  const ym1 = at(bestLag - 1);
  const y0 = at(bestLag);
  const y1 = at(bestLag + 1);
  const den = ym1 - 2 * y0 + y1;
  const frac = Math.abs(den) > 1e-15 ? (0.5 * (ym1 - y1)) / den : 0;
  const refined = bestLag + (Math.abs(frac) < 1 ? frac : 0);
  // Sign convention. ifft(X·conj(Y))[k] = Σ x[t]·y[t−k], so a y that LAGS x by
  // D samples peaks at k = −D. The reported `lag` is the delay of y relative
  // to x, hence the negation — getting this backwards silently reverses every
  // downstream causal ordering, so the battery pins the sign explicitly.
  return { lag: 0 - refined, peak: best, abstained: false }; // 0−x avoids a -0 lag
}

/** Natural log guarded for zero/negative arguments (used by the MI estimators). */
export function safeLog(v: number, floor = 1e-300): number {
  return dlog(v > floor ? v : floor);
}
