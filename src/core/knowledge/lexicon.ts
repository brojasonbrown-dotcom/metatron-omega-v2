/**
 * Ω-LEXICON — words the brain computes, not labels it stores.
 *
 * Four deterministic mechanisms, no model, no network:
 *
 *   1. SIGNATURE   w → z_w ∈ U(1)^d  (FHRR phasor vector). z_w is the unit-
 *                  normalised bundle of the word's character-trigram phasors,
 *                  so words that share spelling share phase structure:
 *                  sim(run, runs) ≫ sim(run, cat). Recomputed on demand — the
 *                  lexicon costs zero storage; only learned deltas are kept.
 *   2. LEARNING    a sparse co-occurrence delta per word (Hebbian, closure-
 *                  safe: the delta is bounded so ‖z_w‖ stays 1 after renorm).
 *   3. BINDING     role ⊛ filler = elementwise phasor product (exact inverse
 *                  = conjugate). A sentence is the bundle of its bound slots
 *                  and can be decoded role-by-role.
 *   4. GROUNDING   catalog conditions like `ż > 0` compile to predicates over
 *                  a measured field trajectory. A word "fires" when the field
 *                  does what the word describes. Conditions that cannot be
 *                  computed from the field are marked ungrounded and never
 *                  scored.
 */

import catalogRaw from './lexiconCatalog.json';
import { fnv1a } from './tokenize';
import { dlog, dpow } from '@metatron/trnn-core/core/dmath';
import { calibratedBeta } from '@/core/gematria/resonanceKernel';
import {
  lexeme,
  lexemePattern,
  lexemeRungs,
  lexemeTorus,
  LEXEME_MAX_POS,
  type LexemeTorus,
} from '@/core/gematria/lexeme';

/** Everything the field holds about one word — its unique, inspectable pattern. */
export interface WordInspection {
  readonly token: string;
  /** Exact base-27 integer code. */
  readonly value: number;
  /** False when the word exceeds the injective 11-letter bound. */
  readonly exact: boolean;
  /** Zeckendorf address — the unique key of the code. */
  readonly address: string;
  /** 22-symbol bucket channel (bucketing only). */
  readonly residue: number;
  readonly torus: LexemeTorus;
  /** 32 sign bits of the meaning vector's real part, hex — a visible fingerprint. */
  readonly fingerprint: string;
  /** Times the lexicon has learned this word. */
  readonly count: number;
  /** Nearest other known words by meaning. */
  readonly neighbours: readonly Recall[];
  readonly crisp: boolean;
  /** Catalog entries for this word: grounded ones carry a live predicate. */
  readonly catalog: readonly CatalogEntry[];
}

/** Working width of the phasor space (F17). */
export const LEX_DIM = 1597;

// ─── 1. Signatures ────────────────────────────────────────────────────────

/** Complex vector as split re/im arrays. */
export interface Phasor {
  readonly re: Float64Array;
  readonly im: Float64Array;
}

function zeros(d: number): { re: Float64Array; im: Float64Array } {
  return { re: new Float64Array(d), im: new Float64Array(d) };
}

/** Deterministic unit phasor vector for an atomic key. */
export function atom(key: string, d = LEX_DIM): Phasor {
  const out = zeros(d);
  let h = fnv1a(key);
  for (let i = 0; i < d; i++) {
    // xorshift32 — deterministic across runtimes
    h ^= h << 13;
    h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    const theta = (h / 4294967296) * 2 * Math.PI;
    out.re[i] = Math.cos(theta);
    out.im[i] = Math.sin(theta);
  }
  return out;
}

/** Renormalise every component to unit modulus (projection onto U(1)^d). */
export function toUnit(v: Phasor): Phasor {
  const d = v.re.length;
  const out = zeros(d);
  for (let i = 0; i < d; i++) {
    const m = Math.hypot(v.re[i], v.im[i]);
    if (m > 1e-12) {
      out.re[i] = v.re[i] / m;
      out.im[i] = v.im[i] / m;
    } else {
      out.re[i] = 1;
      out.im[i] = 0;
    }
  }
  return out;
}

/** Real part of the normalised Hermitian inner product, ∈ [−1, 1]. */
export function similarity(a: Phasor, b: Phasor): number {
  const d = Math.min(a.re.length, b.re.length);
  let s = 0;
  for (let i = 0; i < d; i++) s += a.re[i] * b.re[i] + a.im[i] * b.im[i];
  return d > 0 ? s / d : 0;
}

