/**
 * AudioCortex — high-resolution perceptual audio front-end.
 *
 * Per 233 Hz hop (≈4.29 ms) we compute, from a windowed time-domain frame
 * and its FFT magnitude:
 *
 *   • 64-band mel spectrum (log-power)        — log1p(Σ |X|² · Wb)
 *   • 13 MFCC                                  — DCT-II of mel, c1..c13
 *   • 12-bin chroma                             — pitch-class profile (D3)
 *   • RMS energy                               — √(Σ x²/N)
 *   • LUFS-lite                                 — K-weighted RMS, 400 ms window (D7)
 *   • Zero-crossing rate                       — neighbour sign flips / N
 *   • Spectral centroid / flatness / rolloff85
 *   • Spectral flux (onset detector)           — Σ max(0, Δmag) / N
 *   • Onset: adaptive-threshold peak-pick on flux envelope (D1)
 *   • Tempo: autocorr of onset envelope, BPM 60–180 (D2)
 *   • Voicing / F0 via YIN (only when RMS is real AND spectrum is not too
 *     flat — flatness > 0.6 ⇒ likely noise, skip YIN) (B3a)
 *   • Harmonicity                              — 1 − cmnd-min
 *
 * Designed to be allocation-free per call (all buffers preallocated) and
 * to run in well under 1 ms on a single audio frame.
 */

import { getMelBank, applyMel, dct2, type MelBank } from './MelFilterbank';

export interface AudioFeatures {
  /** Concatenated dense feature vector for the SensoryGateway / lattice. */
  feature: Float32Array;
  mel: Float32Array;
  mfcc: Float32Array;
  chroma: Float32Array;
  rms: number;
  lufs: number;
  zcr: number;
  centroid: number;
  flatness: number;
  rolloff: number;
  flux: number;
  /** 1 if a flux peak was detected this frame (adaptive threshold). */
  onset: number;
  /** Estimated tempo in BPM (0 = no estimate yet). */
  bpm: number;
  /** Fundamental frequency in Hz (0 if unvoiced). */
  f0: number;
  voicing: number;
  harmonicity: number;
}

const MEL_BANDS = 64;
const MFCC_COEFS = 13;
const CHROMA_BINS = 12;
const YIN_TAU_MIN = 32;       // f0 ≤ sr/32  ≈ 1500 Hz @ 48 kHz
const YIN_TAU_MAX = 600;      // f0 ≥ sr/600 ≈ 80 Hz   @ 48 kHz
const YIN_THRESHOLD = 0.15;
const ONSET_WIN = 43;          // ~185 ms @ 233 Hz — adaptive flux baseline window
const TEMPO_WIN = 233;          // 1 s of onset envelope for tempo autocorr
const LUFS_WIN_FRAMES = 96;    // ~400 ms @ 233 Hz K-weighted RMS

export class AudioCortex {
  private sampleRate: number;
  private fftSize: number;
  private bank: MelBank;
  private mel = new Float32Array(MEL_BANDS);
  private mfcc = new Float32Array(MFCC_COEFS);
  private chroma = new Float32Array(CHROMA_BINS);
  private prevMag: Float32Array;
  private cmnd: Float32Array;          // YIN cumulative mean normalised difference
  private feature: Float32Array;        // packed feature vector
  private onsetRing: Float32Array = new Float32Array(ONSET_WIN);
  private onsetIdx = 0;
  private tempoRing: Float32Array = new Float32Array(TEMPO_WIN);
  private tempoIdx = 0;
  private tempoFilled = 0;
  private bpmEMA = 0;
  private lufsRing: Float32Array = new Float32Array(LUFS_WIN_FRAMES);
  private lufsIdx = 0;
  private kHpZ1 = 0;                    // pre-filter state for K-weighting
  private kShelfZ1 = 0;

  constructor(sampleRate = 48000, fftSize = 1024) {
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
    this.bank = getMelBank(sampleRate, fftSize, MEL_BANDS);
    this.prevMag = new Float32Array(fftSize / 2);
    this.cmnd = new Float32Array(YIN_TAU_MAX + 1);
    // packed: 64 mel + 13 mfcc + 12 chroma + 10 scalars = 99
    this.feature = new Float32Array(MEL_BANDS + MFCC_COEFS + CHROMA_BINS + 10);
  }

