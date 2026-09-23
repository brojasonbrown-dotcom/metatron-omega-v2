/**
 * Ω-CAPACITY C6 — one measured table, and the layering it implies.
 *
 * The recommendation lines are derived from the measurements in the same run;
 * they are not editorial. If a class stops being lossless, or the fan-in drops,
 * the recommendation changes with it.
 */

import { measureEnvelope } from './envelope';
import { measureSuperposition } from './superposition';
import { measureLayering } from './layering';
import { measureResidency } from './residency';
import { measureRetrieval } from './retrieval';
import { measureNesting } from './nesting';
import type { CapacityReport } from './types';

export interface ReportOptions {
  readonly budgetMsPerRung?: number;
  readonly vsaDim?: number;
  readonly population?: number;
  readonly residencyFrames?: number;
  /** Host quota in bytes, when known; drives the durable ceiling. */
  readonly quotaBytes?: number;
}

function recommend(r: Omit<CapacityReport, 'recommendation'>): string[] {
  const out: string[] = [];
  const best = [...r.envelope.rungs].sort((a, b) => b.numbersPerSecond - a.numbersPerSecond)[0];
  out.push(
    `Peak measured throughput ${Math.round(best.numbersPerSecond).toLocaleString()} numbers/s at rung ${best.width} ` +
    `(round-trip error ${best.roundTripError.toExponential(1)}).`,
  );
  const lossless = r.layering.classes.filter((c) => c.lossless).map((c) => c.name);
  out.push(
    lossless.length === r.layering.classes.length
      ? 'Every rate class decimates losslessly: ingest wide, analyse narrow, no information is paid for twice.'
      : `Lossless classes: ${lossless.join(', ') || 'none'} — route anything else at its native width.`,
  );
  out.push(
    `Bundle at most ${r.superposition.measuredFanIn} items per hypervector prototype ` +
    `(weakest component similarity ${r.superposition.fanInSimilarity.toFixed(3)}); split beyond that rather than blurring.`,
  );
  out.push(
    r.retrieval.knee === null
      ? 'Prefilter did not reach 0.9 recall at any probed candidate set — rescore exhaustively for this population.'
      : `Recall 0.9 is reached at ${r.retrieval.knee} candidates (${r.retrieval.kneeNumbersRead} numbers read); budget recall there.`,
  );
  out.push(
    `Durable cost ${r.residency.bytesPerNumber.toFixed(2)} bytes/number measured on sealed shards → ` +
    `${r.durableNumberCeiling.toLocaleString()} retained numbers at the assumed quota.`,
  );
  out.push(
    r.nesting.closed
      ? `Nesting closes at depth ${r.nesting.depth} with defect ${r.nesting.defect.toExponential(1)} (floor ${r.nesting.floor.toExponential(1)}) ` +
        `while the flat rung loses ${(100 * r.nesting.flatError).toFixed(0)}% — carry residuals, never truncate.`
      : `Nesting did NOT close: defect ${r.nesting.defect.toExponential(1)} exceeds the float64 floor ${r.nesting.floor.toExponential(1)}. Do not treat this nest as lossless.`,
  );
  out.push(
    `Nest costs ${r.nesting.overhead.toFixed(2)}× a flat field of the same top width and answers to band ${r.nesting.nestBandLimit} ` +
    `where the coarse rung alone reaches ${r.nesting.flatBandLimit}.`,
  );
  out.push(
    `RAM holds ${r.envelope.residentNumbers.toLocaleString()} numbers at once ` +
    `(${(r.envelope.workingBytes / 1048576).toFixed(0)} MiB working, provenance ${r.envelope.provenance}).`,
  );
  return out;
}

/** Default assumed quota when the host will not say: 10 GiB, desktop OPFS. */
export const ASSUMED_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

export async function measureCapacity(o: ReportOptions = {}): Promise<CapacityReport> {
  const envelope = measureEnvelope(o.budgetMsPerRung ?? 12);
  const superposition = measureSuperposition(o.vsaDim ?? 1597, o.population ?? 512);
  const layering = measureLayering();
  const residency = await measureResidency({ frames: o.residencyFrames ?? 512 });
  const retrieval = measureRetrieval({ population: o.population ?? 512 });
  const nesting = measureNesting();

  const quota = o.quotaBytes ?? ASSUMED_QUOTA_BYTES;
  const durableNumberCeiling = Number.isFinite(residency.bytesPerNumber) && residency.bytesPerNumber > 0
    ? Math.floor(quota / residency.bytesPerNumber)
    : 0;

  const base = { envelope, superposition, layering, residency, retrieval, nesting, durableNumberCeiling };
  return { ...base, recommendation: recommend(base) };
}