function normToken(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const sigCache = new Map<string, Phasor>();

/** Spelling signature: unit bundle of `#word#` trigram atoms. */
export function spellingSignature(word: string, d = LEX_DIM): Phasor {
  const t = normToken(word);
  const key = `${d}:${t}`;
  const hit = sigCache.get(key);
  if (hit) return hit;
  const acc = zeros(d);
  const w = `#${t}#`;
  const grams = Math.max(1, w.length - 2);
  for (let j = 0; j < grams; j++) {
    const a = atom(`g:${w.slice(j, j + 3)}`, d);
    for (let i = 0; i < d; i++) {
      acc.re[i] += a.re[i];
      acc.im[i] += a.im[i];
    }
  }
  const sig = toUnit(acc);
  if (sigCache.size > 4181) sigCache.clear();
  sigCache.set(key, sig);
  return sig;
}

// ─── 3. Binding ───────────────────────────────────────────────────────────

/** role ⊛ filler: elementwise complex product. */
export function bind(a: Phasor, b: Phasor): Phasor {
  const d = Math.min(a.re.length, b.re.length);
  const out = zeros(d);
  for (let i = 0; i < d; i++) {
    out.re[i] = a.re[i] * b.re[i] - a.im[i] * b.im[i];
    out.im[i] = a.re[i] * b.im[i] + a.im[i] * b.re[i];
  }
  return out;
}

/** Exact inverse of bind for unit phasors: multiply by the conjugate. */
export function unbind(bound: Phasor, role: Phasor): Phasor {
  const d = Math.min(bound.re.length, role.re.length);
  const out = zeros(d);
  for (let i = 0; i < d; i++) {
    out.re[i] = bound.re[i] * role.re[i] + bound.im[i] * role.im[i];
    out.im[i] = bound.im[i] * role.re[i] - bound.re[i] * role.im[i];
  }
  return out;
}

export const ROLES = ['agent', 'action', 'object', 'place', 'time', 'manner'] as const;
export type Role = (typeof ROLES)[number];

export type SentenceFrame = Partial<Record<Role, string>>;

/** Bundle of bound (role, filler) slots — one vector per sentence. */
export function encodeSentence(frame: SentenceFrame, lex?: LexiconMemory, d = LEX_DIM): Phasor {
  const acc = zeros(d);
  for (const r of ROLES) {
    const w = frame[r];
    if (!w) continue;
    const s = bind(atom(`role:${r}`, d), lex ? lex.signature(w) : spellingSignature(w, d));
    for (let i = 0; i < d; i++) {
      acc.re[i] += s.re[i];
      acc.im[i] += s.im[i];
    }
  }
  return acc;
}

export interface RoleDecode {
  readonly role: Role;
  readonly word: string | null;
  readonly score: number;
  readonly runnerUp: number;
}

/** Recover each role's filler by unbinding and matching against candidates. */
export function decodeSentence(
  v: Phasor,
  candidates: readonly string[],
  lex?: LexiconMemory,
  d = LEX_DIM,
): RoleDecode[] {
  const sigs = candidates.map((w) => (lex ? lex.signature(w) : spellingSignature(w, d)));
  const res: RoleDecode[] = [];
  for (const r of ROLES) {
    const probe = unbind(v, atom(`role:${r}`, d));
    let best = -Infinity,
      second = -Infinity,
      bi = -1;
    for (let k = 0; k < sigs.length; k++) {
      const s = similarity(probe, sigs[k]);
      if (s > best) {
        second = best;
        best = s;
        bi = k;
      } else if (s > second) second = s;
    }
    // a slot is filled iff its best match clears the chance floor 3/√d
    const floor = 3 / Math.sqrt(d);
    res.push({
      role: r,
      word: bi >= 0 && best > floor ? candidates[bi] : null,
      score: best,
      runnerUp: second,
    });
  }
  return res;
}

// ─── 2. Learning ──────────────────────────────────────────────────────────

/** Learning rate φ⁻³ — matches the Hebbian matrix. */
export const LEX_ETA = 0.2360679774997897;
/** Co-occurrence window: ±φ³ ≈ 4.236 tokens → 4. */
export const LEX_WINDOW = 4;
/** PPMI context-distribution smoothing exponent (Levy–Goldberg–Dagan 2015). */
export const LEX_PPMI_ALPHA = 0.75;

/** Utterances kept in the association ring (F17). */
export const LEX_UTTER_CAP = 1597;

export interface Recall {
  readonly word: string;
  readonly score: number;
}

/** φ⁻¹ — crispness threshold shared with `recall`. */
const PHI_INV_LEX = 0.6180339887498949;
/** φ⁻² — a readout pick must explain ≥ this share of the REMAINING energy. */
const READ_STOP = 0.3819660112501051;
/** φ⁻⁵ — minimum first-pick cosine margin (calibratedBeta's own floor). */
const READ_MARGIN = 0.09016994374947424;
/** Relative residual energy treated as fully explained (float64 round-off scale). */
const READ_FLOOR = 1e-20;

export interface FieldReadout {
  /** Words read from the field in pick order, with summed projection weight. */
  /** Words in pick (strength) order; `pos` = rank of the word's strongest pick (W4). */
  readonly words: readonly { word: string; weight: number; share: number; pos: number }[];
  /** W4: the read words ordered by position — the field's reading of word order. */
  readonly sequence: readonly string[];
  /** Fraction of field energy the picked words explain, ∈ [0,1]. */
  readonly explained: number;
  /** Cosine margin of the first pick over the runner-up. */
  readonly margin: number;
  /** margin ≥ φ⁻⁵ and explained ≥ φ⁻¹. */
  readonly crisp: boolean;
  /** ‖field‖₂ over the per-rung slots that were read. */
  readonly energy: number;
}

export interface RecallResult {
  readonly hits: readonly Recall[];
  readonly beta: number;
  /** Softmax mass on the top hit; ≥ φ⁻¹ counts as a crisp pick. */
  readonly topMass: number;
  readonly crisp: boolean;
}

/**
 * Lexical memory: spelling signature ⊕ learned context delta, per word.
 * Context delta is the φ⁻³-rate running mean of the spelling signatures of
 * neighbours within ±4 tokens, weighted by 1/distance and by surprise.
 */
export class LexiconMemory {
  readonly d: number;
  private readonly delta = new Map<string, { re: Float32Array; im: Float32Array; n: number }>();
  private readonly freq = new Map<string, number>();
  private total = 0;
  /** Unit field templates keyed `rungs:word`; derived from the word only. */
  private readonly templates = new Map<string, Float64Array | null>();
  /** Ω-UNDERSTAND W2: symmetric co-occurrence counts within ±LEX_WINDOW. */
  private readonly cooc = new Map<string, Map<string, number>>();
  /** Ω-UNDERSTAND W2: word → next-word counts (and the reverse). */
  private readonly nextW = new Map<string, Map<string, number>>();
  private readonly prevW = new Map<string, Map<string, number>>();
  /** Bounded ring of every learned utterance (not salience-gated). */
  private readonly utter: { id: number; tokens: string[]; tick: number }[] = [];
  /** word → ids of ring utterances containing it, ascending. */
  private readonly postings = new Map<string, number[]>();
  private nextId = 0;
  /** Ω-UNDERSTAND W3: unit PPMI rows derived from `cooc`; null = stale. */
  private ppmi: Map<string, Map<string, number>> | null = null;

  constructor(d = LEX_DIM) {
    this.d = d;
  }

  get size(): number {
    return this.freq.size;
  }
  get tokens(): number {
    return this.total;
  }
  count(word: string): number {
    return this.freq.get(normToken(word)) ?? 0;
  }

  /** Meaning vector: unit(spelling + context delta). */
  signature(word: string): Phasor {
    const t = normToken(word);
    const base = spellingSignature(t, this.d);
    const dl = this.delta.get(t);
    if (!dl) return base;
    const acc = zeros(this.d);
    for (let i = 0; i < this.d; i++) {
      acc.re[i] = base.re[i] + dl.re[i];
      acc.im[i] = base.im[i] + dl.im[i];
    }
    return toUnit(acc);
  }

  /**
   * Learn from one token sequence. `gain` ∈ [0,1] is surprise-weighted rate;
   * `tick` stamps the utterance in the association index (−1 = unknown).
   * Counts (frequency, co-occurrence, succession, postings) are observations
   * and are recorded at any gain; only the meaning delta is gain-weighted.
   */
  learn(tokens: readonly string[], gain = 1, tick = -1): void {
    const toks = tokens.map(normToken).filter((t) => t.length > 0);
    const g = Math.max(0, Math.min(1, gain));
    this.index(toks, tick);
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      this.freq.set(t, (this.freq.get(t) ?? 0) + 1);
      this.total++;
      if (g === 0) continue;
      let dl = this.delta.get(t);
      if (!dl) {
        dl = { re: new Float32Array(this.d), im: new Float32Array(this.d), n: 0 };
        this.delta.set(t, dl);
      }
      for (
        let k = Math.max(0, i - LEX_WINDOW);
        k <= Math.min(toks.length - 1, i + LEX_WINDOW);
        k++
      ) {
        if (k === i) continue;
        const nb = spellingSignature(toks[k], this.d);
        // IDF-style damping: frequent neighbours (Zipf head) teach less.
        const idf = 1 / Math.log(Math.E + (this.freq.get(toks[k]) ?? 0));
        const w = (LEX_ETA * g * idf) / Math.abs(k - i);
        for (let j = 0; j < this.d; j++) {
          // running mean toward neighbour; bounded because |nb_j| = 1 and w < 1
          dl.re[j] += w * (nb.re[j] - dl.re[j]);
          dl.im[j] += w * (nb.im[j] - dl.im[j]);
        }
      }
      dl.n++;
    }
  }

  /** Record co-occurrence, succession and postings for one utterance. */
  private index(toks: readonly string[], tick: number): void {
    if (toks.length === 0) return;
    this.ppmi = null;
    for (let i = 0; i < toks.length; i++) {
      for (let k = i + 1; k <= Math.min(toks.length - 1, i + LEX_WINDOW); k++) {
        if (toks[k] === toks[i]) continue;
        bump(this.cooc, toks[i], toks[k]);
        bump(this.cooc, toks[k], toks[i]);
      }
      if (i + 1 < toks.length) {
        bump(this.nextW, toks[i], toks[i + 1]);
        bump(this.prevW, toks[i + 1], toks[i]);
      }
    }
    const id = this.nextId++;
    this.utter.push({ id, tokens: [...toks], tick });
    for (const t of new Set(toks)) {
      const p = this.postings.get(t);
      if (p) p.push(id);
      else this.postings.set(t, [id]);
    }
    while (this.utter.length > LEX_UTTER_CAP) {
      const old = this.utter.shift()!;
      for (const t of new Set(old.tokens)) {
        const p = this.postings.get(t);
        if (!p) continue;
        // ids are ascending and the ring evicts oldest first, so the evicted
        // id is always the head of every posting list that holds it.
        if (p[0] === old.id) p.shift();
        if (p.length === 0) this.postings.delete(t);
      }
    }
  }

  /**
   * Ω-UNDERSTAND W3 — unit-normalised PPMI rows over `cooc`.
   * PPMI(w,c) = max(0, ln(n(w,c)·D / (S_w·D·P_α(c)))), S_w = Σ_c n(w,c),
   * D = Σ S, P_α(c) = S_c^α/Σ S^α with α = ¾ (context-distribution smoothing,
   * Levy–Goldberg–Dagan 2015). Pure function of `cooc`; rebuilt lazily.
   */
  private ppmiRows(): Map<string, Map<string, number>> {
    if (this.ppmi) return this.ppmi;
    const S = new Map<string, number>();
    let D = 0;
    let Za = 0;
    for (const [w, row] of this.cooc) {
      let s = 0;
      for (const c of row.values()) s += c;
      S.set(w, s);
      D += s;
      Za += dpow(s, LEX_PPMI_ALPHA);
    }
    const rows = new Map<string, Map<string, number>>();
    for (const [w, row] of this.cooc) {
      const sw = S.get(w)!;
      const out = new Map<string, number>();
      let n2 = 0;
      for (const [c, n] of row) {
        const pc = dpow(S.get(c)!, LEX_PPMI_ALPHA) / Za;
        const v = dlog((n * D) / (sw * D * pc));
        if (v > 0) {
          out.set(c, v);
          n2 += v * v;
        }
      }
      if (n2 === 0) continue;
      const inv = 1 / Math.sqrt(n2);
      for (const [c, v] of out) out.set(c, v * inv);
      rows.set(w, out);
    }
    this.ppmi = rows;
    return rows;
  }

  /** Ω-UNDERSTAND W3 — cosine of PPMI context rows ∈ [0,1]; 0 if either is unknown. */
  meaning(a: string, b: string): number {
    const rows = this.ppmiRows();
    const ra = rows.get(normToken(a));
    const rb = rows.get(normToken(b));
    if (!ra || !rb) return 0;
    const [small, big] = ra.size <= rb.size ? [ra, rb] : [rb, ra];
    let dot = 0;
    for (const [c, v] of small) dot += v * (big.get(c) ?? 0);
    return Math.min(1, dot);
  }

  /**
   * Ω-UNDERSTAND W3 — words used like `word`: ranked by `meaning`, over
   * candidates that share at least one positive-PPMI context. `shared` is the
   * evidence count (number of shared contexts).
   */
  similar(word: string, k = 8): { word: string; score: number; shared: number }[] {
    const t = normToken(word);
    const rows = this.ppmiRows();
    const r = rows.get(t);
    if (!r) return [];
    const acc = new Map<string, { score: number; shared: number }>();
    for (const [c, v] of r) {
      // contexts are symmetric: words having c as a context are cooc(c)'s keys
      const holders = this.cooc.get(c);
      if (!holders) continue;
      for (const w of holders.keys()) {
        if (w === t) continue;
        const u = rows.get(w)?.get(c);
        if (!u) continue;
        const e = acc.get(w) ?? { score: 0, shared: 0 };
        e.score += v * u;
        e.shared++;
        acc.set(w, e);
      }
    }
    return [...acc]
      .map(([w, e]) => ({ word: w, score: Math.min(1, e.score), shared: e.shared }))
      .sort((a, b) => b.score - a.score || (a.word < b.word ? -1 : 1))
      .slice(0, k);
  }

  /** Normalised association c(a,b)/√(f(a)·f(b)) ∈ [0, ~2·LEX_WINDOW]. */
  private assoc(a: string, b: string, c: number): number {
    const fa = this.freq.get(a) ?? 0;
    const fb = this.freq.get(b) ?? 0;
    return fa > 0 && fb > 0 ? c / Math.sqrt(fa * fb) : 0;
  }

  /**
   * Ω-UNDERSTAND W2 — everything the lexicon holds that involves `word`.
   *
   * spelling: nearest known words by spelling signature alone;
   * context:  nearest by learned meaning signature (spelling ⊕ context);
   * follows/precedes: succession counts with conditional probability;
   * together: co-occurrence within ±LEX_WINDOW, normalised c/√(f·f);
   * sentences: latest utterances containing the word (from the full ring);
   * spread: bounded spreading activation over the co-occurrence graph —
   *   hop 1 = assoc(seed,b), hop 2 = φ⁻¹·Σ_b act₁(b)·assoc(b,c); seed and
   *   hop-1 words are not re-scored at hop 2. Deterministic (ties by word).
   */
  associate(word: string, k = 8): Association {
    const t = normToken(word);
    const count = this.freq.get(t) ?? 0;
    const byScore = (a: { word: string; score: number }, b: { word: string; score: number }) =>
      b.score - a.score || (a.word < b.word ? -1 : 1);
    const known = [...this.freq.keys()].filter((w) => w !== t);
    const sp = spellingSignature(t, this.d);
    const spelling = known
      .map((w) => ({ word: w, score: similarity(sp, spellingSignature(w, this.d)) }))
      // Unrelated atoms correlate at ~1/√d; keep only words above 3σ of that
      // noise floor, i.e. words that actually share trigrams.
      .filter((x) => x.score > 3 / Math.sqrt(this.d))
      .sort(byScore)
      .slice(0, k);
    const context =
      count > 0
        ? this.recall(this.signature(t), k + 1)
            .hits.filter((h) => h.word !== t)
            .slice(0, k)
        : [];
    const seq = (m: Map<string, number> | undefined) => {
      if (!m) return [];
      let tot = 0;
      for (const c of m.values()) tot += c;
      return [...m]
        .map(([w, c]) => ({ word: w, count: c, p: c / tot }))
        .sort((a, b) => b.count - a.count || (a.word < b.word ? -1 : 1))
        .slice(0, k);
    };
    const nb = this.cooc.get(t);
    const hop1 = new Map<string, number>();
    if (nb) for (const [w, c] of nb) hop1.set(w, this.assoc(t, w, c));
    const together = [...(nb ?? [])]
      .map(([w, c]) => ({ word: w, count: c, assoc: hop1.get(w) ?? 0 }))
      .sort((a, b) => b.assoc - a.assoc || (a.word < b.word ? -1 : 1))
      .slice(0, k);
    const hop2 = new Map<string, number>();
    for (const [b, a1] of hop1) {
      const nb2 = this.cooc.get(b);
      if (!nb2) continue;
      for (const [c, cnt] of nb2) {
        if (c === t || hop1.has(c)) continue;
        hop2.set(c, (hop2.get(c) ?? 0) + PHI_INV_LEX * a1 * this.assoc(b, c, cnt));
      }
    }
    const spread = [
      ...[...hop1].map(([w, a]) => ({ word: w, activation: a, hop: 1 })),
      ...[...hop2].map(([w, a]) => ({ word: w, activation: a, hop: 2 })),
    ]
      .sort((a, b) => b.activation - a.activation || (a.word < b.word ? -1 : 1))
      .slice(0, k);
    const ids = this.postings.get(t) ?? [];
    const sentences: { text: string; tick: number }[] = [];
    const base = this.utter.length > 0 ? this.utter[0].id : 0;
    for (let i = ids.length - 1; i >= 0 && sentences.length < k; i--) {
      const u = this.utter[ids[i] - base];
      if (u && u.id === ids[i]) sentences.push({ text: u.tokens.join(' '), tick: u.tick });
    }
    return {
      word: t,
      count,
      occurrences: ids.length,
      spelling,
      context,
      meaning: this.similar(t, k),
      follows: seq(this.nextW.get(t)),
      precedes: seq(this.prevW.get(t)),
      together,
      spread,
      sentences,
    };
  }

  /**
   * Modern-Hopfield recall over known words with calibrated β = 2 ln N / Δ̂,
   * Δ̂ = measured gap between best and second-best similarity.
   */
  recall(probe: Phasor, k = 5): RecallResult {
    const words = [...this.freq.keys()];
    if (words.length === 0) return { hits: [], beta: 0, topMass: 0, crisp: false };
    const scored = words.map((w) => ({ word: w, score: similarity(probe, this.signature(w)) }));
    scored.sort((a, b) => b.score - a.score || (a.word < b.word ? -1 : 1));
    const gap = scored.length > 1 ? scored[0].score - scored[1].score : 1;
    const beta = calibratedBeta(scored.length, gap);
    let z = 0;
    const top = scored[0].score;
    for (const s of scored) z += Math.exp(beta * (s.score - top));
    const topMass = 1 / z;
    return { hits: scored.slice(0, k), beta, topMass, crisp: topMass >= 0.6180339887498949 };
  }

  /** Unit-norm field template of a word for a given rung count (cached). */
  private template(word: string, rungs: number, pos = 0): Float64Array | null {
    const key = rungs + ':' + pos + ':' + word;
    const hit = this.templates.get(key);
    if (hit !== undefined) return hit;
    const p = lexemePattern(word, rungs, pos);
    let t: Float64Array | null = null;
    if (p) {
      let n = 0;
      for (let i = 0; i < p.length; i++) n += p[i] * p[i];
      n = Math.sqrt(n);
      if (n > 0) {
        for (let i = 0; i < p.length; i++) p[i] /= n;
        t = p;
      }
    }
    this.templates.set(key, t);
    return t;
  }

  /**
   * Ω-UNDERSTAND W1 — read words OUT of the field.
   *
   * Non-negative matching pursuit over the unit field templates of every
   * known word (the same `lexemePattern` injection writes). Each step picks
   * the template with the largest positive projection onto the residual,
   * records it, and subtracts it ("explain away"), so a word whose energy is
   * already accounted for cannot win again by crosstalk — the failure raw
   * cosine ranking showed (moon .40 > drinks .33). Stops at `maxWords`, or
   * when a pick explains < φ⁻² of the energy still unexplained.
   *
   * `margin` is the first pick's cosine lead over the runner-up (a softmax
   * mass would be tautological here: calibratedBeta is built to make it ≥
   * N/(N+1)). `explained` = 1 − ‖r‖²/‖r₀‖². crisp: margin ≥ φ⁻⁵, explained ≥ φ⁻¹.
   * Reads only the per-rung slots; the four global invariant slots are ignored.
   */
  readPsi(field: ArrayLike<number>, maxWords = 8): FieldReadout {
    const empty: FieldReadout = { words: [], sequence: [], explained: 0, margin: 0, crisp: false, energy: 0 };
    const rungs = lexemeRungs(field.length);
    if (rungs <= 0 || this.freq.size === 0) return empty;
    const dim = rungs * 4;
    const res = new Float64Array(dim);
    let e0 = 0;
    for (let i = 0; i < dim; i++) {
      const v = field[i];
      res[i] = Number.isFinite(v) ? v : 0;
      e0 += res[i] * res[i];
    }
    if (!(e0 > 0)) return empty;
    // W4: one template per (word, position); positions beyond maxWords are
    // not searched (their φ⁻ʳ amplitude is below what the stop rule keeps).
    const P = Math.min(Math.max(1, maxWords), LEXEME_MAX_POS + 1);
    const vocab: { word: string; t: Float64Array; pos: number }[] = [];
    for (const w of [...this.freq.keys()].sort()) {
      for (let p = 0; p < P; p++) {
        const t = this.template(w, rungs, p);
        if (t) vocab.push({ word: w, t, pos: p });
      }
    }
    if (vocab.length === 0) return empty;

    const weight = new Map<string, number>();
    const posOf = new Map<string, { pos: number; c: number }>();
    const posOwner = new Map<number, string>();
    const order: string[] = [];
    let margin = 0;
    let e = e0;
    for (let step = 0; step < Math.max(1, maxWords) * 2 && order.length < maxWords; step++) {
      let best = -1;
      let bestC = 0;
      let second = 0;
      for (let j = 0; j < vocab.length; j++) {
        // W4: one token per position per utterance — a position already read
        // is closed to every other word (structural fact of injection).
        const owner = posOwner.get(vocab[j].pos);
        if (owner !== undefined && owner !== vocab[j].word) continue;
        const t = vocab[j].t;
        let c = 0;
        for (let i = 0; i < dim; i++) c += res[i] * t[i];
        if (c > bestC) {
          // runner-up = best of a DIFFERENT word (same word at another
          // position is not a rival identity)
          if (best < 0 || vocab[best].word !== vocab[j].word) second = bestC;
          bestC = c;
          best = j;
        } else if (c > second && vocab[best].word !== vocab[j].word) second = c;
      }
      // Second clause: residual is at float round-off — nothing left to read
      // (without it, more templates means more noise-level picks; measured W4).
      if (best < 0 || bestC * bestC < e * READ_STOP || e <= e0 * READ_FLOOR) break;
      if (step === 0) margin = (bestC - second) / Math.sqrt(e0);
      const t = vocab[best].t;
      e = 0;
      for (let i = 0; i < dim; i++) {
        res[i] -= bestC * t[i];
        e += res[i] * res[i];
      }
      const w = vocab[best].word;
      posOwner.set(vocab[best].pos, w);
      if (!weight.has(w)) {
        order.push(w);
        posOf.set(w, { pos: vocab[best].pos, c: bestC });
      } else if (bestC > posOf.get(w)!.c) posOf.set(w, { pos: vocab[best].pos, c: bestC });
      weight.set(w, (weight.get(w) ?? 0) + bestC);
    }
    // Injection writes positions 0..L−1 with no gaps: a word read beyond the
    // first unread position cannot belong to the utterance — drop it and
    // return its energy to the residual (it was a crosstalk pick).
    let prefix = 0;
    while (posOwner.has(prefix)) prefix++;
    for (let k = order.length - 1; k >= 0; k--) {
      const w = order[k];
      if (posOf.get(w)!.pos < prefix) continue;
      order.splice(k, 1);
      const c = weight.get(w)!;
      weight.delete(w);
      const t = this.template(w, rungs, posOf.get(w)!.pos)!;
      e = 0;
      for (let i = 0; i < dim; i++) {
        res[i] += c * t[i];
        e += res[i] * res[i];
      }
    }
    const explained = Math.max(0, Math.min(1, 1 - e / e0));
    const total = order.reduce((s, w) => s + (weight.get(w) ?? 0), 0);
    const words = order.map((w) => ({
      word: w,
      weight: weight.get(w) ?? 0,
      share: total > 0 ? (weight.get(w) ?? 0) / total : 0,
      pos: posOf.get(w)!.pos,
    }));
    const sequence = [...words].sort((a, b) => a.pos - b.pos || b.weight - a.weight).map((w) => w.word);
    return {
      words,
      sequence,
      explained,
      margin,
      crisp: margin >= READ_MARGIN && explained >= PHI_INV_LEX,
      energy: Math.sqrt(e0),
    };
  }

  /** The word's full field pattern: exact code, address, torus spot, meaning, grounding. */
  inspect(word: string, rungs = 9): WordInspection {
    const t = normToken(word);
    const lx = lexeme(t);
    const sig = this.signature(t);
    let bits = 0;
    for (let i = 0; i < 32 && i < sig.re.length; i++) if (sig.re[i] >= 0) bits |= 1 << i;
    const r = this.recall(sig, 6);
    return {
      token: lx.token,
      value: lx.value,
      exact: lx.exact,
      address: lx.address,
      residue: lx.residue,
      torus: lexemeTorus(lx, rungs),
      fingerprint: (bits >>> 0).toString(16).padStart(8, '0'),
      count: this.count(t),
      neighbours: r.hits.filter((h) => h.word !== t).slice(0, 5),
      crisp: r.crisp,
      catalog: lexiconCatalog().filter((e) => e.word.toLowerCase() === t),
    };
  }

  /**
   * Lossless snapshot. Deltas stay Float32 (their working precision), so the
   * saved state restores bit-identically; structured-clone storage keeps
   * typed arrays without a number[] blow-up. Spelling signatures are NOT
   * stored — they are recomputed from the word itself.
   */
  snapshot(): LexiconSnapshot {
    const words: LexiconSnapshot['words'] = [];
    for (const [w, f] of this.freq) {
      const dl = this.delta.get(w);
      words.push([w, f, dl ? dl.re.slice() : null, dl ? dl.im.slice() : null]);
    }
    const pack = (m: Map<string, Map<string, number>>) =>
      [...m].map(([w, inner]) => [w, [...inner]] as [string, [string, number][]]);
    return {
      d: this.d,
      total: this.total,
      words,
      assoc: {
        cooc: pack(this.cooc),
        next: pack(this.nextW),
        utter: this.utter.map(
          (u) => [u.id, u.tick, u.tokens.join(' ')] as [number, number, string],
        ),
        nextId: this.nextId,
      },
    };
  }

  /** Replace this memory's contents in place (the store holds a readonly ref). */
  load(s: LexiconSnapshot): void {
    this.ppmi = null;
    this.freq.clear();
    this.delta.clear();
    this.total = 0;
    this.cooc.clear();
    this.nextW.clear();
    this.prevW.clear();
    this.utter.length = 0;
    this.postings.clear();
    this.nextId = 0;
    if (!s || s.d !== this.d || !Array.isArray(s.words)) return;
    // Association index (absent in pre-W2 snapshots → starts empty).
    const a = s.assoc;
    if (a) {
      for (const [w, inner] of a.cooc ?? []) this.cooc.set(w, new Map(inner));
      for (const [w, inner] of a.next ?? []) {
        this.nextW.set(w, new Map(inner));
        for (const [n, c] of inner) bump(this.prevW, n, w, c);
      }
      for (const [id, tick, text] of a.utter ?? []) {
        const tokens = text.length > 0 ? text.split(' ') : [];
        this.utter.push({ id, tokens, tick });
        for (const t of new Set(tokens)) {
          const p = this.postings.get(t);
          if (p) p.push(id);
          else this.postings.set(t, [id]);
        }
      }
      this.nextId = Number.isFinite(a.nextId) ? a.nextId : this.utter.length;
    }
    this.total = Number.isFinite(s.total) ? s.total : 0;
    for (const [w, f, re, im] of s.words) {
      this.freq.set(w, f);
      if (re && im && re.length === this.d && im.length === this.d) {
        this.delta.set(w, { re: Float32Array.from(re), im: Float32Array.from(im), n: f });
      }
    }
  }

  static restore(s: LexiconSnapshot): LexiconMemory {
    const m = new LexiconMemory(s.d);
    m.load(s);
    return m;
  }
}

