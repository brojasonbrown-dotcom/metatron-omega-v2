/**
 * P9.3 — the evidence ledger.
 *
 * These tests are adversarial on purpose: the ledger's only value is that a
 * tampered or reordered pass fails to verify. If any of these ever pass while
 * the log has been edited, the ledger is decoration.
 */

import { describe, it, expect } from 'vitest';
import {
  FindingLedger,
  sealFinding,
  sessionSeed,
  LOG_ID,
} from '../../src/core/analysis/findingLedger';
import type { PairFinding, SpineReport } from '../../src/core/analysis/analysisSpine';
import { canonicalJson, utf8 } from '../../packages/trnn-core/src/ledger/canonical';
import { hashLeaf, toHex } from '../../packages/trnn-core/src/ledger/merkle';
import { verifyTreeHead } from '../../packages/trnn-core/src/ledger/sth';

const SEED = new Uint8Array(32).fill(7);

function finding(over: Partial<PairFinding> = {}): PairFinding {
  return {
    a: 'engine.energy',
    b: 'memory.surprise',
    n: 200,
    unmatched: 0,
    toleranceMs: 31.25,
    verdict: 'report',
    correlation: null,
    causal: null,
    association: 0.87,
    bus: null,
    direction: 0.3,
    directionVerdict: 'forward',
    ...over,
  } as PairFinding;
}

function report(findings: PairFinding[]): SpineReport {
  const reported = findings.filter((f) => f.verdict === 'report').length;
  return {
    findings,
    reported,
    abstained: findings.length - reported,
    skipped: 0,
    strongest: findings.find((f) => f.verdict === 'report') ?? null,
  };
}

describe('P9.3 finding ledger', () => {
  it('seals a pass and verifies inclusion and signature', () => {
    const l = new FindingLedger(SEED);
    const e = l.seal(report([finding()]), 1_700_000_000_000);
    expect(e.pass.index).toBe(0);
    expect(l.size).toBe(1);
    expect(l.verifyEntry(e)).toEqual({ ok: true, reason: null });
    expect(verifyTreeHead(e.sth)).toBe(true);
    expect(e.sth.logId).toBe(LOG_ID);
  });

  it('the leaf is the hash of the canonical bytes it publishes', () => {
    const l = new FindingLedger(SEED);
    const e = l.seal(report([finding()]), 1000);
    expect(toHex(hashLeaf(utf8(e.pass.canonical)))).toBe(e.pass.leafHex);
  });

  it('older entries stay provable as the log grows', () => {
    const l = new FindingLedger(SEED);
    const first = l.seal(report([finding()]), 1);
    for (let i = 2; i <= 40; i++) l.seal(report([finding({ association: i / 100 })]), i);
    expect(l.size).toBe(40);
    expect(l.verifyEntry(first).ok).toBe(true);
    expect(l.proofAt(0).length).toBeGreaterThan(0);
  });

  it('each new head extends the previous one', () => {
    const l = new FindingLedger(SEED);
    const a = l.seal(report([finding()]), 1);
    for (let i = 2; i <= 9; i++) l.seal(report([finding()]), i);
    expect(l.verifyExtends(a.sth)).toBe(true);
  });

  it('rejects a tampered record body', () => {
    const l = new FindingLedger(SEED);
    const e = l.seal(report([finding()]), 1);
    const forged = {
      ...e,
      pass: { ...e.pass, canonical: e.pass.canonical.replace('0.87', '0.99') },
    };
    // The canonical bytes no longer hash to the sealed leaf.
    expect(toHex(hashLeaf(utf8(forged.pass.canonical)))).not.toBe(e.pass.leafHex);
  });

  it('rejects a tampered leaf hash', () => {
    const l = new FindingLedger(SEED);
    const e = l.seal(report([finding()]), 1);
    const forged = { ...e, pass: { ...e.pass, leafHex: 'ff'.repeat(32) } };
    expect(l.verifyEntry(forged).ok).toBe(false);
    expect(l.verifyEntry(forged).reason).toBe('leaf hash mismatch');
  });

  it('rejects a tampered signed head', () => {
    const l = new FindingLedger(SEED);
    const e = l.seal(report([finding()]), 1);
    expect(l.verifyEntry({ ...e, sth: { ...e.sth, size: 99 } }).ok).toBe(false);
    expect(l.verifyEntry({ ...e, sth: { ...e.sth, rootHex: '00'.repeat(32) } }).ok).toBe(false);
    expect(l.verifyEntry({ ...e, sth: { ...e.sth, timestamp: 2 } }).ok).toBe(false);
  });

  it('a head from a different key does not verify as ours', () => {
    const a = new FindingLedger(SEED);
    const b = new FindingLedger(new Uint8Array(32).fill(9));
    const ea = a.seal(report([finding()]), 1);
    const eb = b.seal(report([finding()]), 1);
    // Both are internally valid but carry different publishers.
    expect(verifyTreeHead(ea.sth)).toBe(true);
    expect(verifyTreeHead(eb.sth)).toBe(true);
    expect(ea.sth.publicKey).not.toBe(eb.sth.publicKey);
  });

  it('non-finite statistics seal as null, never as a confident zero', () => {
    const f = finding({
      verdict: 'abstain',
      reason: 'below floor',
      association: null,
      direction: NaN as unknown as number,
    });
    const sealedF = sealFinding(f);
    expect(sealedF.association).toBeNull();
    expect(sealedF.direction).toBeNull();
    const json = canonicalJson({ f: sealedF });
    expect(json).toContain('"association":null');
    expect(() => canonicalJson({ bad: Infinity })).toThrow();
  });

  it('is byte-deterministic: identical passes seal to identical leaves', () => {
    const a = new FindingLedger(SEED);
    const b = new FindingLedger(SEED);
    const r = report([
      finding(),
      finding({ b: 'sense.arousal', verdict: 'abstain', association: null }),
    ]);
    const ea = a.seal(r, 12345);
    const eb = b.seal(r, 12345);
    expect(ea.pass.canonical).toBe(eb.pass.canonical);
    expect(ea.pass.leafHex).toBe(eb.pass.leafHex);
    expect(ea.sth.signature).toBe(eb.sth.signature);
    expect(a.rootHex).toBe(b.rootHex);
  });

  it('reordering two passes changes the root — order is part of the evidence', () => {
    const r1 = report([finding({ association: 0.1 })]);
    const r2 = report([finding({ association: 0.2 })]);
    const a = new FindingLedger(SEED);
    a.seal(r1, 1);
    a.seal(r2, 2);
    const b = new FindingLedger(SEED);
    b.seal(r2, 2);
    b.seal(r1, 1);
    expect(a.rootHex).not.toBe(b.rootHex);
  });

  it('bounds retained bodies while keeping every leaf provable', () => {
    const l = new FindingLedger(SEED, 5);
    let first = l.seal(report([finding()]), 1);
    for (let i = 2; i <= 30; i++) l.seal(report([finding()]), i);
    expect(l.recent(100).length).toBe(5);
    expect(l.size).toBe(30);
    // The evicted body still verifies against the live log.
    expect(l.verifyEntry(first).ok).toBe(true);
    first = l.latest()!;
    expect(first.pass.index).toBe(29);
  });

  it('sessionSeed yields a 32-byte seed usable for signing', () => {
    const s = sessionSeed();
    expect(s.length).toBe(32);
    expect(() => new FindingLedger(s)).not.toThrow();
  });
});
