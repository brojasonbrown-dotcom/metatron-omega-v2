/**
 * Web Worker shell around the unified shard kernel (`fieldKernelCore.ts`).
 * Physics lives in the core; this file owns only the message protocol and
 * per-worker buffer lifecycle.
 *
 * Phase 2b adds two optional fields:
 *   - init.bankCoef  (ArrayBuffer transferred once)  → per-mode Wolfram coef table
 *   - compute.bankAlpha (number)                     → per-tick perturbation strength
 * When bankCoef is absent or bankAlpha === 0, kernel output is bit-identical
 * to the pre-Phase-2b path (IEEE 754: x * 1.0 === x).
 */
import { runShardKernel } from '@metatron/field-kernel-core';

type InitMessage = {
  id: number;
  type: 'init';
  kStart: number;
  kEnd: number;
  carrierHz: number;
  bankCoef?: ArrayBuffer;
};

type ComputeMessage = {
  id: number;
  type: 'compute';
  tSeconds: number;
  qScalar: number;
  reflectEnabled: boolean;
  computePressure: number;
  bankAlpha?: number;
};

type KernelMessage = InitMessage | ComputeMessage;

const workerSelf = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<KernelMessage>) => void) | null;
};

let kStart = 0;
let kEnd = -1;
let carrierHz = 144;
let prev = new Float64Array(0);
let bankCoef: Float64Array | undefined;

function initShard(message: InitMessage) {
  kStart = message.kStart;
  kEnd = message.kEnd;
  carrierHz = message.carrierHz;
  const nodes = Math.max(0, kEnd - kStart + 1);
  prev = new Float64Array(nodes);
  if (message.bankCoef && message.bankCoef.byteLength === nodes * 8) {
    bankCoef = new Float64Array(message.bankCoef);
  } else {
    bankCoef = undefined;
  }
  workerSelf.postMessage({ id: message.id, type: 'ready', nodes: prev.length });
}

function computeShard(message: ComputeMessage) {
  const started = performance.now();
  const nodes = prev.length;
  const amplitudes = new Float64Array(nodes);

  const acc = runShardKernel({
    kStart,
    nodes,
    carrierHz,
    tSeconds: message.tSeconds,
    qScalar: message.qScalar,
    reflectEnabled: message.reflectEnabled,
    computePressure: message.computePressure,
    prev,
    out: amplitudes,
    bankCoef,
    bankAlpha: message.bankAlpha ?? 0,
  });

  workerSelf.postMessage(
    {
      id: message.id,
      type: 'result',
      nodes,
      term1: acc.term1,
      term2: acc.term2,
      term3: acc.term3,
      term4: acc.term4,
      energy: acc.energy,
      coherenceNum: acc.coherenceNum,
      coherenceDen: acc.coherenceDen,
      elapsedMs: performance.now() - started,
      amplitudes: amplitudes.buffer,
    },
    [amplitudes.buffer],
  );
}

workerSelf.onmessage = (event: MessageEvent<KernelMessage>) => {
  if (event.data.type === 'init') initShard(event.data);
  else computeShard(event.data);
};

export {};