export interface LexiconSnapshot {
  d: number;
  total: number;
  words: [string, number, ArrayLike<number> | null, ArrayLike<number> | null][];
  /** Ω-UNDERSTAND W2 association index; optional so older snapshots load. */
  assoc?: {
    cooc: [string, [string, number][]][];
    next: [string, [string, number][]][];
    utter: [number, number, string][];
    nextId: number;
  };
}

/** Everything the lexicon holds that involves one word (Ω-UNDERSTAND W2). */
export interface Association {
  readonly word: string;
  readonly count: number;
  /** Utterances in the bounded ring that contain the word. */
  readonly occurrences: number;
  readonly spelling: readonly Recall[];
  readonly context: readonly Recall[];
  /** Ω-UNDERSTAND W3: words used in the same contexts (PPMI cosine). */
  readonly meaning: readonly { word: string; score: number; shared: number }[];
  readonly follows: readonly { word: string; count: number; p: number }[];
  readonly precedes: readonly { word: string; count: number; p: number }[];
  readonly together: readonly { word: string; count: number; assoc: number }[];
  readonly spread: readonly { word: string; activation: number; hop: number }[];
  readonly sentences: readonly { text: string; tick: number }[];
}

/** Increment m[a][b] by c. */
function bump(m: Map<string, Map<string, number>>, a: string, b: string, c = 1): void {
  let inner = m.get(a);
  if (!inner) {
    inner = new Map();
    m.set(a, inner);
  }
  inner.set(b, (inner.get(b) ?? 0) + c);
}

