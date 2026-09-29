/**
 * N1 battery — the per-node sensory array and the toroid scan.
 *
 * Every law the SNA claims is measured here, not asserted in a comment:
 *
 *  N1-1  band plan bins are distinct, in range, and φ-ordered
 *  N1-2  the block DFT accumulator equals a Bluestein FFT bin, exactly
 *  N1-3  Parseval capture is a true fraction on a pure in-band tone
 *  N1-4  current divergence closes: Σ_j div_j = 0 to machine precision
 *  N1-5  digest parity — sensors on vs. off produces identical digests
 *  N1-6  determinism — two identical runs agree bit-for-bit on every readout
 *  N1-7  energy shares sum to 1 and the entropy stays in [0, 1]
 *  N1-8  scanRung reports ABSENT rather than zeros when a section is missing
 *  N1-9  a live scan passes all six sections on a driven rung
 */

import { describe, expect, it } from 'vitest';
import { SingleTorusEngine } from '../src/engine/SingleTorusEngine';
import { MultiTorusEngine } from '../src/engine/MultiTorusEngine';
import { DENSE_CORE } from '../src/core/scaleLadder';
import { SensoryNodeArray, planBands, goldenStride, LADDER_ANCHOR } from '../src/sense/nodeArray';
import { scanRung } from '../src/sense/scan';
import { createLattice } from '../src/torus/lattice';
import { createField } from '../src/core/complex';
import { fft } from '../src/spectral/fft';
import { PHI_INV } from '../src/core/constants';

const DEPTH = 89;
const BANDS = 8;

describe('N1-1 band plan', () => {
  it('snaps the φ ladder to distinct in-range DFT bins', () => {
    const plan = planBands(BANDS, DEPTH);
    expect(plan).toHaveLength(BANDS);
    const bins = new Set(plan.map((p) => p.bin));
    expect(bins.size).toBe(BANDS);
    for (const p of plan) {
      expect(p.bin).toBeGreaterThan(0);
      expect(p.bin).toBeLessThan(DEPTH);
      const signed = p.bin <= DEPTH / 2 ? p.bin : p.bin - DEPTH;
      expect(p.frequency).toBeCloseTo(signed / DEPTH, 15);
      expect(Math.sign(p.frequency)).toBe(p.sense);
    }
    // The ladder is anchored on a φ power, not on Nyquist.
    expect(LADDER_ANCHOR).toBeCloseTo(PHI_INV * PHI_INV, 15);
    expect(plan[0].target).toBeCloseTo(LADDER_ANCHOR, 15);
    // Bands come in ± pairs at the same φ rung.
    for (let k = 0; k < BANDS; k += 2) {
      expect(plan[k].sense).toBe(1);
      expect(plan[k + 1].sense).toBe(-1);
      expect(plan[k].target).toBeCloseTo(-plan[k + 1].target, 15);
      expect(plan[k].frequency).toBeCloseTo(-plan[k + 1].frequency, 15);
    }
    // φ ordering: each rung's target magnitude is exactly φ⁻¹ of the previous.
    for (let k = 2; k < BANDS; k += 2) {
      expect(plan[k].target / plan[k - 2].target).toBeCloseTo(PHI_INV, 12);
    }
  });

  it('refuses a non-Fibonacci window, an odd band count and an over-wide request', () => {
    expect(() => new SensoryNodeArray(89, { depth: 90 })).toThrow(/Fibonacci/);
    expect(() => new SensoryNodeArray(89, { depth: 21, bands: 7 })).toThrow(/even/);
    expect(() => new SensoryNodeArray(89, { depth: 8, bands: 16 })).toThrow(/cannot fit/);
  });
});

/** Drive one node with a known complex signal for `depth` ticks. */
function driveSingleNode(
  array: SensoryNodeArray,
  lattice: ReturnType<typeof createLattice>,
  n: number,
  sample: (t: number) => [number, number],
): void {
  const z = createField(n);
  for (let t = 0; t < array.depth; t++) {
    z.re.fill(0);
    z.im.fill(0);
    const [re, im] = sample(t);
    z.re[0] = re;
    z.im[0] = im;
    array.update(z, lattice);
  }
}

