/**
 * Main-thread fallback shell around the unified shard kernel
 * (`fieldKernelCore.ts`). Used when Web Workers are unavailable. Physics is
 * bit-for-bit identical to the worker path.
 */
import type { FieldShardResult, FieldShardSpec } from './WorkerPool';
import { runShardKernel } from '@metatron/field-kernel-core';

export function computeShardOnMainThread(
  spec: FieldShardSpec,
  carrierHz: number,
  tSeconds: number,
  qScalar: number,
  reflectEnabled: boolean,
  computePressure: number,
  previous?: Float64Array,
  bankCoef?: Float64Array,
  bankAlpha?: number,
): FieldShardResult & { readonly nextPrev: Float64Array } {
  const started = performance.now();
  const nodes = Math.max(0, spec.kEnd - spec.kStart + 1);
  const prev = previous && previous.length === nodes ? previous : new Float64Array(nodes);
  const amplitudes = new Float64Array(nodes);

  const acc = runShardKernel({
    kStart: spec.kStart,
    nodes,
    carrierHz,
    tSeconds,
    qScalar,
    reflectEnabled,
    computePressure,
    prev,
    out: amplitudes,
    bankCoef: bankCoef && bankCoef.length === nodes ? bankCoef : undefined,
    bankAlpha: bankAlpha ?? 0,
  });

  return {
    nodes,
    amplitudes,
    term1: acc.term1,
    term2: acc.term2,
    term3: acc.term3,
    term4: acc.term4,
    energy: acc.energy,
    coherenceNum: acc.coherenceNum,
    coherenceDen: acc.coherenceDen,
    elapsedMs: performance.now() - started,
    nextPrev: prev,
  };
}
