/**
 * P9.2 — the live feed's honesty rules.
 *
 * The sampler is the only place where a stalled source could be turned into a
 * stream of repeated observations. These tests exist to keep that impossible.
 */

import { describe, it, expect } from 'vitest';
import {
  sampleFrame,
  freshCursors,
  frameHasData,
  CHANNEL_IDS,
  type SampleInput,
} from '../../src/core/analysis/channelSampler';
import { StreamWindow } from '../../src/core/analysis/streamWindow';
import { analysePair } from '../../src/core/analysis/analysisSpine';

const engine = (tick: number, over: Partial<SampleInput['engine'] & object> = {}) => ({
  tick,
  coherenceWarm: 0.8,
  warmRungs: 5,
  energy: 1.2,
  fluxMoved: 3,
  fluxImbalance: 1e-16,
  tickRate: 60,
  ...over,
});

describe('P9.2 channel sampler', () => {
  it('records a fresh engine tick', () => {
    const c = freshCursors();
    const f = sampleFrame({ engine: engine(1), memory: null, sense: null }, c);
    expect(f['engine.coherence']).toBe(0.8);
    expect(f['engine.tickRate']).toBe(60);
    expect(frameHasData(f)).toBe(true);
  });

  it('a stalled engine yields gaps, not repeats', () => {
    const c = freshCursors();
    sampleFrame({ engine: engine(7), memory: null, sense: null }, c);
    const again = sampleFrame({ engine: engine(7), memory: null, sense: null }, c);
    expect(Number.isNaN(again['engine.coherence'])).toBe(true);
    expect(frameHasData(again)).toBe(false);
  });

  it('cold coherence abstains: warmRungs=0 is not a measurement', () => {
    const c = freshCursors();
    const f = sampleFrame(
      { engine: engine(1, { warmRungs: 0, coherenceWarm: 0 }), memory: null, sense: null },
      c,
    );
    expect(Number.isNaN(f['engine.coherence'])).toBe(true);
    // The other engine channels are still real measurements.
    expect(f['engine.energy']).toBe(1.2);
  });

  it('an absent source is all gaps, never zeros', () => {
    const c = freshCursors();
    const f = sampleFrame({ engine: null, memory: null, sense: null }, c);
    for (const id of CHANNEL_IDS) expect(Number.isNaN(f[id])).toBe(true);
    expect(frameHasData(f)).toBe(false);
  });

  it('a null arousal is a gap even when the gateway advanced', () => {
    const c = freshCursors();
    const f = sampleFrame(
      { engine: null, memory: null, sense: { totalIngests: 5, arousal: null } },
      c,
    );
    expect(Number.isNaN(f['sense.arousal'])).toBe(true);
  });

  it('sources advance independently', () => {
    const c = freshCursors();
    sampleFrame(
      {
        engine: engine(1),
        memory: { drivenTicks: 1, meanSurprise: 0.5, totalMerged: 2 },
        sense: null,
      },
      c,
    );
    const f = sampleFrame(
      {
        engine: engine(1),
        memory: { drivenTicks: 2, meanSurprise: 0.6, totalMerged: 3 },
        sense: null,
      },
      c,
    );
    expect(Number.isNaN(f['engine.energy'])).toBe(true);
    expect(f['memory.surprise']).toBe(0.6);
  });

  it('a frozen engine cannot fabricate a correlation downstream', () => {
    // Engine stalls at tick 9 while memory keeps moving. If the sampler
    // repeated the stale engine values, the two channels would pair up into a
    // long constant/varying segment and the spine would be handed evidence
    // that does not exist. It must abstain instead.
    const c = freshCursors();
    const w = new StreamWindow(1024);
    for (let i = 0; i < 300; i++) {
      const f = sampleFrame(
        {
          engine: engine(9),
          memory: { drivenTicks: i + 1, meanSurprise: i / 300, totalMerged: i },
          sense: null,
        },
        c,
      );
      w.pushFrame(i * 62.5, f as unknown as Record<string, number>);
    }
    expect(w.stats('engine.energy')!.count).toBeLessThanOrEqual(1);
    const finding = analysePair(w, 'engine.energy', 'memory.surprise');
    expect(finding.verdict).toBe('abstain');
    expect(finding.association).toBeNull();
  });

  it('genuinely co-moving sources do produce a measured association', () => {
    const c = freshCursors();
    const w = new StreamWindow(1024);
    for (let i = 0; i < 300; i++) {
      const f = sampleFrame(
        {
          engine: engine(i + 1, { energy: 1 + i / 100 }),
          memory: { drivenTicks: i + 1, meanSurprise: 0.5 + i / 200, totalMerged: i },
          sense: null,
        },
        c,
      );
      w.pushFrame(i * 62.5, f as unknown as Record<string, number>);
    }
    const finding = analysePair(w, 'engine.energy', 'memory.surprise', { skipCausal: true });
    expect(finding.verdict).toBe('report');
    expect(finding.association!).toBeGreaterThan(0.9);
  });
});