describe('N1-2 accumulator equals the FFT bin', () => {
  it('matches a Bluestein FFT of the same window to machine precision', () => {
    const n = 89;
    const lattice = createLattice(n);
    const array = new SensoryNodeArray(n, { bands: BANDS, depth: DEPTH });
    const samples: Array<[number, number]> = [];
    // a deterministic, spectrally rich signal — three tones plus a ramp
    const gen = (t: number): [number, number] => {
      const a =
        Math.cos((2 * Math.PI * 7 * t) / DEPTH) + 0.4 * Math.cos((2 * Math.PI * 27 * t) / DEPTH);
      const b =
        Math.sin((2 * Math.PI * 17 * t) / DEPTH) - 0.25 * Math.sin((2 * Math.PI * 3 * t) / DEPTH);
      return [a, b];
    };
    for (let t = 0; t < DEPTH; t++) samples.push(gen(t));
    driveSingleNode(array, lattice, n, gen);

    const re = Float64Array.from(samples, (s) => s[0]);
    const im = Float64Array.from(samples, (s) => s[1]);
    const spec = fft(re, im);

    for (const p of array.plan) {
      const fr = spec.re[p.bin];
      const fi = spec.im[p.bin];
      const expected = Math.hypot(fr, fi) / DEPTH;
      const got = array.bandAmp[p.index];
      expect(Math.abs(got - expected)).toBeLessThan(1e-11);
    }
  });
});

describe('N1-3 Parseval capture', () => {
  it('reports full capture for a signal built only from planned bins', () => {
    const n = 89;
    const lattice = createLattice(n);
    const array = new SensoryNodeArray(n, { bands: BANDS, depth: DEPTH });
    const plan = array.plan;
    driveSingleNode(array, lattice, n, (t) => {
      let re = 0;
      let im = 0;
      for (const p of plan) {
        const th = (2 * Math.PI * p.bin * t) / DEPTH;
        re += Math.cos(th);
        im += Math.sin(th);
      }
      return [re, im];
    });
    // Signal lives entirely on planned positive-frequency bins.
    expect(array.capture[0]).toBeGreaterThan(0.999999);
    expect(array.capture[0]).toBeLessThanOrEqual(1);
  });

  it('reports partial capture when the energy sits off the ladder', () => {
    const n = 89;
    const lattice = createLattice(n);
    const array = new SensoryNodeArray(n, { bands: 2, depth: DEPTH });
    const off = 13; // not in the 2-band plan (bins 34 and 89−34)
    driveSingleNode(array, lattice, n, (t) => {
      const th = (2 * Math.PI * off * t) / DEPTH;
      return [Math.cos(th), Math.sin(th)];
    });
    expect(array.capture[0]).toBeLessThan(0.01);
  });
});

describe('N1-4 flux closure', () => {
  it('sums the current divergence to zero across the grid', () => {
    const n = 233;
    const lattice = createLattice(n);
    const array = new SensoryNodeArray(n, { bands: BANDS, depth: DEPTH });
    const z = createField(n);
    for (let j = 0; j < n; j++) {
      const th = 2 * Math.PI * j * PHI_INV;
      z.re[j] = Math.cos(th) * (1 + 0.3 * Math.cos((7 * Math.PI * j) / n));
      z.im[j] = Math.sin(2 * th) * (1 - 0.2 * Math.sin((5 * Math.PI * j) / n));
    }
    const rep = array.update(z, lattice);
    expect(rep.circulation).toBeGreaterThan(0);
    expect(Math.abs(rep.divergenceSum) / rep.circulation).toBeLessThan(1e-12);
  });

  it('uses the lattice golden stride for the minor-spiral incident lines', () => {
    const array = new SensoryNodeArray(233, { bands: 4, depth: 21 });
    expect(array.goldenStep).toBe(goldenStride(233));
    expect(array.goldenStep).toBeGreaterThan(0);
    expect(array.goldenStep).toBeLessThan(233);
  });
});

describe('N1-5 digest parity', () => {
  it('leaves the single-rung digest bit-identical', () => {
    const base = new SingleTorusEngine({ nodes: 89, seed: 'n1-parity', coherenceDelay: 13 });
    const sensed = new SingleTorusEngine({
      nodes: 89,
      seed: 'n1-parity',
      coherenceDelay: 13,
      sensors: { bands: BANDS, depth: DEPTH },
    });
    let a = base.run(1);
    let b = sensed.run(1);
    for (let i = 0; i < 120; i++) {
      a = base.step();
      b = sensed.step();
      expect(b.digest).toBe(a.digest);
    }
    expect(sensed.sensorReport()!.windowsClosed).toBeGreaterThan(0);
  });

  it('leaves the web digest bit-identical across the dense core', () => {
    const rungs = DENSE_CORE.slice(0, 4);
    const mk = (sensors: boolean) =>
      new MultiTorusEngine({
        rungs,
        nodes: 89,
        seed: 'n1-web',
        coherenceDelay: 13,
        drive: 0.5,
        sensors: sensors ? { bands: 4, depth: 21 } : undefined,
      });
    const base = mk(false);
    const sensed = mk(true);
    for (let i = 0; i < 60; i++) {
      const a = base.step();
      const b = sensed.step();
      expect(b.digest).toBe(a.digest);
    }
  });
});

