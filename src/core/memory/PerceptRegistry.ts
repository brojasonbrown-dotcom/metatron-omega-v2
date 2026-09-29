/**
 * PerceptRegistry — named, recognisable percepts on top of SensoryGateway atoms.
 *
 * A "percept" is any SimHash sensory atom that has been reinforced past the
 * Hurwitz threshold (default = ⌈φ⁴⌉ = 7). Each percept carries:
 *   • stable id           p_<8-char hash prefix>
 *   • dominant modality   (audio / video / imu / synthetic)
 *   • EMA embedding       (rolling centroid of top-K amplitudes, α = 1/φ²)
 *   • optional label      (set by chat/tool layer — Metatron names its own)
 *   • co-bound siblings   (other percept ids active in the same fold window)
 *   • first/last seen, total reinforcements
 *
 * Recognition: `recognise(injection)` returns the best match by SimHash
 * Hamming distance × embedding cosine. Confidence ≥ 1/φ ≈ 0.618 → "recognised";
 * 0.382..0.618 → "familiar"; below → novel.
 *
 * Pure browser-side. No I/O, no allocation in steady state (Map ops only).
 */

import { hammingPre, parseHash64 } from '@/core/sensory/SimHashPhi';
import type { SensoryInjection } from '@/core/sensory/SensoryGateway';
import type { SensoryModality } from '@/core/sensory/SensoryAtom';

export const PHI = (1 + Math.sqrt(5)) / 2;
export const PHI_INV = 1 / PHI;
export const PHI_INV_SQ = PHI_INV * PHI_INV; // ≈ 0.381966 — EMA α
export const PROMOTE_REINFORCEMENTS = 7; // ⌈φ⁴⌉
export const RECOG_CONFIDENT = PHI_INV; // ≈ 0.618
export const RECOG_FAMILIAR = PHI_INV_SQ; // ≈ 0.382
const NEAR_HAMMING = 8; // bits — same percept band
const EMBED_DIM = 32; // matches SensoryGateway topK
const COBIND_CAP = 16; // max co-bound ids per percept

export interface Percept {
  id: string;
  hash: string; // 16-char hex simHash
  modality: SensoryModality;
  reinforcements: number;
  firstSeen: number;
  lastSeen: number;
  embedding: Float32Array; // EMA centroid of top-K amps, length EMBED_DIM
  label?: string; // user/Metatron-set name
  coBound: Map<string, number>; // perceptId → cross-modal co-activation weight
}

export interface Recognition {
  percept: Percept | null;
  confidence: number; // 0..1
  status: 'recognised' | 'familiar' | 'novel';
}

export interface PerceptStats {
  total: number;
  named: number;
  perModality: Record<SensoryModality, number>;
  boundPairs: number;
}

export class PerceptRegistry {
  private byId = new Map<string, Percept>();
  private byHash = new Map<string, string>(); // hash → id
  private cap: number;

  constructor(cap = 1024) {
    this.cap = Math.max(64, cap | 0);
  }

  setCap(c: number): void {
    this.cap = Math.max(64, c | 0);
    this.evictIfFull();
  }
  capacity(): number {
    return this.cap;
  }
  size(): number {
    return this.byId.size;
  }

  get(id: string): Percept | null {
    return this.byId.get(id) ?? null;
  }
  getByHash(hash: string): Percept | null {
    const id = this.byHash.get(hash);
    return id ? (this.byId.get(id) ?? null) : null;
  }

  /** All percepts, newest first. */
  list(limit = 32): Percept[] {
    const out: Percept[] = [];
    for (const p of this.byId.values()) out.push(p);
    out.sort((a, b) => b.lastSeen - a.lastSeen);
    return out.slice(0, limit);
  }

  /**
   * Update the registry from one sensory injection. Returns the percept iff
   * the atom is promoted (reinforced ≥ threshold), else null. Idempotent for
   * the same injection reference.
   */
  upsert(inj: SensoryInjection, tick: number): Percept | null {
    if (!inj.hash || inj.indices.length === 0) return null;
    let id = this.byHash.get(inj.hash);
    let p: Percept | undefined = id ? this.byId.get(id) : undefined;

    if (!p) {
      // Only promote once the atom has crossed the Hurwitz threshold.
      if (inj.reinforcements < PROMOTE_REINFORCEMENTS) return null;
      id = makeId(inj.hash);
      p = {
        id,
        hash: inj.hash,
        modality: inj.modality,
        reinforcements: inj.reinforcements,
        firstSeen: tick,
        lastSeen: tick,
        embedding: embedFromTopK(inj.indices, inj.amplitudes),
        coBound: new Map(),
      };
      this.byId.set(id, p);
      this.byHash.set(inj.hash, id);
      this.evictIfFull();
      return p;
    }

    // EMA blend: e ← (1-α)·e + α·newEmbed
    const fresh = embedFromTopK(inj.indices, inj.amplitudes);
    const a = PHI_INV_SQ;
    const e = p.embedding;
    for (let i = 0; i < e.length; i++) e[i] = (1 - a) * e[i] + a * fresh[i];
    p.reinforcements = inj.reinforcements;
    p.lastSeen = tick;
    return p;
  }

