/**
 * Gate 1 — Ω-DEPTH Section 1 · honest RAM headroom.
 *
 * Contract under test:
 *   • caps derive deterministically from a fixed synthetic ceiling
 *   • the working budget is exactly WORKING_FRACTION of that ceiling
 *   • pressure sheds journal → pathway → patterns first, never tape or sensory
 *   • the freeze band freezes the fractal pool before evicting further
 *   • floors are never breached
 *   • provenance is never 'measured' unless a probe supplied it
 */

import { describe, expect, it } from 'vitest';
import {
  computeMemoryCaps,
  memoryPressure,
  PRESSURE_FREEZE,
  PRESSURE_TRIM,
  WORKING_FRACTION,
} from '@/core/memory/MemoryGovernor';

const CEILING = 64 * 1024 * 1024 * 1024;
const base = () => computeMemoryCaps({ ceilingBytes: CEILING, provenance: 'fallback', pressure: 0 });

describe('Ω-DEPTH Gate 1 — RAM headroom', () => {
  it('working budget is 70% of the ceiling and reproducible', () => {
    const a = base();
    const b = base();
    expect(WORKING_FRACTION).toBe(0.7);
    expect(a.ramBytes).toBe(CEILING * WORKING_FRACTION);
    expect(a).toEqual(b);
  });

  it('pressure is used bytes over budget, clamped', () => {
    expect(memoryPressure(50, 100)).toBe(0.5);
    expect(memoryPressure(0, 0)).toBe(0);
    expect(memoryPressure(1e12, 100)).toBe(4);
  });

  it('nominal pressure applies no trims', () => {
    const caps = computeMemoryCaps({ ceilingBytes: CEILING, pressure: PRESSURE_TRIM - 0.01 });
    expect(caps.shedLevel).toBe(0);
    expect(caps.trims).toHaveLength(0);
    expect(caps.fractalFrozen).toBe(false);
  });

  it('trim band sheds the lowest-value layers only', () => {
    const nominal = base();
    const trimmed = computeMemoryCaps({ ceilingBytes: CEILING, pressure: PRESSURE_TRIM + 0.01 });
    expect(trimmed.shedLevel).toBe(1);
    expect(trimmed.maxJournalRecords).toBeLessThan(nominal.maxJournalRecords);
    expect(trimmed.maxPathwayEdges).toBeLessThan(nominal.maxPathwayEdges);
    expect(trimmed.maxPatterns).toBeLessThan(nominal.maxPatterns);
    // untouched floors
    expect(trimmed.maxTapeFrames).toBe(nominal.maxTapeFrames);
    expect(trimmed.maxSensoryAtoms).toBe(nominal.maxSensoryAtoms);
    expect(trimmed.maxEpisodes).toBe(nominal.maxEpisodes);
    expect(trimmed.fractalFrozen).toBe(false);
    expect(trimmed.trims[0]).toContain('journal');
  });

  it('freeze band freezes child fields and trims further, tape still untouched', () => {
    const nominal = base();
    const frozen = computeMemoryCaps({ ceilingBytes: CEILING, pressure: PRESSURE_FREEZE + 0.01 });
    expect(frozen.shedLevel).toBe(2);
    expect(frozen.fractalFrozen).toBe(true);
    expect(frozen.maxEpisodes).toBeLessThan(nominal.maxEpisodes);
    expect(frozen.maxJournalRecords).toBeLessThan(
      computeMemoryCaps({ ceilingBytes: CEILING, pressure: PRESSURE_TRIM + 0.01 }).maxJournalRecords,
    );
    expect(frozen.maxTapeFrames).toBe(nominal.maxTapeFrames);
    expect(frozen.maxSensoryAtoms).toBe(nominal.maxSensoryAtoms);
    expect(frozen.trims.at(-1)).toContain('frozen');
  });

  it('floors hold under extreme pressure on a tiny ceiling', () => {
    const caps = computeMemoryCaps({ ceilingBytes: 1024, pressure: 4 });
    expect(caps.maxSensoryAtoms).toBeGreaterThanOrEqual(64);
    expect(caps.maxTapeFrames).toBeGreaterThanOrEqual(1024);
    expect(caps.maxHebbianEntries).toBeGreaterThanOrEqual(64);
    expect(caps.maxEpisodes).toBeGreaterThanOrEqual(64);
    expect(caps.maxPatterns).toBeGreaterThanOrEqual(8);
    expect(caps.maxPathwayEdges).toBeGreaterThanOrEqual(32);
    expect(caps.maxJournalRecords).toBeGreaterThanOrEqual(16);
  });

  it('provenance is never fabricated', () => {
    expect(base().provenance).toBe('fallback');
    expect(computeMemoryCaps({ ceilingBytes: CEILING, provenance: 'reported' }).provenance).toBe(
      'reported',
    );
  });

  it('fractal pool gets a real byte share', () => {
    const caps = base();
    expect(caps.fractalPoolBytes).toBe(Math.floor(caps.ramBytes * 0.08));
  });
});
