/**
 * Ω-REAL P6 certification — RFC-6962 ledger + Genome v2.
 *
 * The battery is written to fail if the guarantees are only claimed:
 * tampering must break proofs, corrections must preserve the old body,
 * shredding must actually destroy readability, and lineage must terminate on
 * a cyclic graph.
 */

import { describe, it, expect } from 'vitest';
import {
  MerkleLog,
  hashLeaf,
  hashNode,
  emptyRoot,
  toHex,
  fromHex,
  verifyInclusion,
  verifyConsistency,
} from '../src/ledger/merkle';
import { canonicalJson, bytesToBase64, base64ToBytes, utf8 } from '../src/ledger/canonical';
import { keyPairFromSeed, signTreeHead, verifyTreeHead } from '../src/ledger/sth';
import { GenomeLedger, leafBytes, type Provenance } from '../src/genome/record';
import { sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { gcm } from '@noble/ciphers/aes.js';

const leaf = (s: string) => utf8(s);

describe('P6 · RFC-6962 Merkle log', () => {
  it('matches the RFC vectors for the empty and single-leaf trees', () => {
    const log = new MerkleLog();
    expect(toHex(log.root())).toBe(toHex(emptyRoot()));
    expect(toHex(emptyRoot())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    log.append(new Uint8Array(0));
    // MTH({d0}) = SHA-256(0x00) for the empty leaf.
    expect(toHex(log.root())).toBe(toHex(sha256(new Uint8Array([0x00]))));
  });

  it('domain-separates leaves from internal nodes', () => {
    const a = hashLeaf(leaf('a'));
    const b = hashLeaf(leaf('b'));
    expect(toHex(hashNode(a, b))).not.toBe(toHex(hashLeaf(new Uint8Array([...a, ...b]))));
  });

  it('round-trips hex', () => {
    const h = hashLeaf(leaf('x'));
    expect(toHex(fromHex(toHex(h)))).toBe(toHex(h));
  });

  it('verifies inclusion for every leaf at every tree size 1..33', () => {
    const log = new MerkleLog();
    for (let n = 1; n <= 33; n++) {
      log.append(leaf(`d${n - 1}`));
      const root = log.root(n);
      for (let m = 0; m < n; m++) {
        const proof = log.inclusionProof(m, n);
        expect(verifyInclusion(log.leafHash(m)!, m, n, proof, root)).toBe(true);
      }
    }
  });

  it('inclusion proofs are O(log n) sized', () => {
    const log = new MerkleLog();
    for (let i = 0; i < 1024; i++) log.append(leaf(`d${i}`));
    expect(log.inclusionProof(500, 1024).length).toBe(10);
  });

  it('rejects a tampered leaf, a wrong index and a truncated path', () => {
    const log = new MerkleLog();
    for (let i = 0; i < 16; i++) log.append(leaf(`d${i}`));
    const root = log.root();
    const proof = log.inclusionProof(5);
    expect(verifyInclusion(hashLeaf(leaf('evil')), 5, 16, proof, root)).toBe(false);
    expect(verifyInclusion(log.leafHash(5)!, 6, 16, proof, root)).toBe(false);
    expect(verifyInclusion(log.leafHash(5)!, 5, 16, proof.slice(1), root)).toBe(false);
  });

  it('verifies consistency for every pair m ≤ n up to 33', () => {
    const log = new MerkleLog();
    const roots: Uint8Array[] = [log.root(0)];
    for (let i = 0; i < 33; i++) {
      log.append(leaf(`d${i}`));
      roots.push(log.root(i + 1));
    }
    for (let n = 1; n <= 33; n++) {
      for (let m = 0; m <= n; m++) {
        const p = log.consistencyProof(m, n);
        expect(verifyConsistency(m, roots[m], n, roots[n], p)).toBe(true);
      }
    }
  });

  it('consistency proofs are O(log n) sized, not O(n)', () => {
    const log = new MerkleLog();
    for (let i = 0; i < 1024; i++) log.append(leaf(`d${i}`));
    expect(log.consistencyProof(700, 1024).length).toBeLessThanOrEqual(11);
  });

  it('rejects a rewritten history', () => {
    const a = new MerkleLog();
    for (let i = 0; i < 8; i++) a.append(leaf(`d${i}`));
    const oldRoot = a.root(8);
    for (let i = 8; i < 16; i++) a.append(leaf(`d${i}`));

    // A forked log that changed leaf 3 then appended the same tail.
    const b = new MerkleLog();
    for (let i = 0; i < 16; i++) b.append(leaf(i === 3 ? 'tampered' : `d${i}`));

    const proof = b.consistencyProof(8, 16);
    expect(verifyConsistency(8, oldRoot, 16, b.root(16), proof)).toBe(false);
  });
});

describe('P6 · canonical JSON', () => {
  it('is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('drops undefined members and normalises -0', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson(-0)).toBe('0');
  });

  it('refuses non-finite numbers instead of silently writing null', () => {
    expect(() => canonicalJson({ x: NaN })).toThrow();
    expect(() => canonicalJson({ x: Infinity })).toThrow();
  });

  it('round-trips base64 for arbitrary byte lengths', () => {
    for (let n = 0; n < 40; n++) {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = (i * 37 + n) & 0xff;
      expect(Array.from(base64ToBytes(bytesToBase64(b)))).toEqual(Array.from(b));
    }
  });
});

describe('P6 · signed tree heads', () => {
  const keys = keyPairFromSeed(new Uint8Array(32).fill(11));

  it('signs and verifies a head', () => {
    const sth = signTreeHead({ logId: 'omega', size: 7, rootHex: 'ab', timestamp: 100 }, keys);
    expect(verifyTreeHead(sth, keys.publicKey)).toBe(true);
  });

  it('is deterministic for the same head', () => {
    const h = { logId: 'omega', size: 7, rootHex: 'ab', timestamp: 100 };
    expect(signTreeHead(h, keys).signature).toBe(signTreeHead(h, keys).signature);
  });

  it('rejects a head whose size, root or timestamp was edited', () => {
    const sth = signTreeHead({ logId: 'omega', size: 7, rootHex: 'ab', timestamp: 100 }, keys);
    expect(verifyTreeHead({ ...sth, size: 8 })).toBe(false);
    expect(verifyTreeHead({ ...sth, rootHex: 'ac' })).toBe(false);
    expect(verifyTreeHead({ ...sth, timestamp: 101 })).toBe(false);
    expect(verifyTreeHead({ ...sth, logId: 'other' })).toBe(false);
  });

  it('rejects a head signed by a different key', () => {
    const other = keyPairFromSeed(new Uint8Array(32).fill(12));
    const sth = signTreeHead({ logId: 'omega', size: 1, rootHex: 'ab', timestamp: 1 }, other);
    expect(verifyTreeHead(sth, keys.publicKey)).toBe(false);
  });
});

function newLedger(): GenomeLedger {
  return new GenomeLedger(
    'omega-genome',
    new Uint8Array(32).fill(5),
    keyPairFromSeed(new Uint8Array(32).fill(9)),
  );
}

const prov: Provenance = { attributedTo: 'test', generatedBy: 'r6', evidence: 'measured' };

describe('P6 · Genome v2 records', () => {
  it('seals and reopens a body', () => {
    const g = newLedger();
    g.append({
      id: 'r1',
      kind: 'percept',
      body: { hz: 1.5, tag: 'tone' },
      recordedAt: 10,
      provenance: prov,
    });
    expect(g.open('r1')).toEqual({ hz: 1.5, tag: 'tone' });
  });

  it('does not store the body in the clear', () => {
    const g = newLedger();
    g.append({
      id: 'r1',
      kind: 'percept',
      body: { secret: 'kingfisher' },
      recordedAt: 10,
      provenance: prov,
    });
    expect(g.get('r1')!.sealed).not.toContain('kingfisher');
  });

  it('binds the header as AAD — a record re-labelled after sealing will not open', () => {
    const g = newLedger();
    const rec = g.append({
      id: 'r1',
      kind: 'percept',
      body: { a: 1 },
      recordedAt: 10,
      provenance: prov,
    });
    const key = hkdf(
      sha256,
      new Uint8Array(32).fill(5),
      utf8('genome-v2-salt'),
      utf8('record:r1'),
      32,
    );
    const packed = base64ToBytes(rec.sealed);
    const nonce = packed.slice(0, 12);
    const ct = packed.slice(12);

    // Correct header opens.
    const aadOk = utf8(canonicalJson(rec.header as unknown as Record<string, unknown>));
    expect(JSON.parse(new TextDecoder().decode(gcm(key, nonce, aadOk).decrypt(ct)))).toEqual({
      a: 1,
    });

    // Any header edit breaks the tag — the body cannot be re-attributed.
    for (const edit of [{ kind: 'belief' }, { recordedAt: 11 }, { id: 'r2' }]) {
      const aadBad = utf8(
        canonicalJson({ ...rec.header, ...edit } as unknown as Record<string, unknown>),
      );
      expect(() => gcm(key, nonce, aadBad).decrypt(ct)).toThrow();
    }
  });

  it('rejects duplicate ids', () => {
    const g = newLedger();
    g.append({ id: 'r1', kind: 'k', body: 1, recordedAt: 1, provenance: prov });
    expect(() =>
      g.append({ id: 'r1', kind: 'k', body: 2, recordedAt: 2, provenance: prov }),
    ).toThrow(/duplicate/);
  });

  it('keeps the pre-correction body readable after a correction', () => {
    const g = newLedger();
    g.append({ id: 'r1', kind: 'belief', body: { omega: 0.372 }, recordedAt: 1, provenance: prov });
    g.correct(
      'r1',
      { omega: 0.418 },
      { id: 'r2', recordedAt: 2, reason: 'remeasured after warm-up', provenance: prov },
    );
    expect(g.open('r1')).toEqual({ omega: 0.372 });
    expect(g.open('r2')).toEqual({ omega: 0.418 });
    expect(g.current('r1')!.header.id).toBe('r2');
    expect(g.get('r2')!.header.supersedes).toBe('r1');
    expect(g.get('r2')!.header.correctionReason).toBe('remeasured after warm-up');
  });

  it('refuses an empty correction reason', () => {
    const g = newLedger();
    g.append({ id: 'r1', kind: 'k', body: 1, recordedAt: 1, provenance: prov });
    expect(() =>
      g.correct('r1', 2, { id: 'r2', recordedAt: 2, reason: '   ', provenance: prov }),
    ).toThrow(/reason/);
  });

  it('refuses to double-supersede', () => {
    const g = newLedger();
    g.append({ id: 'r1', kind: 'k', body: 1, recordedAt: 1, provenance: prov });
    g.correct('r1', 2, { id: 'r2', recordedAt: 2, reason: 'a', provenance: prov });
    expect(() =>
      g.correct('r1', 3, { id: 'r3', recordedAt: 3, reason: 'b', provenance: prov }),
    ).toThrow(/superseded/);
  });

  it('crypto-shredding destroys readability but keeps the ledger intact', () => {
    const g = newLedger();
    g.append({ id: 'r1', kind: 'k', body: { pii: 'name' }, recordedAt: 1, provenance: prov });
    const rootBefore = g.rootHex();
    expect(g.shred('r1')).toBe(true);
    expect(g.open('r1')).toBeNull();
    expect(g.isShredded('r1')).toBe(true);
    expect(g.rootHex()).toBe(rootBefore);
    expect(g.audit(1).ok).toBe(true);
  });

  it('lineage terminates on a cyclic derivedFrom graph', () => {
    const g = newLedger();
    g.append({
      id: 'a',
      kind: 'k',
      body: 1,
      recordedAt: 1,
      provenance: { ...prov, derivedFrom: ['b'] },
    });
    g.append({
      id: 'b',
      kind: 'k',
      body: 2,
      recordedAt: 2,
      provenance: { ...prov, derivedFrom: ['a'] },
    });
    // 'a' is the query root, not its own ancestor: the walk must stop at 'b'
    // instead of looping a→b→a forever.
    expect(g.lineage('a')).toEqual(['b']);
    expect(g.lineage('b')).toEqual(['a']);
  });

  it('answers bi-temporal validity queries', () => {
    const g = newLedger();
    g.append({
      id: 'r1',
      kind: 'k',
      body: 1,
      recordedAt: 1,
      validFrom: 0,
      validTo: 10,
      provenance: prov,
    });
    g.append({
      id: 'r2',
      kind: 'k',
      body: 2,
      recordedAt: 2,
      validFrom: 10,
      validTo: null,
      provenance: prov,
    });
    expect(g.validAt(5).map((r) => r.header.id)).toEqual(['r1']);
    expect(g.validAt(10).map((r) => r.header.id)).toEqual(['r2']);
    expect(g.validAt(1000).map((r) => r.header.id)).toEqual(['r2']);
  });

  it('produces inclusion evidence a third party can verify without the ledger', () => {
    const g = newLedger();
    for (let i = 0; i < 20; i++) {
      g.append({ id: `r${i}`, kind: 'k', body: { i }, recordedAt: i, provenance: prov });
    }
    const rec = g.get('r7')!;
    const ev = g.prove('r7', 999)!;
    const leafH = sha256(new Uint8Array([0x00, ...leafBytes(rec.header, rec.sealed)]));
    expect(toHex(leafH)).toBe(rec.leafHex);
    expect(
      verifyInclusion(
        leafH,
        ev.leafIndex,
        ev.treeSize,
        ev.proofHex.map(fromHex),
        fromHex(ev.rootHex),
      ),
    ).toBe(true);
    expect(verifyTreeHead(ev.sth)).toBe(true);
    expect(ev.sth.rootHex).toBe(ev.rootHex);
  });

  it('proves append-only growth across a batch of writes', () => {
    const g = newLedger();
    for (let i = 0; i < 10; i++)
      g.append({ id: `r${i}`, kind: 'k', body: i, recordedAt: i, provenance: prov });
    const oldRoot = fromHex(g.rootHex());
    const oldSize = g.size;
    for (let i = 10; i < 25; i++)
      g.append({ id: `r${i}`, kind: 'k', body: i, recordedAt: i, provenance: prov });
    const proof = g.proveAppendOnly(oldSize).map(fromHex);
    expect(verifyConsistency(oldSize, oldRoot, g.size, fromHex(g.rootHex()), proof)).toBe(true);
  });

  it('self-audits a populated ledger', () => {
    const g = newLedger();
    for (let i = 0; i < 40; i++)
      g.append({ id: `r${i}`, kind: 'k', body: { i }, recordedAt: i, provenance: prov });
    g.correct(
      'r3',
      { i: 3, fixed: true },
      { id: 'c3', recordedAt: 100, reason: 'drift', provenance: prov },
    );
    const a = g.audit(200);
    expect(a.failures).toEqual([]);
    expect(a.ok).toBe(true);
    expect(a.checked).toBe(41);
  });

  it('is byte-reproducible: same inputs ⇒ same root', () => {
    const build = () => {
      const g = newLedger();
      for (let i = 0; i < 12; i++)
        g.append({
          id: `r${i}`,
          kind: 'k',
          body: { i, s: `v${i}` },
          recordedAt: i,
          provenance: prov,
        });
      return g.rootHex();
    };
    expect(build()).toBe(build());
  });
});
