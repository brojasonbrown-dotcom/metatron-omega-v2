/**
 * N2 battery — the rung-by-rung toroid scan, run against the *hosted*
 * configuration rather than a hand-tuned toy rig.
 *
 * One MACRO web (18 dense-core rungs, Fibonacci clock, real drive/chords/organs
 * /sensors defaults) is advanced once and then scanned read-only. Each rung the
 * programme has certified gets its own case, so a later change that quietly
 * breaks an already-signed rung fails here instead of silently regressing.
 *
 *  N2-0  rung rank 0 (n=1)   — T1, certified
 *  N2-1  rung rank 1 (n=13)  — T2, certified
 *  N2-2  rung rank 2 (n=15)  — T3, certified
 *  N2-3  rung rank 3 (n=27)  — T4, certified
 *  N2-4  rung rank 4 (n=29)  — T5, certified
 *  N2-5  rung rank 5 (n=41)  — T6, certified
 *  N2-6  rung rank 6 (n=43)  — T7, certified
 *  N2-7  rung rank 7 (n=55)  — T8, certified
 *  N2-8  rung rank 8 (n=57)  — T9, certified
 *  N2-9  rung rank 9 (n=69)  — T10, certified
 *  N2-10 rung rank 10 (n=71) — T11, certified
 *  N2-11 rung rank 11 (n=83) — T12, certified
 *  N2-*  scan is read-only: scanning twice yields the identical report
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { MultiTorusEngine } from '../src/engine/MultiTorusEngine';
import { DENSE_CORE } from '../src/core/scaleLadder';
import { profileById, nodesForRank } from '../src/runtime/profiles';
import {
  DEFAULT_ORGANS,
  DEFAULT_SENSORS,
  DEFAULT_CHORDS,
  DEFAULT_CHORD_GAIN,
  DEFAULT_DRIVE,
} from '../src/runtime/host';
import { rungScan } from '../src/runtime/views';
import type { RungScanReport } from '../src/sense/scan';

// The hosted sensory plan analyses a 233-tick Fibonacci window and the deeper
// rungs run on a divided clock, so the web is advanced far enough for at least
// one window to close on every certified rung before it is read. Rank 5 runs
// on a /8 clock (~1864 ticks) and rank 6 on a /13 clock (~3029 ticks) for 233
// samples — hence 3200.
const TICKS = 3200;


let engine: MultiTorusEngine;
let nodes: number[];

beforeAll(() => {
  const p = profileById('MACRO');
  const rungs = DENSE_CORE.slice(0, p.rungs);
  nodes = rungs.map((_, r) => nodesForRank(p, r));
  engine = new MultiTorusEngine({
    rungs,
    nodes: (_r, rank) => nodes[rank],
    seed: 'toroid-scan',
    couplingBand: p.couplingBand,
    clock: p.clock,
    modes: p.modes,
    tapeCapacity: p.tape,
    drive: DEFAULT_DRIVE,
    organs: DEFAULT_ORGANS,
    sensors: DEFAULT_SENSORS,
    chords: DEFAULT_CHORDS,
    chordGain: DEFAULT_CHORD_GAIN,
  });
  for (let i = 0; i < TICKS; i++) engine.step();
}, 120_000);

/** Every law a certified rung must satisfy, measured on the live report. */
function certify(r: RungScanReport, rank: number): void {
  // S1 census — the grid is a real Fibonacci lattice with four incident lines.
  expect(r.rank).toBe(rank);
  expect(r.census.status).toBe('OK');
  expect(r.census.nodes).toBe(nodes[rank]);
  expect(r.census.fibonacci).toBe(true);
  expect(r.census.incidentLines).toBe(4);
  expect(r.census.minSeparation).toBeGreaterThan(0);
  expect(r.census.separationRatio).toBeGreaterThan(1);

  // S2 organs — every node carries a live organ with bounded modal residual
  // and a full-rank radial plane (rungs 55-71 used to lose it entirely).
  expect(r.organs.status).toBe('OK');
  expect(r.organs.report!.radialBands).toBe(8);
  expect(r.organs.report!.radialPeak).toBeGreaterThan(0);
  expect(r.organs.report!.maxEigenResidual).toBeLessThan(1);
  expect(r.organs.coherenceHistogram.reduce((a, b) => a + b, 0)).toBe(nodes[rank]);
  expect(r.organs.participationHistogram.reduce((a, b) => a + b, 0)).toBe(nodes[rank]);

  // S3 spectral — the φ ladder is on distinct bins, closed windows, no silence.
  expect(r.spectral.status).toBe('OK');
  expect(r.spectral.windowsClosed).toBeGreaterThan(0);
  expect(new Set(r.spectral.plan.map((p) => p.bin)).size).toBe(r.spectral.bands);
  expect(r.spectral.silentNodes).toBe(0);
  expect(r.spectral.minCapture).toBeGreaterThan(0.5);
  expect(r.spectral.probe).not.toBeNull();
  expect(r.spectral.probe!.lines[0].share).toBeGreaterThan(0);

  // S4 energy — shares are a normalised distribution over a spread grid.
  expect(r.energy.status).toBe('OK');
  expect(r.energy.total).toBeGreaterThan(0);
  expect(r.energy.peakShare).toBeGreaterThan(0);
  expect(r.energy.peakShare).toBeLessThanOrEqual(1);
  expect(r.energy.entropy).toBeGreaterThan(0);
  expect(r.energy.entropy).toBeLessThanOrEqual(1);

  // S5 flux — the divergence closes on the lattice to machine precision.
  expect(r.flux.status).toBe('OK');
  expect(r.flux.circulation).toBeGreaterThan(0);
  expect(r.flux.closureDefect).toBeLessThan(1e-12);

  // S6 verdict.
  expect(r.verdict.defects).toEqual([]);
  expect(r.verdict.pass).toBe(true);
}

