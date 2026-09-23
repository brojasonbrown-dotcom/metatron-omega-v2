/**
 * RFC-6962 Merkle tree — append-only log with inclusion and consistency proofs.
 *
 * Domain separation is the whole point of the RFC-6962 shape and is not
 * optional: leaves hash as SHA-256(0x00 ‖ data) and internal nodes as
 * SHA-256(0x01 ‖ left ‖ right). Without the prefixes an attacker can present
 * an internal node as a leaf ("second-preimage") and forge membership.
 *
 * The reference implementation this replaces verified consistency by
 * recomputing the whole old root — O(n) per check, which silently becomes the
 * dominant cost of every audit. The proofs here are the true O(log n) RFC
 * algorithms (PATH / PROOF), and verification never touches the leaf store.
 */

import { sha256 } from '@noble/hashes/sha2.js';

export type Hash = Uint8Array;

const LEAF_PREFIX = 0x00;
const NODE_PREFIX = 0x01;

/** SHA-256 of the empty log, per RFC 6962 §2.1. */
export function emptyRoot(): Hash {
  return sha256(new Uint8Array(0));
}

export function hashLeaf(data: Uint8Array): Hash {
  const b = new Uint8Array(1 + data.length);
  b[0] = LEAF_PREFIX;
  b.set(data, 1);
  return sha256(b);
}

export function hashNode(left: Hash, right: Hash): Hash {
  const b = new Uint8Array(1 + left.length + right.length);
  b[0] = NODE_PREFIX;
  b.set(left, 1);
  b.set(right, 1 + left.length);
  return sha256(b);
}

export function toHex(h: Uint8Array): string {
  let s = '';
  for (let i = 0; i < h.length; i++) s += h[i].toString(16).padStart(2, '0');
  return s;
}

export function fromHex(s: string): Uint8Array {
  const n = s.length >> 1;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function hashEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/** Largest power of two strictly less than n (the RFC's split point k). */
function splitPoint(n: number): number {
  let k = 1;
  while (k << 1 < n) k <<= 1;
  return k;
}

/** MTH(D[0:n]) over already-hashed leaves. */
function mth(leaves: readonly Hash[], lo: number, hi: number): Hash {
  const n = hi - lo;
  if (n === 0) return emptyRoot();
  if (n === 1) return leaves[lo];
  const k = splitPoint(n);
  return hashNode(mth(leaves, lo, lo + k), mth(leaves, lo + k, hi));
}

/**
 * Append-only Merkle log. Stores leaf hashes only; leaf payloads live with the
 * caller, so the log itself never becomes a second copy of the data.
 */
export class MerkleLog {
  private readonly leaves: Hash[] = [];

  get size(): number { return this.leaves.length; }

  /** Append raw leaf data; returns the leaf index. */
  append(data: Uint8Array): number {
    this.leaves.push(hashLeaf(data));
    return this.leaves.length - 1;
  }

  /** Append an already-computed leaf hash (for replay from a persisted log). */
  appendLeafHash(h: Hash): number {
    this.leaves.push(Uint8Array.from(h));
    return this.leaves.length - 1;
  }

  leafHash(i: number): Hash | null {
    return i >= 0 && i < this.leaves.length ? this.leaves[i] : null;
  }

  /** Merkle tree head over the first `size` leaves (default: all). */
  root(size = this.leaves.length): Hash {
    if (size < 0 || size > this.leaves.length) throw new RangeError('size out of range');
    return mth(this.leaves, 0, size);
  }

  /** RFC-6962 PATH(m, D[0:n]) — audit path proving leaf m is in the size-n tree. */
  inclusionProof(m: number, size = this.leaves.length): Hash[] {
    if (size < 0 || size > this.leaves.length) throw new RangeError('size out of range');
    if (m < 0 || m >= size) throw new RangeError('leaf index out of range');
    const path: Hash[] = [];
    let lo = 0, hi = size, idx = m;
    while (hi - lo > 1) {
      const k = splitPoint(hi - lo);
      if (idx < k) {
        path.push(mth(this.leaves, lo + k, hi));
        hi = lo + k;
      } else {
        path.push(mth(this.leaves, lo, lo + k));
        idx -= k;
        lo = lo + k;
      }
    }
    // RFC-6962 PATH is ordered leaf → root; the descent above collects it
    // root → leaf, and a verifier consuming it in that order will hash the
    // right siblings at the wrong levels and reject valid proofs.
    path.reverse();
    return path;
  }

  /** RFC-6962 PROOF(m, D[0:n]) — consistency between the size-m and size-n heads. */
  consistencyProof(m: number, n = this.leaves.length): Hash[] {
    if (m < 0 || n > this.leaves.length || m > n) throw new RangeError('bad range');
    if (m === 0 || m === n) return [];
    return this.subproof(m, 0, n, true);
  }

  private subproof(m: number, lo: number, hi: number, isComplete: boolean): Hash[] {
    const n = hi - lo;
    if (m === n) return isComplete ? [] : [mth(this.leaves, lo, hi)];
    const k = splitPoint(n);
    if (m <= k) {
      const p = this.subproof(m, lo, lo + k, isComplete);
      p.push(mth(this.leaves, lo + k, hi));
      return p;
    }
    const p = this.subproof(m - k, lo + k, hi, false);
    p.push(mth(this.leaves, lo, lo + k));
    return p;
  }
}

/** Verify an audit path: does `leaf` sit at index m of a size-n tree with `root`? */
export function verifyInclusion(
  leaf: Hash, m: number, size: number, proof: readonly Hash[], root: Hash,
): boolean {
  if (m < 0 || m >= size) return false;
  let r = leaf;
  let fn = m, sn = size - 1;
  for (let p = 0; p < proof.length; p++) {
    if (sn === 0) return false; // proof longer than the tree is deep
    if ((fn & 1) === 1 || fn === sn) {
      r = hashNode(proof[p], r);
      // Skip the levels where this subtree was carried up unchanged.
      while ((fn & 1) === 0 && fn !== 0) { fn >>= 1; sn >>= 1; }
    } else {
      r = hashNode(r, proof[p]);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && hashEquals(r, root);
}

/**
 * Verify a consistency proof: is the size-n tree an append-only extension of
 * the size-m tree? O(log n) — it never reconstructs either tree.
 */
export function verifyConsistency(
  m: number, oldRoot: Hash, n: number, newRoot: Hash, proof: readonly Hash[],
): boolean {
  if (m > n || m < 0) return false;
  if (m === n) return proof.length === 0 && hashEquals(oldRoot, newRoot);
  if (m === 0) return proof.length === 0;

  let node = m - 1;
  let size = n - 1;
  while ((node & 1) === 1) { node >>= 1; size >>= 1; }

  let p = 0;
  let fn: Hash, sn: Hash;
  if (node > 0) {
    if (proof.length === 0) return false;
    fn = sn = proof[p++];
  } else {
    // m is an exact power of two: the old root is itself the first seed.
    fn = sn = oldRoot;
  }

  while (node > 0) {
    if (p >= proof.length) return false;
    if ((node & 1) === 1) {
      const s = proof[p++];
      fn = hashNode(s, fn);
      sn = hashNode(s, sn);
    } else if (node < size) {
      sn = hashNode(sn, proof[p++]);
    }
    node >>= 1;
    size >>= 1;
  }
  while (size > 0) {
    if (p >= proof.length) return false;
    sn = hashNode(sn, proof[p++]);
    size >>= 1;
  }
  return p === proof.length && hashEquals(fn, oldRoot) && hashEquals(sn, newRoot);
}
