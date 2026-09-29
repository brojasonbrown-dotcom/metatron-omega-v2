/**
 * Ω-READY R1–R3 certification battery.
 *
 * These are not smoke tests. Each one pins a property the host transplant
 * depends on: determinism of intake, byte-exactness of the encoding, the single
 * hash law, HLC monotonicity, and Q60 arithmetic identical to the Rust merge.
 */

import { describe, it, expect } from 'vitest';
import {
  encodeCbor,
  decodeCbor,
  toHex,
  fromHex,
  hash,
  hashHex,
  hashValueHex,
  hashLegacySha256Hex,
  HASH_LAW,
  INTEROP_VERSION,
  hlcZero,
  hlcTick,
  hlcMerge,
  hlcCompare,
  hlcEncode,
  hlcDecode,
  deterministicId,
  type CborValue,
} from '../../src/core/interop/contract';
import {
  BN_ONE,
  U128_MAX,
  I128_MAX,
  I128_MIN,
  PHI_SCALED,
  PHI_INV_SCALED,
  PHI_INV2_SCALED,
  PHI_INV3_SCALED,
  bnFromNumber,
  bnToNumber,
  bnToDecimalString,
  bnClampUnit,
  log2Fix,
  exp2Fix,
  exp2Frac,
  isqrt,
  weightedGeometricMean,
  phiWeightedGeometricMean,
  mergeSubstrates,
  satMulU128,
  satI128,
  satDivI128,
  trustScoreMultiplier,
  trustTier,
  trustInvalidationQuorum,
} from '../../src/core/interop/bn128';
import { SensoryGateway } from '../../src/core/sensory/SensoryGateway';

// ── R2.1 canonical CBOR ────────────────────────────────────────────────────

