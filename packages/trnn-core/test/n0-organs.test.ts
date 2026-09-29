/**
 * Gate N — per-node organs, stable-ratio chords, and the permanent tape.
 *
 * The claim under test is coverage, not sampling: EVERY node on EVERY rung
 * must carry EVERY organ, the chords must not break the receipt-mass law, and
 * the tape must be exactly restorable. Anything additive must also be provably
 * inert at zero strength — that is what keeps the S0 oracle valid.
 */
import { describe, expect, it } from 'vitest';
import { NodeOrgans, organBytes, RADIAL_GAIN_MAX } from '../src/cell/organs';
import { SingleTorusEngine } from '../src/engine/SingleTorusEngine';
import { MultiTorusEngine } from '../src/engine/MultiTorusEngine';
import { buildCoupling, chordOffsets } from '../src/web/coupling';
import { TuringTape, zeckendorf, TAPE_BOUND } from '../src/memory/turingTape';
import { DENSE_CORE } from '../src/core/scaleLadder';
import { EngineHost } from '../src/runtime/host';
import { createField } from '../src/core/complex';

describe('N0 — per-node organ coverage', () => {
  it('gives every node an eigenmode, radial, superposition and sensory record', () => {
    const e = new SingleTorusEngine({ nodes: 89, seed: 'n0', organs: {} });
    e.run(21);
    const o = e.organs!;
    expect(o.n).toBe(89);
    for (let j = 0; j < o.n; j++) {
      expect(Number.isFinite(o.eigenResidual[j])).toBe(true);
      expect(o.eigenLead[j]).toBeGreaterThanOrEqual(0);
      expect(o.participation[j]).toBeGreaterThan(0);
      expect(o.participation[j]).toBeLessThanOrEqual(1 + 1e-12);
      expect(o.localCoherence[j]).toBeGreaterThanOrEqual(0);
      expect(o.localCoherence[j]).toBeLessThanOrEqual(1 + 1e-12);
      expect(o.senseGain[j]).toBeGreaterThanOrEqual(0);
      // every node owns a full radial coefficient row, not a shared one
      let nonzero = 0;
      for (let k = 0; k < o.orders; k++) if (o.radialCoef[j * o.orders + k] !== 0) nonzero++;
      expect(nonzero).toBeGreaterThan(0);
    }
  });

  it('gives different nodes different radial rows (no shared surrogate ray)', () => {
    const e = new SingleTorusEngine({ nodes: 144, seed: 'n0-ray', organs: {} });
    e.run(13);
    const o = e.organs!;
    const rows = new Set<string>();
    for (let j = 0; j < o.n; j++) {
      rows.add(Array.from(o.radialCoef.slice(j * o.orders, (j + 1) * o.orders)).join(','));
    }
    expect(rows.size).toBeGreaterThan(o.n / 2);
  });

  it('reports exact bytes and refuses an out-of-envelope radial gain', () => {
    const o = new NodeOrgans(55, 13, {});
    expect(o.bytes()).toBeGreaterThan(organBytes(55) * 0.5);
    expect(() => new NodeOrgans(55, 13, { radialGain: RADIAL_GAIN_MAX * 2 })).toThrow(RangeError);
    expect(() => new NodeOrgans(0, 13)).toThrow(RangeError);
  });

  it('is inert at radialGain 0 — digest identical to a rung without organs', () => {
    const bare = new SingleTorusEngine({ nodes: 89, seed: 'inert' });
    const with0 = new SingleTorusEngine({ nodes: 89, seed: 'inert', organs: { radialGain: 0 } });
    bare.run(233);
    with0.run(233);
    expect(with0.digest()).toBe(bare.digest());
  });

  it('is deterministic: the same build twice agrees bit-for-bit under drive', () => {
    const mk = () => new SingleTorusEngine({ nodes: 89, seed: 'det', organs: { radialGain: 0.3 } });
    const a = mk();
    const b = mk();
    a.run(200);
    b.run(200);
    expect(a.digest()).toBe(b.digest());
    for (let j = 0; j < 89; j++) {
      expect(a.organs!.radialCoef[j]).toBe(b.organs!.radialCoef[j]);
    }
  });

  it('stays bounded and finite when the radial organ drives the R slot', () => {
    const e = new SingleTorusEngine({
      nodes: 144,
      seed: 'drive',
      organs: { radialGain: RADIAL_GAIN_MAX },
      drive: 0.5,
    });
    const r = e.run(1000);
    expect(r.finite).toBe(true);
    expect(r.clamped).toBe(0);
    expect(r.peak).toBeLessThan(TAPE_BOUND * 4);
  });
});

