/**
 * Signed Tree Heads — Ed25519 over the canonical head record.
 *
 * A Merkle root alone proves internal consistency; it proves nothing about
 * WHO published it. An operator holding two divergent roots cannot tell which
 * one this machine actually emitted unless the head is signed. The signature
 * covers {logId, size, rootHash, timestamp} in canonical JSON, so a head
 * cannot be replayed against a different log or re-dated.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { canonicalJson, utf8, bytesToBase64, base64ToBytes } from './canonical';
import { toHex } from './merkle';

export interface TreeHead {
  readonly logId: string;
  readonly size: number;
  readonly rootHex: string;
  /** Logical timestamp supplied by the caller — never Date.now() inside, so
   *  replays are reproducible. */
  readonly timestamp: number;
}

export interface SignedTreeHead extends TreeHead {
  readonly signature: string; // base64
  readonly publicKey: string; // base64
}

export interface LogKeyPair {
  readonly secretKey: Uint8Array;
  readonly publicKey: Uint8Array;
}

/** Derive a key pair deterministically from a 32-byte seed. */
export function keyPairFromSeed(seed: Uint8Array): LogKeyPair {
  if (seed.length !== 32) throw new RangeError('seed must be 32 bytes');
  const secretKey = Uint8Array.from(seed);
  return { secretKey, publicKey: ed25519.getPublicKey(secretKey) };
}

export function headBytes(head: TreeHead): Uint8Array {
  return utf8(
    canonicalJson({
      logId: head.logId,
      size: head.size,
      rootHex: head.rootHex,
      timestamp: head.timestamp,
    }),
  );
}

export function signTreeHead(head: TreeHead, keys: LogKeyPair): SignedTreeHead {
  const sig = ed25519.sign(headBytes(head), keys.secretKey);
  return {
    ...head,
    signature: bytesToBase64(sig),
    publicKey: bytesToBase64(keys.publicKey),
  };
}

export function verifyTreeHead(sth: SignedTreeHead, expectedPublicKey?: Uint8Array): boolean {
  const pk = base64ToBytes(sth.publicKey);
  if (expectedPublicKey) {
    if (pk.length !== expectedPublicKey.length) return false;
    let d = 0;
    for (let i = 0; i < pk.length; i++) d |= pk[i] ^ expectedPublicKey[i];
    if (d !== 0) return false;
  }
  try {
    return ed25519.verify(base64ToBytes(sth.signature), headBytes(sth), pk);
  } catch {
    return false;
  }
}

export { toHex };
