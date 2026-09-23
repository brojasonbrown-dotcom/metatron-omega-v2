/** Local-first knowledge types. Everything is stored on-device. */

export interface KDocument {
  id: string;
  field: string;
  url: string;
  title: string;
  source: string;      // tool that produced it (web_fetch, wikipedia, sec_edgar…)
  fetchedAt: number;
  chars: number;
  chunkIds: string[];
}

export interface KChunk {
  id: string;
  docId: string;
  field: string;
  ord: number;
  text: string;
  /** hashed semantic vector (VECTOR_DIM) */
  vec: Float64Array;
  /** φ-plane bitmap barcode over vec */
  barcode: Uint32Array;
  tokens: number;
  /** wall-clock capture time (ms) — drives Fibonacci age banding */
  createdAt: number;
  /** ladder rung dominant at capture, -1 when untagged */
  rung: number;
  /** provenance confidence in [0,1] — 1 when the source is first-party */
  trust: number;
  /** capture modality; 'text' for ordinary documents */
  modality?: 'text' | 'geometry' | 'image' | 'audio';
  /**
   * The measured non-text descriptor blended into `vec` at ingest, retained so
   * a reload can rebuild the identical cross-modal vector. Without it the
   * restore path re-encodes text only and silently drops the binding.
   */
  descriptor?: number[];

  /** ids of chunks this one contradicts (maintained by the consolidator) */
  contradicts?: string[];
  /** id of the prototype this chunk was consolidated into, when any */
  prototypeOf?: string;
}

export interface RecallHit {
  chunk: KChunk;
  doc: KDocument | undefined;
  /** per-channel contributions, all in [0,1] */
  barcode: number;
  lexical: number;
  semantic: number;
  spread: number;
  /** PPMI-SVD latent cosine in [0,1]; NaN when the space abstains */
  latent: number;
  /**
   * Field-signature (Ω-SHFN G) phase-aligned cosine in [0,1]; NaN when the
   * chunk carries only a semantic fingerprint and no measured field state.
   */
  fieldSig: number;
  /** live-field resonance in [0,1], NaN when the engine is not streaming */
  resonance: number;
  /** channel that held the resonance back */
  resonanceVeto: string | null;
  /** Fibonacci age band index — 0 is freshest */
  band: number;
  /** ids of conflicting chunks surfaced alongside this hit */
  contradicts: string[];
  score: number;
}


export interface KnowledgeStats {
  fields: number;
  documents: number;
  chunks: number;
  terms: number;
  concepts: number;
  edges: number;
  bytes: number;
  bands: number;
}
