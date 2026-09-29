/**
 * S1 — scale↔sensor binding and the rung-enable criterion.
 *
 * Falsifiable claims:
 *   1. A rung with no declared band is `inferred` and carries no sensor.
 *   2. A rung is `measured` only when a real frontend covers its band AND
 *      satisfies Nyquist on the band's top edge.
 *   3. Band widths are reported in octaves and φ-rungs, matching the
 *      Wolfram-verified figures for hearing and vision.
 *   4. A rung turns on only when the ring residual is non-increasing across a
 *      full Fibonacci window; a partial window, a NaN, or any real increase
 *      above the Pisot floor refuses it.
 */

import { describe, it, expect } from 'vitest';
import {
  bandOctaves,
  bandPhiRungs,
  bindScaleSensors,
  sensorCovers,
  sensorNyquistOk,
  type SensorPassband,
} from '@/core/runtime/rhuftf/ScaleMeasurement';
import {
  RHUFTF_SCALE_SHAPES,
  RHUFTF_SCALE_BANDS,
  RHUFTF_SENSOR_PASSBANDS,
  rhuftfScaleBindings,
} from '@/core/runtime/rhuftf/registry';
import { RingWindow, fibWindow, pisotFloor } from '@/core/runtime/rhuftf/torusClosure';

const AUDIBLE = { fLo: 20, fHi: 20000 };
const VISIBLE = { fLo: 4.3e14, fHi: 7.5e14 };

describe('band arithmetic', () => {
  it('hearing spans 9.965784285 octaves', () => {
    expect(bandOctaves(AUDIBLE)).toBeCloseTo(9.965784284662087, 9);
  });

  it('vision spans less than one octave', () => {
    expect(bandOctaves(VISIBLE)).toBeCloseTo(0.802553935793783, 9);
    expect(bandOctaves(VISIBLE)).toBeLessThan(1);
  });

  it('reports width in φ-rungs, the ladder unit', () => {
    expect(bandPhiRungs(AUDIBLE)).toBeCloseTo(Math.log(1000) / Math.log(1.618033988749895), 6);
  });

  it('returns NaN rather than 0 for an undeclared band', () => {
    expect(bandOctaves(null)).toBeNaN();
    expect(bandPhiRungs(null)).toBeNaN();
    expect(bandOctaves({ fLo: 0, fHi: 100 })).toBeNaN();
  });
});

describe('sensor coverage and Nyquist', () => {
  const mic: SensorPassband = { sensor: 'audio', fLo: 20, fHi: 20000, sampleRateHz: 48000 };
  const slowMic: SensorPassband = { sensor: 'slow', fLo: 20, fHi: 20000, sampleRateHz: 8000 };
  const retina: SensorPassband = { sensor: 'vision', fLo: 4.3e14, fHi: 7.5e14 };

  it('accepts a covering, fast-enough sampled sensor', () => {
    expect(sensorCovers(mic, AUDIBLE)).toBe(true);
    expect(sensorNyquistOk(mic, AUDIBLE)).toBe(true);
  });

  it('rejects an undersampled sensor even when it claims the band', () => {
    expect(sensorCovers(slowMic, AUDIBLE)).toBe(true);
    expect(sensorNyquistOk(slowMic, AUDIBLE)).toBe(false);
  });

  it('exempts an integrating detector from Nyquist on the carrier', () => {
    expect(sensorNyquistOk(retina, VISIBLE)).toBe(true);
  });

  it('rejects partial coverage', () => {
    expect(sensorCovers(mic, { fLo: 5, fHi: 20000 })).toBe(false);
    expect(sensorCovers(mic, { fLo: 20, fHi: 30000 })).toBe(false);
  });
});