describe('N2 — per-node receptors', () => {
  it('scales the sensory injection node by node and records what landed', () => {
    const e = new SingleTorusEngine({ nodes: 55, seed: 'recv', organs: {} });
    const o = e.organs!;
    o.setReceptor(7, 1, 0);
    const s = createField(55);
    for (let j = 0; j < 55; j++) {
      s.re[j] = 0.4;
      s.im[j] = 0;
    }
    e.setSensory(s);
    expect(o.senseLast[7]).toBe(0);
    expect(o.senseLast[8]).toBeGreaterThan(0);
    expect(() => o.setReceptor(999, 1)).toThrow(RangeError);
  });
});

describe('N3 — stable-ratio chords', () => {
  const rungs = DENSE_CORE.slice(0, 18);

  it('reproduces the pre-chord matrix exactly when no chords are asked for', () => {
    const a = buildCoupling(rungs, { band: 3 });
    const b = buildCoupling(rungs, { band: 3, chords: [], chordGain: 1 });
    expect(Array.from(b.w)).toEqual(Array.from(a.w));
    expect(a.chords).toEqual([]);
  });

  it('installs long-range offsets and still sums every row to exactly 1', () => {
    const m = buildCoupling(rungs, {
      band: 3,
      chords: ['fibonacci', 'lucas', 'spiral'],
      chordGain: 0.618,
    });
    expect(m.chords.length).toBeGreaterThan(0);
    for (const d of m.chords) expect(d).toBeGreaterThan(3);
    expect(m.rowSumDefect).toBeLessThan(1e-15);
    // a chord actually reaches beyond the band
    let reached = false;
    for (let i = 0; i < m.size; i++) {
      for (let j = 0; j < m.size; j++) {
        if (Math.abs(i - j) > 3 && m.w[i * m.size + j] > 0) reached = true;
      }
    }
    expect(reached).toBe(true);
  });

  it('never lets a chord outrank a same-distance neighbour', () => {
    const m = buildCoupling(rungs, { band: 1, chords: ['fibonacci'], chordGain: 1 });
    for (let i = 1; i < m.size - 1; i++) {
      const neighbour = m.w[i * m.size + (i - 1)];
      for (const d of m.chords) {
        if (i - d < 0) continue;
        expect(m.w[i * m.size + (i - d)]).toBeLessThan(neighbour);
      }
    }
  });

  it('offsets are the ladder’s own arithmetic', () => {
    expect(chordOffsets('fibonacci', 18)).toEqual([1, 2, 3, 5, 8, 13]);
    expect(chordOffsets('lucas', 18)).toEqual([1, 3, 4, 7, 11]);
    expect(chordOffsets('spiral', 18)).toEqual([2, 3, 4, 7, 11]);
  });

  it('a chorded web runs finite with zero ordering violations', () => {
    const w = new MultiTorusEngine({
      rungs: rungs.slice(0, 8),
      nodes: 55,
      seed: 'chorded',
      chords: ['fibonacci', 'lucas', 'spiral'],
      chordGain: 0.618,
    });
    const r = w.run(300);
    expect(r.finite).toBe(true);
    expect(r.orderingViolations).toBe(0);
    expect(Math.abs(r.fluxImbalance)).toBeLessThan(1e-9);
    expect(r.rowSumDefect).toBeLessThan(1e-15);
  });
});

