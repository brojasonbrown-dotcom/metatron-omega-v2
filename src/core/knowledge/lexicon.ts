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
import { calibratedBeta } from '@/core/gematria/resonanceKernel';

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
    h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
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
    if (m > 1e-12) { out.re[i] = v.re[i] / m; out.im[i] = v.im[i] / m; }
    else { out.re[i] = 1; out.im[i] = 0; }
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
    for (let i = 0; i < d; i++) { acc.re[i] += a.re[i]; acc.im[i] += a.im[i]; }
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
    for (let i = 0; i < d; i++) { acc.re[i] += s.re[i]; acc.im[i] += s.im[i]; }
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
  v: Phasor, candidates: readonly string[], lex?: LexiconMemory, d = LEX_DIM,
): RoleDecode[] {
  const sigs = candidates.map((w) => (lex ? lex.signature(w) : spellingSignature(w, d)));
  const res: RoleDecode[] = [];
  for (const r of ROLES) {
    const probe = unbind(v, atom(`role:${r}`, d));
    let best = -Infinity, second = -Infinity, bi = -1;
    for (let k = 0; k < sigs.length; k++) {
      const s = similarity(probe, sigs[k]);
      if (s > best) { second = best; best = s; bi = k; } else if (s > second) second = s;
    }
    // a slot is filled iff its best match clears the chance floor 3/√d
    const floor = 3 / Math.sqrt(d);
    res.push({ role: r, word: bi >= 0 && best > floor ? candidates[bi] : null, score: best, runnerUp: second });
  }
  return res;
}

// ─── 2. Learning ──────────────────────────────────────────────────────────

/** Learning rate φ⁻³ — matches the Hebbian matrix. */
export const LEX_ETA = 0.2360679774997897;
/** Co-occurrence window: ±φ³ ≈ 4.236 tokens → 4. */
export const LEX_WINDOW = 4;

export interface Recall {
  readonly word: string;
  readonly score: number;
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

  constructor(d = LEX_DIM) { this.d = d; }

  get size(): number { return this.freq.size; }
  get tokens(): number { return this.total; }
  count(word: string): number { return this.freq.get(normToken(word)) ?? 0; }

  /** Meaning vector: unit(spelling + context delta). */
  signature(word: string): Phasor {
    const t = normToken(word);
    const base = spellingSignature(t, this.d);
    const dl = this.delta.get(t);
    if (!dl) return base;
    const acc = zeros(this.d);
    for (let i = 0; i < this.d; i++) { acc.re[i] = base.re[i] + dl.re[i]; acc.im[i] = base.im[i] + dl.im[i]; }
    return toUnit(acc);
  }

