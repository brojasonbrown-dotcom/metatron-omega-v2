/**
 * Ω-CAPACITY — the measured ceiling table (C1–C6).
 *
 * Read-only throughout: nothing here writes to the engine, the corpus of
 * record, or any persisted store — the residency probe uses its own in-memory
 * blob store so a measurement can never contaminate the archive.
 */

export * from './types';
export { measureEnvelope, measureRung, PROBE_RUNGS } from './envelope';
export {
  measureSuperposition,
  measureFanIn,
  probeFanIn,
  measureSignatureDigits,
  measureBarcodeDistinct,
  Z_FLOOR,
} from './superposition';
export { measureLayering, measureDecimation, RATE_CLASSES, LOSSLESS_TOL } from './layering';
export { measureResidency, type ResidencyOptions } from './residency';
export { measureRetrieval, measureBarcodeSensitivity, type RetrievalOptions } from './retrieval';
export { measureNesting, NEST_LADDER, type NestingCapacity } from './nesting';
export {
  measureCapacity,
  formatCapacityReport,
  ASSUMED_QUOTA_BYTES,
  type ReportOptions,
} from './report';
