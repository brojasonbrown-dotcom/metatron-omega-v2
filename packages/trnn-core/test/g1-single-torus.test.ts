/**
 * Gate G1 — certified single torus: contraction, boundedness, determinism,
 * rollback, and the spectral roundtrip (early G2 evidence).
 */
import { describe, expect, it } from 'vitest';
import { SingleTorusEngine } from '../src/engine/SingleTorusEngine';
import { createField, distance, maxNorm } from '../src/core/complex';
import { cellStep } from '../src/cell/update';
import { CLAMP_MAX, JURY_GAIN_REFERENCE, phiPow } from '../src/core/constants';
import { createLattice, minSeparation } from '../src/torus/lattice';
import { analyze, buildBasis, coeffBuffer, synthesize } from '../src/torus/superposition';
import { lucasLine } from '../src/torus/eigenmodes';
import { lucasBig } from '../src/core/fibonacci';
import { memoryRoots } from '../src/cell/memory';
import { SeedStream } from '../src/core/determinism';

function randomField(n: number, seed: string, scale = 1) {
  const f = createField(n);
  const r = new SeedStream(seed);
  for (let i = 0; i < n; i++) {
    f.re[i] = scale * r.signed();
    f.im[i] = scale * r.signed();
  }
  return f;
}

describe('G1 cell contraction', () => {
  it('the unforced cell contracts at or below the Jury gain', () => {
    const z = randomField(144, 'contract');
    const out = createField(144);
    let worst = 0;
    for (let t = 0; t < 200; t++) {
      const r = cellStep(z, out, {});
      worst = Math.max(worst, r.realizedGain);
      z.re.set(out.re);
      z.im.set(out.im);
    }
    expect(worst).toBeLessThanOrEqual(JURY_GAIN_REFERENCE + 1e-12);
    expect(maxNorm(z)).toBeLessThan(1e-12);
  });

  it('two trajectories converge (contraction in the difference)', () => {
    const a = randomField(144, 'a');
    const b = randomField(144, 'b');
    const ao = createField(144);
    const bo = createField(144);
    const d0 = distance(a, b);
    for (let t = 0; t < 40; t++) {
      cellStep(a, ao, {});
      cellStep(b, bo, {});
      a.re.set(ao.re);
      a.im.set(ao.im);
      b.re.set(bo.re);
      b.im.set(bo.im);
    }
    expect(distance(a, b)).toBeLessThan(d0 * Math.pow(JURY_GAIN_REFERENCE, 40) * 1.001 + 1e-15);
  });

  it('the phi^4 clamp bounds any admissible state', () => {
    const z = randomField(144, 'big', 1000);
    const out = createField(144);
    const r = cellStep(z, out, {});
    expect(r.clamped).toBeGreaterThan(0);
    expect(maxNorm(out)).toBeLessThanOrEqual(CLAMP_MAX + 1e-12);
  });

  it('memory kernel roots are exactly {1, -phi^-2}', () => {
    const [r1, r2] = memoryRoots();
    expect(r1).toBe(1);
    expect(r2).toBe(-phiPow(-2));
  });
});

describe('G1 lattice + spectral basis', () => {
  it('rejects non-Fibonacci node counts', () => {
    expect(() => createLattice(100)).toThrow();
    expect(() => createLattice(144)).not.toThrow();
  });

  it('the golden advance is well separated (no degenerate lattice)', () => {
    expect(minSeparation(createLattice(987))).toBeGreaterThan(0);
  });

  it('analysis is the exact inverse of synthesis (roundtrip < 1e-12)', () => {
    const basis = buildBasis(createLattice(987));
    const c = coeffBuffer(basis);
    const r = new SeedStream('coeff');
    for (let i = 0; i < c.length; i++) c[i] = r.signed();
    const psi = createField(987);
    synthesize(basis, c, psi);
    const back = coeffBuffer(basis);
    analyze(basis, psi, back);
    let worst = 0;
    for (let i = 0; i < c.length; i++) worst = Math.max(worst, Math.abs(c[i] - back[i]));
    expect(worst).toBeLessThan(1e-12);
  });

  it('spectral lines equal the Lucas numbers', () => {
    for (let k = 1; k <= 13; k++) {
      expect(Math.abs(lucasLine(k) - Number(lucasBig(k)))).toBeLessThan(2.8e-13);
    }
  });
});

describe('G1 engine', () => {
  it('runs bounded and finite for 1000 ticks', () => {
    const e = new SingleTorusEngine({ nodes: 987, seed: 'g1', coherenceDelay: 233 });
    let last = e.step();
    for (let t = 1; t < 1000; t++) {
      last = e.step();
      expect(last.finite).toBe(true);
      expect(last.peak).toBeLessThanOrEqual(CLAMP_MAX + 1e-12);
    }
    expect(last.tick).toBe(1000);
    expect(Number.isFinite(last.energy)).toBe(true);
  }, 30000);

  it('is bit-deterministic from a seed', () => {
    const a = new SingleTorusEngine({ nodes: 144, seed: 'same' });
    const b = new SingleTorusEngine({ nodes: 144, seed: 'same' });
    for (let t = 0; t < 300; t++) expect(a.step().digest).toBe(b.step().digest);
  });

  it('a different seed diverges', () => {
    const a = new SingleTorusEngine({ nodes: 144, seed: 'x' });
    const b = new SingleTorusEngine({ nodes: 144, seed: 'y' });
    a.run(10);
    b.run(10);
    expect(a.digest()).not.toBe(b.digest());
  });

  it('coherence is warm after the golden delay and stays in [0,1]', () => {
    const e = new SingleTorusEngine({ nodes: 144, seed: 'coh', coherenceDelay: 34 });
    for (let t = 0; t < 200; t++) {
      const r = e.step();
      expect(r.coherence).toBeGreaterThanOrEqual(0);
      expect(r.coherence).toBeLessThanOrEqual(1);
    }
    expect(e.step().coherenceWarm).toBe(true);
  });

  it('checkpoints every 144 ticks and rollback restores the digest chain', () => {
    const e = new SingleTorusEngine({ nodes: 144, seed: 'cp' });
    for (let t = 0; t < 143; t++) e.step();
    expect(e.step().checkpointed).toBe(true);
    const cp = e.checkpoint();
    const after = e.run(20).digest;
    e.restore(cp);
    expect(e.currentTick()).toBe(cp.tick);
    expect(e.digest()).toBe(cp.digest);
    const replay = e.run(20).digest;
    expect(replay).toBe(after);
  });

  it('external input is admitted and does not break the bound', () => {
    const e = new SingleTorusEngine({ nodes: 144, seed: 'inp' });
    e.setInput(randomField(144, 'drive', 1));
    for (let t = 0; t < 300; t++) {
      const r = e.step();
      expect(r.finite).toBe(true);
      expect(r.peak).toBeLessThanOrEqual(CLAMP_MAX + 1e-12);
    }
  });

  it('the transcription tape records one digest-linked frame per tick', () => {
    const e = new SingleTorusEngine({ nodes: 144, seed: 'tape', tapeCapacity: 64 });
    e.run(100);
    expect(e.tape.size()).toBe(64);
    const tail = e.tape.tail(3);
    expect(tail.length).toBe(3);
    expect(tail[2].digest).toBe(e.digest());
    expect(tail[2].tick).toBe(99);
  });
});
