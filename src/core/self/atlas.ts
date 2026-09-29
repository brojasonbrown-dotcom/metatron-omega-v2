/**
 * Ω-MAP — the Capability Atlas.
 *
 * The registry answers "is this module alive?". The atlas answers "what is it,
 * structurally?": what it consumes, what it emits, at what native rate, what it
 * depends on, what it already feeds, and what it *could* feed if something were
 * wired. Those last items are hypotheses and are labelled SPEC — never merged
 * into the verified `does` line.
 *
 * Rules this file obeys, enforced by test/self/o1-atlas.test.ts:
 *   • `does` states only behaviour that exists in the cited source today.
 *   • `affordances` are potential, always label 'SPEC', never phrased as ability.
 *   • `hz` is a real design constant or null. Never an estimate, never a guess.
 *   • Every `source` path exists on disk; every id exists in the live registry.
 */

export type AtlasLayer =
  | 'sense'
  | 'field'
  | 'memory'
  | 'knowledge'
  | 'analysis'
  | 'cognition'
  | 'governance'
  | 'ui';

/**
 * Port kinds are the atlas's type system. Two modules are *port compatible*
 * when one emits a kind the other accepts — that is the only mechanical basis
 * on which an unused pairing may be proposed.
 */
export type PortKind =
  | 'field-frame' // Ψ samples / rung state
  | 'snapshot' // host telemetry (tick, coherence, digest)
  | 'spectrum' // eigenmodes, radial coefficients
  | 'topology' // declared ladder shape
  | 'thought' // cognition output (novelty, surprise, concept)
  | 'pattern' // consolidated φ-signature / episode
  | 'vector' // genome vector + barcode
  | 'signature' // eigen-ordered field coefficients for stored text
  | 'text' // symbolic chunk / journal line
  | 'document' // fetched external material
  | 'surprise' // scalar prediction error
  | 'series'; // timestamped scalar channel for correlation/causality

export interface AtlasPort {
  /** stable port name, unique within its module */
  name: string;
  kind: PortKind;
  /** unit of the payload, or null when it is structural rather than numeric */
  unit: string | null;
  /** native design rate in Hz, or null when the port is event-driven */
  hz: number | null;
  what: string;
}

export interface Affordance {
  /** the hypothesis, phrased as a possibility */
  what: string;
  /** what would have to be true or built first */
  requires: string;
  /** epistemic label — always SPEC in this file */
  label: 'SPEC';
}

export interface AtlasEntry {
  /** must match a SelfModule.id from the live registry */
  id: string;
  layer: AtlasLayer;
  /** one verified line: what this module does today */
  does: string;
  inputs: AtlasPort[];
  outputs: AtlasPort[];
  /** module ids this one reads from */
  dependsOn: string[];
  /** module ids this one already delivers to, as wired in code today */
  feeds: string[];
  /** hard constraints a consumer must respect */
  limits: string[];
  affordances: Affordance[];
  /** file that certifies the behaviour above, or null when uncertified */
  evidence: string | null;
  source: string;
}

const A = (what: string, requires: string): Affordance => ({ what, requires, label: 'SPEC' });

