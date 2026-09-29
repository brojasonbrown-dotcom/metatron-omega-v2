/**
 * P9.1 — the analysis spine, certified.
 *
 * Two things are on trial here:
 *   1. the alignment layer, which is the only place where fabricated evidence
 *      can enter (zero-filled dropouts, reused samples, non-simultaneous pairs)
 *   2. the spine's abstention discipline under real, thin and hostile input.
 */

import { describe, it, expect } from 'vitest';
import { SeedStream } from '@metatron/trnn-core/core/determinism';
import { dsin, dcos } from '@metatron/trnn-core/core/dmath';
import { STAT_FLOOR } from '@metatron/trnn-core/substrate/correlation';
import { StreamWindow, ALIGN_TOLERANCE_FRACTION } from '../../src/core/analysis/streamWindow';
import { analyseWindow, analysePair, miToCorrelation } from '../../src/core/analysis/analysisSpine';

/** A window with two channels sampled on the same clock. */
function coupled(n: number, coupling: number, dtMs = 4): StreamWindow {
  const w = new StreamWindow(2048);
  const s = new SeedStream('p9/coupled');
  for (let i = 0; i < n; i++) {
    const t = i * dtMs;
    const drive = dsin(i / 7);
    w.push('a', t, drive + 0.1 * s.signed());
    w.push('b', t, coupling * drive + (1 - coupling) * s.signed());
  }
  return w;
}

describe('P9.1 stream window — alignment', () => {
  it('never zero-fills a dropout: a gap is a gap', () => {
    const w = new StreamWindow();
    for (let i = 0; i < 100; i++) {
      w.push('a', i * 4, i % 5 === 0 ? NaN : 1);
      w.push('b', i * 4, 1);
    }
    const st = w.stats('a')!;
    expect(st.gaps).toBe(20);
    expect(st.count).toBe(80);
    // No stored sample is the fabricated zero.
    const v = w.series('a');
    expect([...v].every((x) => x === 1)).toBe(true);
  });

  it('rejects out-of-order stamps instead of re-sorting history', () => {
    const w = new StreamWindow();
    w.push('a', 100, 1);
    expect(w.push('a', 50, 2)).toBe(false);
    expect(w.stats('a')!.count).toBe(1);
    expect(w.stats('a')!.gaps).toBe(1);
  });

  it('pairs one-to-one: a slow sample cannot marry many fast ones', () => {
    const w = new StreamWindow();
    for (let i = 0; i < 200; i++) w.push('fast', i * 2, i);
    for (let i = 0; i < 20; i++) w.push('slow', i * 20, i);
    const p = w.pair('slow', 'fast');
    // At most as many pairs as the slower channel has samples.
    expect(p.n).toBeLessThanOrEqual(20);
    // Every fast sample used is distinct: reconstruct and check strict growth.
    for (let i = 1; i < p.n; i++) expect(p.t[i]).toBeGreaterThan(p.t[i - 1]);
  });

  it('refuses pairs outside tolerance rather than calling them simultaneous', () => {
    // b goes offline halfway through. The second half of a has no partner
    // within tolerance and must be counted as unmatched, not stretched to the
    // last surviving b sample.
    const w = new StreamWindow();
    for (let i = 0; i < 200; i++) {
      w.push('a', i * 10, i * 10);
      if (i < 100) w.push('b', i * 10 + 1, i * 10 + 1);
    }
    const p = w.pair('a', 'b');
    expect(p.toleranceMs).toBeCloseTo(10 * ALIGN_TOLERANCE_FRACTION, 12);
    expect(p.n).toBe(100);
    expect(p.unmatched).toBe(100);
    // Values carry their own timestamps: every accepted pair is genuinely
    // inside the tolerance window.
    for (let i = 0; i < p.n; i++) {
      expect(Math.abs(p.a[i] - p.b[i])).toBeLessThanOrEqual(p.toleranceMs);
    }
  });

  it('two channels that never overlap in time produce no pairs at all', () => {
    const w = new StreamWindow();
    for (let i = 0; i < 100; i++) w.push('early', i * 10, 1);
    for (let i = 0; i < 100; i++) w.push('late', 100_000 + i * 10, 1);
    const p = w.pair('early', 'late');
    expect(p.n).toBe(0);
    expect(p.underFloor).toBe(true);
    expect(p.unmatched).toBe(100);
  });

  it('accepts a small jitter that is genuinely inside tolerance', () => {
    const w = new StreamWindow();
    for (let i = 0; i < 100; i++) {
      w.push('a', i * 10, 1);
      w.push('b', i * 10 + 1, 1);
    }
    expect(w.pair('a', 'b').n).toBe(100);
  });

  it('is monotone: pairing a prefix is a prefix of the pairing', () => {
    const w = new StreamWindow();
    const half = new StreamWindow();
    for (let i = 0; i < 120; i++) {
      w.push('a', i * 5, dsin(i));
      w.push('b', i * 5 + 1, dcos(i));
      if (i < 60) {
        half.push('a', i * 5, dsin(i));
        half.push('b', i * 5 + 1, dcos(i));
      }
    }
    const full = w.pair('a', 'b');
    const pre = half.pair('a', 'b');
    for (let i = 0; i < pre.n; i++) {
      expect(full.a[i]).toBe(pre.a[i]);
      expect(full.b[i]).toBe(pre.b[i]);
    }
  });

  it('abstains on an unknown or empty channel with a stated reason', () => {
    const w = new StreamWindow();
    w.push('a', 0, 1);
    expect(w.pair('a', 'nope').reason).toContain('unknown channel');
    expect(w.pair('a', 'a').reason).toBeDefined(); // single sample: no period
  });

  it('reports measured rate, not a configured one', () => {
    const w = new StreamWindow();
    for (let i = 0; i < 200; i++) w.push('imu', (i * 1000) / 377, 1);
    expect(w.stats('imu')!.hz).toBeCloseTo(377, 6);
  });

  it('bounds memory: the ring holds at most its capacity', () => {
    const w = new StreamWindow(64);
    for (let i = 0; i < 5000; i++) w.push('a', i, i);
    const st = w.stats('a')!;
    expect(st.count).toBe(64);
    expect(st.accepted).toBe(5000);
    expect(w.series('a')[63]).toBe(4999);
  });
});