/** Fixed-width text table — the artefact C6 asked for. */
export function formatCapacityReport(r: CapacityReport): string {
  const L: string[] = [];
  L.push('Ω-CAPACITY — measured on this host');
  L.push('');
  L.push('C1 rung ceilings');
  L.push('  width  band   bytes/tick   ticks/s      numbers/s     rt-error');
  for (const g of r.envelope.rungs) {
    L.push(
      `  ${String(g.width).padStart(5)}  ${String(g.bandLimit).padStart(4)}  ` +
      `${String(g.bytesPerTick).padStart(10)}   ${g.ticksPerSecond.toFixed(0).padStart(8)}  ` +
      `${Math.round(g.numbersPerSecond).toLocaleString().padStart(13)}  ${g.roundTripError.toExponential(1)}`,
    );
  }
  L.push(`  RAM working ${(r.envelope.workingBytes / 1048576).toFixed(0)} MiB · resident ${r.envelope.residentNumbers.toLocaleString()} numbers · provenance ${r.envelope.provenance}`);
  L.push('');
  L.push('C2 superposition');
  L.push(`  FHRR dim ${r.superposition.dim} · chance σ ${r.superposition.chanceSigma.toExponential(2)} · measured fan-in ${r.superposition.measuredFanIn} (sim ${r.superposition.fanInSimilarity.toFixed(3)})`);
  L.push(`  barcode ${r.superposition.barcodeBits} bits · ${r.superposition.barcodeDistinct}/${r.superposition.barcodeProbed} distinct`);
  L.push(`  signature ${r.superposition.signatureDigits.toFixed(1)} digits/slot · ${r.superposition.signatureBitsLog2.toFixed(0)} bits per 13-mode signature`);
  L.push('');
  L.push('C3 ingest layering');
  for (const c of r.layering.classes) {
    L.push(`  ${c.name.padEnd(18)} ${String(c.hz).padStart(6)} Hz  w=${String(c.width).padStart(5)}  ${c.numbersPerSecond.toLocaleString().padStart(10)} num/s  ${c.lossless ? 'lossless' : 'lossy'} (${c.decimationError.toExponential(1)})`);
  }
  L.push(`  surviving band limit ${r.layering.survivingBandLimit}`);
  L.push('');
  L.push('C4 residency');
  L.push(`  ${r.residency.storeKind} · ${r.residency.framesWritten} frames × ${r.residency.width} · warm ${r.residency.warmBytes} B · cold ${r.residency.coldBytes} B`);
  L.push(`  ${r.residency.bytesPerNumber.toFixed(2)} bytes/number · seal ${r.residency.sealMs.toFixed(1)} ms · read ${r.residency.readMs.toFixed(1)} ms · ledger ${r.residency.ledgerLeaves} leaves`);
  L.push('');
  L.push('C5 retrieval');
  L.push('  cand   precision  recall   numbers-read');
  for (const p of r.retrieval.points) {
    L.push(`  ${String(p.candidates).padStart(5)}   ${p.precision.toFixed(3).padStart(9)}  ${p.recall.toFixed(3).padStart(6)}   ${String(p.numbersRead).padStart(12)}`);
  }
  L.push('');
  L.push('C7 nesting (Ω-UNBOUND)');
  L.push('  level  band   energy-share');
  for (const l of r.nesting.levels) {
    L.push(`  ${String(l.width).padStart(5)}  ${String(l.bandLimit).padStart(4)}   ${(100 * l.energyShare).toFixed(1).padStart(6)}%`);
  }
  L.push(`  depth ${r.nesting.depth} · defect ${r.nesting.defect.toExponential(1)} vs floor ${r.nesting.floor.toExponential(1)} · ${r.nesting.closed ? 'CLOSED' : 'NOT CLOSED'}`);
  L.push(`  flat single-rung error ${r.nesting.flatError.toExponential(1)} · band ${r.nesting.flatBandLimit} → nested band ${r.nesting.nestBandLimit}`);
  L.push(`  footprint ${r.nesting.bytes} B (${r.nesting.overhead.toFixed(2)}× flat) · cycle ${r.nesting.cycleMs.toFixed(2)} ms`);
  L.push('');
  L.push('C6 recommendation');
  for (const line of r.recommendation) L.push(`  • ${line}`);
  return L.join('\n');
}