  /** Learn from one token sequence. `gain` ∈ [0,1] is surprise-weighted rate. */
  learn(tokens: readonly string[], gain = 1): void {
    const toks = tokens.map(normToken).filter((t) => t.length > 0);
    const g = Math.max(0, Math.min(1, gain));
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      this.freq.set(t, (this.freq.get(t) ?? 0) + 1);
      this.total++;
      if (g === 0) continue;
      let dl = this.delta.get(t);
      if (!dl) { dl = { re: new Float32Array(this.d), im: new Float32Array(this.d), n: 0 }; this.delta.set(t, dl); }
      for (let k = Math.max(0, i - LEX_WINDOW); k <= Math.min(toks.length - 1, i + LEX_WINDOW); k++) {
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

  snapshot(): { d: number; total: number; words: [string, number, number[], number[]][] } {
    const words: [string, number, number[], number[]][] = [];
    for (const [w, f] of this.freq) {
      const dl = this.delta.get(w);
      words.push([w, f, dl ? Array.from(dl.re) : [], dl ? Array.from(dl.im) : []]);
    }
    return { d: this.d, total: this.total, words };
  }

  static restore(s: ReturnType<LexiconMemory['snapshot']>): LexiconMemory {
    const m = new LexiconMemory(s.d);
    m.total = s.total;
    for (const [w, f, re, im] of s.words) {
      m.freq.set(w, f);
      if (re.length === s.d) m.delta.set(w, { re: Float32Array.from(re), im: Float32Array.from(im), n: f });
    }
    return m;
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
  | 'rising' | 'falling' | 'accelerating' | 'decelerating' | 'steady'
  | 'changed' | 'returned' | 'periodic' | 'converging' | 'approaching' | 'eigen';

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

interface RawRow { w: string; s: string; t: string; c: string }

let catalogCache: CatalogEntry[] | null = null;

export function lexiconCatalog(): readonly CatalogEntry[] {
  if (catalogCache) return catalogCache;
  catalogCache = (catalogRaw as RawRow[]).map((r) => ({
    word: r.w, section: r.s, type: r.t, condition: r.c, predicate: compileCondition(r.c),
  }));
  return catalogCache;
}

export function groundedEntries(): readonly CatalogEntry[] {
  return lexiconCatalog().filter((e) => e.predicate !== null && /^[A-Za-z][A-Za-z -]*$/.test(e.word));
}

/** Tolerance on a finite difference: φ⁻⁵ of the channel's own spread. */
function tol(x: readonly number[]): number {
  let lo = Infinity, hi = -Infinity;
  for (const v of x) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo;
  return Number.isFinite(span) && span > 0 ? span * 0.09016994374947424 : 1e-9;
}

function dist(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { const d = a[i] - b[i]; s += d * d; }
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
    case 'rising': return v1 > e && v0 > 0;
    case 'falling': return v1 < -e && v0 < 0;
    case 'accelerating': return a > e;
    case 'decelerating': return a < -e;
    case 'steady': return Math.abs(v1) <= e && Math.abs(v0) <= e;
    case 'changed': return Math.abs(x[n - 1] - x[0]) > e;
    case 'returned': {
      for (let i = 0; i < n - 2; i++) if (Math.abs(x[n - 1] - x[i]) <= e && Math.abs(x[n - 2] - x[i]) > e) return true;
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
      const p = s[s.length - 2], q = s[s.length - 1];
      let dot = 0, np = 0, nq = 0;
      for (let i = 0; i < Math.min(p.length, q.length); i++) { dot += p[i] * q[i]; np += p[i] * p[i]; nq += q[i] * q[i]; }
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
    if (ok === undefined) { ok = evaluatePredicate(k, tr); fired.set(k, ok); }
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
  return { entries: all.length, grounded: g.length, ungrounded: all.length - g.length, byPredicate: by };
}

// ─── 6. Field → words ─────────────────────────────────────────────────────

/** One canonical word per fired predicate — the verb the field is "doing". */
const CANON: Readonly<Record<PredicateKind, string>> = {
  rising: 'rise', falling: 'fall', accelerating: 'accelerate', decelerating: 'slow',
  steady: 'hold', changed: 'change', returned: 'return', periodic: 'cycle',
  converging: 'settle', approaching: 'approach', eigen: 'scale',
};

/**
 * Transcribe the field's current state into a short sentence frame.
 * Action = strongest fired predicate (fixed priority: dynamics before
 * statics); object = top recalled concept word. Returns null when nothing
 * fired — the brain stays silent rather than inventing a description.
 */
export function describeField(tr: Trajectory, recalled: readonly string[] = []): { frame: SentenceFrame; text: string; fired: PredicateKind[] } | null {
  const order: PredicateKind[] = ['accelerating', 'decelerating', 'rising', 'falling', 'approaching', 'converging', 'periodic', 'returned', 'eigen', 'changed', 'steady'];
  const fired = order.filter((k) => evaluatePredicate(k, tr));
  if (fired.length === 0) return null;
  const frame: SentenceFrame = { agent: 'field', action: CANON[fired[0]] };
  if (recalled[0]) frame.object = recalled[0];
  if (fired.length > 1) frame.manner = CANON[fired[1]];
  const text = [frame.agent, frame.action + 's', frame.object, frame.manner ? `while ${frame.manner}ing`.replace(/eing$/, 'ing') : null]
    .filter(Boolean).join(' ');
  return { frame, text, fired };
}
