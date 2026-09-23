/**
 * Split complex field: two Float64Arrays (re/im), zero per-step allocation.
 * complex128 without object churn — every operation writes into a caller-owned
 * destination.
 */

export interface CField {
  readonly re: Float64Array;
  readonly im: Float64Array;
  readonly n: number;
}

export function createField(n: number): CField {
  return { re: new Float64Array(n), im: new Float64Array(n), n };
}

export function copyField(dst: CField, src: CField): void {
  dst.re.set(src.re);
  dst.im.set(src.im);
}

export function zeroField(f: CField): void {
  f.re.fill(0);
  f.im.fill(0);
}

export function cloneField(f: CField): CField {
  return { re: Float64Array.from(f.re), im: Float64Array.from(f.im), n: f.n };
}

/** Sum |z_i|^2. */
export function energy(f: CField): number {
  let s = 0;
  for (let i = 0; i < f.n; i++) s += f.re[i] * f.re[i] + f.im[i] * f.im[i];
  return s;
}

/** max_i |z_i|. */
export function maxNorm(f: CField): number {
  let m = 0;
  for (let i = 0; i < f.n; i++) {
    const a = Math.sqrt(f.re[i] * f.re[i] + f.im[i] * f.im[i]);
    if (a > m) m = a;
  }
  return m;
}

/** ||a - b||_2. */
export function distance(a: CField, b: CField): number {
  let s = 0;
  for (let i = 0; i < a.n; i++) {
    const dr = a.re[i] - b.re[i];
    const di = a.im[i] - b.im[i];
    s += dr * dr + di * di;
  }
  return Math.sqrt(s);
}

/** <a|b> = sum conj(a_i) b_i. */
export function inner(a: CField, b: CField): { re: number; im: number } {
  let re = 0;
  let im = 0;
  for (let i = 0; i < a.n; i++) {
    re += a.re[i] * b.re[i] + a.im[i] * b.im[i];
    im += a.re[i] * b.im[i] - a.im[i] * b.re[i];
  }
  return { re, im };
}

export function scaleField(f: CField, k: number): void {
  for (let i = 0; i < f.n; i++) {
    f.re[i] *= k;
    f.im[i] *= k;
  }
}

export function isFiniteField(f: CField): boolean {
  for (let i = 0; i < f.n; i++) {
    if (!Number.isFinite(f.re[i]) || !Number.isFinite(f.im[i])) return false;
  }
  return true;
}

/** Per-element max-norm clamp to `limit` (Law L8), preserving phase. */
export function clampField(f: CField, limit: number): number {
  let clamped = 0;
  for (let i = 0; i < f.n; i++) {
    const a = Math.sqrt(f.re[i] * f.re[i] + f.im[i] * f.im[i]);
    if (a > limit && a > 0) {
      const k = limit / a;
      f.re[i] *= k;
      f.im[i] *= k;
      clamped++;
    }
  }
  return clamped;
}