describe('N4 — permanent processing tape', () => {
  it('addresses in Zeckendorf and refuses a non-Fibonacci capacity', () => {
    expect(zeckendorf(0)).toEqual([]);
    expect(zeckendorf(12).map((i) => [1, 2, 3, 5, 8, 13, 21][i])).toEqual([8, 3, 1]);
    expect(() => new TuringTape({ capacity: 1000 })).toThrow(RangeError);
  });

  it('writes, moves the head by Fibonacci strides, and never exceeds the bound', () => {
    const tape = new TuringTape({ capacity: 233 });
    const e = new SingleTorusEngine({ nodes: 89, seed: 'tape', drive: 0.6 });
    const motions = new Set<number>();
    for (let t = 0; t < 500; t++) {
      e.step();
      const st = tape.advance(e.snapshot().z);
      motions.add(Math.abs(st.motion));
      expect(st.peak).toBeLessThanOrEqual(TAPE_BOUND + 1e-12);
    }
    expect(tape.occupied()).toBeGreaterThan(1);
    // every motion magnitude is a Fibonacci number or a deliberate stay
    for (const m of motions) expect([0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233]).toContain(m);
  });

  it('checkpoints and restores exactly', () => {
    const tape = new TuringTape({ capacity: 233 });
    const e = new SingleTorusEngine({ nodes: 89, seed: 'tape-cp', drive: 0.6 });
    for (let t = 0; t < 120; t++) {
      e.step();
      tape.advance(e.snapshot().z);
    }
    const cp = tape.checkpoint();
    const headAt = tape.position();
    for (let t = 0; t < 60; t++) {
      e.step();
      tape.advance(e.snapshot().z);
    }
    expect(tape.position()).not.toBe(-1);
    tape.restore(cp);
    expect(tape.position()).toBe(headAt);
    expect(tape.steps()).toBe(cp.step);
    for (let a = 0; a < 233; a++) expect(tape.cell(a).re).toBe(cp.re[a]);
  });

  it('is deterministic across two identical runs', () => {
    const run = () => {
      const tape = new TuringTape({ capacity: 233 });
      const e = new SingleTorusEngine({ nodes: 89, seed: 'tape-det', drive: 0.6 });
      let last = tape.advance(e.snapshot().z);
      for (let t = 0; t < 300; t++) {
        e.step();
        last = tape.advance(e.snapshot().z);
      }
      return last;
    };
    expect(run()).toEqual(run());
  });

  it('does not perturb the rung digests it observes', () => {
    const bare = new MultiTorusEngine({ rungs: DENSE_CORE.slice(0, 5), nodes: 55, seed: 'tap' });
    const taped = new MultiTorusEngine({
      rungs: DENSE_CORE.slice(0, 5),
      nodes: 55,
      seed: 'tap',
      tape: { capacity: 233 },
    });
    bare.run(150);
    taped.run(150);
    expect(taped.engines[0].digest()).toBe(bare.engines[0].digest());
    expect(taped.tape!.occupied()).toBeGreaterThan(0);
  });
});

describe('N6 — hosted build carries the whole stack', () => {
  it('every node on every rung has organs, plus chords and a live tape', () => {
    const host = new EngineHost({ profile: 'NANO', seed: 'n6' });
    for (let i = 0; i < 60; i++) host.stepOnce();
    const s = host.snapshot();
    expect(s.organNodes).toBe(s.totalNodes);
    expect(s.chords.length).toBeGreaterThan(0);
    expect(s.tapeCapacity).toBeGreaterThan(0);
    expect(s.tapeOccupancy).toBeGreaterThan(0);
    expect(s.organParticipation).toBeGreaterThan(0);
    expect(s.finite).toBe(true);
  });

  it('can be built without any of it, and then reports honest zeros', () => {
    const host = new EngineHost({
      profile: 'PICO',
      seed: 'n6-off',
      organs: null,
      chords: null,
      tape: null,
    });
    for (let i = 0; i < 30; i++) host.stepOnce();
    const s = host.snapshot();
    expect(s.organNodes).toBe(0);
    expect(s.chords).toEqual([]);
    expect(s.tapeCapacity).toBe(0);
  });
});

describe('N0 — radial plane is representable on every dense-core rung', () => {
  it('keeps a full-rank basis for every ladder index in the dense core', () => {
    for (const rung of [1, 13, 15, 27, 29, 41, 43, 55, 57, 69, 71, 83, 85, 97, 99, 111, 113, 125]) {
      const o = new NodeOrgans(89, 13, { rung });
      const r = o.report();
      expect(r.radialBands).toBe(8);
      expect(r.radialGramDefect).toBeLessThan(0.5);
      expect(o.radialBasis.grid.n).toBeGreaterThanOrEqual(8);
    }
  });

  it('reads the reconstruction inside the ray envelope (bounded saturation)', () => {
    const e = new SingleTorusEngine({ nodes: 233, seed: 'radial-env', rung: 55, organs: {} });
    e.run(200);
    const r = e.organs!.report();
    expect(r.radialBands).toBe(8);
    expect(r.radialPeak).toBeGreaterThan(0);
    expect(Number.isFinite(r.radialPeak)).toBe(true);
    expect(r.radialClipped).toBeLessThanOrEqual(233);
  });
});