  /**
   * @param time  windowed time-domain frame (Float32Array, length = fftSize)
   * @param mag   matching FFT magnitude (length fftSize/2). The frontend
   *              owns the FFT; cortex owns the analysis.
   */
  process(time: Float32Array, mag: Float32Array): AudioFeatures {
    const N = time.length;
    const halfFft = mag.length;

    // --- RMS + ZCR (time domain) + LUFS-lite K-weighting ---
    let sq = 0, zc = 0, kSq = 0;
    let prev = time[0];
    // K-weighting approximation: a 2nd-order high-pass + high-shelf cascade.
    // We use single-pole IIRs as a cheap stand-in (TPDF stable across runs).
    const hpA = Math.exp(-2 * Math.PI * 38 / this.sampleRate);          // HP @ 38 Hz
    const shelfA = Math.exp(-2 * Math.PI * 1500 / this.sampleRate);     // shelf @ 1.5 kHz
    const shelfGain = 1.585;                                             // ~+4 dB @ HF
    for (let i = 0; i < N; i++) {
      const x = time[i];
      sq += x * x;
      if ((prev >= 0) !== (x >= 0)) zc++;
      prev = x;
      // K filter
      const hp = x - this.kHpZ1 * hpA;
      this.kHpZ1 = x;
      const sh = hp * shelfA + this.kShelfZ1 * (1 - shelfA);
      this.kShelfZ1 = sh;
      const kY = hp + (sh * (shelfGain - 1));
      kSq += kY * kY;
    }
    const rms = Math.sqrt(sq / Math.max(1, N));
    const zcr = zc / Math.max(1, N - 1);
    const meanSqK = kSq / Math.max(1, N);
    this.lufsRing[this.lufsIdx] = meanSqK;
    this.lufsIdx = (this.lufsIdx + 1) % LUFS_WIN_FRAMES;
    let lufsAcc = 0;
    for (let i = 0; i < LUFS_WIN_FRAMES; i++) lufsAcc += this.lufsRing[i];
    const lufsMean = lufsAcc / LUFS_WIN_FRAMES;
    const lufs = lufsMean > 1e-12 ? -0.691 + 10 * Math.log10(lufsMean) : -120;

    // --- Spectral descriptors ---
    let magSum = 0, weighted = 0, logSum = 0, energy = 0;
    for (let k = 0; k < halfFft; k++) {
      const m = mag[k];
      magSum += m;
      weighted += m * k;
      logSum += Math.log(m + 1e-9);
      energy += m * m;
    }
    const centroidBin = magSum > 1e-9 ? weighted / magSum : 0;
    const centroid = (centroidBin / halfFft) * (this.sampleRate / 2);
    const geomMean = Math.exp(logSum / Math.max(1, halfFft));
    const arithMean = magSum / Math.max(1, halfFft);
    const flatness = arithMean > 1e-9 ? geomMean / arithMean : 0;
    // rolloff85
    const target = 0.85 * magSum;
    let cum = 0, rolloffBin = halfFft - 1;
    for (let k = 0; k < halfFft; k++) {
      cum += mag[k];
      if (cum >= target) { rolloffBin = k; break; }
    }
    const rolloff = (rolloffBin / halfFft) * (this.sampleRate / 2);

    // --- Spectral flux (positive Δmag) ---
    let flux = 0;
    for (let k = 0; k < halfFft; k++) {
      const d = mag[k] - this.prevMag[k];
      if (d > 0) flux += d;
      this.prevMag[k] = mag[k];
    }
    flux /= Math.max(1, halfFft);

    // --- Onset peak-pick (adaptive threshold over rolling baseline) ---
    this.onsetRing[this.onsetIdx] = flux;
    this.onsetIdx = (this.onsetIdx + 1) % ONSET_WIN;
    let baseSum = 0, baseSqSum = 0;
    for (let i = 0; i < ONSET_WIN; i++) { baseSum += this.onsetRing[i]; baseSqSum += this.onsetRing[i] * this.onsetRing[i]; }
    const baseMean = baseSum / ONSET_WIN;
    const baseStd = Math.sqrt(Math.max(0, baseSqSum / ONSET_WIN - baseMean * baseMean));
    const onset = flux > baseMean + 1.6 * baseStd && flux > 1.2 * baseMean ? 1 : 0;

    // --- Tempo (autocorr of onset envelope over the last second) ---
    this.tempoRing[this.tempoIdx] = onset;
    this.tempoIdx = (this.tempoIdx + 1) % TEMPO_WIN;
    if (this.tempoFilled < TEMPO_WIN) this.tempoFilled++;
    let bpm = this.bpmEMA;
    // only recompute every ~233 frames to stay cheap
    if (this.tempoFilled === TEMPO_WIN && this.tempoIdx === 0) {
      const minLag = Math.floor(60 / 180 * 233);  // 180 BPM
      const maxLag = Math.floor(60 / 60 * 233);    // 60 BPM
      let bestLag = 0, bestCorr = 0;
      for (let lag = minLag; lag <= maxLag; lag++) {
        let c = 0;
        for (let i = 0; i < TEMPO_WIN - lag; i++) c += this.tempoRing[i] * this.tempoRing[i + lag];
        if (c > bestCorr) { bestCorr = c; bestLag = lag; }
      }
      if (bestLag > 0) {
        const inst = 60 * 233 / bestLag;
        bpm = this.bpmEMA === 0 ? inst : 0.7 * this.bpmEMA + 0.3 * inst;
        this.bpmEMA = bpm;
      }
    }

    // --- Mel + MFCC + Chroma ---
    applyMel(this.bank, mag, this.mel);
    dct2(this.mel, MFCC_COEFS, this.mfcc);
    computeChroma(mag, this.sampleRate, this.fftSize, this.chroma);

    // --- YIN F0 (only when RMS is real AND spectrum is harmonic-ish) ---
    let f0 = 0, voicing = 0, harmonicity = 0;
    if (rms > 0.01 && flatness < 0.6) {
      const tauMax = Math.min(YIN_TAU_MAX, Math.floor(N / 2) - 1);
      // step 1: difference function
      this.cmnd[0] = 1;
      let runningSum = 0;
      for (let tau = 1; tau <= tauMax; tau++) {
        let d = 0;
        for (let i = 0; i < N - tau; i++) {
          const diff = time[i] - time[i + tau];
          d += diff * diff;
        }
        runningSum += d;
        // step 2: cumulative mean normalised
        this.cmnd[tau] = runningSum > 1e-12 ? (d * tau) / runningSum : 1;
      }
      // step 3: absolute threshold + parabolic interpolation (A4 fix: no
      // mutation of the outer loop counter; we scan for the local min and
      // break explicitly)
      let tauEst = 0;
      for (let tau = YIN_TAU_MIN; tau <= tauMax; tau++) {
        if (this.cmnd[tau] < YIN_THRESHOLD) {
          // local minimum scan within the dip — read-only
          let localTau = tau;
          while (localTau + 1 <= tauMax && this.cmnd[localTau + 1] < this.cmnd[localTau]) localTau++;
          tauEst = localTau;
          break;
        }
      }
      if (tauEst > 0) {
        // parabolic refinement
        const x0 = tauEst > 1 ? this.cmnd[tauEst - 1] : this.cmnd[tauEst];
        const x1 = this.cmnd[tauEst];
        const x2 = tauEst + 1 <= tauMax ? this.cmnd[tauEst + 1] : x1;
        const denom = 2 * (2 * x1 - x0 - x2);
        const shift = denom !== 0 ? (x2 - x0) / denom : 0;
        const tauRef = tauEst + shift;
        f0 = this.sampleRate / Math.max(1e-9, tauRef);
        harmonicity = Math.max(0, 1 - x1);
        voicing = Math.min(1, harmonicity * Math.min(1, rms * 8));
      }
    }
    void energy;

    // --- Pack feature vector ---
    const f = this.feature;
    let p = 0;
    for (let i = 0; i < MEL_BANDS; i++) f[p++] = this.mel[i] * 0.25;       // 0..64
    for (let i = 0; i < MFCC_COEFS; i++) f[p++] = this.mfcc[i] * 0.1;      // 64..77
    for (let i = 0; i < CHROMA_BINS; i++) f[p++] = this.chroma[i];          // 77..89
    f[p++] = Math.min(1, rms * 4);
    f[p++] = zcr;
    f[p++] = Math.min(1, centroid / (this.sampleRate / 2));
    f[p++] = flatness;
    f[p++] = Math.min(1, rolloff / (this.sampleRate / 2));
    f[p++] = Math.min(1, flux * 4);
    f[p++] = onset;
    f[p++] = voicing;
    f[p++] = harmonicity;
    f[p++] = Math.max(-1, Math.min(1, (lufs + 60) / 60));   // map −120..0 LUFS → −1..1

    return {
      feature: f, mel: this.mel, mfcc: this.mfcc, chroma: this.chroma,
      rms, lufs, zcr, centroid, flatness, rolloff, flux, onset,
      bpm, f0, voicing, harmonicity,
    };
  }

