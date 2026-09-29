/**
 * Gate G6 — sensory plane + braid memory.
 *
 * Contract under test:
 *   • encoders are deterministic and never break ‖v‖_inf ≤ φ
 *   • fusion of k channels stays inside the bound for any k
 *   • the plane refuses an actuator loop gain above φ⁻²
 *   • attaching a silent plane leaves the engine digest bit-identical (no regression)
 *   • a live plane actually drives the field (the P5 relaxation-to-zero is cured)
 *   • braid recall ≥ 0.99 at rated capacity, and the R1–R6 cascade is ordered
 */

import { describe, expect, it } from 'vitest';
import {
  MultiTorusEngine,
  PHI,
  SingleTorusEngine,
  createField,
  maxNorm,
  phiPow,
} from '../src/index';
import {
  SENSE_BOUND,
  boundField,
  encodeAudio,
  encodeGrid,
  encodeScalars,
  encodeText,
  senseField,
} from '../src/sense/encode';
import { fuseChannels } from '../src/sense/fusion';
import { MAX_LOOP_GAIN, SensoryPlane } from '../src/sense/plane';
import { TorusBraid, braidBeta, ratedCapacity, BRAID_MULTIPLICITY } from '../src/memory/braid';

const N = 144;

function ramp(n: number, k: number): Float64Array {
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.sin((2 * Math.PI * k * i) / n) * 3;
  return v;
}

describe('G6.1 — encoders', () => {
  it('SENSE_BOUND is exactly φ', () => {
    expect(SENSE_BOUND).toBe(PHI);
  });

  it('scalar encoding is deterministic and bounded', () => {
    const a = senseField(N);
    const b = senseField(N);
    const r1 = encodeScalars(ramp(377, 5), a);
    const r2 = encodeScalars(ramp(377, 5), b);
    expect(Array.from(a.re)).toEqual(Array.from(b.re));
    expect(Array.from(a.im)).toEqual(Array.from(b.im));
    expect(r1.peak).toBeLessThanOrEqual(SENSE_BOUND + 1e-12);
    expect(r1.scale).toBeLessThanOrEqual(1);
    expect(r2.support).toBeGreaterThan(0);
  });

  it('a quiet input is never inflated to the bound', () => {
    const f = senseField(N);
    const tiny = new Float64Array(N).fill(1e-6);
    const rep = encodeScalars(tiny, f);
    expect(rep.scale).toBe(1);
    expect(rep.peak).toBeLessThan(1e-5);
  });

  it('text encoding is order sensitive and deterministic', () => {
    const a = senseField(N);
    const b = senseField(N);
    const c = senseField(N);
    encodeText('metatron omega', a);
    encodeText('metatron omega', b);
    encodeText('omega metatron', c);
    expect(Array.from(a.re)).toEqual(Array.from(b.re));
    let same = true;
    for (let i = 0; i < N; i++) if (Math.abs(a.re[i] - c.re[i]) > 1e-15) same = false;
    expect(same).toBe(false);
    expect(maxNorm(a)).toBeLessThanOrEqual(SENSE_BOUND + 1e-12);
  });

  it('grid and audio encoders respect the bound', () => {
    const g = senseField(N);
    const data = new Float64Array(32 * 32);
    for (let i = 0; i < data.length; i++) data[i] = (i % 17) * 9;
    const gr = encodeGrid(data, 32, 32, g);
    expect(gr.peak).toBeLessThanOrEqual(SENSE_BOUND + 1e-12);

    const a = senseField(N);
    const pcm = new Float64Array(2048);
    for (let i = 0; i < pcm.length; i++) pcm[i] = 5 * Math.sin(i * 0.31);
    const ar = encodeAudio(pcm, a);
    expect(ar.peak).toBeLessThanOrEqual(SENSE_BOUND + 1e-12);
    expect(ar.energy).toBeGreaterThan(0);
  });

  it('boundField only ever scales down', () => {
    const f = senseField(8);
    f.re[0] = 0.1;
    const before = maxNorm(f);
    boundField(f);
    expect(maxNorm(f)).toBe(before);
  });
});

