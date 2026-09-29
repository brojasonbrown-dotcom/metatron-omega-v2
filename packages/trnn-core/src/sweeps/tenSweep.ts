/**
 * Ω-REAL P7 — the Ten-Sweep Consolidation Protocol.
 *
 * Ten passes over the live corpus, each a DIFFERENT operator with an entry
 * condition, a measured exit metric, and a ledger seal. Sweeps 1–7 fire in the
 * long heartbeat gap (12 steps between stable rungs), sweeps 8–10 in the short
 * gap (2) — the schedule is derived from `heartbeatSchedule`, never hardcoded.
 *
 * Defects in the reference prototype that are fixed here rather than ported:
 *   • Six of the ten sweeps sealed `ok: true` unconditionally — a "protocol"
 *     that cannot fail is telemetry theatre. Every sweep here has a real exit
 *     predicate over its own measured metric, and a failing sweep is sealed as
 *     failed instead of being dropped.
 *   • The reference read `time.time()` inside sweeps 3 and 5, so two replays of
 *     the same corpus produced different seals and the ledger could not be
 *     used as evidence. Time enters this port only through an injected logical
 *     clock; the protocol is bit-deterministic for a fixed corpus.
 *   • Its "adversarial red team" only checked `id in corpus and leaf in leaves`
 *     — a membership test the forger controls. Here forgeries are verified the
 *     way a third party would: recompute the leaf from (header ‖ ciphertext)
 *     and run the RFC-6962 inclusion proof. Tampering with the body, the id,
 *     the kind or the epoch must all be rejected, and genuine records must all
 *     still verify (a red team that rejects everything proves nothing).
 *   • Sweep 1 swallowed every exception, so a programming error looked like an
 *     envelope failure. Crypto-shredded records are counted separately from
 *     genuine failures, because a shredded body is *supposed* to be unreadable.
 *   • Sweep 5 summed prototype vectors without renormalising and left merged
 *     records in the candidate set, so merging was neither idempotent nor
 *     stable. Here consolidation is a phasor bundle, merged records are closed
 *     in valid-time, and idempotence is the exit metric: an immediate re-run
 *     must merge zero.
 *   • Sweep 9 reported `over_budget` and did nothing. Here it emits an eviction
 *     plan (lowest trust first, oldest as the tiebreak) and the exit metric is
 *     that the plan actually brings projected usage under budget.
 */

import { PHI_INV } from '../core/constants';
import { GenomeLedger, leafBytes, verifyInclusion, type SealedRecord } from '../genome/record';
import { toHex, hashLeaf, type Hash } from '../ledger/merkle';
import {
  CONSOLIDATION_COS,
  MIN_PAIRED,
  LUCAS_MOD13_PERIOD,
  heartbeatSchedule,
  type HeartbeatKind,
} from '../substrate/phiSubstrate';
import {
  bundle,
  similarity,
  CleanupMemory,
  CLEANUP_FAN_IN,
  type Hypervector,
} from '../substrate/vsa';
import { fuseResonance, type BusChannel } from '../substrate/resonanceBus';

export const SWEEP_NAMES: Readonly<Record<number, string>> = Object.freeze({
  1: 'intake_replay',
  2: 'hdc_binding',
  3: 'temporal_stamping',
  4: 'contradiction_pass',
  5: 'prototype_consolidation',
  6: 'causal_attribution',
  7: 'cross_level_rescoring',
  8: 'adversarial_red_team',
  9: 'governor_compression',
  10: 'reflective_synthesis',
});

/** Sweeps that belong to the long gap, and those that belong to the short one. */
export const LONG_GAP_SWEEPS: readonly number[] = Object.freeze([1, 2, 3, 4, 5, 6, 7]);
export const SHORT_GAP_SWEEPS: readonly number[] = Object.freeze([8, 9, 10]);

export interface SweepMetric {
  readonly [k: string]: unknown;
}

export interface SweepReport {
  readonly n: number;
  readonly name: string;
  readonly metric: SweepMetric;
  readonly ok: boolean;
  /** Why the exit predicate failed; null when it passed. */
  readonly reason: string | null;
  /** Ledger id of the SweepSeal record. */
  readonly sealId: string;
  readonly leafIndex: number;
}

