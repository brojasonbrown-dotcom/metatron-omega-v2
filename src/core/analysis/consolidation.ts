/**
 * Ω-P9.4 — consolidation of live findings.
 *
 * P9.3 made every analysis pass provable. Provable evidence that nothing ever
 * reads is still inert, so this phase closes the loop: sealed findings become
 * a first-class corpus, and the certified Ten-Sweep protocol runs over that
 * corpus — replay, HDC binding, bi-temporal stamping, contradiction
 * resolution, prototype consolidation, causal attribution, cross-level
 * re-scoring, red team, governor compression, reflection.
 *
 * Rules kept from P6/P7, deliberately:
 *   • Every clock value is injected. Nothing inside reads a wall clock.
 *   • "Not measured" is never spelled 0. An abstained finding carries NaN
 *     trust, which the sweeps read as "never scored".
 *   • A failing sweep is sealed and shown, not skipped or rounded green.
 */

import {
  Corpus,
  TenSweepProtocol,
  type CausalEstimate,
  type ProtocolResult,
  type RescoreInput,
  type SweepReport,
} from '@metatron/trnn-core/sweeps/tenSweep';
import { GenomeLedger } from '@metatron/trnn-core/genome/record';
import { keyPairFromSeed } from '@metatron/trnn-core/ledger/sth';
import { bind, bundle, randomHv, type Hypervector } from '@metatron/trnn-core/substrate/vsa';
import type { PairFinding, SpineReport } from './analysisSpine';

/** Hypervector width for finding atoms. Large enough that chance cos ≈ 0.03. */
export const FINDING_DIM = 1024;

/** Quantisation levels per numeric slot: coarse enough that repeats collapse. */
export const LEVELS = 13;

/** Corpus kind. 'FactChunk' is the kind sweep 5 consolidates by default. */
export const FINDING_KIND = 'FactChunk';

/** Fan-in for the sweep-2 cleanup memory. */
export const FINDING_FAN_IN = 5;

/** Governor budget in atoms; over it, sweep 9 must produce a reaching plan. */
export const CORPUS_BUDGET = 610;

/** Weight of the pair-identity slot inside the finding vector. */
export const PAIR_WEIGHT = 8;

const OWNER = 'omega/analysis/consolidation';

function roleHv(name: string): Hypervector {
  return randomHv(FINDING_DIM, `role:${name}`);
}

/** Quantised filler. Non-finite input maps to an explicit "unmeasured" atom. */
export function levelHv(slot: string, v: number | null | undefined): Hypervector {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return randomHv(FINDING_DIM, `lvl:${slot}:unmeasured`);
  }
  const c = Math.max(-1, Math.min(1, v));
  const bucket = Math.round(c * LEVELS);
  return randomHv(FINDING_DIM, `lvl:${slot}:${bucket}`);
}

/**
 * Structured encoding of one finding: pair identity plus the measured slots,
 * bound role→filler and bundled. Two findings that agree on every quantised
 * slot encode to the same vector, which is exactly what sweep 5 should merge.
 */
export function findingVector(f: PairFinding): Hypervector {
  const pairKey = f.a < f.b ? `${f.a}|${f.b}` : `${f.b}|${f.a}`;
  const slots: [Hypervector, Hypervector, number][] = [
    // Pair identity carries φ² weight: two different channel pairs must never
    // land inside the consolidation cone just because their statistics agree.
    [roleHv('pair'), randomHv(FINDING_DIM, `pair:${pairKey}`), PAIR_WEIGHT],
    [roleHv('assoc'), levelHv('assoc', f.association), 1],
    [roleHv('pearson'), levelHv('pearson', f.correlation?.pearson.value ?? null), 1],
    [roleHv('spearman'), levelHv('spearman', f.correlation?.spearman.value ?? null), 1],
    [roleHv('dcor'), levelHv('dcor', f.correlation?.dcor.value ?? null), 1],
    [roleHv('mi'), levelHv('mi', f.correlation?.mi.value ?? null), 1],
    [roleHv('dir'), levelHv('dir', f.direction), 1],
  ];
  return bundle(
    slots.map(([r, v]) => bind(r, v)),
    slots.map(([, , w]) => w),
  ).hv;
}

