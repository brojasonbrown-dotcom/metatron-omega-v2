/**
 * VideoCortex — perceptual video front-end.
 *
 * Per frame (32×32 luminance + RGB downsample):
 *
 *   • Luminance pyramid          — 32, 16, 8 (φ-decimated, area average)
 *   • Sobel gradients            — Gx, Gy, magnitude, orientation
 *   • Orientation histogram      — 8 bins (HOG-lite, magnitude-weighted)
 *   • Motion energy              — mean |I_t − I_{t-1}|
 *   • Lucas–Kanade optical flow  — (u, v) global flow on 16×16 (D4)
 *   • Center-surround salience   — DoG(σ1 vs σ2≈φσ1) absolute response
 *   • YCbCr skin saliency        — mean(mask) of (Cb,Cr) skin band (D5)
 *   • Color opponency            — (R−G), (B−Y) means (Y = (R+G)/2)
 *   • Scene-cut detector         — χ² on 16-bin luminance histogram (D6)
 *
 * All buffers preallocated; designed to stay well under 1 ms per frame.
 */

export interface VideoFeatures {
  feature: Float32Array;        // packed dense vector for gateway/lattice
  motion: number;
  salience: number;
  /** Optical flow (u, v) in pixels/frame at 16×16 scale. */
  flowU: number;
  flowV: number;
  /** χ² distance from previous-frame luminance histogram (>~0.5 ⇒ scene cut). */
  sceneCut: number;
  skin: number;
  orientationHist: Float32Array;
}

const W = 32, H = 32;
const N_PIX = W * H;
const HOG_BINS = 8;
const SCALE16 = 16, SCALE8 = 8;
const HIST_BINS = 16;

export class VideoCortex {
  private prev = new Float32Array(N_PIX);
  private gx = new Float32Array(N_PIX);
  private gy = new Float32Array(N_PIX);
  private mag = new Float32Array(N_PIX);
  private hog = new Float32Array(HOG_BINS);
  private lum16 = new Float32Array(SCALE16 * SCALE16);
  private lum16Prev = new Float32Array(SCALE16 * SCALE16);
  private lum8 = new Float32Array(SCALE8 * SCALE8);
  private dogA = new Float32Array(SCALE16 * SCALE16);
  private dogB = new Float32Array(SCALE16 * SCALE16);
  private hist = new Float32Array(HIST_BINS);
  private histPrev = new Float32Array(HIST_BINS);
  // feature: 16×16 lum (256) + 8×8 lum (64) + 8 HOG + 16 hist + 10 scalars = 354
  private feature = new Float32Array(SCALE16 * SCALE16 + SCALE8 * SCALE8 + HOG_BINS + HIST_BINS + 10);
  private hasPrev16 = false;