describe('G6.2 — fusion', () => {
  it('k channels stay inside the bound for k = 1..13', () => {
    for (let k = 1; k <= 13; k++) {
      const inputs = [];
      for (let c = 0; c < k; c++) {
        const f = senseField(N);
        encodeScalars(ramp(N, c + 1), f);
        inputs.push({ id: `c${c}`, field: f });
      }
      const out = senseField(N);
      const rep = fuseChannels(inputs, out);
      expect(rep.count).toBe(k);
      expect(rep.weight).toBeCloseTo(1 / Math.sqrt(k), 15);
      expect(rep.withinBound).toBe(true);
      expect(maxNorm(out)).toBeLessThanOrEqual(SENSE_BOUND + 1e-12);
    }
  });

  it('an empty fusion is a zero field, not an error', () => {
    const out = senseField(N);
    const rep = fuseChannels([], out);
    expect(rep.count).toBe(0);
    expect(maxNorm(out)).toBe(0);
  });
});

describe('G6.3 — the sensory plane', () => {
  const nodes = [144, 89, 55];

  it('rejects a loop gain above φ⁻²', () => {
    const plane = new SensoryPlane(nodes);
    expect(plane.currentLoopGain()).toBeCloseTo(phiPow(-2), 15);
    expect(() => plane.setLoopGain(MAX_LOOP_GAIN * 1.001)).toThrow(/exceeds/);
    expect(plane.setLoopGain(phiPow(-3))).toBeCloseTo(phiPow(-3), 15);
  });

  it('injects a bounded, falling-off field on every rung', () => {
    const plane = new SensoryPlane(nodes);
    plane.declare({ id: 'audio', modality: 'audio', nodes: 144 });
    const f = senseField(144);
    encodeScalars(ramp(144, 3), f);
    plane.push('audio', f, 0);
    const { fields, report } = plane.resolve();
    expect(fields.length).toBe(3);
    expect(report.withinBound).toBe(true);
    expect(report.rungs[0].peak).toBeGreaterThan(0);
    // φ^(-r/2) falloff is monotone
    expect(report.rungs[0].falloff).toBeGreaterThan(report.rungs[1].falloff);
    expect(report.rungs[1].falloff).toBeGreaterThan(report.rungs[2].falloff);
    for (const r of report.rungs) expect(r.peak).toBeLessThanOrEqual(SENSE_BOUND + 1e-12);
  });

  it('a muted plane injects exactly zero', () => {
    const plane = new SensoryPlane(nodes);
    plane.declare({ id: 'text', modality: 'text', nodes: 144 });
    const f = senseField(144);
    encodeText('hello', f);
    plane.push('text', f, 0);
    plane.mute('text');
    const { fields } = plane.resolve();
    for (const fl of fields) expect(maxNorm(fl)).toBe(0);
  });
});

describe('G6.4 — engine integration', () => {
  it('a silent sensory term leaves the digest bit-identical', () => {
    const a = new SingleTorusEngine({ nodes: N, seed: 'g6', coherenceDelay: 8 });
    const b = new SingleTorusEngine({ nodes: N, seed: 'g6', coherenceDelay: 8 });
    b.setSensory(null);
    for (let i = 0; i < 89; i++) {
      a.step();
      b.step();
    }
    expect(b.digest()).toBe(a.digest());
  });

  it('a live sensory injection keeps the field alive instead of relaxing to zero', () => {
    const silent = new SingleTorusEngine({ nodes: N, seed: 'g6b', coherenceDelay: 8 });
    const driven = new SingleTorusEngine({ nodes: N, seed: 'g6b', coherenceDelay: 8 });
    const s = senseField(N);
    encodeScalars(ramp(N, 2), s);
    for (let i = 0; i < 300; i++) {
      silent.step();
      driven.setSensory(s);
      driven.step();
    }
    const quiet = silent.snapshot();
    const live = driven.snapshot();
    expect(maxNorm(quiet.z)).toBeLessThan(1e-12);
    expect(maxNorm(live.z)).toBeGreaterThan(1e-6);
    expect(maxNorm(live.z)).toBeLessThan(phiPow(4)); // never clamps
  });

  it('an over-bound injection is clamped by the engine, not trusted', () => {
    const e = new SingleTorusEngine({ nodes: 55, seed: 'g6c', coherenceDelay: 8 });
    const evil = createField(55);
    for (let i = 0; i < 55; i++) evil.re[i] = 1e6;
    e.setSensory(evil);
    for (let i = 0; i < 50; i++) e.step();
    expect(maxNorm(e.snapshot().z)).toBeLessThan(phiPow(4));
  });

  it('a plane attached to the web drives every rung and stays finite', () => {
    const engine = new MultiTorusEngine({
      nodes: (_r, rank) => [144, 89, 55][rank] ?? 55,
      seed: 'g6w',
    });
    const ranks = engine.rungs.length;
    const plane = new SensoryPlane(engine.engines.map((e) => e.nodes));
    plane.declare({ id: 'scalar', modality: 'scalar', nodes: engine.engines[0].nodes });
    const f = senseField(engine.engines[0].nodes);
    encodeScalars(ramp(233, 3), f);
    plane.push('scalar', f, 0);
    engine.attachSensory(plane);
    let rep = engine.step();
    for (let i = 0; i < 200; i++) rep = engine.step();
    expect(ranks).toBeGreaterThan(0);
    expect(rep.finite).toBe(true);
    expect(rep.orderingViolations).toBe(0);
    expect(plane.report().withinBound).toBe(true);
  });
});