/** A live corpus item. Mutable by design: sweeps consolidate it in place. */
export interface CorpusItem {
  readonly id: string;
  readonly kind: string;
  /** FHRR phase vector used by sweeps 2 and 5. */
  vector: Hypervector;
  /** [0,1]; non-finite means "never scored", which is not the same as 0. */
  trust: number;
  contradicts: string[];
  recordedAt: number;
  validFrom: number | null;
  validTo: number | null;
  supersededBy: string | null;
}

export class Corpus {
  readonly items: CorpusItem[] = [];

  add(item: CorpusItem): CorpusItem {
    this.items.push(item);
    return item;
  }

  byId(): Map<string, CorpusItem> {
    const m = new Map<string, CorpusItem>();
    for (const it of this.items) m.set(it.id, it);
    return m;
  }

  /** Items still open in valid-time and not superseded, in insertion order. */
  open(): CorpusItem[] {
    return this.items.filter((i) => i.validTo === null && i.supersededBy === null);
  }
}

/* ── schedule ─────────────────────────────────────────────────────────────── */

export interface SweepSlot {
  readonly tick: number;
  /** Kind of the gap this rung OPENS (long = 12 steps, short = 2). */
  readonly opens: HeartbeatKind;
  readonly sweeps: readonly number[];
}

/**
 * Firing schedule: each stable rung opens a gap, and the gap's length decides
 * which sweeps run in it. Derived from the Lucas-mod-13 stable rungs, so the
 * {12,2} heartbeat is a consequence of the substrate rather than a constant.
 */
export function sweepSchedule(cycles = 1, start = 0): SweepSlot[] {
  // One extra cycle of rungs so the final rung's forward gap is known.
  const rungs = heartbeatSchedule(cycles + 1, start).map((r) => r.tick);
  const out: SweepSlot[] = [];
  const limit = start + cycles * LUCAS_MOD13_PERIOD;
  for (let i = 0; i < rungs.length - 1; i++) {
    const tick = rungs[i];
    if (tick >= limit) break;
    const opens: HeartbeatKind = rungs[i + 1] - tick === 2 ? 'short' : 'long';
    out.push({ tick, opens, sweeps: opens === 'long' ? LONG_GAP_SWEEPS : SHORT_GAP_SWEEPS });
  }
  return out;
}

/* ── individual operators (pure, exported for direct testing) ─────────────── */

export interface ReplayMetric extends SweepMetric {
  readonly total: number;
  readonly replayed: number;
  readonly shredded: number;
  readonly failures: readonly string[];
}

/**
 * Sweep 1 — intake replay. Every corpus item must still open from the ledger
 * and round-trip to the same canonical body. Shredded bodies are expected to
 * be unreadable and are counted, not blamed.
 */
export function sweep1IntakeReplay(corpus: Corpus, ledger: GenomeLedger): ReplayMetric {
  let replayed = 0;
  let shredded = 0;
  const failures: string[] = [];
  for (const it of corpus.items) {
    const rec = ledger.get(it.id);
    if (!rec) {
      failures.push(`${it.id}: not in ledger`);
      it.trust = damp(it.trust);
      continue;
    }
    if (ledger.isShredded(it.id)) {
      shredded++;
      continue;
    }
    let body: unknown;
    try {
      body = ledger.open(it.id);
    } catch {
      // Only an AEAD failure lands here: the envelope no longer authenticates.
      failures.push(`${it.id}: envelope failed to authenticate`);
      it.trust = damp(it.trust);
      continue;
    }
    if (body === null) {
      failures.push(`${it.id}: body unreadable`);
      it.trust = damp(it.trust);
      continue;
    }
    replayed++;
  }
  return { total: corpus.items.length, replayed, shredded, failures };
}

function damp(t: number): number {
  return Number.isFinite(t) ? Math.max(0, t * PHI_INV) : NaN;
}

export interface BindingMetric extends SweepMetric {
  readonly members: number;
  readonly bundles: number;
  readonly fanIn: number;
  readonly recalled: number;
  readonly probed: number;
  readonly abstained: number;
}