describe('N2 hosted rung scans', () => {
  it('T1 — rank 0 (n=1) passes all six sections', () => {
    certify(rungScan(engine, 0)!, 0);
  });

  it('T2 — rank 1 (n=13) passes all six sections', () => {
    certify(rungScan(engine, 1)!, 1);
  });

  it('T3 — rank 2 (n=15) passes all six sections', () => {
    certify(rungScan(engine, 2)!, 2);
  });

  it('T4 — rank 3 (n=27) passes all six sections', () => {
    certify(rungScan(engine, 3)!, 3);
  });

  it('T5 — rank 4 (n=29) passes all six sections', () => {
    certify(rungScan(engine, 4)!, 4);
  });

  it('T6 — rank 5 (n=41) passes all six sections', () => {
    certify(rungScan(engine, 5)!, 5);
  });

  it('T7 — rank 6 (n=43) passes all six sections', () => {
    certify(rungScan(engine, 6)!, 6);
  });

  it('T8 — rank 7 (n=55) passes all six sections', () => {
    certify(rungScan(engine, 7)!, 7);
  });

  it('T9 — rank 8 (n=57) passes all six sections', () => {
    certify(rungScan(engine, 8)!, 8);
  });

  it('T10 — rank 9 (n=69) passes all six sections', () => {
    certify(rungScan(engine, 9)!, 9);
  });

  it('T11 — rank 10 (n=71) passes all six sections', () => {
    certify(rungScan(engine, 10)!, 10);
  });

  it('T12 — rank 11 (n=83) passes all six sections', () => {
    certify(rungScan(engine, 11)!, 11);
  });

  it('T13 — rank 12 (n=85) passes all six sections', () => {
    certify(rungScan(engine, 12)!, 12);
  });

  it('T14 — rank 13 (n=97) passes all six sections', () => {
    certify(rungScan(engine, 13)!, 13);
  });

  it('T15 — rank 14 (n=99) passes all six sections', () => {
    certify(rungScan(engine, 14)!, 14);
  });

  it('T16 — rank 15 (n=111) passes all six sections', () => {
    certify(rungScan(engine, 15)!, 15);
  });

  it('T17 — rank 16 (n=113) passes all six sections', () => {
    certify(rungScan(engine, 16)!, 16);
  });

  it('T18 — rank 17 (n=125) passes all six sections', () => {
    certify(rungScan(engine, 17)!, 17);
  });

  it('all 18 rungs certify clean in a single sweep', () => {
    for (let rank = 0; rank < 18; rank += 1) {
      const scan = rungScan(engine, rank)!;
      expect(scan.verdict.pass, `rank ${rank}: ${scan.verdict.defects.join('; ')}`).toBe(true);
    }
  });


  it('scans read-only: a repeated scan is byte-identical', () => {
    const a = rungScan(engine, 1)!;
    const b = rungScan(engine, 1)!;
    expect(b).toEqual(a);
    expect(b.verdict.digest).toBe(a.verdict.digest);
    // and the neighbouring rung is untouched by having scanned this one
    expect(rungScan(engine, 0)!.verdict.digest).toBe(rungScan(engine, 0)!.verdict.digest);
  });
});