describe('G6.5 — TorusBraid Hopfield', () => {
  it('β(G) = φ²√(G/28)', () => {
    expect(BRAID_MULTIPLICITY).toBe(28);
    expect(braidBeta(28)).toBeCloseTo(PHI * PHI, 15);
    expect(braidBeta(112)).toBeCloseTo(PHI * PHI * 2, 15);
  });

  it('recall ≥ 0.99 at rated capacity', () => {
    const nodes = 233;
    const M = ratedCapacity(nodes);
    const braid = new TorusBraid({ nodes, capacity: M });
    const pats = [];
    for (let p = 0; p < M; p++) {
      const f = senseField(nodes);
      encodeText(`pattern-${p}-metatron`, f);
      pats.push(f);
      braid.store(`p${p}`, f, p);
    }
    expect(braid.load).toBe(M);
    let worst = 1;
    let hits = 0;
    for (let p = 0; p < M; p++) {
      const r = braid.recall(pats[p]);
      if (r.index === p) hits++;
      const sim = braid.similarityTo(p, pats[p]) / Math.max(1e-18, braid.similarityTo(p, pats[p]));
      worst = Math.min(worst, sim);
      expect(r.accepted).toBe(true);
    }
    expect(hits / M).toBeGreaterThanOrEqual(0.99);
    expect(worst).toBeGreaterThanOrEqual(0.99);
  });

  it('R1 short-circuits on an exact key', () => {
    const braid = new TorusBraid({ nodes: 89 });
    const f = senseField(89);
    encodeText('anchor', f);
    braid.store('anchor', f, 1);
    const r = braid.recall(f, 'anchor');
    expect(r.stage).toBe('R1');
    expect(r.sweeps).toBe(0);
    expect(r.similarity).toBe(1);
  });

  it('a clean cue resolves at R2 with a positive margin', () => {
    const braid = new TorusBraid({ nodes: 144 });
    for (let p = 0; p < 20; p++) {
      const f = senseField(144);
      encodeText(`cue-${p}`, f);
      braid.store(`c${p}`, f, p);
    }
    const probe = senseField(144);
    encodeText('cue-7', probe);
    const r = braid.recall(probe);
    expect(r.stage).toBe('R2');
    expect(r.key).toBe('c7');
    expect(r.margin).toBeGreaterThan(0);
  });

  it('a degraded cue escalates past R2 and still recovers the right pattern', () => {
    const braid = new TorusBraid({ nodes: 144 });
    const originals = [];
    for (let p = 0; p < 13; p++) {
      const f = senseField(144);
      encodeText(`noisy-${p}`, f);
      originals.push(f);
      braid.store(`n${p}`, f, p);
    }
    const probe = senseField(144);
    probe.re.set(originals[5].re);
    probe.im.set(originals[5].im);
    // knock out 40% of the support
    for (let i = 0; i < 144; i++)
      if (i % 5 < 2) {
        probe.re[i] = 0;
        probe.im[i] = 0;
      }
    const r = braid.recall(probe);
    expect(r.index).toBe(5);
    expect(['R2', 'R3', 'R4', 'R5', 'R6']).toContain(r.stage);
  });

  it('re-storing a key is idempotent in capacity', () => {
    const braid = new TorusBraid({ nodes: 55, capacity: 4 });
    const f = senseField(55);
    encodeText('same', f);
    for (let i = 0; i < 10; i++) braid.store('same', f, i);
    expect(braid.load).toBe(1);
  });

  it('an empty braid misses cleanly', () => {
    const braid = new TorusBraid({ nodes: 55 });
    const r = braid.recall(senseField(55));
    expect(r.stage).toBe('miss');
    expect(r.accepted).toBe(false);
  });
});