export function pairKeyOf(f: PairFinding): string {
  return f.a < f.b ? `${f.a}|${f.b}` : `${f.b}|${f.a}`;
}

export interface IngestResult {
  /** Atoms added by this pass. */
  readonly added: number;
  /** Atoms superseded because a newer observation of the same pair arrived. */
  readonly superseded: number;
  /** Direction reversals recorded as explicit contradictions. */
  readonly contradictions: number;
}

export interface ConsolidationSummary {
  readonly cycles: number;
  readonly lastCycle: ProtocolResult | null;
  readonly corpusItems: number;
  readonly openItems: number;
  readonly prototypes: number;
  readonly ledgerSize: number;
  readonly rootHex: string;
  readonly publicKey: string;
}

/**
 * Turns sealed analysis passes into a Ten-Sweep corpus and runs the protocol
 * over it. Owns its own genome ledger: sweep 1 and sweep 8 need every corpus
 * atom to be openable and provable, so ingest and sealing happen together.
 */
export class FindingConsolidator {
  readonly corpus = new Corpus();
  private readonly ledger: GenomeLedger;
  private readonly protocol: TenSweepProtocol;
  /** pairKey → id of the newest open atom for that pair. */
  private readonly latest = new Map<string, string>();
  private atoms = 0;
  private cycles = 0;
  private last: ProtocolResult | null = null;

  constructor(seed: Uint8Array, logId = 'omega.consolidation.v1') {
    if (seed.length !== 32) throw new RangeError('seed must be 32 bytes');
    const master = Uint8Array.from(seed);
    // Distinct signing seed: a master key must never double as a signing key.
    const signSeed = Uint8Array.from(seed, (b, i) => (b ^ (0x5a + i)) & 0xff);
    this.ledger = new GenomeLedger(logId, master, keyPairFromSeed(signSeed));
    this.protocol = new TenSweepProtocol(this.ledger, OWNER);
  }

  get size(): number { return this.corpus.items.length; }
  get cycleCount(): number { return this.cycles; }
  get ledgerSize(): number { return this.ledger.size; }

  /** Seals each reported finding as a corpus atom. Abstentions are skipped:
   *  an abstention is the absence of evidence, not a fact to consolidate. */
  ingest(report: SpineReport, at: number): IngestResult {
    let added = 0, superseded = 0, contradictions = 0;
    const byId = this.corpus.byId();

    for (const f of report.findings) {
      if (f.verdict !== 'report') continue;
      const key = pairKeyOf(f);
      const id = `assoc:${key}:${this.atoms++}`;
      const priorId = this.latest.get(key) ?? null;
      const prior = priorId ? byId.get(priorId) ?? null : null;

      const contradicts: string[] = [];
      if (
        prior &&
        typeof f.direction === 'number' && Number.isFinite(f.direction) &&
        Number.isFinite(prior.trust) &&
        typeof priorDirection(prior) === 'number' &&
        (priorDirection(prior) as number) * f.direction < 0
      ) {
        contradicts.push(prior.id);
        contradictions++;
      }

      this.ledger.append({
        id,
        kind: FINDING_KIND,
        body: {
          pair: key, a: f.a, b: f.b, n: f.n,
          association: fin(f.association),
          pearson: fin(f.correlation?.pearson.value),
          spearman: fin(f.correlation?.spearman.value),
          dcor: fin(f.correlation?.dcor.value),
          mi: fin(f.correlation?.mi.value),
          direction: fin(f.direction),
          directionVerdict: f.directionVerdict ?? null,
        },
        recordedAt: at,
        provenance: {
          attributedTo: OWNER,
          generatedBy: 'p9.2:analysis_spine',
          derivedFrom: priorId ? [priorId] : undefined,
          evidence: 'measured',
        },
      });

      const item = this.corpus.add({
        id,
        kind: FINDING_KIND,
        vector: findingVector(f),
        trust: typeof f.association === 'number' && Number.isFinite(f.association)
          ? f.association
          : Number.NaN,
        contradicts,
        recordedAt: at,
        validFrom: at,
        validTo: null,
        supersededBy: null,
      });
      DIRECTION.set(item.id, typeof f.direction === 'number' && Number.isFinite(f.direction)
        ? f.direction : null);
      byId.set(id, item);
      added++;

      if (prior && prior.supersededBy === null) {
        prior.supersededBy = id;
        superseded++;
      }
      this.latest.set(key, id);
    }
    return { added, superseded, contradictions };
  }