  // ─── SOLFEGGIO 9-BAND & FLOWER 55-BAND ACTIVITY ─────────────────────
  //
  // Both methods reuse the freshest FFT magnitude the caller already has
  // (from AudioFrontend / AudioCortex.process). They are allocation-free
  // per call, share preallocated output buffers, and use EMA smoothing on
  // 1/φ² (α ≈ 0.382) to survive one dropped audio quantum without
  // ringing. Silent input → uniform 1/9 or 1/55 (neutral distribution),
  // which downstream consumers scale by global coherence.
  //
  // These are NOT called by process(); AudioFrontend calls them once
  // after process() so V10-golden paths that only use process() stay
  // bit-identical.

  private static readonly SOLFEGGIO_HZ = [174, 285, 396, 417, 528, 639, 741, 852, 963] as const;
  private static readonly SEMI_UP = 1.0594630943592953;      // 2^(1/12)
  private static readonly SEMI_DOWN = 1 / 1.0594630943592953;
  private static readonly PHI = 1.6180339887498949;
  private static readonly EMA_ALPHA = 1 / (1.6180339887498949 * 1.6180339887498949); // 1/φ²

  private solfeggioBands = new Float32Array(9);
  private flowerBands = new Float32Array(55);
  private solfeggioBins: Int32Array | null = null;   // [b0_lo, b0_hi, b1_lo, b1_hi, ...] length 18
  private flowerBins: Int32Array | null = null;      // length 110