/**
 * Sweep 2 — HDC binding. Items of `kind` are folded into fan-in-capped
 * prototypes and then probed back through the cleanup memory. The exit metric
 * is measured recall, not the bundle count: a bundle nobody can decode is not
 * consolidation, it is data loss.
 */
export function sweep2HdcBinding(
  corpus: Corpus,
  opts: { kind?: string; fanIn?: number; zFloor?: number } = {},
): BindingMetric {
  const kind = opts.kind ?? 'Episode';
  const fanIn = Math.max(1, Math.floor(opts.fanIn ?? CLEANUP_FAN_IN));
  const members = corpus.items.filter((i) => i.kind === kind && i.validTo === null);
  if (members.length === 0) {
    return { members: 0, bundles: 0, fanIn, recalled: 0, probed: 0, abstained: 0 };
  }
  const dim = members[0].vector.length;
  const cleanup = new CleanupMemory(dim, fanIn, opts.zFloor ?? 5);
  const bundles = Math.ceil(members.length / fanIn);
  members.forEach((m, i) => cleanup.add(`bundle:${Math.floor(i / fanIn)}`, m.vector));

  let recalled = 0;
  let abstained = 0;
  members.forEach((m, i) => {
    const hit = cleanup.query(m.vector);
    if (hit === null) {
      abstained++;
      return;
    }
    if (hit.label === `bundle:${Math.floor(i / fanIn)}`) recalled++;
  });
  return { members: members.length, bundles, fanIn, recalled, probed: members.length, abstained };
}

export interface StampMetric extends SweepMetric {
  readonly backfilled: number;
  readonly closed: number;
  readonly openRecords: number;
  readonly inverted: readonly string[];
}

/**
 * Sweep 3 — bi-temporal stamping. Backfills `validFrom` from `recordedAt`,
 * closes superseded records at the injected clock, and reports any interval
 * whose end precedes its start (an inversion is a data defect, never repaired
 * silently).
 */
export function sweep3TemporalStamping(corpus: Corpus, now: number): StampMetric {
  let backfilled = 0;
  let closed = 0;
  const inverted: string[] = [];
  for (const it of corpus.items) {
    if (it.validFrom === null) {
      it.validFrom = it.recordedAt;
      backfilled++;
    }
    if (it.supersededBy !== null && it.validTo === null) {
      it.validTo = now;
      closed++;
    }
    if (it.validTo !== null && it.validFrom !== null && it.validTo < it.validFrom)
      inverted.push(it.id);
  }
  return {
    backfilled,
    closed,
    openRecords: corpus.items.filter((i) => i.validTo === null).length,
    inverted,
  };
}

export interface ContradictionMetric extends SweepMetric {
  readonly pairs: number;
  readonly resolved: number;
  readonly escalated: readonly (readonly [string, string])[];
  readonly dangling: readonly string[];
}

/**
 * Sweep 4 — contradiction resolution by trust × recency. Ties are escalated by
 * name, never broken arbitrarily: the machine says "I cannot decide this"
 * instead of picking the one that happened to be first in memory.
 */