// ─── 3b. Sound → word ─────────────────────────────────────────────────────
//
// The speech-to-text service is a TEACHER, not the hearer. For every chunk
// it transcribes, the chunk's own acoustic descriptor a ∈ ℝᵏ is paired with
// the bundle of the heard words' meaning vectors t ∈ ℂᵈ, and a linear map
// W: ℝᵏ → ℂᵈ is learned by normalised LMS (the exact least-squares gradient
// step, stable for 0 < μ < 2):  W ← W + μ (t − W a) aᵀ / ‖a‖².
// The field's guess for a chunk is recall(W a) over the learned vocabulary.
// Accuracy is PREQUENTIAL: the guess is made before the pair is learned, so
// every scored trial is on unseen data — the score cannot be inflated by
// memorisation of the chunk being scored.

/** Log-spaced analysis bands (Hz). 24 bands ≈ critical-band resolution. */
export const SOUND_BANDS = 24;
const SOUND_LO = 80;
const SOUND_HI = 7600;
/** Descriptor = per-band mean + std of log energy, plus bias. */
export const SOUND_DIM = SOUND_BANDS * 2 + 1;
/** NLMS step μ = φ⁻³ (inside the stable interval (0, 2)). */
const SOUND_MU = 0.2360679774997897;
/** Scoring window: F8 trials. */
export const SOUND_WINDOW = 21;