describe('ladder binding', () => {
  const bindings = rhuftfScaleBindings();

  it('binds every declared rung exactly once, in order', () => {
    expect(bindings.length).toBe(RHUFTF_SCALE_SHAPES.length);
    expect(bindings.map((b) => b.scale)).toEqual(RHUFTF_SCALE_SHAPES.map((s) => s.scale));
  });

  it('marks a rung with no band as inferred with no sensor', () => {
    for (const b of bindings) {
      if (RHUFTF_SCALE_BANDS[b.scale] === null) {
        expect(b.provenance).toBe('inferred');
        expect(b.sensor).toBeNull();
        expect(b.nyquistOk).toBe(false);
        expect(b.octaves).toBeNaN();
      }
    }
  });

  it('measures the audible rung through the audio frontend', () => {
    const n4 = bindings.find((b) => b.scale === 4)!;
    expect(n4.provenance).toBe('measured');
    expect(n4.sensor).toBe('audio');
    expect(n4.nyquistOk).toBe(true);
    expect(n4.octaves).toBeCloseTo(9.965784284662087, 9);
  });

  it('never silently scores an unsensed rung: most rungs are inferred', () => {
    const measured = bindings.filter((b) => b.provenance === 'measured');
    expect(measured.length).toBeGreaterThan(0);
    expect(measured.length).toBeLessThan(bindings.length);
  });

  it('refuses a band no declared frontend covers', () => {
    const out = bindScaleSensors(
      [{ scale: 0, nodes: 7 }],
      [{ fLo: 1e9, fHi: 1e10 }],
      RHUFTF_SENSOR_PASSBANDS,
    );
    expect(out[0].provenance).toBe('inferred');
    expect(out[0].sensor).toBeNull();
    expect(out[0].octaves).toBeCloseTo(Math.log2(10), 12);
  });

  it('is deterministic', () => {
    expect(rhuftfScaleBindings()).toEqual(bindings);
  });
});

describe('rung-enable criterion', () => {
  it('rounds the window up to a Fibonacci length', () => {
    expect(fibWindow(1)).toBe(3);
    expect(fibWindow(13)).toBe(13);
    expect(fibWindow(14)).toBe(21);
  });

  it('refuses a partially filled window', () => {
    const w = new RingWindow(20, 5);
    for (let i = 0; i < 4; i++) {
      const v = w.push(1 / (i + 1));
      expect(v.stable).toBe(false);
    }
    expect(w.push(1 / 5).stable).toBe(true);
  });

  it('accepts a monotonically closing loop and reports negative φ-decay', () => {
    const w = new RingWindow(20, 5);
    let r = 1;
    let v = w.verdict();
    for (let i = 0; i < 5; i++) {
      v = w.push(r);
      r /= 1.618033988749895;
    }
    expect(v.stable).toBe(true);
    expect(v.violation).toBe(-1);
    expect(v.decayPhiPerTick).toBeCloseTo(-1, 9);
  });

  it('refuses any real increase and names the offending step', () => {
    const w = new RingWindow(20, 5);
    const seq = [1, 0.5, 0.25, 0.4, 0.2];
    let v = w.verdict();
    for (const x of seq) v = w.push(x);
    expect(v.stable).toBe(false);
    expect(v.violation).toBe(3);
  });

  it('tolerates increases below the Pisot floor — that is float64 noise', () => {
    const rung = 10;
    const floor = pisotFloor(rung);
    const w = new RingWindow(rung, 5);
    let v = w.verdict();
    for (const x of [floor, floor / 2, floor / 4, floor / 2, floor / 8]) v = w.push(x);
    expect(v.floor).toBeCloseTo(floor, 20);
    expect(v.stable).toBe(true);
  });

  it('treats a non-finite residual as loss of evidence, not as stability', () => {
    const w = new RingWindow(20, 3);
    w.push(1);
    w.push(0.5);
    const v = w.push(NaN);
    expect(v.count).toBe(0);
    expect(v.stable).toBe(false);
    w.push(0.3);
    w.push(0.2);
    expect(w.push(0.1).stable).toBe(true);
  });
});
