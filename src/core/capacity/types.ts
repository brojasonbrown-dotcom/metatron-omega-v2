/**
 * Ω-CAPACITY — measured ceilings, not estimates.
 *
 * Every number in these types comes from something that actually ran on this
 * host: an FFT that was timed, a bundle that was decoded, a shard that was
 * written and read back. Nothing here is a projection from a datasheet, and
 * nothing here writes to the engine.
 */

/** One rung of the φ ladder measured end to end. */
export interface RungCapacity {
  /** Node/mode count of the rung (Fibonacci width). */
  readonly width: number;
  /** Usable signed wavenumbers at this width (Nyquist excluded). */
  readonly bandLimit: number;
  /** Bytes one tick of this rung costs as a complex field (float64 re+im). */
  readonly bytesPerTick: number;
  /** Measured unitary FFT round trips per second at this width. */
  readonly fftPerSecond: number;
  /** Measured numbers (float64 slots) touched per second at this width. */
  readonly numbersPerSecond: number;
  /** Ticks per second sustainable if a tick is one forward+inverse transform. */
  readonly ticksPerSecond: number;
  /** Round-trip relative error of the timed transform — the honesty check. */
  readonly roundTripError: number;
}

export interface EnvelopeCapacity {
  /** Working RAM the governor actually grants (0.70 of the ceiling). */
  readonly workingBytes: number;
  readonly ceilingBytes: number;
  readonly provenance: string;
  /** Tape frames, episodes, atoms the caps allow right now. */
  readonly maxTapeFrames: number;
  readonly maxEpisodes: number;
  readonly maxSensoryAtoms: number;
  /** Total float64 slots RAM can hold at once across tape + episodes. */
  readonly residentNumbers: number;
  readonly rungs: readonly RungCapacity[];
  /** Wall-clock milliseconds the probe itself consumed. */
  readonly probeMs: number;
}

export interface SuperpositionCapacity {
  /** Hypervector dimension probed. */
  readonly dim: number;
  /** Chance similarity sigma at this dimension: 1/√(2D). */
  readonly chanceSigma: number;
  /** Largest bundle size whose components were all still recoverable at z≥5. */
  readonly measuredFanIn: number;
  /** Similarity of a bundled component at the measured fan-in. */
  readonly fanInSimilarity: number;
  /** Distinguishable signature states, log2, from the 256-bit barcode. */
  readonly barcodeBits: number;
  /** Measured distinct barcodes over the probe population (collision test). */
  readonly barcodeDistinct: number;
  readonly barcodeProbed: number;
  /** Measured usable decimal digits of a float64 signature slot. */
  readonly signatureDigits: number;
  /** log2 of distinguishable states in one 13-mode float64 signature. */
  readonly signatureBitsLog2: number;
}

export interface RateClass {
  readonly name: string;
  readonly hz: number;
  readonly width: number;
  readonly numbersPerSecond: number;
  /** True when decimation into this class is exact (spectral resample). */
  readonly lossless: boolean;
  /** Measured relative error of the decimation into this class. */
  readonly decimationError: number;
}

export interface LayeringCapacity {
  readonly classes: readonly RateClass[];
  readonly totalNumbersPerSecond: number;
  /** Widest band-limit that survives the narrowest class in the chain. */
  readonly survivingBandLimit: number;
}

export interface ResidencyCapacity {
  readonly storeKind: string;
  readonly framesWritten: number;
  readonly width: number;
  readonly warmBytes: number;
  readonly coldBytes: number;
  /** Bytes per retained number, measured on real shard bytes. */
  readonly bytesPerNumber: number;
  readonly sealMs: number;
  readonly readMs: number;
  /** Numbers per second the durable path sustained, sealing included. */
  readonly durableNumbersPerSecond: number;
  /** Ledger leaves committed for the units written. */
  readonly ledgerLeaves: number;
  readonly rootHex: string;
}

export interface RetrievalPoint {
  readonly candidates: number;
  readonly precision: number;
  readonly recall: number;
  readonly numbersRead: number;
}

export interface RetrievalCapacity {
  readonly population: number;
  readonly queries: number;
  readonly points: readonly RetrievalPoint[];
  /** Smallest candidate set that still reached recall ≥ 0.9. */
  readonly knee: number | null;
  /** Recall budget in numbers read at the knee. */
  readonly kneeNumbersRead: number;
}

import type { NestingCapacity } from './nesting';

export interface CapacityReport {
  readonly envelope: EnvelopeCapacity;
  readonly superposition: SuperpositionCapacity;
  readonly layering: LayeringCapacity;
  readonly residency: ResidencyCapacity;
  readonly retrieval: RetrievalCapacity;
  /** Ω-UNBOUND C7 — nesting depth and closure, the measured absence of a wall. */
  readonly nesting: NestingCapacity;
  /** Retained numbers the host can durably hold, measured, not claimed. */
  readonly durableNumberCeiling: number;
  /** Plain-language recommendation derived from the measurements above. */
  readonly recommendation: readonly string[];
}
