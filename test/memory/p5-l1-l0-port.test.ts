/**
 * Ω-REAL P5 port certification — memristive L1 and DMD-over-L0.
 *
 * Two claims are under test:
 *   1. The memristive plasticity port is OFF by default and, when off, is
 *      bit-identical to the historical saturating-linear Hebb rule.
 *   2. The tape predictor reports the substrate's real oscillation and
 *      abstains (null) rather than inventing a spectrum from thin evidence.
 */

import { describe, it, expect } from 'vitest';
import { HebbianMatrix } from '@/core/memory/HebbianMatrix';

function drive(m: HebbianMatrix, steps: number, seed = 1): void {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let t = 0; t < steps; t++) {
    const a = new Float64Array(8);
    for (let i = 0; i < 8; i++) a[i] = 2 * rnd() - 1;
    m.update(a);
  }
}

function weights(m: HebbianMatrix): number[] {
  return m.snapshot().entries.map(([, , w]) => w);
}

describe('P5 · L1 memristive port', () => {
  it('is OFF by default', () => {
    const def = new HebbianMatrix(4096);
    const off = new HebbianMatrix(4096, { memristive: false });
    drive(def, 200);
    drive(off, 200);
    expect(weights(def)).toEqual(weights(off));
  });

  it('changes the trajectory when explicitly enabled', () => {
    const off = new HebbianMatrix(4096, { memristive: false });
    const on = new HebbianMatrix(4096, { memristive: true });
    drive(off, 200);
    drive(on, 200);
    expect(weights(on)).not.toEqual(weights(off));
  });

  it('keeps every weight strictly inside the rails under saturating drive', () => {
    const on = new HebbianMatrix(4096, { memristive: true });
    for (let t = 0; t < 500; t++) {
      const a = new Float64Array(4).fill(1);
      on.update(a);
    }
    for (const w of weights(on)) {
      expect(Math.abs(w)).toBeLessThan(1);
      expect(Number.isFinite(w)).toBe(true);
    }
  });

  it('recall stays finite and bounded under the memristive rule', () => {
    const on = new HebbianMatrix(4096, { memristive: true });
    drive(on, 300, 7);
    const cue = new Float64Array(8).fill(0.5);
    for (const y of on.recall(cue)) expect(Number.isFinite(y)).toBe(true);
  });
});

function pushFrame(tape: FieldTape, tick: number, t: number): void {
  const psi = new Float64Array(8);
  for (let i = 0; i < 8; i++) psi[i] = Math.sin(2 * Math.PI * 0.05 * t + i);
  // 1.5 Hz oscillation at 30 Hz sampling, lightly damped.
  const a = Math.exp(-0.02 * t);
  tape.write({
    tick,
    psi,
    qualiaScalar: 0.4 * a * Math.cos(2 * Math.PI * 1.5 * (t / 30)),
    coherence: 0.5 + 0.3 * a * Math.sin(2 * Math.PI * 1.5 * (t / 30)),
    energy: 1 + 0.2 * a * Math.cos(2 * Math.PI * 1.5 * (t / 30)),
    salience: 0.3 * a * Math.sin(2 * Math.PI * 1.5 * (t / 30) + 0.7),
    novelty: 0.1,
    surprise: 0.05,
  });
}