function fftMag2(frame: Float64Array): Float64Array {
  const n = frame.length;
  const re = Float64Array.from(frame);
  const im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const t = re[i];
      re[i] = re[j];
      re[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k),
          wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2],
          ai = im[i + k + len / 2];
        const xr = ar * wr - ai * wi,
          xi = ar * wi + ai * wr;
        re[i + k + len / 2] = re[i + k] - xr;
        im[i + k + len / 2] = im[i + k] - xi;
        re[i + k] += xr;
        im[i + k] += xi;
      }
    }
  }
  const out = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) out[i] = re[i] * re[i] + im[i] * im[i];
  return out;
}

/**
 * Acoustic descriptor of a mono PCM chunk: Hann-windowed 1024-pt frames,
 * 50 % hop, energy in 24 log-spaced bands → log → per-band mean and std
 * over voiced frames (frames below −60 dB of the chunk peak are silence and
 * excluded). Mean-removed and unit-normalised so loudness does not decide
 * the word. Returns null when the chunk holds no signal.
 */
export function soundDescriptor(pcm: ArrayLike<number>, sampleRate: number): Float64Array | null {
  const N = 1024,
    hop = 512;
  if (!(sampleRate > 0) || pcm.length < N) return null;
  const hann = new Float64Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const edges: number[] = [];
  for (let b = 0; b <= SOUND_BANDS; b++)
    edges.push(SOUND_LO * Math.pow(SOUND_HI / SOUND_LO, b / SOUND_BANDS));
  const binHz = sampleRate / N;
  const frames: Float64Array[] = [];
  const energy: number[] = [];
  const buf = new Float64Array(N);
  for (let s = 0; s + N <= pcm.length; s += hop) {
    for (let i = 0; i < N; i++) buf[i] = pcm[s + i] * hann[i];
    const p = fftMag2(buf);
    const bands = new Float64Array(SOUND_BANDS);
    let e = 0;
    for (let b = 0; b < SOUND_BANDS; b++) {
      const lo = Math.max(1, Math.floor(edges[b] / binHz));
      const hi = Math.min(p.length - 1, Math.max(lo, Math.ceil(edges[b + 1] / binHz)));
      let acc = 0;
      for (let k = lo; k <= hi; k++) acc += p[k];
      bands[b] = acc;
      e += acc;
    }
    frames.push(bands);
    energy.push(e);
  }
  const peak = Math.max(...energy);
  if (!(peak > 0)) return null;
  const voiced = frames.filter((_, i) => energy[i] >= peak * 1e-6);
  if (voiced.length === 0) return null;
  const out = new Float64Array(SOUND_DIM);
  for (let b = 0; b < SOUND_BANDS; b++) {
    let m = 0;
    for (const f of voiced) m += Math.log(f[b] + 1e-12);
    m /= voiced.length;
    let v = 0;
    for (const f of voiced) {
      const x = Math.log(f[b] + 1e-12) - m;
      v += x * x;
    }
    out[b] = m;
    out[SOUND_BANDS + b] = Math.sqrt(v / voiced.length);
  }
  // Remove overall level from the means, then unit-normalise.
  let mu = 0;
  for (let b = 0; b < SOUND_BANDS; b++) mu += out[b];
  mu /= SOUND_BANDS;
  for (let b = 0; b < SOUND_BANDS; b++) out[b] -= mu;
  let n2 = 0;
  for (let i = 0; i < SOUND_DIM - 1; i++) n2 += out[i] * out[i];
  const inv = n2 > 0 ? 1 / Math.sqrt(n2) : 0;
  for (let i = 0; i < SOUND_DIM - 1; i++) out[i] *= inv;
  out[SOUND_DIM - 1] = 1; // bias
  return out;
}