  /** Ensure the ±1-semitone bin windows for each solfeggio band are cached. */
  private ensureSolfeggioBins(): Int32Array {
    if (this.solfeggioBins) return this.solfeggioBins;
    const binHz = this.sampleRate / this.fftSize;
    const halfFft = this.fftSize / 2;
    const bins = new Int32Array(18);
    for (let i = 0; i < 9; i++) {
      const f = AudioCortex.SOLFEGGIO_HZ[i];
      const fLo = f * AudioCortex.SEMI_DOWN;
      const fHi = f * AudioCortex.SEMI_UP;
      const kLo = Math.max(1, Math.floor(fLo / binHz));
      const kHi = Math.min(halfFft - 1, Math.ceil(fHi / binHz));
      bins[i * 2] = kLo;
      bins[i * 2 + 1] = Math.max(kLo, kHi);
    }
    this.solfeggioBins = bins;
    return bins;
  }

  /** Ensure the φ-spaced 55-band edges (log-spaced 40 Hz → Nyquist) are cached. */
  private ensureFlowerBins(): Int32Array {
    if (this.flowerBins) return this.flowerBins;
    const binHz = this.sampleRate / this.fftSize;
    const halfFft = this.fftSize / 2;
    // 55 bands log-spaced across 40 Hz .. sr/2. Log(φ)-natural spacing
    // gives the "flower" of the audible spectrum (~9 octaves total).
    const fLo0 = 40;
    const fHi0 = this.sampleRate / 2;
    const logLo = Math.log(fLo0);
    const logHi = Math.log(fHi0);
    const bins = new Int32Array(110);
    for (let i = 0; i < 55; i++) {
      const t0 = i / 55;
      const t1 = (i + 1) / 55;
      const fLo = Math.exp(logLo + (logHi - logLo) * t0);
      const fHi = Math.exp(logLo + (logHi - logLo) * t1);
      const kLo = Math.max(1, Math.floor(fLo / binHz));
      const kHi = Math.min(halfFft - 1, Math.max(kLo, Math.ceil(fHi / binHz)));
      bins[i * 2] = kLo;
      bins[i * 2 + 1] = kHi;
    }
    this.flowerBins = bins;
    return bins;
  }