  /**
   * Bind two percepts that co-fired in the same tick. Symmetric. Bounded by
   * COBIND_CAP per side; weakest link drops when full.
   */
  bind(idA: string, idB: string, weight: number): void {
    if (idA === idB) return;
    const a = this.byId.get(idA);
    const b = this.byId.get(idB);
    if (!a || !b) return;
    addBound(a, idB, weight);
    addBound(b, idA, weight);
  }

  /** Find the best-matching percept for a fresh injection. */
  recognise(inj: SensoryInjection): Recognition {
    if (!inj.hash) return { percept: null, confidence: 0, status: 'novel' };
    // Fast path: exact hash match.
    const direct = this.getByHash(inj.hash);
    if (direct) {
      const cos = cosineTopK(direct.embedding, inj.indices, inj.amplitudes);
      const conf = Math.max(0, cos);
      return { percept: direct, confidence: conf, status: classify(conf) };
    }
    // Linear scan within modality + near-Hamming.
    const q = parseHash64(inj.hash);
    let best: Percept | null = null;
    let bestConf = 0;
    for (const p of this.byId.values()) {
      if (p.modality !== inj.modality) continue;
      const hd = hammingPre(q.hi, q.lo, p.hash);
      if (hd > NEAR_HAMMING) continue;
      const hammingScore = 1 - hd / 64;
      const cos = cosineTopK(p.embedding, inj.indices, inj.amplitudes);
      const conf = Math.max(0, hammingScore * cos);
      if (conf > bestConf) {
        bestConf = conf;
        best = p;
      }
    }
    return { percept: best, confidence: bestConf, status: classify(bestConf) };
  }

  /** Set a human-readable label. Returns false if percept doesn't exist. */
  name(id: string, label: string): boolean {
    const p = this.byId.get(id);
    if (!p) return false;
    p.label = label.slice(0, 64);
    return true;
  }

  forget(id: string): boolean {
    const p = this.byId.get(id);
    if (!p) return false;
    this.byId.delete(id);
    this.byHash.delete(p.hash);
    // Unlink from co-bound siblings.
    for (const sibId of p.coBound.keys()) {
      const sib = this.byId.get(sibId);
      sib?.coBound.delete(id);
    }
    return true;
  }

  clear(): void {
    this.byId.clear();
    this.byHash.clear();
  }

  stats(): PerceptStats {
    const perModality: Record<SensoryModality, number> = {
      audio: 0,
      video: 0,
      imu: 0,
      synthetic: 0,
      'vision-embed': 0,
    };
    let named = 0;
    let bonds = 0;
    for (const p of this.byId.values()) {
      perModality[p.modality]++;
      if (p.label) named++;
      bonds += p.coBound.size;
    }
    return { total: this.byId.size, named, perModality, boundPairs: bonds >> 1 };
  }

  private evictIfFull(): void {
    while (this.byId.size > this.cap) {
      // LRU by lastSeen — drop the oldest.
      let oldest: Percept | null = null;
      for (const p of this.byId.values()) {
        if (!oldest || p.lastSeen < oldest.lastSeen) oldest = p;
      }
      if (oldest) this.forget(oldest.id);
      else break;
    }
  }
}

function makeId(hash: string): string {
  return 'p_' + hash.slice(0, 8);
}

function classify(conf: number): Recognition['status'] {
  if (conf >= RECOG_CONFIDENT) return 'recognised';
  if (conf >= RECOG_FAMILIAR) return 'familiar';
  return 'novel';
}

function embedFromTopK(indices: Int32Array, amps: Float32Array): Float32Array {
  // Project the variable-K top sparse vector into a fixed EMBED_DIM bucket
  // (modular hashing). Stable across reinforcements because the same atom's
  // top-K is captured once at creation; recognition compares EMA-blended
  // centroids in the same bucket space.
  const out = new Float32Array(EMBED_DIM);
  for (let i = 0; i < indices.length; i++) {
    const b = ((indices[i] % EMBED_DIM) + EMBED_DIM) % EMBED_DIM;
    out[b] += amps[i];
  }
  // L2-normalise.
  let n = 0;
  for (let i = 0; i < out.length; i++) n += out[i] * out[i];
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

function cosineTopK(emb: Float32Array, indices: Int32Array, amps: Float32Array): number {
  const fresh = embedFromTopK(indices, amps);
  let dot = 0;
  for (let i = 0; i < emb.length; i++) dot += emb[i] * fresh[i];
  return dot; // both already L2-normalised
}

function addBound(p: Percept, sibId: string, weight: number): void {
  const cur = p.coBound.get(sibId) ?? 0;
  // Saturating add — weights stay in [0, 1].
  p.coBound.set(sibId, Math.min(1, cur + weight));
  if (p.coBound.size > COBIND_CAP) {
    let weakest: string | null = null;
    let weakestW = Number.POSITIVE_INFINITY;
    for (const [k, w] of p.coBound) {
      if (w < weakestW) {
        weakestW = w;
        weakest = k;
      }
    }
    if (weakest && weakest !== sibId) p.coBound.delete(weakest);
  }
}