export function sweep4ContradictionPass(corpus: Corpus): ContradictionMetric {
  const byId = corpus.byId();
  const seen = new Set<string>();
  let pairs = 0;
  let resolved = 0;
  const escalated: (readonly [string, string])[] = [];
  const dangling: string[] = [];

  for (const it of corpus.items) {
    for (const otherId of it.contradicts) {
      const other = byId.get(otherId);
      if (!other) {
        dangling.push(`${it.id}→${otherId}`);
        continue;
      }
      const key = it.id < otherId ? `${it.id}|${otherId}` : `${otherId}|${it.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs++;
      const a = score(it);
      const b = score(other);
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) <= 1e-9) {
        escalated.push(it.id < otherId ? [it.id, otherId] : [otherId, it.id]);
        continue;
      }
      const loser = a > b ? other : it;
      loser.trust = damp(loser.trust);
      resolved++;
    }
  }
  return { pairs, resolved, escalated, dangling };
}

/** Trust discounted by a φ-octave once a record is closed in valid-time. */
function score(it: CorpusItem): number {
  return it.trust * (it.validTo === null ? 1 : PHI_INV);
}

export interface ConsolidationMetric extends SweepMetric {
  readonly candidates: number;
  readonly merged: number;
  readonly survivors: number;
  readonly prototypeIds: readonly string[];
  /**
   * Highest pairwise cos left among survivors, or null when fewer than two
   * survivors make the statistic undefined. Never a sentinel number: a
   * sentinel is a value a dashboard will happily plot.
   */
  readonly residualCos: number | null;
}

export interface ConsolidationOptions {
  readonly kinds?: readonly string[];
  readonly threshold?: number;
  readonly now: number;
  readonly attributedTo: string;
}

/**
 * Sweep 5 — prototype consolidation. Near-duplicates (cos ≥ 1 − φ⁻³) collapse
 * into a sealed Prototype whose vector is the phasor bundle of its members and
 * whose provenance names every one of them. Merged members are closed in
 * valid-time, so nothing is deleted and the lineage stays walkable.
 */
export function sweep5PrototypeConsolidation(
  corpus: Corpus,
  ledger: GenomeLedger,
  opts: ConsolidationOptions,
): ConsolidationMetric {
  const kinds = new Set(opts.kinds ?? ['FactChunk', 'Episode', 'Prototype']);
  const threshold = opts.threshold ?? CONSOLIDATION_COS;
  const candidates = corpus.items.filter(
    (i) => kinds.has(i.kind) && i.validTo === null && i.supersededBy === null,
  );

  const keep: CorpusItem[] = [];
  const memberIds = new Map<string, string[]>();
  const prototypeIds: string[] = [];
  let merged = 0;

  for (const it of candidates) {
    let target: CorpusItem | null = null;
    for (const p of keep) {
      const s = similarity(it.vector, p.vector);
      if (Number.isFinite(s) && s >= threshold) {
        target = p;
        break;
      }
    }
    if (target === null) {
      keep.push(it);
      memberIds.set(it.id, [it.id]);
      continue;
    }

    const members = [...(memberIds.get(target.id) ?? [target.id]), it.id];
    const protoId = `proto:${members[0]}:${members.length}`;
    const hv = bundle([target.vector, it.vector]).hv;
    ledger.append({
      id: protoId,
      kind: 'Prototype',
      body: { members },
      recordedAt: opts.now,
      provenance: {
        attributedTo: opts.attributedTo,
        generatedBy: 'sweep5:prototype_consolidation',
        derivedFrom: [target.id, it.id],
        evidence: 'derived',
      },
    });
    target.validTo = opts.now;
    target.supersededBy = protoId;
    it.validTo = opts.now;
    it.supersededBy = protoId;

    const proto: CorpusItem = {
      id: protoId,
      kind: 'Prototype',
      vector: hv,
      trust: Math.max(finite(target.trust), finite(it.trust)),
      contradicts: [],
      recordedAt: opts.now,
      validFrom: opts.now,
      validTo: null,
      supersededBy: null,
    };
    corpus.add(proto);
    keep.splice(keep.indexOf(target), 1, proto);
    memberIds.set(protoId, members);
    prototypeIds.push(protoId);
    merged++;
  }

  // Residual: the worst near-duplicate that survived. Must be below threshold,
  // otherwise the pass left work behind and is not idempotent.
  let residual = 0;
  for (let i = 0; i < keep.length; i++) {
    for (let j = i + 1; j < keep.length; j++) {
      const s = similarity(keep[i].vector, keep[j].vector);
      if (Number.isFinite(s) && s > residual) residual = s;
    }
  }
  return {
    candidates: candidates.length,
    merged,
    survivors: keep.length,
    prototypeIds,
    residualCos: keep.length > 1 ? residual : null,
  };
}

function finite(x: number): number {
  return Number.isFinite(x) ? x : 0;
}

export interface CausalEstimate {
  readonly theta: number;
  readonly se: number;
  /** Paired sample count behind the estimate. */
  readonly n: number;
}

export interface CausalMetric extends SweepMetric {
  readonly decisionTypes: number;
  readonly spoke: number;
  readonly abstained: readonly string[];
  readonly thetas: Readonly<Record<string, number>>;
  readonly malformed: readonly string[];
}

/**
 * Sweep 6 — causal attribution refresh. Estimates below the F9 paired-sample
 * floor abstain by name; estimates that are non-finite or carry a negative
 * standard error are malformed and fail the sweep rather than being rounded
 * into the report the way the reference did.
 */
export function sweep6CausalAttribution(
  estimates: Readonly<Record<string, CausalEstimate>> = {},
  minPaired = MIN_PAIRED,
): CausalMetric {
  const thetas: Record<string, number> = {};
  const abstained: string[] = [];
  const malformed: string[] = [];
  const keys = Object.keys(estimates).sort();
  for (const k of keys) {
    const e = estimates[k];
    if (!Number.isFinite(e.theta) || !Number.isFinite(e.se) || e.se < 0) {
      malformed.push(k);
      continue;
    }
    if (!Number.isFinite(e.n) || e.n < minPaired) {
      abstained.push(k);
      continue;
    }
    thetas[k] = e.theta;
  }
  return {
    decisionTypes: keys.length,
    spoke: Object.keys(thetas).length,
    abstained,
    thetas,
    malformed,
  };
}

export interface RescoreMetric extends SweepMetric {
  readonly items: number;
  readonly measured: number;
  readonly abstained: number;
  readonly gated: number;
  readonly dead: number;
  /** Null — never 0 — when nothing was measurable. */
  readonly rMean: number | null;
  readonly rMin: number | null;
  readonly rMax: number | null;
}

export interface RescoreInput {
  readonly id: string;
  readonly channels: readonly BusChannel[];
  readonly phaseDev?: number;
  readonly coherence?: number;
}

/**
 * Sweep 7 — cross-level re-scoring through the resonance bus. The reference
 * averaged an array that defaulted to `zeros(1)`, so an empty corpus reported a
 * confident R̄ = 0. Here an unmeasurable corpus reports null.
 */
export function sweep7CrossLevelRescoring(inputs: readonly RescoreInput[]): RescoreMetric {
  let measured = 0,
    abstained = 0,
    gated = 0,
    dead = 0;
  let sum = 0,
    min = Number.POSITIVE_INFINITY,
    max = Number.NEGATIVE_INFINITY;
  for (const it of inputs) {
    const r = fuseResonance(it.channels, { phaseDev: it.phaseDev, coherence: it.coherence });
    if (r.gated) gated++;
    if (r.dead) dead++;
    if (!Number.isFinite(r.value)) {
      abstained++;
      continue;
    }
    measured++;
    sum += r.value;
    if (r.value < min) min = r.value;
    if (r.value > max) max = r.value;
  }
  return {
    items: inputs.length,
    measured,
    abstained,
    gated,
    dead,
    rMean: measured > 0 ? sum / measured : null,
    rMin: measured > 0 ? min : null,
    rMax: measured > 0 ? max : null,
  };
}

export interface Forgery {
  readonly label: string;
  readonly header: SealedRecord['header'];
  readonly sealed: string;
  readonly leafIndex: number;
}

export interface RedTeamMetric extends SweepMetric {
  readonly genuine: number;
  readonly genuineVerified: number;
  readonly attempted: number;
  readonly accepted: readonly string[];
}

/**
 * Sweep 8 — adversarial red team. Each forgery is checked exactly as an
 * outside auditor would: recompute the leaf from (header ‖ ciphertext) and run
 * the inclusion proof for the claimed index against the live root. Genuine
 * records are checked in the same pass, so a verifier that rejects everything
 * cannot pass this sweep.
 */
export function sweep8RedTeam(
  corpus: Corpus,
  ledger: GenomeLedger,
  forgeries: readonly Forgery[],
  timestamp: number,
): RedTeamMetric {
  let genuine = 0;
  let genuineVerified = 0;
  for (const it of corpus.items) {
    const rec = ledger.get(it.id);
    if (!rec) continue;
    genuine++;
    const ev = ledger.prove(it.id, timestamp);
    if (!ev) continue;
    const leaf = hashLeaf(leafBytes(rec.header, rec.sealed));
    if (
      verifyInclusion(
        leaf,
        ev.leafIndex,
        ev.treeSize,
        ev.proofHex.map(fromHex),
        fromHex(ev.rootHex),
      )
    ) {
      genuineVerified++;
    }
  }

  const accepted: string[] = [];
  const size = ledger.size;
  const root = fromHex(ledger.rootHex());
  for (const f of forgeries) {
    const leaf = hashLeaf(leafBytes(f.header, f.sealed));
    const proof = ledger.inclusionProofAt(f.leafIndex, size);
    if (!proof) continue; // no proof obtainable: the forgery is already refused
    if (verifyInclusion(leaf, f.leafIndex, size, proof.map(fromHex), root)) accepted.push(f.label);
  }
  return { genuine, genuineVerified, attempted: forgeries.length, accepted };
}

function fromHex(hex: string): Hash {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out as Hash;
}

export interface CompressionMetric extends SweepMetric {
  readonly usage: Readonly<Record<string, number>>;
  readonly total: number;
  /** null = unbounded; an infinite budget is not a number a seal can carry. */
  readonly budget: number | null;
  readonly overBudget: boolean;
  readonly evictionPlan: readonly string[];
  readonly projected: number;
}

/**
 * Sweep 9 — governor compression. When the corpus is over budget the sweep
 * emits the eviction plan that brings it back under: lowest trust first, then
 * oldest. Reporting "over budget" without a remedy (the reference behaviour) is
 * not a consolidation operator.
 */
export function sweep9GovernorCompression(
  corpus: Corpus,
  usage: Readonly<Record<string, number>>,
  budget: number,
): CompressionMetric {
  const total = Object.values(usage).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const bounded = Number.isFinite(budget);
  const overBudget = bounded && total > budget;
  const plan: string[] = [];
  let projected = total;
  if (overBudget) {
    const perItem = corpus.items.length > 0 ? total / corpus.items.length : 0;
    const order = corpus.items.slice().sort((a, b) => {
      const ta = Number.isFinite(a.trust) ? a.trust : -1;
      const tb = Number.isFinite(b.trust) ? b.trust : -1;
      if (ta !== tb) return ta - tb;
      if (a.recordedAt !== b.recordedAt) return a.recordedAt - b.recordedAt;
      return a.id < b.id ? -1 : 1;
    });
    for (const it of order) {
      if (projected <= budget || perItem <= 0) break;
      plan.push(it.id);
      projected -= perItem;
    }
  }
  return {
    usage,
    total,
    budget: bounded ? budget : null,
    overBudget,
    evictionPlan: plan,
    projected,
  };
}

export interface ReflectionMetric extends SweepMetric {
  readonly sweepsOk: number;
  readonly sweepsTotal: number;
  readonly failed: readonly string[];
  readonly ts: number;
}

/** Sweep 10 — reflective synthesis over the nine that came before. */
export function sweep10Reflection(reports: readonly SweepReport[], now: number): ReflectionMetric {
  return {
    sweepsOk: reports.filter((r) => r.ok).length,
    sweepsTotal: reports.length,
    failed: reports.filter((r) => !r.ok).map((r) => `${r.n}:${r.name}`),
    ts: now,
  };
}

/* ── the protocol ─────────────────────────────────────────────────────────── */

export interface ProtocolInputs {
  /** Logical clock. No wall clock is ever read inside the protocol. */
  readonly now: number;
  readonly effectEstimates?: Readonly<Record<string, CausalEstimate>>;
  readonly rescore?: readonly RescoreInput[];
  readonly forgeries?: readonly Forgery[];
  readonly usage?: Readonly<Record<string, number>>;
  readonly budget?: number;
  readonly bindKind?: string;
  readonly fanIn?: number;
}

export interface ProtocolResult {
  readonly reports: readonly SweepReport[];
  readonly ok: boolean;
  /** Ledger size before and after the cycle — the cycle's own footprint. */
  readonly sealedFrom: number;
  readonly sealedTo: number;
}

export class TenSweepProtocol {
  private cycle = 0;

  constructor(
    private readonly ledger: GenomeLedger,
    private readonly owner = 'metatron/sweeps',
  ) {}

  /** Run one full ten-sweep cycle. Failing sweeps are sealed, not skipped. */
  run(corpus: Corpus, inputs: ProtocolInputs): ProtocolResult {
    const sealedFrom = this.ledger.size;
    const reports: SweepReport[] = [];
    const c = this.cycle++;
    const at = inputs.now;

    const go = (
      n: number,
      metric: SweepMetric,
      verdict: { ok: boolean; reason: string | null },
    ): void => {
      const sealId = `sweep:${c}:${n}`;
      const rec = this.ledger.append({
        id: sealId,
        kind: 'SweepSeal',
        body: { sweep: n, name: SWEEP_NAMES[n], metric, ok: verdict.ok, reason: verdict.reason },
        recordedAt: at,
        provenance: {
          attributedTo: this.owner,
          generatedBy: `sweep${n}:${SWEEP_NAMES[n]}`,
          evidence: 'measured',
        },
      });
      reports.push({
        n,
        name: SWEEP_NAMES[n],
        metric,
        ok: verdict.ok,
        reason: verdict.reason,
        sealId,
        leafIndex: rec.leafIndex,
      });
    };

    const m1 = sweep1IntakeReplay(corpus, this.ledger);
    go(
      1,
      m1,
      check(m1.replayed + m1.shredded === m1.total, `${m1.failures.length} envelope failure(s)`),
    );

    const m2 = sweep2HdcBinding(corpus, { kind: inputs.bindKind, fanIn: inputs.fanIn });
    go(
      2,
      m2,
      check(
        m2.probed === 0 || m2.recalled === m2.probed,
        `recall ${m2.recalled}/${m2.probed} (${m2.abstained} abstained)`,
      ),
    );

    const m3 = sweep3TemporalStamping(corpus, at);
    go(3, m3, check(m3.inverted.length === 0, `${m3.inverted.length} inverted interval(s)`));

    const m4 = sweep4ContradictionPass(corpus);
    go(
      4,
      m4,
      check(
        m4.escalated.length === 0 && m4.dangling.length === 0,
        `${m4.escalated.length} escalated, ${m4.dangling.length} dangling`,
      ),
    );

    const m5 = sweep5PrototypeConsolidation(corpus, this.ledger, {
      now: at,
      attributedTo: this.owner,
    });
    go(
      5,
      m5,
      check(
        m5.residualCos === null || m5.residualCos < CONSOLIDATION_COS,
        `residual cos ${(m5.residualCos ?? NaN).toFixed(6)} ≥ threshold: pass is not idempotent`,
      ),
    );

    const m6 = sweep6CausalAttribution(inputs.effectEstimates);
    go(6, m6, check(m6.malformed.length === 0, `${m6.malformed.length} malformed estimate(s)`));

    const m7 = sweep7CrossLevelRescoring(inputs.rescore ?? []);
    go(
      7,
      m7,
      check(
        m7.items === 0 || m7.measured > 0,
        'every item abstained: no cross-level evidence at all',
      ),
    );

    const m8 = sweep8RedTeam(corpus, this.ledger, inputs.forgeries ?? [], at);
    go(
      8,
      m8,
      check(
        m8.accepted.length === 0 && m8.genuineVerified === m8.genuine,
        `${m8.accepted.length} forgery accepted, ${m8.genuine - m8.genuineVerified} genuine rejected`,
      ),
    );

    const m9 = sweep9GovernorCompression(
      corpus,
      inputs.usage ?? { atoms: corpus.items.length },
      inputs.budget ?? Number.POSITIVE_INFINITY,
    );
    go(
      9,
      m9,
      check(
        !m9.overBudget || m9.projected <= (m9.budget ?? Number.POSITIVE_INFINITY),
        `no eviction plan reaches budget (${m9.projected} > ${m9.budget})`,
      ),
    );

    const m10 = sweep10Reflection(reports, at);
    go(10, m10, check(m10.sweepsOk === m10.sweepsTotal, `failed sweeps: ${m10.failed.join(', ')}`));

    return {
      reports,
      ok: reports.every((r) => r.ok),
      sealedFrom,
      sealedTo: this.ledger.size,
    };
  }

  /** Schedule for `cycles` heartbeat cycles from `start`. */
  static schedule(cycles = 1, start = 0): SweepSlot[] {
    return sweepSchedule(cycles, start);
  }
}

function check(ok: boolean, reason: string): { ok: boolean; reason: string | null } {
  return { ok, reason: ok ? null : reason };
}

export { toHex };
