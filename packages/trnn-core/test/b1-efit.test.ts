/**
 * Gates C, D, E — the three EFIT pathways.
 *
 * C: the diagonal filter is certified ≤ ρ_max for every parameter, and learns a
 *    real diffusion kernel to <1e-6 RMS.
 * D: the mixer genuinely transfers energy into unoccupied modes (a diagonal
 *    filter provably cannot) while staying inside its certified bound.
 * E: phase attention is an isometry and locates a real modal offset.
 */

import { describe, expect, it } from 'vitest';
import { createLattice } from '../src/torus/lattice';
import { analyze, buildBasis, coeffBuffer, synthesize } from '../src/torus/superposition';
import { createField } from '../src/core/complex';
import { SpectralFilter, diffusionTarget } from '../src/learn/spectralFilter';
import { SuperpositionMixer } from '../src/learn/mixer';
import { applySpectralAttention } from '../src/learn/spectralAttention';

function basisAt(n: number) {
  return buildBasis(createLattice(n));
}

describe('Gate C · learnable dispersion filter', () => {
  it('is certified for every parameter value, including absurd ones', () => {
    const f = new SpectralFilter(13);
    for (const v of [0, 1, -1, 1e12, -1e12, 1e300, -1e300]) {
      f.raw.fill(v);
      const c = f.certificate();
      expect(c.holds).toBe(true);
      expect(f.gain()).toBeLessThanOrEqual(f.rhoMax * (1 + 1e-12));
    }
  });

  it('learns a diffusion kernel to machine-useful precision', () => {
    const lambda = new Float64Array(13);
    for (let k = 0; k < 13; k++) lambda[k] = (2 * k) / 12; // normalised spectrum ∈ [0,2]
    const target = diffusionTarget(lambda, 1.2);
    // clip the target into the certified range — anything above ρ_max is
    // honestly unreachable and the fit should not pretend otherwise
    const f0 = new SpectralFilter(13);
    for (let k = 0; k < 13; k++) target[k] = Math.min(target[k], 0.95 * f0.rhoMax);
    const f = f0;
    const rms = f.fitMagnitudes(target, 2, 20000);
    expect(rms).toBeLessThan(1e-6);
  });

  it('scales each mode independently and never mixes them', () => {
    const f = new SpectralFilter(8);
    for (let i = 0; i < f.raw.length; i++) f.raw[i] = Math.sin(i * 1.7) * 3;
    const c = new Float64Array(16);
    c[6] = 1; // a single occupied mode
    f.apply(c);
    for (let k = 0; k < 8; k++) {
      if (k === 3) continue;
      expect(Math.hypot(c[2 * k], c[2 * k + 1])).toBe(0);
    }
  });

  it('is deterministic', () => {
    const a = new SpectralFilter(21);
    const b = new SpectralFilter(21);
    for (let i = 0; i < a.raw.length; i++) {
      a.raw[i] = Math.cos(i);
      b.raw[i] = Math.cos(i);
    }
    const t = new Float64Array(21).fill(0.3);
    expect(a.fitMagnitudes(t, 1, 300)).toBe(b.fitMagnitudes(t, 1, 300));
  });
});

