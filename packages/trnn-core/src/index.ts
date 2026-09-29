/**
 * @metatron/trnn-core — public surface.
 * Phase O-P0 (foundation) + O-P1 (certified single torus).
 */

export * from './core/constants';
export * from './core/indexing';
export * from './core/fibonacci';
export * from './core/scaleLadder';
export * from './core/window';
export * from './core/determinism';
export * from './core/complex';

export * from './cell/update';
export * from './cell/memory';
export * from './cell/closure';
export * from './cell/organs';

export * from './torus/lattice';
export * from './torus/eigenmodes';
export * from './torus/superposition';

export * from './measure/coherence';
export * from './measure/state';
export * from './measure/transcription';

export * from './spectral/sphere';
export * from './spectral/radial';
export * from './spectral/site';
export * from './spectral/laplacian';
export * from './spectral/fft';
export * from './spectral/exact';

// Ω-DEPTH — demand-driven fractal nesting + geometric-algebra channels.
export * from './fractal/nest';
export * from './fractal/pool';
export * from './algebra/clifford';

export { SingleTorusEngine } from './engine/SingleTorusEngine';
export type { EngineOptions, TickReport, Checkpoint } from './engine/SingleTorusEngine';

export * from './web/coupling';
export * from './web/octave';
export * from './web/fluxLedger';
export * from './web/ordering';
export * from './web/morphism';

export { MultiTorusEngine } from './engine/MultiTorusEngine';
export type { MultiTorusOptions, WebTickReport } from './engine/MultiTorusEngine';

// Ω-P4 — runtime + governor.
export * from './runtime/profiles';
export * from './runtime/hardware';
export * from './runtime/governor';
export * from './runtime/calibrate';
export * from './runtime/runLedger';
export { EngineHost, MIN_HZ, MAX_HZ } from './runtime/host';
export * from './runtime/views';
export type {
  HostOptions,
  HostSnapshot,
  SenseView,
  SenseChannelView,
  MemoryView,
} from './runtime/host';
export { MEMORY_STRIDE, MIND_STRIDE } from './runtime/host';
export type { LearnRun, LearnRunOptions } from './runtime/host';
export { Mind, NOVELTY_THRESHOLD } from './cognition/mind';
export type { MindReport, Thought, MindOptions } from './cognition/mind';
export { ConceptStore } from './cognition/concepts';
export type { ConceptRecord, ConceptStats, SearchHit, SearchTrace } from './cognition/concepts';
export { SelfModel, DiagonalSSM, DiagonalRLS, LAMBDA_MAX } from './cognition/selfModel';
export type { SelfModelReport, PredictionEntry } from './cognition/selfModel';

// Ω-P6 — sensory plane + braid memory.
export * from './sense/encode';
export * from './sense/fusion';
export * from './sense/plane';
export * from './sense/nodeArray';
export * from './sense/scan';
export * from './memory/braid';
export * from './memory/turingTape';

// Ω-P8 — learning tiers.
export * from './learn/params';
export * from './learn/spectralFilter';
export * from './learn/mixer';
export * from './learn/spectralAttention';
export * from './learn/cell';
export * from './learn/battery';
export * from './learn/tiers';

/* Ω-OPERATOR — spectral calculus, mode-current witness, resampling, Sobolev,
   banded mode coupling. Namespaced to keep generic names out of the root. */
export * as operator from './operator/index';

/* Ω-REAL substrate: φ parity, innovation coherence, and the measurement stack. */
export * from './substrate/phiSubstrate';
export * from './substrate/coherenceKernel';
export * from './substrate/signalStats';
export * from './substrate/correlation';
export * from './substrate/causal';
export * from './substrate/resonanceBus';
export * from './substrate/vsa';
export * from './substrate/hierBundle';
export * from './substrate/plasticity';
export * from './substrate/dmd';

/* Ω-REAL P6: append-only evidence — RFC-6962 ledger and sealed Genome v2. */
export * from './ledger/canonical';
export * from './ledger/merkle';
export * from './ledger/sth';
export * from './genome/record';

/* Ω-REAL P7: the Ten-Sweep Consolidation Protocol. */
export * from './sweeps/tenSweep';

/* Ω-REAL P8: certification harness — golden set, abstention, ACI, latency. */
export * from './harness/golden';
export * from './harness/abstention';
export * from './harness/conformal';
export * from './harness/latency';
export * from './harness/certify';
export * from './harness/battery';