  /**
   * 9-band solfeggio activity, in probability-distribution space.
   * Each band = Σ mag² within ±1 semitone of its center frequency,
   * normalized so all bands sum to 1. EMA-smoothed on 1/φ².
   * Silent input → uniform 1/9 (F5 neutral).
   */
  solfeggio9(mag: Float32Array): Float32Array {
    const bins = this.ensureSolfeggioBins();
    const out = this.solfeggioBands;
    let total = 0;
    // Accumulate raw power per band.
    const raw = _scratchRaw9;
    for (let i = 0; i < 9; i++) {
      const lo = bins[i * 2];
      const hi = bins[i * 2 + 1];
      let e = 0;
      for (let k = lo; k <= hi; k++) e += mag[k] * mag[k];
      raw[i] = e;
      total += e;
    }
    // EMA-smooth toward the normalized distribution.
    const alpha = AudioCortex.EMA_ALPHA;
    const oneMinusAlpha = 1 - alpha;
    if (total > 1e-12) {
      const inv = 1 / total;
      for (let i = 0; i < 9; i++) out[i] = oneMinusAlpha * out[i] + alpha * (raw[i] * inv);
    } else {
      // Silence → drift toward uniform 1/9.
      const uniform = 1 / 9;
      for (let i = 0; i < 9; i++) out[i] = oneMinusAlpha * out[i] + alpha * uniform;
    }
    return out;
  }

  /**
   * 55-band φ-spaced flower activity, probability-distribution space.
   * Same EMA convention. Silent input → uniform 1/55.
   */
  flowerBands55(mag: Float32Array): Float32Array {
    const bins = this.ensureFlowerBins();
    const out = this.flowerBands;
    let total = 0;
    const raw = _scratchRaw55;
    for (let i = 0; i < 55; i++) {
      const lo = bins[i * 2];
      const hi = bins[i * 2 + 1];
      let e = 0;
      for (let k = lo; k <= hi; k++) e += mag[k] * mag[k];
      raw[i] = e;
      total += e;
    }
    const alpha = AudioCortex.EMA_ALPHA;
    const oneMinusAlpha = 1 - alpha;
    if (total > 1e-12) {
      const inv = 1 / total;
      for (let i = 0; i < 55; i++) out[i] = oneMinusAlpha * out[i] + alpha * (raw[i] * inv);
    } else {
      const uniform = 1 / 55;
      for (let i = 0; i < 55; i++) out[i] = oneMinusAlpha * out[i] + alpha * uniform;
    }
    return out;
  }
}

// Module-level scratch buffers shared by all AudioCortex instances (there
// is exactly one in the browser and the methods are single-threaded).
const _scratchRaw9 = new Float32Array(9);
const _scratchRaw55 = new Float32Array(55);


/**
 * 12-bin chroma vector — sum the squared magnitudes of every bin into
 * its pitch class via log2(freq/A4)·12 mod 12. Equal-temperament.
 *
 * Optimisation: the per-bin pitch class is a pure function of
 * (sampleRate, fftSize, numBins). Caching it as an Int8Array (−1 for
 * out-of-band bins) eliminates ~512 transcendental ops per frame.
 * Bit-identical to the original arithmetic.
 */
const chromaPcCache = new Map<string, Int8Array>();
function getChromaPcTable(sampleRate: number, fftSize: number, numBins: number): Int8Array {
  const key = `${sampleRate}|${fftSize}|${numBins}`;
  const hit = chromaPcCache.get(key);
  if (hit) return hit;
  const tbl = new Int8Array(numBins);
  const binHz = sampleRate / fftSize;
  const A4 = 440;
  tbl[0] = -1;
  for (let k = 1; k < numBins; k++) {
    const f = k * binHz;
    if (f < 50 || f > 5000) { tbl[k] = -1; continue; }
    tbl[k] = Math.floor((((Math.log2(f / A4) * 12) % 12) + 12) % 12);
  }
  chromaPcCache.set(key, tbl);
  return tbl;
}

function computeChroma(mag: Float32Array, sampleRate: number, fftSize: number, out: Float32Array): void {
  for (let i = 0; i < CHROMA_BINS; i++) out[i] = 0;
  const N = mag.length;
  const pc = getChromaPcTable(sampleRate, fftSize, N);
  for (let k = 1; k < N; k++) {
    const p = pc[k];
    if (p < 0) continue;
    const m = mag[k];
    out[p] += m * m;
  }
  let s = 0;
  for (let i = 0; i < CHROMA_BINS; i++) s += out[i];
  if (s > 1e-9) for (let i = 0; i < CHROMA_BINS; i++) out[i] /= s;
}