export interface SoundTrial {
  readonly guess: string | null;
  readonly guessTop: readonly string[];
  readonly heard: readonly string[];
  readonly hit1: boolean;
  readonly hit5: boolean;
  readonly crisp: boolean;
}

export interface SoundWordSnapshot {
  d: number;
  k: number;
  re: ArrayLike<number>;
  im: ArrayLike<number>;
  trials: number;
  scored: number;
  hits1: number;
  hits5: number;
  recent: number[];
}

export class SoundWordMap {
  readonly d: number;
  readonly k = SOUND_DIM;
  private re: Float32Array;
  private im: Float32Array;
  trials = 0;
  hits1 = 0;
  hits5 = 0;
  /** Trials that produced a guess before learning (the scored ones). */
  scoredN = 0;
  /** 1 = top-1 hit, 0 = miss; last SOUND_WINDOW scored trials. */
  private recent: number[] = [];
  lastTrial: SoundTrial | null = null;

  constructor(d = LEX_DIM) {
    this.d = d;
    this.re = new Float32Array(d * this.k);
    this.im = new Float32Array(d * this.k);
  }

  predict(a: ArrayLike<number>): Phasor {
    const out = zeros(this.d);
    for (let i = 0; i < this.d; i++) {
      let r = 0,
        m = 0;
      const o = i * this.k;
      for (let j = 0; j < this.k; j++) {
        r += this.re[o + j] * a[j];
        m += this.im[o + j] * a[j];
      }
      out.re[i] = r;
      out.im[i] = m;
    }
    return out;
  }