  /** Runs one full Ten-Sweep cycle over everything ingested so far. */
  run(report: SpineReport | null, at: number): ProtocolResult {
    const res = this.protocol.run(this.corpus, {
      now: at,
      bindKind: FINDING_KIND,
      fanIn: FINDING_FAN_IN,
      effectEstimates: report ? effectEstimates(report) : {},
      rescore: report ? rescoreInputs(report) : [],
      forgeries: [],
      usage: { atoms: this.corpus.items.length },
      budget: CORPUS_BUDGET,
    });
    this.cycles++;
    this.last = res;
    return res;
  }

  summary(at = 0): ConsolidationSummary {
    return {
      cycles: this.cycles,
      lastCycle: this.last,
      corpusItems: this.corpus.items.length,
      openItems: this.corpus.open().length,
      prototypes: this.corpus.items.filter((i) => i.kind === 'Prototype').length,
      ledgerSize: this.ledger.size,
      rootHex: this.ledger.rootHex(),
      publicKey: this.ledger.head(at).publicKey,
    };
  }
}

/** Direction memo, keyed by atom id — kept out of CorpusItem's fixed shape. */
const DIRECTION = new Map<string, number | null>();

function priorDirection(item: { id: string }): number | null {
  return DIRECTION.get(item.id) ?? null;
}

function fin(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Sweep-6 effect estimates from the directed scan: θ is the signed direction
 * and its standard error the 1/√n paired-sample floor. Findings without a
 * measured direction are omitted, so sweep 6 abstains on them by name.
 */
export function effectEstimates(report: SpineReport): Record<string, CausalEstimate> {
  const out: Record<string, CausalEstimate> = {};
  for (const f of report.findings) {
    if (f.verdict !== 'report') continue;
    if (typeof f.direction !== 'number' || !Number.isFinite(f.direction)) continue;
    if (!Number.isFinite(f.n) || f.n <= 1) continue;
    out[pairKeyOf(f)] = { theta: f.direction, se: 1 / Math.sqrt(f.n), n: f.n };
  }
  return out;
}

/** Sweep-7 inputs: every measured member of the family becomes a bus channel. */
export function rescoreInputs(report: SpineReport): RescoreInput[] {
  const out: RescoreInput[] = [];
  for (const f of report.findings) {
    if (f.verdict !== 'report' || !f.correlation) continue;
    const channels = [
      chan('pearson', f.correlation.pearson.value),
      chan('spearman', f.correlation.spearman.value),
      chan('dcor', f.correlation.dcor.value),
      chan('mi', f.correlation.mi.value),
    ].filter((c): c is { id: string; value: number } => c !== null);
    if (channels.length === 0) continue;
    out.push({ id: pairKeyOf(f), channels });
  }
  return out;
}

function chan(id: string, v: number | null | undefined): { id: string; value: number } | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const a = Math.abs(v);
  return { id, value: a > 1 ? 1 : a };
}

/** Compact, UI-ready view of one cycle. */
export interface SweepLine {
  readonly n: number;
  readonly name: string;
  readonly ok: boolean;
  readonly reason: string | null;
  readonly sealId: string;
}

export function sweepLines(res: ProtocolResult | null): SweepLine[] {
  if (!res) return [];
  return res.reports.map((r: SweepReport) => ({
    n: r.n, name: r.name, ok: r.ok, reason: r.reason, sealId: r.sealId,
  }));
}