describe('P9.1 analysis spine — measurement', () => {
  it('measures a real coupling and names a direction', () => {
    const w = coupled(400, 0.9);
    const f = analysePair(w, 'a', 'b');
    expect(f.verdict).toBe('report');
    expect(f.association).toBeGreaterThan(0.5);
    expect(f.correlation!.pearson.value!).toBeGreaterThan(0.7);
    expect(f.bus!.counted).toBeGreaterThanOrEqual(5);
  });

  it('abstains below the F9 floor instead of reporting a thin number', () => {
    const w = coupled(STAT_FLOOR - 5, 0.9);
    const f = analysePair(w, 'a', 'b');
    expect(f.verdict).toBe('abstain');
    expect(f.association).toBeNull();
    expect(f.correlation).toBeNull();
    expect(f.reason).toContain('floor');
  });

  it('does not manufacture association between independent channels', () => {
    const w = new StreamWindow(2048);
    const s = new SeedStream('p9/indep');
    for (let i = 0; i < 400; i++) {
      w.push('a', i * 4, s.signed());
      w.push('b', i * 4, s.signed());
    }
    const f = analysePair(w, 'a', 'b');
    expect(f.verdict).toBe('report');
    expect(f.association!).toBeLessThan(0.2);
  });

  it('keeps unbounded statistics out of the fused product', () => {
    const w = coupled(300, 0.8);
    const f = analysePair(w, 'a', 'b');
    const ids = f.bus!.channels.map((c) => c.id);
    expect(ids).not.toContain('hsic');
    expect(ids).not.toContain('granger');
    for (const c of f.bus!.channels) {
      expect(c.value).toBeGreaterThanOrEqual(0);
      expect(c.value).toBeLessThanOrEqual(1);
    }
    // HSIC is still reported — excluded from fusion, not from the record.
    expect(f.correlation!.hsic).toBeDefined();
  });

  it('mi→ρ is the Gaussian identity, and abstains on nonsense', () => {
    expect(miToCorrelation(0)).toBe(0);
    // I = −½ln(1−ρ²) with ρ = 0.8
    const rho = 0.8;
    const mi = -0.5 * Math.log(1 - rho * rho);
    expect(miToCorrelation(mi)).toBeCloseTo(rho, 10);
    expect(Number.isNaN(miToCorrelation(NaN))).toBe(true);
    expect(Number.isNaN(miToCorrelation(-1))).toBe(true);
  });

  it('detects a lagged drive as directed, with the sign the right way round', () => {
    const w = new StreamWindow(2048);
    const s = new SeedStream('p9/lagged');
    const drive: number[] = [];
    for (let i = 0; i < 500; i++) drive.push(dsin(i / 5) + 0.3 * s.signed());
    for (let i = 3; i < 500; i++) {
      w.push('cause', i * 4, drive[i]);
      w.push('effect', i * 4, 0.85 * drive[i - 3] + 0.15 * s.signed());
    }
    const f = analysePair(w, 'cause', 'effect', { maxLag: 5 });
    expect(f.verdict).toBe('report');
    expect(f.direction).not.toBeNull();
    expect(f.direction!).toBeGreaterThan(0);
  });

  it('skipCausal really skips: no causal report, correlation intact', () => {
    const w = coupled(300, 0.7);
    const f = analysePair(w, 'a', 'b', { skipCausal: true });
    expect(f.causal).toBeNull();
    expect(f.direction).toBeNull();
    expect(f.correlation).not.toBeNull();
  });

  it('is deterministic: two runs over the same window agree exactly', () => {
    const w = coupled(300, 0.6);
    const x = analysePair(w, 'a', 'b');
    const y = analysePair(w, 'a', 'b');
    expect(y.association).toBe(x.association);
    expect(y.direction).toBe(x.direction);
    expect(y.correlation!.dcor.value).toBe(x.correlation!.dcor.value);
  });
});

