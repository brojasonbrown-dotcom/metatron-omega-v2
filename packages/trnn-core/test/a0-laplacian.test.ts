/**
 * Gate A — measured spectral ground truth.
 *
 * Every assertion here is on a *measured* quantity: the eigen residual, the
 * spectrum bounds implied by the normalised Laplacian, and the cross-run digest.
 */

import { describe, expect, it } from 'vitest';
import {
  applySparse,
  buildRingLaplacian,
  lanczosEigenpairs,
  measureSpectrum,
  spectrumDigest,
  strideSet,
} from '../src/spectral/laplacian';

describe('Gate A · ring Laplacian', () => {
  it('uses Fibonacci chords only', () => {
    expect(strideSet(610)).toEqual([1, 2, 3, 5, 8]);
    expect(strideSet(13)).toEqual([1, 2, 3, 5]);
  });

  it('is symmetric with unit diagonal', () => {
    const L = buildRingLaplacian(89);
    const seen = new Map<string, number>();
    for (let i = 0; i < L.n; i++) {
      for (let p = L.rowPtr[i]; p < L.rowPtr[i + 1]; p++) {
        const j = L.colIdx[p];
        if (i === j) expect(L.val[p]).toBeCloseTo(1, 15);
        seen.set(`${i}:${j}`, L.val[p]);
      }
    }
    for (const [key, v] of seen) {
      const [i, j] = key.split(':');
      expect(seen.get(`${j}:${i}`)).toBeCloseTo(v, 15);
    }
  });

  it('annihilates the D^{1/2} constant mode (λ_0 = 0)', () => {
    const L = buildRingLaplacian(89);
    const x = new Float64Array(L.n).fill(1 / Math.sqrt(L.n));
    const y = new Float64Array(L.n);
    applySparse(L, x, y);
    let m = 0;
    for (let i = 0; i < L.n; i++) m = Math.max(m, Math.abs(y[i]));
    expect(m).toBeLessThan(1e-12);
  });
});

describe('Gate A · Lanczos eigenpairs', () => {
  it('resolves the low end with residual < 1e-10', () => {
    const L = buildRingLaplacian(233);
    const pairs = lanczosEigenpairs(L, 13);
    expect(pairs.lambda.length).toBe(13);
    for (let i = 0; i < pairs.residual.length; i++) {
      expect(pairs.residual[i]).toBeLessThan(1e-10);
    }
  });

  it('returns eigenvalues in [0, 2] and ascending', () => {
    const pairs = lanczosEigenpairs(buildRingLaplacian(233), 13);
    for (let i = 0; i < pairs.lambda.length; i++) {
      expect(pairs.lambda[i]).toBeGreaterThan(-1e-12);
      expect(pairs.lambda[i]).toBeLessThan(2 + 1e-12);
      if (i > 0) expect(pairs.lambda[i]).toBeGreaterThanOrEqual(pairs.lambda[i - 1] - 1e-15);
    }
  });

  it('produces an orthonormal eigenbasis', () => {
    const pairs = lanczosEigenpairs(buildRingLaplacian(144 + 89), 8);
    for (let a = 0; a < pairs.vectors.length; a++) {
      for (let b = a; b < pairs.vectors.length; b++) {
        let s = 0;
        for (let i = 0; i < pairs.vectors[a].length; i++)
          s += pairs.vectors[a][i] * pairs.vectors[b][i];
        expect(Math.abs(s - (a === b ? 1 : 0))).toBeLessThan(1e-9);
      }
    }
  });

  it('is bit-deterministic across runs', () => {
    const a = measureSpectrum(233, 13);
    const b = measureSpectrum(233, 13);
    expect(a.digest).toBe(b.digest);
    expect(spectrumDigest(a.lambda)).toBe(a.digest);
    for (let i = 0; i < a.lambda.length; i++) expect(a.lambda[i]).toBe(b.lambda[i]);
    expect(a.maxResidual).toBeLessThan(1e-10);
  });
});