describe('N1-6 determinism', () => {
  it('produces identical readouts on two identical runs', () => {
    const mk = () =>
      new SingleTorusEngine({
        nodes: 89,
        seed: 'n1-det',
        coherenceDelay: 13,
        drive: 0.4,
        sensors: { bands: 4, depth: 21 },
      });
    const a = mk();
    const b = mk();
    a.run(97);
    b.run(97);
    expect(Array.from(a.sensors!.bandAmp)).toEqual(Array.from(b.sensors!.bandAmp));
    expect(Array.from(a.sensors!.divergence)).toEqual(Array.from(b.sensors!.divergence));
    expect(Array.from(a.sensors!.frequency)).toEqual(Array.from(b.sensors!.frequency));
    expect(a.sensorReport()).toEqual(b.sensorReport());
  });
});

describe('N1-7 energy bookkeeping', () => {
  it('keeps shares normalised and entropy inside [0, 1]', () => {
    const e = new SingleTorusEngine({
      nodes: 233,
      seed: 'n1-energy',
      coherenceDelay: 13,
      drive: 0.6,
      sensors: { bands: 4, depth: 21 },
    });
    e.run(64);
    const s = e.sensors!;
    let sum = 0;
    for (let j = 0; j < s.n; j++) sum += s.share[j];
    expect(sum).toBeCloseTo(1, 12);
    const rep = e.sensorReport()!;
    expect(rep.energyEntropy).toBeGreaterThan(0);
    expect(rep.energyEntropy).toBeLessThanOrEqual(1);
    expect(rep.peakShare).toBeGreaterThan(0);
    expect(rep.peakShare).toBeLessThanOrEqual(1);
    expect(s.bytes()).toBeGreaterThan(0);
  });
});

describe('N1-8/9 toroid scan', () => {
  it('marks missing sections ABSENT instead of reporting zeros', () => {
    const e = new SingleTorusEngine({ nodes: 89, seed: 'n1-scan-bare', coherenceDelay: 13 });
    e.run(5);
    const r = scanRung(e, 0);
    expect(r.census.status).toBe('OK');
    expect(r.organs.status).toBe('ABSENT');
    expect(r.spectral.status).toBe('ABSENT');
    expect(r.energy.status).toBe('ABSENT');
    expect(r.flux.status).toBe('ABSENT');
    expect(r.verdict.notes.join(' ')).toMatch(/no sensory node array/);
    expect(r.verdict.pass).toBe(true);
  });

  it('passes all six sections on a live instrumented rung', () => {
    const e = new SingleTorusEngine({
      nodes: 233,
      seed: 'n1-scan-live',
      coherenceDelay: 13,
      drive: 0.6,
      organs: { radialOrders: 8, radialGain: 0, stride: 3 },
      sensors: { bands: 4, depth: 21 },
    });
    e.run(64);
    const r = scanRung(e, 0);
    expect(r.census.nodes).toBe(233);
    expect(r.census.separationRatio).toBeGreaterThan(0);
    expect(r.organs.status).toBe('OK');
    expect(r.spectral.status).toBe('OK');
    expect(r.spectral.windowsClosed).toBeGreaterThan(0);
    expect(r.spectral.occupancy).toHaveLength(4);
    // The probe must locate the motion even where the sparse ladder misses it.
    expect(r.spectral.probe).not.toBeNull();
    expect(r.spectral.probe!.lines.length).toBeGreaterThan(0);
    const shares = r.spectral.probe!.lines.map((l) => l.share);
    expect(shares).toEqual([...shares].sort((a, b) => b - a));
    expect(shares[0]).toBeGreaterThan(0);
    expect(r.spectral.probe!.ladderShare).toBeGreaterThanOrEqual(0);
    expect(r.spectral.probe!.ladderShare).toBeLessThanOrEqual(1);
    expect(r.energy.hotNodes.length).toBe(8);
    expect(r.flux.status).toBe('OK');
    expect(r.verdict.defects).toEqual([]);
    expect(r.verdict.pass).toBe(true);
  });
});