describe('P9.1 analysis spine — whole window', () => {
  it('analyses every pair in deterministic order and finds the strongest', () => {
    const w = new StreamWindow(2048);
    const s = new SeedStream('p9/multi');
    for (let i = 0; i < 400; i++) {
      const t = i * 4;
      const d = dsin(i / 9);
      w.push('audio', t, d + 0.1 * s.signed());
      w.push('imu', t, 0.95 * d + 0.05 * s.signed()); // tightly coupled
      w.push('video', t, s.signed()); // independent
    }
    const r = analyseWindow(w, { skipCausal: true });
    expect(r.findings.map((f) => `${f.a}|${f.b}`)).toEqual([
      'audio|imu',
      'audio|video',
      'imu|video',
    ]);
    expect(r.strongest!.a).toBe('audio');
    expect(r.strongest!.b).toBe('imu');
    expect(r.reported).toBe(3);
  });

  it('counts budgeted-out pairs as skipped, never as uncorrelated', () => {
    const w = new StreamWindow(512);
    for (let i = 0; i < 200; i++) {
      for (const id of ['a', 'b', 'c', 'd']) w.push(id, i * 4, i + id.charCodeAt(0));
    }
    const r = analyseWindow(w, { pairBudget: 2, skipCausal: true });
    expect(r.findings.length).toBe(2);
    expect(r.skipped).toBe(4); // 6 pairs total
  });

  it('an all-abstaining window reports no strongest pair rather than a zero', () => {
    const w = new StreamWindow();
    for (let i = 0; i < 10; i++) {
      w.push('a', i * 4, i);
      w.push('b', i * 4, i);
    }
    const r = analyseWindow(w);
    expect(r.reported).toBe(0);
    expect(r.strongest).toBeNull();
    expect(r.findings.every((f) => f.verdict === 'abstain')).toBe(true);
  });

  it('a fully dead channel abstains instead of correlating with silence', () => {
    const w = new StreamWindow(1024);
    const s = new SeedStream('p9/dead');
    for (let i = 0; i < 300; i++) {
      w.push('live', i * 4, s.signed());
      w.push('dead', i * 4, NaN); // sensor offline the whole time
    }
    const f = analysePair(w, 'live', 'dead');
    expect(f.verdict).toBe('abstain');
    expect(f.association).toBeNull();
  });

  it('a constant channel abstains: zero variance is no evidence', () => {
    const w = new StreamWindow(1024);
    const s = new SeedStream('p9/const');
    for (let i = 0; i < 300; i++) {
      w.push('live', i * 4, s.signed());
      w.push('flat', i * 4, 1);
    }
    const f = analysePair(w, 'live', 'flat', { skipCausal: true });
    expect(f.correlation!.pearson.value).toBeNull();
    expect(f.verdict).toBe('abstain');
  });
});
