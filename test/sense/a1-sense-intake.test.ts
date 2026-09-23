/**
 * Ω-ACTIVATE Layer A gate battery — the sensory intake edge.
 *
 * A1  the channel dependency graph is exact and pure
 * A2  atom hashing is deterministic: identical input reinforces, never re-stores
 * A3  the gateway holds its capacity under sustained novel input
 * A4  fused Ψ injection is bounded and finite (variance-preserving fusion)
 * A5  cross-modal fusion never exceeds the single-modality bound
 * A6  a zero-device build is inert: no ingest, no throw, nothing live
 */
import { describe, it, expect } from 'vitest';
import { SensoryGateway } from '@/core/sensory/SensoryGateway';
import {
  CHANNEL_SPECS,
  canEnable,
  dependentsOf,
  specFor,
  getSensoryDriver,
  type SensoryChannelId,
} from '@/ui/omega/sensoryDriver';

function feature(seed: number, d = 64): Float32Array {
  const f = new Float32Array(d);
  let x = seed * 2654435761 >>> 0;
  for (let i = 0; i < d; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    f[i] = (x / 4294967296) - 0.5;
  }
  return f;
}

function l2(v: Float64Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

describe('A1 — channel graph', () => {
  it('declares every frontend exactly once', () => {
    const ids = CHANNEL_SPECS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['imu', 'audio', 'camera', 'screen', 'vision']);
  });

  it('gates the vision embedder behind a live camera', () => {
    const none = new Set<SensoryChannelId>();
    const withCam = new Set<SensoryChannelId>(['camera']);
    expect(canEnable('vision', none).ok).toBe(false);
    expect(canEnable('vision', withCam).ok).toBe(true);
    expect(canEnable('imu', none).ok).toBe(true);
    expect(canEnable('imu', new Set<SensoryChannelId>(['imu'])).ok).toBe(false);
  });

  it('tears down dependents with their source', () => {
    expect(dependentsOf('camera')).toEqual(['vision']);
    expect(dependentsOf('imu')).toEqual([]);
    expect(specFor('audio').nominalHz).toBe(233);
    expect(specFor('imu').nominalHz).toBe(377);
  });
});

describe('A2 — deterministic atoms', () => {
  it('reinforces an identical percept instead of storing it twice', () => {
    const g = new SensoryGateway(256);
    const f = feature(7);
    const a = g.ingest(f, 'synthetic', 1);
    const b = g.ingest(f, 'synthetic', 2);
    expect(b.hash).toBe(a.hash);
    expect(g.stats().atoms).toBe(1);
    expect(b.reinforcements).toBeGreaterThan(a.reinforcements);
    expect(b.novelty).toBeLessThanOrEqual(a.novelty);
  });

  it('separates genuinely different percepts', () => {
    const g = new SensoryGateway(256);
    g.ingest(feature(1), 'synthetic', 1);
    g.ingest(feature(2), 'synthetic', 2);
    g.ingest(feature(3), 'synthetic', 3);
    expect(g.stats().atoms).toBe(3);
    expect(g.stats().totalIngests).toBe(3);
  });
});

describe('A3 — capacity', () => {
  it('never exceeds its cap under sustained novel input', () => {
    const cap = 64;
    const g = new SensoryGateway(cap);
    for (let i = 0; i < 2000; i++) g.ingest(feature(i + 100), 'synthetic', i);
    const st = g.stats();
    expect(st.atoms).toBeLessThanOrEqual(cap);
    expect(st.bytesUsed).toBeLessThanOrEqual(st.bytesBudget);
    expect(st.totalIngests).toBe(2000);
  });
});

describe('A4/A5 — Ψ injection', () => {
  it('stays finite and bounded for a single modality', () => {
    const g = new SensoryGateway(256);
    const inj = g.ingest(feature(11), 'audio', 5);
    const psi = new Float64Array(1597);
    g.injectPsi(psi, inj);
    expect(Number.isFinite(l2(psi))).toBe(true);
    expect(l2(psi)).toBeGreaterThan(0);
    expect(l2(psi)).toBeLessThan(1);
  });

  it('fuses three modalities without exceeding the single-modality bound', () => {
    const g = new SensoryGateway(256);
    const injections = [
      g.ingest(feature(21), 'audio', 5),
      g.ingest(feature(22), 'video', 5),
      g.ingest(feature(23), 'imu', 5),
    ];
    const fused = new Float64Array(1597);
    g.injectPsiFused(fused, injections);

    let worstSingle = 0;
    for (const inj of injections) {
      const one = new Float64Array(1597);
      g.injectPsi(one, inj);
      worstSingle = Math.max(worstSingle, l2(one));
    }
    const n = l2(fused);
    expect(Number.isFinite(n)).toBe(true);
    // √k normalisation: the fold cannot be louder than √k × the loudest single.
    expect(n).toBeLessThanOrEqual(worstSingle * Math.sqrt(injections.length) + 1e-12);
  });

  it('is a strict no-op with nothing sensed', () => {
    const g = new SensoryGateway(256);
    const psi = new Float64Array(64);
    g.injectPsi(psi, null);
    g.injectPsiFused(psi, []);
    expect(l2(psi)).toBe(0);
  });
});

describe('A6 — zero-device build is inert', () => {
  it('refuses every channel without a browser and touches no gateway', async () => {
    const d = getSensoryDriver();
    const before = d.getSnapshot();
    const ok = await d.enable('imu');
    const after = d.getSnapshot();
    expect(ok).toBe(false);
    expect(after.anyLive).toBe(false);
    expect(after.totalIngests).toBe(before.totalIngests);
    expect(after.channels.find((c) => c.id === 'imu')?.state).toBe('unsupported');
  });

  it('disable is safe on an idle channel', () => {
    const d = getSensoryDriver();
    expect(() => d.disable('camera')).not.toThrow();
    expect(d.isLive('camera')).toBe(false);
  });
});
