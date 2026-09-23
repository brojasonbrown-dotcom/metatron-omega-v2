/**
 * Ω-CAPACITY C1–C6 — the measurement harness must be honest before it is fast.
 *
 * These tests do not assert a particular host's speed (that would be a flake
 * factory); they assert the *properties* a capacity measurement must have:
 * it must run something real, the transform it timed must be correct, the
 * lossless claim must hold, and the retrieval curve must be monotone.
 */
import { describe, it, expect } from 'vitest';
import {
  measureRung,
  measureEnvelope,
  probeFanIn,
  measureFanIn,
  measureSignatureDigits,
  measureBarcodeDistinct,
  measureSuperposition,
  measureLayering,
  measureDecimation,
  LOSSLESS_TOL,
  measureResidency,
  measureRetrieval,
  measureBarcodeSensitivity,
  measureCapacity,
  formatCapacityReport,
  Z_FLOOR,
} from '@/core/capacity';

describe('Ω-CAPACITY C1 · envelope', () => {
  it('c1.1 · a timed rung reports a correct transform', () => {
    const r = measureRung(233, 4);
    expect(r.width).toBe(233);
    expect(r.bandLimit).toBe(116);
    expect(r.bytesPerTick).toBe(233 * 16);
    expect(r.roundTripError).toBeLessThan(1e-12);
  });

  it('c1.2 · throughput is positive and derived from the same loop', () => {
    const r = measureRung(89, 4);
    expect(r.ticksPerSecond).toBeGreaterThan(0);
    expect(r.fftPerSecond).toBeCloseTo(r.ticksPerSecond * 2, 6);
    expect(r.numbersPerSecond).toBeCloseTo(r.ticksPerSecond * 89 * 4, 6);
  });

  it('c1.3 · wider rungs are never faster per tick than narrow ones by orders', () => {
    const a = measureRung(13, 4);
    const b = measureRung(2584, 6);
    expect(a.ticksPerSecond).toBeGreaterThan(b.ticksPerSecond);
  });

  it('c1.4 · envelope covers every probe rung and reports RAM provenance', () => {
    const e = measureEnvelope(3);
    expect(e.rungs.length).toBe(5);
    expect(e.workingBytes).toBeGreaterThan(0);
    expect(e.workingBytes).toBeLessThanOrEqual(e.ceilingBytes);
    expect(e.residentNumbers).toBeGreaterThan(0);
    expect(typeof e.provenance).toBe('string');
    expect(e.probeMs).toBeGreaterThanOrEqual(0);
  });
});

describe('Ω-CAPACITY C2 · superposition', () => {
  it('c2.1 · fan-in degrades monotonically with bundle size', () => {
    const small = probeFanIn(1597, 5);
    const large = probeFanIn(1597, 233);
    expect(small.minSimilarity).toBeGreaterThan(large.minSimilarity);
  });

  it('c2.2 · the measured ceiling clears the abstention floor', () => {
    const f = measureFanIn(1597);
    expect(f.z).toBeGreaterThanOrEqual(Z_FLOOR);
    expect(f.m).toBeGreaterThanOrEqual(8);
  });

  it('c2.3 · float64 keeps at least 12 digits through a unitary round trip', () => {
    expect(measureSignatureDigits(233)).toBeGreaterThan(12);
  });

  it('c2.4 · the barcode is collision-free over a random population', () => {
    const b = measureBarcodeDistinct(256);
    expect(b.distinct).toBe(b.probed);
  });

  it('c2.5 · report is internally consistent', () => {
    const s = measureSuperposition(1597, 128);
    expect(s.barcodeBits).toBe(256);
    expect(s.chanceSigma).toBeCloseTo(1 / Math.sqrt(2 * 1597), 9);
    expect(s.signatureBitsLog2).toBeGreaterThan(400);
  });
});

describe('Ω-CAPACITY C3 · layering', () => {
  it('c3.1 · band-limited decimation is exact both ways', () => {
    expect(measureDecimation(2584, 233)).toBeLessThan(LOSSLESS_TOL);
    expect(measureDecimation(233, 987)).toBeLessThan(LOSSLESS_TOL);
  });

  it('c3.2 · every scheduled rate class is measured and priced', () => {
    const l = measureLayering();
    expect(l.classes.length).toBe(5);
    for (const c of l.classes) {
      expect(c.numbersPerSecond).toBeCloseTo(c.hz * c.width * 2, 6);
      expect(c.lossless).toBe(true);
    }
    expect(l.survivingBandLimit).toBe(44); // narrowest class is width 89
  });
});

describe('Ω-CAPACITY C4 · residency', () => {
  it('c4.1 · sealed bytes cost about four bytes per retained number', async () => {
    const r = await measureResidency({ frames: 178, width: 233, shardFrames: 89, segmentShards: 2 });
    expect(r.storeKind).toBe('memory');
    expect(r.bytesPerNumber).toBeGreaterThan(3.5);
    expect(r.bytesPerNumber).toBeLessThan(6);
    expect(r.ledgerLeaves).toBeGreaterThan(0);
    expect(r.rootHex.length).toBeGreaterThan(0);
    expect(r.durableNumbersPerSecond).toBeGreaterThan(0);
  });

  it('c4.2 · the probe never touches the real archive', async () => {
    const a = await measureResidency({ frames: 89, width: 13, shardFrames: 34 });
    const b = await measureResidency({ frames: 89, width: 13, shardFrames: 34 });
    expect(a.warmBytes).toBe(b.warmBytes);
    expect(a.rootHex).toBe(b.rootHex);
  });
});

describe('Ω-CAPACITY C5 · retrieval', () => {
  it('c5.1 · recall is non-decreasing in candidate-set size', () => {
    const r = measureRetrieval({ population: 256, queries: 16 });
    for (let i = 1; i < r.points.length; i++) {
      expect(r.points[i].recall).toBeGreaterThanOrEqual(r.points[i - 1].recall - 1e-12);
    }
  });

  it('c5.1b · the prefilter finds planted neighbours at a small candidate set', () => {
    const r = measureRetrieval({ population: 256, queries: 16 });
    expect(r.points[0].recall).toBeGreaterThan(0.8);
    expect(r.knee).not.toBeNull();
  });

  it('c5.1c · barcode displacement grows monotonically with input noise', () => {
    const a = measureBarcodeSensitivity(0.01);
    const b = measureBarcodeSensitivity(0.15);
    const c = measureBarcodeSensitivity(0.5);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(c).toBeLessThan(128); // still far from the 50% random-code limit
  });

  it('c5.2 · numbers read scales with the candidate set, and the knee is priced', () => {
    const r = measureRetrieval({ population: 256, queries: 16 });
    expect(r.points[0].numbersRead).toBeLessThan(r.points[r.points.length - 1].numbersRead);
    if (r.knee !== null) expect(r.kneeNumbersRead).toBe(r.knee * 13);
  });
});

describe('Ω-CAPACITY C6 · report', () => {
  it('c6.1 · the full report is measured, complete and renderable', async () => {
    const r = await measureCapacity({ budgetMsPerRung: 3, population: 128, residencyFrames: 89 });
    expect(r.envelope.rungs.length).toBe(5);
    expect(r.durableNumberCeiling).toBeGreaterThan(1e8);
    expect(r.recommendation.length).toBeGreaterThanOrEqual(6);
    const text = formatCapacityReport(r);
    expect(text).toContain('C1 rung ceilings');
    expect(text).toContain('C6 recommendation');
    expect(text).not.toContain('NaN');
  });
});