  /**
   * @param lum   32×32 luminance in [-0.5, 0.5]
   * @param rMean global red mean in [0,1]
   * @param gMean global green mean
   * @param bMean global blue mean
   * @param cb    optional Cb mean in [-0.5, 0.5] for skin estimate
   * @param cr    optional Cr mean in [-0.5, 0.5] for skin estimate
   */
  process(lum: Float32Array, rMean: number, gMean: number, bMean: number, cb = 0, cr = 0): VideoFeatures {
    // --- Sobel gradients on 32×32 ---
    let magSum = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const tl = lum[i - W - 1], tc = lum[i - W], tr = lum[i - W + 1];
        const ml = lum[i - 1],     mr = lum[i + 1];
        const bl = lum[i + W - 1], bc = lum[i + W], br = lum[i + W + 1];
        const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
        const gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
        this.gx[i] = gx; this.gy[i] = gy;
        const m = Math.hypot(gx, gy);
        this.mag[i] = m;
        magSum += m;
      }
    }

    // --- HOG-lite ---
    for (let i = 0; i < HOG_BINS; i++) this.hog[i] = 0;
    for (let i = 0; i < N_PIX; i++) {
      const m = this.mag[i];
      if (m < 1e-3) continue;
      let a = Math.atan2(this.gy[i], this.gx[i]); // [-π, π]
      if (a < 0) a += Math.PI;                    // unsigned
      const bin = Math.min(HOG_BINS - 1, Math.floor((a / Math.PI) * HOG_BINS));
      this.hog[bin] += m;
    }
    const hogNorm = Math.max(1e-9, magSum);
    for (let i = 0; i < HOG_BINS; i++) this.hog[i] /= hogNorm;

    // --- Motion energy (32×32) ---
    let me = 0;
    for (let i = 0; i < N_PIX; i++) me += Math.abs(lum[i] - this.prev[i]);
    me /= N_PIX;

    // downsample to 16×16 (area average 2×2)
    for (let y = 0; y < SCALE16; y++) {
      for (let x = 0; x < SCALE16; x++) {
        const s = (lum[(y * 2) * W + x * 2] + lum[(y * 2) * W + x * 2 + 1] +
                   lum[(y * 2 + 1) * W + x * 2] + lum[(y * 2 + 1) * W + x * 2 + 1]) * 0.25;
        this.lum16[y * SCALE16 + x] = s;
      }
    }
    // downsample to 8×8
    for (let y = 0; y < SCALE8; y++) {
      for (let x = 0; x < SCALE8; x++) {
        const s = (this.lum16[(y * 2) * SCALE16 + x * 2] + this.lum16[(y * 2) * SCALE16 + x * 2 + 1] +
                   this.lum16[(y * 2 + 1) * SCALE16 + x * 2] + this.lum16[(y * 2 + 1) * SCALE16 + x * 2 + 1]) * 0.25;
        this.lum8[y * SCALE8 + x] = s;
      }
    }

    // --- Lucas–Kanade optical flow on 16×16 ---
    // Solve [Σ Ix² Σ IxIy; Σ IxIy Σ Iy²] [u;v] = -[Σ IxIt; Σ IyIt]
    let flowU = 0, flowV = 0;
    if (this.hasPrev16) {
      let sIxx = 0, sIyy = 0, sIxy = 0, sIxt = 0, sIyt = 0;
      for (let y = 1; y < SCALE16 - 1; y++) {
        for (let x = 1; x < SCALE16 - 1; x++) {
          const i = y * SCALE16 + x;
          const ix = (this.lum16[i + 1] - this.lum16[i - 1]) * 0.5;
          const iy = (this.lum16[i + SCALE16] - this.lum16[i - SCALE16]) * 0.5;
          const it = this.lum16[i] - this.lum16Prev[i];
          sIxx += ix * ix; sIyy += iy * iy; sIxy += ix * iy;
          sIxt += ix * it; sIyt += iy * it;
        }
      }
      const det = sIxx * sIyy - sIxy * sIxy;
      if (Math.abs(det) > 1e-6) {
        flowU = -(sIyy * sIxt - sIxy * sIyt) / det;
        flowV = -(-sIxy * sIxt + sIxx * sIyt) / det;
        // clamp absurd magnitudes (degenerate gradient frames)
        const mag = Math.hypot(flowU, flowV);
        if (mag > 8) { flowU = (flowU / mag) * 8; flowV = (flowV / mag) * 8; }
      }
    }
    this.lum16Prev.set(this.lum16);
    this.hasPrev16 = true;

    // --- DoG salience (16×16) ---
    boxBlur(this.lum16, this.dogA, SCALE16, 1);
    boxBlur(this.lum16, this.dogB, SCALE16, 2);
    let sal = 0;
    for (let i = 0; i < this.dogA.length; i++) {
      const v = Math.abs(this.dogA[i] - this.dogB[i]);
      sal += v;
    }
    sal /= this.dogA.length;

    // --- Luminance histogram + χ² scene-cut ---
    for (let i = 0; i < HIST_BINS; i++) this.hist[i] = 0;
    for (let i = 0; i < this.lum16.length; i++) {
      const b = Math.min(HIST_BINS - 1, Math.max(0, Math.floor((this.lum16[i] + 0.5) * HIST_BINS)));
      this.hist[b] += 1;
    }
    {
      const total = this.lum16.length;
      for (let i = 0; i < HIST_BINS; i++) this.hist[i] /= total;
    }
    let chi2 = 0;
    for (let i = 0; i < HIST_BINS; i++) {
      const d = this.hist[i] - this.histPrev[i];
      const s = this.hist[i] + this.histPrev[i];
      if (s > 1e-9) chi2 += (d * d) / s;
    }
    chi2 *= 0.5; // Bhattacharyya-like normalisation
    this.histPrev.set(this.hist);

    // --- Color opponency ---
    const ry = rMean - gMean;
    const by = bMean - (rMean + gMean) * 0.5;

    // --- Skin saliency (YCbCr): canonical skin band is Cb ∈ [77,127]/255 - 0.5 → [-0.20,0.00] and Cr ∈ [133,173]/255 - 0.5 → [0.02, 0.18] ---
    const skin = (cb >= -0.20 && cb <= 0.00 && cr >= 0.02 && cr <= 0.18) ? 1 : 0;

    // --- Pack feature ---
    const f = this.feature;
    let p = 0;
    for (let i = 0; i < this.lum16.length; i++) f[p++] = this.lum16[i];
    for (let i = 0; i < this.lum8.length; i++) f[p++] = this.lum8[i] * 1.5;
    for (let i = 0; i < HOG_BINS; i++) f[p++] = this.hog[i];
    for (let i = 0; i < HIST_BINS; i++) f[p++] = this.hist[i];
    f[p++] = Math.min(1, me * 4);
    f[p++] = Math.min(1, sal * 8);
    f[p++] = Math.min(1, magSum / N_PIX);
    f[p++] = Math.tanh(flowU * 0.25);
    f[p++] = Math.tanh(flowV * 0.25);
    f[p++] = Math.min(1, chi2 * 2);
    f[p++] = skin;
    f[p++] = ry;
    f[p++] = by;
    f[p++] = rMean - 0.5;

    // store current as previous
    this.prev.set(lum);

    return {
      feature: f, motion: me, salience: sal,
      flowU, flowV, sceneCut: chi2, skin,
      orientationHist: this.hog,
    };
  }
}

function boxBlur(src: Float32Array, dst: Float32Array, w: number, r: number): void {
  const h = src.length / w;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          s += src[yy * w + xx]; n++;
        }
      }
      dst[y * w + x] = s / Math.max(1, n);
    }
  }
}
