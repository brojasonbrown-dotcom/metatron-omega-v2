/**
 * Ω-WAKE gate battery — the drive edges that were missing.
 *
 * W1  engine projection is the single truth (no fabricated field snapshot)
 * W2  an Ω snapshot drives real memory layers (tape frames / episodes > 0)
 * W3  thoughts land in the L5 journal exactly once
 */
import { describe, it, expect } from 'vitest';
import { projectEngineState } from '@/ui/omega/engineProjection';
import { outputFromSnapshot, journalThoughts } from '@/ui/omega/memoryDriver';
import { MemoryStore } from '@/core/memory/MemoryStore';
import { tickMemory } from '@/core/memory/tickMemory';
import type { HostSnapshot, MindReport } from '@/core/omega/omegaProtocol';

function snap(over: Partial<HostSnapshot> = {}): HostSnapshot {
  return {
    running: true,
    profile: 'omega',
    seed: 'test',
    tick: 144,
    tickRate: 61.8,
    busHz: 32,
    coherence: 0.618,
    energy: 0.382,
    fluxMoved: 0,
    fluxImbalance: 0,
    orderingViolations: 0,
    rowSumDefect: 0,
    worstEnergyRatio: 1,
    digest: 'deadbeef',
    finite: true,
    stepped: [],
    rungs: [],
    nodes: [],
    totalNodes: 89,
    predictedBytes: 0,
    checkpointTick: null,
    ledgerMarks: 0,
    load: 0.1,
    senseChannels: 0,
    sensePeak: 0,
    ...over,
  } as unknown as HostSnapshot;
}

describe('W1 — engine projection', () => {
  it('reports fallback only when the worker has never emitted', () => {
    const p = projectEngineState(null, false);
    expect(p.fieldState).toBe('fallback');
    expect(p.running).toBe(false);
    expect(p.tick).toBe(0);
  });

  it('projects the live host onto the legacy engine fields', () => {
    const p = projectEngineState(snap(), true);
    expect(p.running).toBe(true);
    expect(p.tick).toBe(144);
    expect(p.fps).toBeCloseTo(61.8, 6);
    expect(p.coherence).toBeCloseTo(0.618, 12);
    expect(p.fieldState).toBe('open');
    expect(p.forcedFallback).toBe(false);
    // Nothing invented: the Ω host has no FieldSnapshot counterpart.
    expect(p.fieldSnapshot).toBeNull();
  });

  it('never emits a non-finite metric', () => {
    const p = projectEngineState(snap({ coherence: NaN, energy: Infinity, tickRate: NaN }), true);
    expect(Number.isFinite(p.coherence)).toBe(true);
    expect(Number.isFinite(p.energy)).toBe(true);
    expect(Number.isFinite(p.fps)).toBe(true);
  });
});

describe('W2 — memory drive edge', () => {
  it('turns Ω snapshots into real tape frames and episodes', () => {
    const store = new MemoryStore();
    expect(store.stats().tapeFrames).toBe(0);
    for (let t = 1; t <= 64; t++) {
      const out = outputFromSnapshot(
        snap({ tick: t, coherence: 0.5 + 0.1 * Math.sin(t / 5), energy: 0.3 + 0.05 * Math.cos(t / 3) }),
      );
      tickMemory(out, store, t);
    }
    const s = store.stats();
    expect(s.tapeFrames).toBeGreaterThan(0);
    expect(s.hebbianEntries).toBeGreaterThan(0);
  });

  it('is deterministic — same snapshot, same output', () => {
    const a = outputFromSnapshot(snap());
    const b = outputFromSnapshot(snap());
    expect(a.metatronCoherence).toBe(b.metatronCoherence);
  });
});

describe('W3 — thought journaling', () => {
  const report = (ticks: number[]): MindReport =>
    ({
      thoughts: ticks.length,
      meanNovelty: 0.5,
      meanSurprise: 0.2,
      recent: ticks.map((tick) => ({
        tick,
        novelty: 0.4,
        surprise: 0.1,
        conceptKey: `c${tick}`,
        conceptId: tick,
        action: 'store',
        source: 'ssm',
        exactOps: 3,
      })),
    }) as unknown as MindReport;

  it('appends new thoughts and advances the watermark', () => {
    const store = new MemoryStore();
    const r = journalThoughts(report([10, 11, 12]), store, -1);
    expect(r.appended).toBe(3);
    expect(r.watermark).toBe(12);
    expect(store.journal.size()).toBe(3);
  });

  it('never double-writes an overlapping report', () => {
    const store = new MemoryStore();
    const first = journalThoughts(report([10, 11, 12]), store, -1);
    const second = journalThoughts(report([11, 12, 13]), store, first.watermark);
    expect(second.appended).toBe(1);
    expect(store.journal.size()).toBe(4);
  });

  it('is a no-op on an empty report', () => {
    const store = new MemoryStore();
    expect(journalThoughts(null, store, 5).appended).toBe(0);
    expect(store.journal.size()).toBe(0);
  });
});
