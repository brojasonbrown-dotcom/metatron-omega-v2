/**
 * Ω-ACTIVATE Layer B gate battery — L0 readback.
 *
 * B1  the tape can be read back: iterate, range, nearest, window
 * B2  recall carries the trajectory of the moment it recalls
 */
import { describe, it, expect } from 'vitest';
import { FieldTape } from '@/core/memory/FieldTape';
import { summariseTrajectory, EMPTY_TRAJECTORY } from '@/core/memory/Trajectory';
import { MemoryStore } from '@/core/memory/MemoryStore';

const DIM = 64;

function psi(tick: number, lockedMode = 5): Float64Array {
  const v = new Float64Array(DIM);
  for (let i = 0; i < DIM; i++) v[i] = 0.01 * Math.sin(0.1 * (i + tick));
  v[lockedMode] = 1; // a mode that persists across the whole run
  return v;
}

function fill(tape: FieldTape, n: number, startTick = 0): void {
  for (let t = 0; t < n; t++) {
    const tick = startTick + t;
    tape.write({
      tick,
      psi: psi(tick),
      qualiaScalar: 0.5,
      coherence: 0.3 + 0.001 * t,   // steadily rising
      energy: 1 - 0.002 * t,        // steadily falling
      salience: 0.4,
      novelty: 0.2,
      surprise: t === 50 ? 0.9 : 0.1,
    });
  }
}

describe('B1 — tape readback', () => {
  it('iterates retained frames oldest → newest', () => {
    const tape = new FieldTape(1 << 16, 8);
    fill(tape, 200);
    const all = [...tape.frames()];
    expect(all.length).toBe(200);
    expect(all[0].tick).toBe(0);
    expect(all.at(-1)!.tick).toBe(199);
    for (let i = 1; i < all.length; i++) expect(all[i].tick).toBeGreaterThan(all[i - 1].tick);
  });

  it('reads an inclusive tick range', () => {
    const tape = new FieldTape(1 << 16, 8);
    fill(tape, 200);
    const r = tape.readRange(40, 60);
    expect(r.length).toBe(21);
    expect(r[0].tick).toBe(40);
    expect(r.at(-1)!.tick).toBe(60);
    expect(tape.readRange(60, 40).length).toBe(21); // order-insensitive
    expect(tape.readRange(9000, 9100)).toEqual([]);
  });

  it('finds the nearest frame to any tick', () => {
    const tape = new FieldTape(1 << 16, 8);
    fill(tape, 200);
    expect(tape.nearest(77)!.tick).toBe(77);
    expect(tape.nearest(-50)!.tick).toBe(0);
    expect(tape.nearest(1e6)!.tick).toBe(199);
    expect(new FieldTape(1 << 16, 8).nearest(0)).toBeNull();
  });

  it('returns a centred replay window, clamped at the edges', () => {
    const tape = new FieldTape(1 << 16, 8);
    fill(tape, 200);
    const w = tape.window(100, 21, 21);
    expect(w.length).toBe(43);
    expect(w[0].tick).toBe(79);
    expect(w.at(-1)!.tick).toBe(121);
    expect(tape.window(0, 21, 21).length).toBe(22);      // clamped left
    expect(tape.window(199, 21, 21).length).toBe(22);    // clamped right
    expect(new FieldTape(1 << 16, 8).window(0)).toEqual([]);
  });

  it('survives ring wrap without emitting stale ticks', () => {
    const cap = 1 << 14;
    const tape = new FieldTape(cap, 8);
    fill(tape, cap + 500);
    const all = [...tape.frames()];
    expect(all.length).toBe(cap);
    expect(all[0].tick).toBe(500);
    expect(all.at(-1)!.tick).toBe(cap + 499);
  });
});

describe('B2 — trajectory summary', () => {
  it('is empty for an empty window', () => {
    expect(summariseTrajectory([])).toEqual(EMPTY_TRAJECTORY);
  });

  it('recovers level, drift, volatility and the locked mode', () => {
    const tape = new FieldTape(1 << 16, 8);
    fill(tape, 200);
    const t = summariseTrajectory(tape.window(100, 21, 21));
    expect(t.frames).toBe(43);
    expect(t.coherenceMean).toBeCloseTo(0.3 + 0.001 * 100, 3);
    expect(t.coherenceDrift).toBeCloseTo(0.001, 6);   // rising
    expect(t.energyDrift).toBeCloseTo(-0.002, 6);      // falling
    expect(t.coherenceVolatility).toBeGreaterThan(0);
    expect(t.coherenceVolatility).toBeLessThan(0.02);
    expect(t.dominantMode).toBe(5);
    expect(t.modalPersistence).toBeGreaterThan(0.1);
    expect(t.peakSurprise).toBeCloseTo(0.1, 6);        // the t=50 spike is outside
  });

  it('captures a surprise spike inside its window', () => {
    const tape = new FieldTape(1 << 16, 8);
    fill(tape, 200);
    expect(summariseTrajectory(tape.window(50, 5, 5)).peakSurprise).toBeCloseTo(0.9, 6);
  });
});

describe('B2 — recall carries L0 evidence', () => {
  it('returns an empty trajectory when the tape has never been written', () => {
    const store = new MemoryStore();
    const r = store.recall(psi(0), 0);
    expect(r.trajectory).toEqual(EMPTY_TRAJECTORY);
  });

  it('attaches real dynamics once the tape has frames', () => {
    const store = new MemoryStore();
    fill(store.fieldTape, 300);
    const r = store.recall(psi(150), 150);
    expect(r.trajectory.frames).toBeGreaterThan(0);
    expect(Number.isFinite(r.trajectory.coherenceMean)).toBe(true);
    expect(r.trajectory.dominantMode).toBeGreaterThanOrEqual(0);
    expect(store.replay(34).length).toBe(34);
    expect(store.trajectoryAt(150).frames).toBe(43);
  });

  it('replay is ordered oldest → newest', () => {
    const store = new MemoryStore();
    fill(store.fieldTape, 100);
    const frames = store.replay(10);
    expect(frames.at(-1)!.tick).toBe(99);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].tick).toBeGreaterThan(frames[i - 1].tick);
    }
  });
});