export const CAPABILITY_ATLAS: readonly AtlasEntry[] = [
  {
    id: 'engine.host',
    layer: 'governance',
    does: 'Owns the multi-torus engine in a worker and publishes structured-clone-safe snapshots on an adaptive bus.',
    inputs: [
      {
        name: 'command',
        kind: 'topology',
        unit: null,
        hz: null,
        what: 'build/start/stop/setHz commands from the UI runtime.',
      },
    ],
    outputs: [
      {
        name: 'snapshot',
        kind: 'snapshot',
        unit: null,
        hz: 64,
        what: 'tick, tickRate, coherence, digest, per-rung state.',
      },
      {
        name: 'tickRate',
        kind: 'series',
        unit: 'Hz',
        hz: 64,
        what: 'measured engine tick rate as a scalar channel.',
      },
    ],
    dependsOn: ['engine.topology'],
    feeds: ['engine.field', 'engine.spectral', 'engine.mind', 'memory.substrate'],
    limits: [
      'Deterministic engine path: no RNG, no wall-clock, no hardware probe inside tick().',
      'Bus rate is adaptive; consumers must tolerate coalesced frames rather than assume every tick.',
    ],
    affordances: [
      A(
        'Snapshot scalars could drive the analysis spine as first-class causal channels.',
        'A sampler binding for every published scalar, plus staleness marking.',
      ),
      A(
        'Checkpoints could seed reproducible A/B runs of learning tiers.',
        'A run harness that restores a checkpoint before each arm.',
      ),
    ],
    evidence: 'packages/trnn-core/test/g4-runtime.test.ts',
    source: 'src/ui/omega/omegaRuntime.ts',
  },
  {
    id: 'engine.field',
    layer: 'field',
    does: 'Evolves the closed toroidal field across every built rung and reports closure defect and corridor state per rung.',
    inputs: [
      {
        name: 'drive',
        kind: 'field-frame',
        unit: null,
        hz: null,
        what: 'sensory injection into receptor nodes.',
      },
    ],
    outputs: [
      {
        name: 'psi',
        kind: 'field-frame',
        unit: null,
        hz: 64,
        what: 'complex field samples per rung.',
      },
      {
        name: 'closureDefect',
        kind: 'series',
        unit: null,
        hz: 64,
        what: 'per-rung flux closure residual.',
      },
      {
        name: 'coherenceWarm',
        kind: 'series',
        unit: null,
        hz: 64,
        what: 'coherence over warm rungs only; cold rungs abstain.',
      },
    ],
    dependsOn: ['engine.host'],
    feeds: ['engine.spectral', 'memory.substrate', 'knowledge.field'],
    limits: [
      'Cold rungs are not measured-zero: they abstain and must be excluded from any mean.',
      'φ⁴ max-norm clamp is always on; a consumer must not interpret clamping as saturation of meaning.',
    ],
    affordances: [
      A(
        'Per-rung closure defect could act as an anomaly channel for the causal layer.',
        'Rung-resolved sampling into the stream window, not just the aggregate.',
      ),
      A(
        'Rung-local Ψ windows could index episodic memory by spatial locus, not only by time.',
        'A locus key in EpisodicStore and a rung-aware recall cue.',
      ),
    ],
    evidence: 'packages/trnn-core/test/g1-single-torus.test.ts',
    source: 'packages/trnn-core/src/engine/MultiTorusEngine.ts',
  },
  {
    id: 'engine.spectral',
    layer: 'field',
    does: 'Measures the leading eigenmodes and radial spectrum of the live field through an executed power-iteration/Lanczos pass.',
    inputs: [
      {
        name: 'psi',
        kind: 'field-frame',
        unit: null,
        hz: null,
        what: 'field state for a requested rank.',
      },
    ],
    outputs: [
      {
        name: 'modes',
        kind: 'spectrum',
        unit: null,
        hz: null,
        what: 'eigenvalues and eigen-ordered coefficients.',
      },
      {
        name: 'radial',
        kind: 'spectrum',
        unit: null,
        hz: null,
        what: 'radial transform of the rung.',
      },
    ],
    dependsOn: ['engine.field'],
    feeds: ['knowledge.field'],
    limits: [
      'Pull-based: a spectral view exists only for ranks that were explicitly requested.',
      'Cost grows with node count; it is not safe on the per-tick path.',
    ],
    affordances: [
      A(
        'Spectral drift between passes could be a cheap regime-change detector.',
        'Retention of the previous spectrum plus a defined drift metric.',
      ),
      A(
        'Eigenmode energy could weight memory salience so structurally novel states are captured preferentially.',
        'A salience term in MemoryCaptureKernel that reads the spectral view.',
      ),
    ],
    evidence: 'packages/trnn-core/test/g2-spectral.test.ts',
    source: 'packages/trnn-core/src/spectral/laplacian.ts',
  },
  {
    id: 'engine.mind',
    layer: 'cognition',
    does: 'Turns engine observations into concepts and scores its own predictions each fold, emitting one auditable Thought per fold.',
    inputs: [
      {
        name: 'observation',
        kind: 'snapshot',
        unit: null,
        hz: null,
        what: 'engine state folded into the self model.',
      },
    ],
    outputs: [
      {
        name: 'thought',
        kind: 'thought',
        unit: null,
        hz: null,
        what: 'novelty, surprise and the concept touched.',
      },
      {
        name: 'surprise',
        kind: 'surprise',
        unit: null,
        hz: null,
        what: 'scalar prediction error in [0,1].',
      },
    ],
    dependsOn: ['engine.host'],
    feeds: [],
    limits: [
      'Fold-driven, not tick-driven; thought count is not a rate.',
      'Novelty and surprise are bounded to [0,1] by contract — a consumer must not rescale them silently.',
    ],
    affordances: [
      A(
        'Surprise could gate memory capture so the tape spends its budget on informative moments.',
        'A surprise input on MemoryCaptureKernel and a documented gating threshold.',
      ),
      A(
        'Concepts could be cross-indexed against corpus concepts to detect where lived state and read knowledge disagree.',
        'A shared concept key space between ConceptStore and KnowledgeBase.',
      ),
    ],
    evidence: 'packages/trnn-core/test/g7-cognition.test.ts',
    source: 'packages/trnn-core/src/cognition/mind.ts',
  },
  {
    id: 'engine.topology',
    layer: 'governance',
    does: 'Reports the built ladder shape the engine is actually running, as published by the worker.',
    inputs: [],
    outputs: [
      {
        name: 'description',
        kind: 'topology',
        unit: null,
        hz: null,
        what: 'rungs, nodes per rung, modes, profile.',
      },
    ],
    dependsOn: [],
    feeds: ['engine.host'],
    limits: [
      'Reflects the built engine only; a requested configuration that failed to build is not reported here.',
    ],
    affordances: [
      A(
        'Topology could parameterise memory capacities so layer budgets scale with the built ladder.',
        'MemoryGovernor reading the description instead of a fixed profile assumption.',
      ),
    ],
    evidence: 'packages/trnn-core/test/g5-views.test.ts',
    source: 'packages/trnn-core/src/runtime/views.ts',
  },
  {
    id: 'memory.substrate',
    layer: 'memory',
    does: 'Captures the field continuously into L0 tape and consolidates salient moments through Hebbian, episodic, pattern, pathway and journal layers.',
    inputs: [
      {
        name: 'capture',
        kind: 'field-frame',
        unit: null,
        hz: 64,
        what: 'Ψ plus coherence/energy/salience per driven tick.',
      },
      {
        name: 'note',
        kind: 'text',
        unit: null,
        hz: null,
        what: 'symbolic line for the journal ring.',
      },
    ],
    outputs: [
      {
        name: 'trajectory',
        kind: 'pattern',
        unit: null,
        hz: null,
        what: 'L0 dynamics summary around a tick.',
      },
      {
        name: 'recall',
        kind: 'pattern',
        unit: null,
        hz: null,
        what: 'ranked φ-signature matches with successors.',
      },
      {
        name: 'salience',
        kind: 'series',
        unit: null,
        hz: 64,
        what: 'last capture salience as a scalar channel.',
      },
    ],
    dependsOn: ['engine.field', 'engine.host'],
    feeds: ['memory.learning'],
    limits: [
      'Every layer has an explicit cap; exceeding it evicts rather than grows.',
      'Determinism contract: identical capture sequences must produce identical snapshots.',
    ],
    affordances: [
      A(
        'Tape windows could supply the analysis spine with true field series instead of aggregate telemetry.',
        'A sampler that reads FieldTape.window() directly with monotone alignment.',
      ),
      A(
        'Pathway edges could predict the next pattern and be scored against what actually arrives.',
        'A prediction slot and an error channel back into the mind loop.',
      ),
    ],
    evidence: 'test/memory/b1-tape-readback.test.ts',
    source: 'src/core/memory/MemoryStore.ts',
  },
  {
    id: 'memory.learning',
    layer: 'memory',
    does: 'Adapts pattern weights from measured prediction error across the substrate, with bounded updates.',
    inputs: [
      {
        name: 'error',
        kind: 'surprise',
        unit: null,
        hz: null,
        what: 'measured prediction error driving the update.',
      },
    ],
    outputs: [
      {
        name: 'meanSurprise',
        kind: 'series',
        unit: null,
        hz: null,
        what: 'running mean surprise.',
      },
      { name: 'merges', kind: 'pattern', unit: null, hz: null, what: 'pattern merge events.' },
    ],
    dependsOn: ['memory.substrate'],
    feeds: [],
    limits: [
      'Updates are bounded and must be driven only by measured error — never by a heuristic prior.',
      'Learning is measured against a fixed-φ baseline or it stays disabled (Law A1).',
    ],
    affordances: [
      A(
        'Merge events could be sealed into the evidence ledger so consolidation history is auditable.',
        'A ledger sink for memory events alongside analysis passes.',
      ),
    ],
    evidence: null,
    source: 'src/core/memory/LearningEngine.ts',
  },
  {
    id: 'knowledge.corpus',
    layer: 'knowledge',
    does: 'Holds acquired documents on-device, rebuilds every index from authoritative chunk text, and serves the recall cascade.',
    inputs: [
      {
        name: 'chunk',
        kind: 'document',
        unit: null,
        hz: null,
        what: 'parsed document chunk with its source record.',
      },
    ],
    outputs: [
      {
        name: 'chunk',
        kind: 'text',
        unit: null,
        hz: null,
        what: 'retrieved chunk text with provenance.',
      },
      {
        name: 'concepts',
        kind: 'text',
        unit: null,
        hz: null,
        what: 'concept graph nodes and edges.',
      },
    ],
    dependsOn: ['knowledge.acquisition'],
    feeds: ['knowledge.genome', 'knowledge.latent', 'knowledge.field'],
    limits: [
      'Chunk text is authoritative; any index disagreeing with it is wrong by definition.',
      'Storage is client-side and bounded by the browser quota.',
    ],
    affordances: [
      A(
        'Concept-graph structure could be compared with mind concepts to locate blind spots.',
        'A shared key space and a defined disagreement metric.',
      ),
    ],
    evidence: 'test/omega-vec.test.ts',
    source: 'src/core/knowledge/KnowledgeBase.ts',
  },
  {
    id: 'knowledge.genome',
    layer: 'knowledge',
    does: 'Gives every chunk a deterministic vector plus φ-barcode identity that the recall channels read.',
    inputs: [{ name: 'text', kind: 'text', unit: null, hz: null, what: 'chunk text to encode.' }],
    outputs: [
      {
        name: 'vector',
        kind: 'vector',
        unit: null,
        hz: null,
        what: 'deterministic embedding + 256-bit barcode.',
      },
    ],
    dependsOn: ['knowledge.corpus'],
    feeds: ['knowledge.latent'],
    limits: [
      'Same text must produce the same vector, always — re-encode exactness is a contract, not a target.',
      'Barcode prefilter is lossy: it narrows candidates, it does not decide relevance.',
    ],
    affordances: [
      A(
        'Vectors could bind with field signatures into one hypervector so text and field share an address space.',
        'An agreed binding operator and a battery showing binding is invertible enough to recall both parts.',
      ),
    ],
    evidence: 'test/omega-vec.test.ts',
    source: 'src/core/knowledge/genome.ts',
  },
  {
    id: 'knowledge.latent',
    layer: 'knowledge',
    does: 'Builds a PPMI + power-iteration latent space that provides a semantic recall channel beyond surface term overlap.',
    inputs: [
      {
        name: 'cooccurrence',
        kind: 'text',
        unit: null,
        hz: null,
        what: 'term co-occurrence counts from the corpus.',
      },
    ],
    outputs: [
      {
        name: 'latentVector',
        kind: 'vector',
        unit: null,
        hz: null,
        what: 'latent coordinates for a term or chunk.',
      },
    ],
    dependsOn: ['knowledge.corpus'],
    feeds: [],
    limits: [
      'Unbuilt latent space contributes nothing; it must abstain rather than fall back to term overlap silently.',
    ],
    affordances: [
      A(
        'Latent drift across acquisition cycles could show what the corpus is actually learning over time.',
        'Retention of previous bases and an alignment metric between them.',
      ),
    ],
    evidence: null,
    source: 'src/core/knowledge/LatentSpace.ts',
  },
  {
    id: 'knowledge.field',
    layer: 'knowledge',
    does: 'Propagates each chunk through the measured Laplacian spectrum and stores eigen-ordered coefficients as its field signature.',
    inputs: [
      {
        name: 'basis',
        kind: 'spectrum',
        unit: null,
        hz: null,
        what: 'measured eigenbasis for the current ladder.',
      },
      { name: 'text', kind: 'text', unit: null, hz: null, what: 'chunk to propagate.' },
    ],
    outputs: [
      {
        name: 'signature',
        kind: 'signature',
        unit: null,
        hz: null,
        what: 'eigen-ordered coefficients per chunk.',
      },
    ],
    dependsOn: ['engine.spectral', 'knowledge.corpus'],
    feeds: [],
    limits: [
      'A chunk without a signature has a semantic fingerprint only; the FLD channel must abstain for it.',
      'Signatures are basis-bound: a rebuilt eigenbasis invalidates them.',
    ],
    affordances: [
      A(
        'Signatures could be matched against live Ψ so the field itself can retrieve text it resonates with.',
        'A cosine index between live field windows and stored signatures, with an abstention rule for cold rungs.',
      ),
    ],
    evidence: 'test/omega-field-signature.test.ts',
    source: 'src/core/knowledge/fieldSignature.ts',
  },
  {
    id: 'knowledge.acquisition',
    layer: 'knowledge',
    does: 'Fetches, OCRs and parses external material into the corpus by field of study, recording source and fetch time per chunk.',
    inputs: [
      {
        name: 'target',
        kind: 'text',
        unit: null,
        hz: null,
        what: 'field of study / source list to pursue.',
      },
    ],
    outputs: [
      {
        name: 'document',
        kind: 'document',
        unit: null,
        hz: null,
        what: 'parsed document with provenance.',
      },
      {
        name: 'novelty',
        kind: 'series',
        unit: null,
        hz: null,
        what: 'per-cycle novelty of what was fetched.',
      },
    ],
    dependsOn: [],
    feeds: ['knowledge.corpus'],
    limits: [
      'Network-bound and failure-prone; failed fetches are recorded, never silently retried into duplicates.',
      'Every ingested chunk must carry its source document and fetch time.',
    ],
    affordances: [
      A(
        'Novelty per cycle could steer the next acquisition target toward the least-covered area.',
        'A coverage measure over the concept graph and a selection policy that reads it.',
      ),
    ],
    evidence: null,
    source: 'src/core/knowledge/Acquisition.ts',
  },
] as const;

export const ATLAS_BY_ID: ReadonlyMap<string, AtlasEntry> = new Map(
  CAPABILITY_ATLAS.map((e) => [e.id, e]),
);