  /** Guess from sound alone (no teacher). Null until any word is known. */
  guess(a: ArrayLike<number>, lex: LexiconMemory, k = 5): RecallResult | null {
    if (this.trials === 0 || lex.size === 0) return null;
    return lex.recall(this.predict(a), k);
  }

  /**
   * One teacher pair: score the guess first (prequential), then learn.
   * Trials with no heard words are neither scored nor learned.
   */
  observe(a: ArrayLike<number>, heardText: string, lex: LexiconMemory): SoundTrial | null {
    const heard = [
      ...new Set(
        heardText
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(Boolean),
      ),
    ];
    if (heard.length === 0 || a.length !== this.k) return null;
    const g = this.guess(a, lex);
    let trial: SoundTrial | null = null;
    if (g && g.hits.length > 0) {
      const top = g.hits.map((h) => h.word);
      const hit1 = heard.includes(top[0]);
      const hit5 = top.some((w) => heard.includes(w));
      this.scoredN++;
      this.hits1 += hit1 ? 1 : 0;
      this.hits5 += hit5 ? 1 : 0;
      this.recent.push(hit1 ? 1 : 0);
      if (this.recent.length > SOUND_WINDOW) this.recent.shift();
      trial = { guess: top[0], guessTop: top, heard, hit1, hit5, crisp: g.crisp };
    }
    // Target: mean of the heard words' meaning vectors.
    const t = zeros(this.d);
    for (const w of heard) {
      const s = lex.signature(w);
      for (let i = 0; i < this.d; i++) {
        t.re[i] += s.re[i] / heard.length;
        t.im[i] += s.im[i] / heard.length;
      }
    }
    const y = this.predict(a);
    let a2 = 0;
    for (let j = 0; j < this.k; j++) a2 += a[j] * a[j];
    if (a2 > 0) {
      const step = SOUND_MU / a2;
      for (let i = 0; i < this.d; i++) {
        const er = (t.re[i] - y.re[i]) * step,
          ei = (t.im[i] - y.im[i]) * step;
        const o = i * this.k;
        for (let j = 0; j < this.k; j++) {
          this.re[o + j] += er * a[j];
          this.im[o + j] += ei * a[j];
        }
      }
    }
    this.trials++;
    this.lastTrial = trial ?? {
      guess: null,
      guessTop: [],
      heard,
      hit1: false,
      hit5: false,
      crisp: false,
    };
    return this.lastTrial;
  }

  stats() {
    const n = this.recent.length;
    const recentAcc = n > 0 ? this.recent.reduce((s, x) => s + x, 0) / n : 0;
    const scored = this.scoredN;
    return {
      trials: this.trials,
      scored,
      top1: scored > 0 ? this.hits1 / scored : 0,
      top5: scored > 0 ? this.hits5 / scored : 0,
      recent: recentAcc,
      recentN: n,
      /** Teacher may be withdrawn only on a full window at ≥ φ⁻¹ top-1. */
      selfSufficient: n === SOUND_WINDOW && recentAcc >= 0.6180339887498949,
      last: this.lastTrial,
    };
  }

  snapshot(): SoundWordSnapshot {
    return {
      d: this.d,
      k: this.k,
      re: this.re.slice(),
      im: this.im.slice(),
      trials: this.trials,
      scored: this.scoredN,
      hits1: this.hits1,
      hits5: this.hits5,
      recent: [...this.recent],
    };
  }

  load(s: SoundWordSnapshot): void {
    if (
      !s ||
      s.d !== this.d ||
      s.k !== this.k ||
      s.re.length !== this.re.length ||
      s.im.length !== this.im.length
    )
      return;
    this.re = Float32Array.from(s.re);
    this.im = Float32Array.from(s.im);
    this.trials = s.trials | 0;
    this.scoredN = s.scored | 0;
    this.hits1 = s.hits1 | 0;
    this.hits5 = s.hits5 | 0;
    this.recent = Array.isArray(s.recent) ? s.recent.slice(-SOUND_WINDOW) : [];
  }
}

// ─── 4. Grounding ─────────────────────────────────────────────────────────

/** Field trajectory the predicates read: a scalar channel + the state path. */
export interface Trajectory {
  /** Scalar observable per tick (e.g. witness coherence or a rung metric). */
  readonly x: readonly number[];
  /** Optional state vectors per tick for distance/eigen predicates. */
  readonly states?: readonly ArrayLike<number>[];
}

export type PredicateKind =
  | 'rising'
  | 'falling'
  | 'accelerating'
  | 'decelerating'
  | 'steady'
  | 'changed'
  | 'returned'
  | 'periodic'
  | 'converging'
  | 'approaching'
  | 'eigen';

export interface CatalogEntry {
  readonly word: string;
  readonly section: string;
  readonly type: string;
  readonly condition: string;
  readonly predicate: PredicateKind | null;
}

/** Condition-text → predicate. Unmatched conditions stay ungrounded. */
const RULES: ReadonlyArray<[RegExp, PredicateKind]> = [
  [/Av\s*=\s*λv/, 'eigen'],
  [/x\(t\+T\)\s*=\s*x\(t\)/, 'periodic'],
  [/ẋ\s*·\s*\(x\*\s*−\s*x\)\s*>\s*0/, 'approaching'],
  [/‖x\s*−\s*x\*‖\s*<\s*ε|→\s*x\*/, 'converging'],
  [/∃t₂>t₁:\s*x\(t₂\)\s*=\s*x\(t₁\)/, 'returned'],
  [/∃t₂>t₁:\s*x\(t₂\)\s*≠\s*x\(t₁\)/, 'changed'],
  [/[zx]̈\s*=\s*−g|[zx]̈\s*<\s*0|ẍ\s*<\s*0/, 'decelerating'],
  [/[zx]̈\s*>\s*0|ẍ\s*>\s*0|[zx]̈\(t₀\)\s*>\s*g/, 'accelerating'],
  [/[zxV]̇\s*>\s*0|ż\s*>\s*0|ẋ\s*>\s*0|V̇\s*>\s*0/, 'rising'],
  [/[zxV]̇\s*<\s*0|ż\s*<\s*0|ẋ\s*<\s*0|V̇\s*<\s*0/, 'falling'],
  [/[EẊv]̇?\s*≈\s*0|ẋ\s*=\s*0|v\s*=\s*0|Ė\s*≈\s*0/, 'steady'],
];