describe('R2 · canonical CBOR', () => {
  it('encodes RFC 8949 head lengths at the shortest width', () => {
    expect(toHex(encodeCbor(0))).toBe('00');
    expect(toHex(encodeCbor(23))).toBe('17');
    expect(toHex(encodeCbor(24))).toBe('1818');
    expect(toHex(encodeCbor(256))).toBe('190100');
    expect(toHex(encodeCbor(65536))).toBe('1a00010000');
    expect(toHex(encodeCbor(-1))).toBe('20');
    expect(toHex(encodeCbor(-500))).toBe('3901f3');
    expect(toHex(encodeCbor(''))).toBe('60');
    expect(toHex(encodeCbor('a'))).toBe('6161');
    expect(toHex(encodeCbor([1, 2, 3]))).toBe('83010203');
    expect(toHex(encodeCbor(true))).toBe('f5');
    expect(toHex(encodeCbor(null))).toBe('f6');
  });

  it('orders map keys bytewise, so key insertion order cannot change the bytes', () => {
    const a = encodeCbor({ b: 1, a: 2, aa: 3 });
    const b = encodeCbor({ aa: 3, a: 2, b: 1 });
    expect(toHex(a)).toBe(toHex(b));
    // shorter key sorts first under bytewise-on-encoded-key ordering
    expect(toHex(a).startsWith('a3' + '6161')).toBe(true);
  });

  it('round-trips nested structures exactly', () => {
    const v: CborValue = {
      version: INTEROP_VERSION,
      n: 34,
      ratio: 0.6180339887498949,
      flags: [true, false, null],
      blob: Uint8Array.from([0, 1, 254, 255]),
      nested: { z: { y: [1, -1, 'x'] } },
    };
    const back = decodeCbor(encodeCbor(v)) as Record<string, CborValue>;
    expect(back.version).toBe(INTEROP_VERSION);
    expect(back.n).toBe(34);
    expect(back.ratio).toBe(0.6180339887498949);
    expect(Array.from(back.blob as Uint8Array)).toEqual([0, 1, 254, 255]);
    expect(back.nested).toEqual({ z: { y: [1, -1, 'x'] } });
  });

  it('drops undefined members but refuses non-finite numbers', () => {
    expect(toHex(encodeCbor({ a: 1, b: undefined as unknown as CborValue }))).toBe(
      toHex(encodeCbor({ a: 1 })),
    );
    expect(() => encodeCbor(Number.NaN)).toThrow(/non-finite/);
    expect(() => encodeCbor({ x: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
  });

  it('rejects trailing bytes rather than silently accepting a truncated preimage', () => {
    const good = encodeCbor([1, 2]);
    const bad = new Uint8Array([...good, 0x00]);
    expect(() => decodeCbor(bad)).toThrow(/trailing/);
  });

  it('encodes bigints beyond float precision without loss', () => {
    const big = 12345678901234567890n;
    expect(decodeCbor(encodeCbor(big))).toBe(big);
  });
});

// ── R2.2 the hash law ──────────────────────────────────────────────────────

describe('R2 · one hash law', () => {
  it('declares SHA3-256 and matches the known-answer test', () => {
    expect(HASH_LAW).toBe('sha3-256');
    // NIST KAT: SHA3-256("") — proves we call SHA3, not SHA-256 or Keccak-256.
    expect(hashHex(new Uint8Array(0))).toBe(
      'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a',
    );
    expect(hashHex(new TextEncoder().encode('abc'))).toBe(
      '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532',
    );
  });

  it('keeps the legacy digest strictly separate — no silent fallback', () => {
    const b = new TextEncoder().encode('abc');
    expect(hashLegacySha256Hex(b)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashLegacySha256Hex(b)).not.toBe(hashHex(b));
  });

  it('hex helpers round-trip', () => {
    const h = hash(new TextEncoder().encode('raffy'));
    expect(Array.from(fromHex(toHex(h)))).toEqual(Array.from(h));
  });

  it('hashes values through canonical CBOR, so key order cannot change a digest', () => {
    expect(hashValueHex({ a: 1, b: 2 })).toBe(hashValueHex({ b: 2, a: 1 }));
    expect(hashValueHex({ a: 1 })).not.toBe(hashValueHex({ a: 2 }));
  });
});

// ── R2.3 HLC v2.1 ──────────────────────────────────────────────────────────

describe('R2 · HLC v2.1', () => {
  it('requires a node id', () => {
    expect(() => hlcZero('')).toThrow(/node id/);
    expect(hlcZero('omega').node).toBe('omega');
  });

  it('is monotone even when the wall clock jumps backwards', () => {
    let h = hlcZero('omega');
    h = hlcTick(h, 1000);
    const forward = hlcTick(h, 2000);
    const backward = hlcTick(forward, 500);
    expect(hlcCompare(forward, h)).toBeGreaterThan(0);
    expect(hlcCompare(backward, forward)).toBeGreaterThan(0);
    expect(backward.wall).toBe(2000);
    expect(backward.counter).toBe(forward.counter + 1);
  });

  it('bumps the counter for repeated ticks inside one millisecond', () => {
    let h = hlcZero('omega');
    h = hlcTick(h, 42);
    const h2 = hlcTick(h, 42);
    expect(h2.wall).toBe(42);
    expect(h2.counter).toBe(h.counter + 1);
  });

  it('merges a remote clock ahead of both inputs', () => {
    const local = { wall: 10, counter: 3, node: 'omega' };
    const remote = { wall: 10, counter: 9, node: 'raffy' };
    const m = hlcMerge(local, remote, 5);
    expect(m).toEqual({ wall: 10, counter: 10, node: 'omega' });
    expect(hlcCompare(m, remote)).toBeGreaterThan(0);
  });

  it('encodes to a string whose lexicographic order equals the clock order', () => {
    const clocks = [
      { wall: 2, counter: 0, node: 'a' },
      { wall: 10, counter: 0, node: 'a' },
      { wall: 10, counter: 2, node: 'a' },
      { wall: 10, counter: 2, node: 'b' },
    ];
    const byClock = [...clocks].sort(hlcCompare).map(hlcEncode);
    const byString = clocks.map(hlcEncode).sort();
    expect(byString).toEqual(byClock);
    expect(hlcDecode(hlcEncode(clocks[2]))).toEqual(clocks[2]);
  });
});

// ── R2.4 deterministic ids ─────────────────────────────────────────────────

describe('R2 · deterministic ids', () => {
  it('derives from content only', () => {
    const h = { wall: 7, counter: 1, node: 'omega' };
    const a = deterministicId('finding', h, { pair: ['x', 'y'], r: 0.5 });
    const b = deterministicId('finding', h, { r: 0.5, pair: ['x', 'y'] });
    expect(a).toBe(b);
    expect(a.startsWith('finding_')).toBe(true);
    expect(deterministicId('finding', h, { r: 0.6, pair: ['x', 'y'] })).not.toBe(a);
    expect(deterministicId('finding', hlcTick(h, 7), { r: 0.5, pair: ['x', 'y'] })).not.toBe(a);
  });
});

// ── R3 Q60 ─────────────────────────────────────────────────────────────────

describe('R3 · BigNum128 fixed point is bit-identical to the host merge', () => {
  const PHI = (1 + Math.sqrt(5)) / 2;

  it("pins the φ constants to the host's 10^18-scaled integers", () => {
    expect(PHI_SCALED).toBe(1_618_033_988_749_894_848n);
    expect(PHI_INV_SCALED).toBe(618_033_988_749_894_848n);
    expect(PHI_INV2_SCALED).toBe(381_966_011_250_105_151n);
    expect(PHI_INV3_SCALED).toBe(236_067_977_499_789_696n);
    expect(bnToNumber(PHI_SCALED)).toBeCloseTo(PHI, 12);
    expect(bnToNumber(PHI_INV_SCALED)).toBeCloseTo(1 / PHI, 12);
    expect(bnToNumber(PHI_INV2_SCALED)).toBeCloseTo(1 / PHI ** 2, 12);
    expect(bnToNumber(PHI_INV3_SCALED)).toBeCloseTo(1 / PHI ** 3, 12);
  });

  it('honours φ⁻¹ + φ⁻² = 1 at the host scale', () => {
    expect(PHI_INV_SCALED + PHI_INV2_SCALED).toBe(999_999_999_999_999_999n);
    expect(BN_ONE - (PHI_INV_SCALED + PHI_INV2_SCALED) <= 1n).toBe(true);
  });

  // Host test vectors, reproduced verbatim from merge.rs #[cfg(test)].
  it('log2_fix(BN_ONE) is exactly zero', () => {
    expect(log2Fix(BN_ONE)).toBe(0n);
  });

  it('log2_fix(½) is within 1 ulp of −2^60 in Q60', () => {
    const log = log2Fix(BN_ONE / 2n);
    const diff = log + (1n << 60n);
    expect(diff >= -1n && diff <= 1n).toBe(true);
  });

  it('exp2_fix(0) is exactly BN_ONE', () => {
    expect(exp2Fix(0n)).toBe(BN_ONE);
  });

  it('log2 then exp2 returns the input within 1e-3 of the unit', () => {
    for (const x of [BN_ONE, (BN_ONE * 3n) / 4n, BN_ONE / 2n, BN_ONE / 4n]) {
      const back = exp2Fix(log2Fix(x));
      const diff = back > x ? back - x : x - back;
      expect(diff <= BN_ONE / 1000n).toBe(true);
    }
  });

  it('reproduces the host isqrt and the exp2 constant ladder', () => {
    expect(isqrt(0n)).toBe(0n);
    expect(isqrt(144n)).toBe(12n);
    expect(isqrt(143n)).toBe(11n);
    // 2^(-1/2) in Q60 — the top rung of the ladder.
    expect(exp2Frac(1n << 59n)).toBe(isqrt(1n << 119n));
  });

  it('merges all-ones to exactly one', () => {
    expect(weightedGeometricMean([BN_ONE, BN_ONE, BN_ONE], [BN_ONE, BN_ONE, BN_ONE])).toBe(BN_ONE);
    expect(phiWeightedGeometricMean([BN_ONE, BN_ONE, BN_ONE])).toBe(BN_ONE);
  });

  it('fails closed: any zero substrate collapses the merge to zero', () => {
    expect(weightedGeometricMean([0n, BN_ONE, BN_ONE], [BN_ONE, BN_ONE, BN_ONE])).toBe(0n);
    expect(phiWeightedGeometricMean([0n, BN_ONE, BN_ONE])).toBe(0n);
    expect(mergeSubstrates({ brain: BN_ONE, metatron: 0n, rumf: BN_ONE })).toBe(0n);
  });

  it('reproduces an equal input, geometric-mean style', () => {
    for (const v of [(BN_ONE * 3n) / 4n, BN_ONE / 2n]) {
      const gm = weightedGeometricMean([v, v, v], [BN_ONE, BN_ONE, BN_ONE]);
      const diff = gm > v ? gm - v : v - gm;
      expect(diff <= BN_ONE / 1000n).toBe(true);
    }
  });

  it('rejects out-of-range coherence rather than clamping it silently', () => {
    expect(() => phiWeightedGeometricMean([BN_ONE + 1n, BN_ONE, BN_ONE])).toThrow(/out of range/);
  });

  it('ranks a strong brain above a weak one under φ weighting', () => {
    const strong = mergeSubstrates({
      brain: bnFromNumber(0.9),
      metatron: bnFromNumber(0.6),
      rumf: bnFromNumber(0.5),
    });
    const weak = mergeSubstrates({
      brain: bnFromNumber(0.4),
      metatron: bnFromNumber(0.6),
      rumf: bnFromNumber(0.5),
    });
    expect(strong > weak).toBe(true);
    expect(bnToNumber(strong)).toBeGreaterThan(0);
    expect(bnToNumber(strong)).toBeLessThanOrEqual(1);
  });

  it('saturates instead of exceeding the host u128/i128 range', () => {
    expect(satMulU128(U128_MAX, 2n)).toBe(U128_MAX);
    expect(satI128(I128_MAX * 4n)).toBe(I128_MAX);
    expect(satI128(I128_MIN * 4n)).toBe(I128_MIN);
    expect(satDivI128(10n, 0n)).toBe(I128_MAX);
  });

  it('converts and renders exactly at the display edge', () => {
    expect(bnFromNumber(1)).toBe(BN_ONE);
    expect(bnToDecimalString(BN_ONE / 2n)).toBe('0.500000000000000000');
    expect(bnClampUnit(-5n)).toBe(0n);
    expect(bnClampUnit(BN_ONE * 3n)).toBe(BN_ONE);
    expect(bnToNumber(bnFromNumber(0.6180339887498949))).toBeCloseTo(0.6180339887498949, 15);
    expect(() => bnFromNumber(Number.NaN)).toThrow(/non-finite/);
    expect(() => bnFromNumber(-1)).toThrow(/negative/);
  });

  it('carries the host trust table exactly', () => {
    expect(trustScoreMultiplier('T0')).toBe(BN_ONE / 2n);
    expect(trustScoreMultiplier('T3')).toBe(BN_ONE);
    expect(trustScoreMultiplier('T4')).toBe(BN_ONE * 2n);
    expect(trustScoreMultiplier('T5')).toBe(BN_ONE * 4n);
    expect(trustTier('T5')).toBe(5);
    expect(trustInvalidationQuorum('T5')).toBe(3);
    expect(trustInvalidationQuorum('T4')).toBe(2);
    expect(trustInvalidationQuorum('T0')).toBe(0);
  });
});

// ── R1 determinism ─────────────────────────────────────────────────────────

describe('R1 · intake determinism', () => {
  function runIntake(): string {
    const gw = new SensoryGateway(24, 8);
    for (let i = 0; i < 400; i++) {
      const vec = new Float64Array(28);
      for (let k = 0; k < 28; k++) vec[k] = Math.sin((i + 1) * 0.017 * (k + 1));
      const feat = new Float32Array(28);
      for (let k = 0; k < 28; k++) feat[k] = vec[k];
      gw.ingest(feat, i % 3 === 0 ? 'audio' : i % 3 === 1 ? 'video' : 'imu', 1000 + i);
    }
    const stats = gw.stats();
    return hashValueHex({
      atoms: stats.atoms,
      total: stats.totalIngests,
      recent: gw.recentAtoms(16).map((a) => a.hash),
    } as CborValue);
  }

  it('produces identical atom sets across two identical runs (no Math.random left)', () => {
    const a = runIntake();
    const b = runIntake();
    expect(a).toBe(b);
  });
});