describe('Gate D · superposition mixer', () => {
  it('transfers energy into modes the input did not occupy', () => {
    const basis = basisAt(233);
    const mixer = new SuperpositionMixer(basis, 0);
    const c = coeffBuffer(basis);
    // Two occupied modes so the spatial modulus actually varies — a single
    // ring mode has constant |ψ|, where a radial σ is exactly a scalar and
    // provably cannot mix. The interesting regime is the non-constant one.
    c[2] = 8;
    c[8] = 5;
    const report = mixer.apply(c);
    // The claim being certified is qualitative and absolute: a diagonal filter
    // transfers *exactly* zero energy into an unoccupied mode, no matter how it
    // is tuned; the mixer transfers a strictly positive amount. The magnitude
    // is modest because most of the newly generated content falls outside the
    // 13-mode span — that is the span's business, not the mixer's.
    expect(report.transfer).toBeGreaterThan(1e-9);
    expect(report.peak).toBeGreaterThan(0);

    const filtered = coeffBuffer(basis);
    filtered[2] = 8;
    filtered[8] = 5;
    const f = new SpectralFilter(basis.vectors.length);
    for (let i = 0; i < f.raw.length; i++) f.raw[i] = Math.cos(i * 3.1) * 7;
    f.apply(filtered);
    for (let k = 0; k < basis.vectors.length; k++) {
      if (k === 1 || k === 4) continue;
      expect(Math.hypot(filtered[2 * k], filtered[2 * k + 1])).toBe(0);
    }
  });

  it('is non-expansive with a zero bias, for any input scale', () => {
    const basis = basisAt(233);
    const mixer = new SuperpositionMixer(basis, 0);
    for (const scale of [1e-6, 1, 10, 1e4]) {
      const c = coeffBuffer(basis);
      for (let k = 0; k < basis.vectors.length; k++) {
        c[2 * k] = scale * Math.cos(k);
        c[2 * k + 1] = scale * Math.sin(k * 0.7);
      }
      const r = mixer.apply(c);
      expect(r.gain).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('respects its certified bound with the bias engaged', () => {
    const basis = basisAt(144);
    const mixer = new SuperpositionMixer(basis);
    for (let i = 0; i < mixer.bias.raw.length; i++) mixer.bias.raw[i] = Math.sin(i * 2.3) * 5;
    const c = coeffBuffer(basis);
    for (let k = 0; k < basis.vectors.length; k++) c[2 * k] = 0.5;
    let norm = 0;
    for (let i = 0; i < c.length; i++) norm += c[i] * c[i];
    norm = Math.sqrt(norm);
    mixer.apply(c);
    let out = 0;
    for (let i = 0; i < c.length; i++) out += c[i] * c[i];
    expect(Math.sqrt(out)).toBeLessThanOrEqual(mixer.bound(norm) * (1 + 1e-9));
  });

  it('preserves phase pointwise in the spatial domain', () => {
    const basis = basisAt(89);
    const mixer = new SuperpositionMixer(basis, 0);
    const c = coeffBuffer(basis);
    c[0] = 2;
    c[3] = 1.5;
    const before = createField(basis.n);
    synthesize(basis, c, before);
    mixer.apply(c);
    const after = createField(basis.n);
    synthesize(basis, c, after);
    // σ is radial, so the *dominant* spatial phase must be unchanged where the
    // amplitude is meaningful.
    let checked = 0;
    for (let i = 0; i < basis.n; i++) {
      if (Math.hypot(before.re[i], before.im[i]) < 1e-3) continue;
      const p0 = Math.atan2(before.im[i], before.re[i]);
      const p1 = Math.atan2(after.im[i], after.re[i]);
      expect(Math.abs(Math.atan2(Math.sin(p1 - p0), Math.cos(p1 - p0)))).toBeLessThan(0.35);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });
});

describe('Gate E · cross-spectral phase attention', () => {
  it('is an isometry — unit-modulus rotation only', () => {
    const modes = 13;
    const c = new Float64Array(2 * modes);
    const m = new Float64Array(2 * modes);
    for (let k = 0; k < modes; k++) {
      c[2 * k] = Math.cos(k * 1.3);
      c[2 * k + 1] = Math.sin(k * 0.4);
      m[2 * k] = Math.cos(k * 1.3 + 0.9);
      m[2 * k + 1] = Math.sin(k * 0.4 + 0.9);
    }
    let e0 = 0;
    for (let i = 0; i < c.length; i++) e0 += c[i] * c[i];
    applySpectralAttention(c, m, modes, 1);
    let e1 = 0;
    for (let i = 0; i < c.length; i++) e1 += c[i] * c[i];
    expect(Math.abs(e1 - e0) / e0).toBeLessThan(1e-10);
  });

  it('locates a modal offset', () => {
    const modes = 21;
    const shift = 5;
    const q = new Float64Array(2 * modes);
    const m = new Float64Array(2 * modes);
    for (let k = 0; k < modes; k++) {
      q[2 * k] = Math.exp(-((k - 3) ** 2) / 2);
      m[2 * (k)] = Math.exp(-(((k - 3 + shift) % modes) ** 2) / 2);
    }
    const r = applySpectralAttention(q, m, modes, 0);
    expect(r.lag).toBe(shift);
    expect(r.alignment).toBeGreaterThan(0);
  });

  it('strength 0 is exactly the identity', () => {
    const modes = 8;
    const c = new Float64Array(2 * modes).fill(0.5);
    const before = Float64Array.from(c);
    applySpectralAttention(c, Float64Array.from(c), modes, 0);
    for (let i = 0; i < c.length; i++) expect(c[i]).toBe(before[i]);
  });
});