export function compileCondition(cond: string): PredicateKind | null {
  for (const [re, k] of RULES) if (re.test(cond)) return k;
  return null;
}

interface RawRow {
  w: string;
  s: string;
  t: string;
  c: string;
}

let catalogCache: CatalogEntry[] | null = null;

export function lexiconCatalog(): readonly CatalogEntry[] {
  if (catalogCache) return catalogCache;
  catalogCache = (catalogRaw as RawRow[]).map((r) => ({
    word: r.w,
    section: r.s,
    type: r.t,
    condition: r.c,
    predicate: compileCondition(r.c),
  }));
  return catalogCache;
}

export function groundedEntries(): readonly CatalogEntry[] {
  return lexiconCatalog().filter(
    (e) => e.predicate !== null && /^[A-Za-z][A-Za-z -]*$/.test(e.word),
  );
}

/** Tolerance on a finite difference: φ⁻⁵ of the channel's own spread. */
function tol(x: readonly number[]): number {
  let lo = Infinity,
    hi = -Infinity;
  for (const v of x) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo;
  return Number.isFinite(span) && span > 0 ? span * 0.09016994374947424 : 1e-9;
}

function dist(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

/** Evaluate a predicate on the most recent window of the trajectory. */
export function evaluatePredicate(kind: PredicateKind, tr: Trajectory): boolean {
  const x = tr.x.filter((v) => Number.isFinite(v));
  const n = x.length;
  if (n < 3) return false;
  const e = tol(x);
  const v1 = x[n - 1] - x[n - 2];
  const v0 = x[n - 2] - x[n - 3];
  const a = v1 - v0;
  switch (kind) {
    case 'rising':
      return v1 > e && v0 > 0;
    case 'falling':
      return v1 < -e && v0 < 0;
    case 'accelerating':
      return a > e;
    case 'decelerating':
      return a < -e;
    case 'steady':
      return Math.abs(v1) <= e && Math.abs(v0) <= e;
    case 'changed':
      return Math.abs(x[n - 1] - x[0]) > e;
    case 'returned': {
      for (let i = 0; i < n - 2; i++)
        if (Math.abs(x[n - 1] - x[i]) <= e && Math.abs(x[n - 2] - x[i]) > e) return true;
      return false;
    }
    case 'periodic': {
      // normalised autocorrelation peak at some lag 2..n/2
      const m = x.reduce((s, v) => s + v, 0) / n;
      let v = 0;
      for (const q of x) v += (q - m) * (q - m);
      if (v <= 0) return false;
      for (let lag = 2; lag <= Math.floor(n / 2); lag++) {
        let c = 0;
        for (let i = lag; i < n; i++) c += (x[i] - m) * (x[i - lag] - m);
        if (c / v >= 0.6180339887498949) return true;
      }
      return false;
    }
    case 'converging': {
      const s = tr.states;
      if (!s || s.length < 3) return Math.abs(v1) < Math.abs(v0) && Math.abs(v0) > 0;
      const k = s.length;
      return dist(s[k - 1], s[k - 2]) < dist(s[k - 2], s[k - 3]);
    }
    case 'approaching': {
      const s = tr.states;
      if (!s || s.length < 3) return false;
      const target = s[0];
      const k = s.length;
      return dist(s[k - 1], target) < dist(s[k - 2], target) - 1e-12;
    }
    case 'eigen': {
      const s = tr.states;
      if (!s || s.length < 2) return false;
      const p = s[s.length - 2],
        q = s[s.length - 1];
      let dot = 0,
        np = 0,
        nq = 0;
      for (let i = 0; i < Math.min(p.length, q.length); i++) {
        dot += p[i] * q[i];
        np += p[i] * p[i];
        nq += q[i] * q[i];
      }
      if (np === 0 || nq === 0) return false;
      const cos = Math.abs(dot) / Math.sqrt(np * nq);
      return cos > 0.999 && Math.abs(Math.sqrt(nq / np) - 1) > 1e-6;
    }
  }
}

export interface Detection {
  readonly word: string;
  readonly predicate: PredicateKind;
  readonly section: string;
}

/** All grounded words whose condition the field currently satisfies. */
export function detectWords(tr: Trajectory): Detection[] {
  const fired = new Map<PredicateKind, boolean>();
  const out: Detection[] = [];
  for (const e of groundedEntries()) {
    const k = e.predicate!;
    let ok = fired.get(k);
    if (ok === undefined) {
      ok = evaluatePredicate(k, tr);
      fired.set(k, ok);
    }
    if (ok) out.push({ word: e.word, predicate: k, section: e.section });
  }
  return out;
}

export interface GroundingStats {
  readonly entries: number;
  readonly grounded: number;
  readonly ungrounded: number;
  readonly byPredicate: Readonly<Record<string, number>>;
}

export function groundingStats(): GroundingStats {
  const all = lexiconCatalog();
  const g = groundedEntries();
  const by: Record<string, number> = {};
  for (const e of g) by[e.predicate!] = (by[e.predicate!] ?? 0) + 1;
  return {
    entries: all.length,
    grounded: g.length,
    ungrounded: all.length - g.length,
    byPredicate: by,
  };
}

// ─── 6. Field → words ─────────────────────────────────────────────────────

/** One canonical word per fired predicate — the verb the field is "doing". */
const CANON: Readonly<Record<PredicateKind, string>> = {
  rising: 'rise',
  falling: 'fall',
  accelerating: 'accelerate',
  decelerating: 'slow',
  steady: 'hold',
  changed: 'change',
  returned: 'return',
  periodic: 'cycle',
  converging: 'settle',
  approaching: 'approach',
  eigen: 'scale',
};

/**
 * Transcribe the field's current state into a short sentence frame.
 * Action = strongest fired predicate (fixed priority: dynamics before
 * statics); object = top recalled concept word. Returns null when nothing
 * fired — the brain stays silent rather than inventing a description.
 */
export function describeField(
  tr: Trajectory,
  recalled: readonly string[] = [],
): { frame: SentenceFrame; text: string; fired: PredicateKind[] } | null {
  const order: PredicateKind[] = [
    'accelerating',
    'decelerating',
    'rising',
    'falling',
    'approaching',
    'converging',
    'periodic',
    'returned',
    'eigen',
    'changed',
    'steady',
  ];
  const fired = order.filter((k) => evaluatePredicate(k, tr));
  if (fired.length === 0) return null;
  const frame: SentenceFrame = { agent: 'field', action: CANON[fired[0]] };
  if (recalled[0]) frame.object = recalled[0];
  if (fired.length > 1) frame.manner = CANON[fired[1]];
  const text = [
    frame.agent,
    frame.action + 's',
    frame.object,
    frame.manner ? `while ${frame.manner}ing`.replace(/eing$/, 'ing') : null,
  ]
    .filter(Boolean)
    .join(' ');
  return { frame, text, fired };
}
