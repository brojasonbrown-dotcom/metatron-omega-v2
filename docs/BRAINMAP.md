# METATRON Ω — BRAINMAP

**Single source of structural truth for the new engine.**
Status: v1.2 (2026-08-24, amendment Ω-07) · governs every module built under it
Live counts (swept 2026-08-24): `trnn-core/src` **78** · `field-kernel-core/src` **8** ·
`src/core` **150** · `src/ui/omega` **36** · `src/lib` **43** · `src/routes` **7** ·
`src/components` **8** · tests **55 files / 830 assertions green** · typecheck 0 errors.
Lineage: **brain v14** (TS law/ontology kernel) → **METATRON K3** (frozen NumPy oracle) →
**TRNN** (certified Python toroidal RHUFT neural network, 334 tests, gates G0–G9 PASS) →
**METATRON Ω** (this repo: browser/worker TypeScript realization + UI + memory + tools).

Governance (inherited Law A4): this file is amended **before** code, never after.

---

## §0 Epistemic law (inherited, non-negotiable)

Every constant, equation and claim carries a label:
`[MATH]` proven · `[DEFINED]` our choice · `[MEASURED]` benchmarked here · `[SPEC]` hypothesis · `[CORRECTED]`/`[DISPROV]`.
No mocks. No asserted capability — capability is shown by a **battery** or it ships disabled.
Numerology is never a design justification.

### Theorems we may assert
- Stability law: rung n is stable ⇔ L(n) ≡ ±1 (mod 13) ⇔ n ≡ {1, 13, 15, 27} (mod 28). `[MATH]`
- Closure obstruction: L(n) mod 13 ≠ 0 ∀n → every torus is minimally open; residual flux must be routed. `[MATH]`
- Memory kernel: weights (1−λ, λ), λ = φ⁻² ⇒ roots exactly {1, −φ⁻²} — unique marginal-stability point. `[MATH]`
- Metatron spectrum: 13-mode φ-weighted lattice spectral lines = Lucas numbers exactly. `[MATH]`
- Closure coupling κ = 1/(φπ), κφπ = 1 exactly (Wolfram cert C6). `[MATH, CORRECTED vs v14]`

---

## §1 The Ten Laws + amendments

| Law | Statement |
|---|---|
| L1 | One constants source. All ≥8-digit floats derive from φ in `core/constants.ts`. |
| L2 | Determinism: engine path has no RNG, no wall-clock, no hardware probe. Same seed ⇒ same digest chain. |
| L3 | Dimensionless couplings only. |
| L4 | Fan-in normalization on every aggregator (rows sum to 1). |
| L5 | Log-space for magnitude-spanning math (ladder spans φ²⁹² ≈ 10⁶¹). |
| L6 | Explicit retention/pruning on every buffer (ring buffers, Fibonacci budgets). |
| L7 | Corridor gates every actuation (STABLE/STRESS/CRITICAL). |
| L8 | Provable contraction certificate < 1 + always-on φ⁴ max-norm clamp. |
| L9 | One implementation site per equation. |
| L10 | Honesty machinery: mistake ledger, audit doc, epistemic labels. |
| A1 | Learning is measured against a fixed-φ baseline or it ships disabled. |
| A2 | Learned params init at φ-law values and are constrained so certificates hold ∀ params. |
| A3 | Resources target 75% of **measured** capacity — not less, never more. |
| A4 | BRAINMAP amended before code. |

---

## §2 Architecture — three concentric rings

```text
                       ┌──────────────── UI: METATRON Ω workstation ─────────────────┐
                       │ FIELD · LADDER · WEB · SPECTRAL · MEMORY · COGNITION ·       │
                       │ LEARN · HARDWARE · TOOLS · INTEGRATIONS · RUNS · CHAT/KOKORO │
                       └───────────────▲──────────────────────────────────────────────┘
                                       │ snapshot bus (structural sharing, 8–64 Hz)
   ┌───────────────────────────────────┴──────────────────────────────────────────┐
   │ RUNTIME  (Web Worker, deterministic, no wall-clock on the engine path)       │
   │  governor(A3) → profile F_k → MultiTorusEngine.tick() → ledger → checkpoint  │
   └───────────────────────────────────▲──────────────────────────────────────────┘
                                       │
   ┌───────────────────────────────────┴──────────────────────────────────────────┐
   │ CORE  @metatron/trnn-core  (pure TS, typed arrays, zero deps)                │
   │  constants · fibonacci · scaleLadder · determinism                           │
   │  cell(update/memory/closure) · torus(lattice/eigenmodes/superposition/       │
   │  sphere/radial) · web(coupling/octave/fluxLedger/ordering/morphism)          │
   │  measure(coherence/corridorGate/state/transcription/telemetry)               │
   │  sensory(encoders/fusion/inject/shell) · learn(memoryPlane/retrieval/        │
   │  selfModel/multirate/governor) · cognition(conceptStore/HNSW/PQ/thoughts)    │
   └──────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 The nested toroid stack
42 stable Lucas rungs, 1 ≤ n ≤ 293. Dense core = the 18 lowest (n ≤ 125); continuation = 24. `[MATH + DEFINED]`
Rung n: major radius L(n) = ℓ_P·φⁿ (log-space), minor r = L(n)/φ, clock τ(n) = t_P·φⁿ(1+0.01n), attenuation qrf(n) = φ^(−n/89).

### 2.2 Node resolution (user-selectable, hardware-governed)
Nodes/torus = F_k. Profiles PICO(144) · BASE(987) · CORE(2584) · GRAND(6765) · COSMIC(75025) · TRANSFINITE(832040) · ABSOLUTE(2178309).
Lattices: `GoldenRing` (oracle/parity path) and the corrected Fibonacci lattice u_j = 2πj/N, v_j = 2πjφ⁻¹ (A-04 — the printed phyllotactic law is degenerate).

### 2.3 Spectral bases
Toroidal e^{i(pu+qv)} on the golden ladder (p,q) = (k, round(kφ⁻¹)); spherical Y_l^m on a Fibonacci shell; radial j_l(πφⁱ r̂).
All CGS2-orthonormalized at one site; analysis/synthesis exact inverses (roundtrip < 1e-12). Weights w_k = φ⁻ᵏ/Σφ⁻ʲ.

### 2.4 The cell (per torus, per tick)
`z⁺ = clamp_φ⁴[ αz + βG + γP + δR + ε(Π−z) + ζ(ẑ−z) + ηU + μV + ξS ]`,
α=φ⁻², β=φ⁻⁵, γ=δ=ζ=φ⁻³, ε=φ⁻⁸, η=μ=φ⁻⁵.
Jury gain g = |α|+|β|+2|ε|+|ζ| = **0.7507764050037854 < 1** `[MATH]`; realized ≤ 0.8365 `[MEASURED]`.
Memory: m⁺ = (1−λ)m + λz⁺, λ = φ⁻².

### 2.5 The web (cross-rung)
w(n,m) = φ^(−|n−m|)·affinity(n,m) (metallic-mean tower boundaries), banded |Δn| > 34 ⇒ 0, per-receiver row-normalized to exactly 1.
±13 octave channel at φ⁻¹³, landing on nearest stable rung or radiating into the FluxLedger sink.
Ladder-CFL: receipts staged Jacobi-form from pre-update state; violation is a runtime error.
Double-entry FluxLedger, conservation ≤ 1e-12 `[MEASURED 2.1e-14]`.

### 2.6 Measurement plane (read-only, never actuates)
Golden-delay coherence C(t) = |⟨Ψ(t)|Ψ(t−233)⟩|²/(|Ψ(t)|²|Ψ(t−233)|²), ignition = up-crossing φ⁻².
Q-hierarchy (local/regional/global/temporal/scale/cross) with weights (φ⁻¹, φ⁻², φ⁻³, φ⁻⁵, φ⁻⁸, φ⁻⁹).
Corridor gate: skill 1/(1+ê), regimes at φ⁻¹ / 0.7φ⁻¹, hysteresis φ⁻⁸, gate scales {1, φ⁻¹, φ⁻²}.
Transcription tape: 13-dim spectral signature per tick, digest-chained.

### 2.7 Sensory → field
Fold: c_k = Σ_{j≡k(13)} f_j·φ^(−⌊j/13⌋); phase-tag ĉ = c·e^{iθ_k(n)}; inject v = gain·rate(CI_low)·synth(ĉ)/|synth(ĉ)|, |v| ≤ φ.
Fusion weights (1, φ⁻¹, φ⁻²) × softmax confidence gate. Natural rungs: vision/audio → 183, text → 197.

### 2.8 Memory plane (six tiers) — merges with the existing Ω substrate
Fast(EMA ring) · Working · Associative(graph) · LongTerm(prototypes) · Meta(contradictions) · Archive(replay),
plus **TorusBraidHopfield**: E(Ψ) = −Σ exp(β·Re⟨Ψ,μᵢ⟩), β(G) = φ²√(G/28) (A-12 corrected — the printed φ/√28 recalls 0.000),
golden-angle write walk, consolidation at persistence S ≥ φ⁻². Retrieval: R1–R6 cascade, stop 1−φ⁻³, S_MAX = √5.

### 2.9 Cognition
HNSW + product-quantization concept store, ConceptHopfield, ThoughtTracker, NoveltyGate, PredictionLedger,
SSM self-model (poles r_i = φ⁻¹φ^(−i/13)) + diagonal RLS baseline (+8.33% margin, ENABLED).

### 2.10 Learning tiers (honest)
- **T0 inference/oracle** — pure TS, deterministic, always available. *(this repo, first)*
- **T1 browser training** — WebGPU/WASM optional; every learnable module keeps its A2 constrained parametrization
  (SimplexGain ≤ 2φ⁻², InputGain φ⁻¹·sigmoid, BoundedEigenvalue r < 1) so certificates hold ∀ params.
- **T2 local sidecar** — the Python TRNN (torch/CUDA) attached over the existing tool bus for real BPTT.
- **T3 hosted** — server function driving the same core for shared runs.
Kill-criterion log carried over: A-06 envelope **DISABLED**, A-08 multi-rate **DISABLED**, A-09 recorded, P3 cell + P7 self-model **ENABLED**.

---

## §3 What already exists here (no regression allowed)

| Asset | Location | Fate |
|---|---|---|
| v14 law kernel (31 root modules, formal/, schemas/) | ~~`packages/brain-core/src`~~ | **REMOVED (Ω-07, 2026-08-24)** — never on a live path; its role was fully absorbed by `trnn-core` + `src/core`. See § Ω-07. |
| v14 field substrate (13-node tile, λ-SSM, eigenmode attention) | ~~`packages/brain-core/src/field`~~ | **REMOVED (Ω-07)** — superseded by the certified 9-term cell (`trnn-core/cell`) plus `learn/spectralAttention.ts`; §5 R-1 is now closed in the trunk's favour. |
| Memory substrate L0–L6 + sensory gateway | `src/core/memory`, `src/core/sensory` | kept; becomes the persistence backing for §2.8 |
| Gematria / Z[φ] / Zeckendorf / bitmap / resonance kernel | `src/core/gematria` | kept; the realized Track G |
| RHUFT ladders, Ω fusion, torus closure, qualia | `src/core/rhuft`, `src/core/runtime/rhuftf`, `src/core/field` | kept; re-pointed at real engine telemetry |
| Tools (19 intel handlers), Kokoro TTS, chat | `src/lib/chat`, `src/ui/omega` | untouched |
| Ω workstation shell | `src/ui/omega/OmegaWorkstation.tsx` | extended with engine decks |

---

## §4 Gaps found in the audit (to be closed)

- `core/indexing.ts` (`at`/`get` bounds-checked accessors) is **missing** — every v14 law module imports it.
- 9 cognition modules not ported (record_perceptron, learning_mode, telemetry_tape, field_genome,
  genome_spectral_signature, lexicon_triples, novelty_gate, resonance_manifold, retained_memory, spectral_memory).
- 9 adapters not ported (phasor_field HDC, spectral_audio/perception/enrichment, structured_codec,
  domain_curriculum, ocr_engine, ocr_feed, web_feed).
- `parallel/` (flat typed-array tree layout + subtree workers) — entirely absent.
- **Zero tests carried over** from either archive. The whole certified gate battery must be re-established here.

---

## §5 Reconciliations (decide before code)

- **R-1 cell vs tile — CLOSED (Ω-07).** `brain-core/field` implemented a 13-node spectral tile with
  attention + λ-SSM; TRNN implements the certified 9-term cell on an F_k lattice. Decision taken and
  now executed: the **TRNN cell is the trunk** (it carries the Jury certificate and K3 bit-parity);
  the tile's attention/spectral mixing survives as the zero-gated learnable term
  `trnn-core/learn/spectralAttention.ts` inside term G, subject to A1/A2. The duplicate tile
  implementation was deleted under Ω-07 once proved import-dead.
- **R-2 constants — CLOSED.** One site wins: `trnn-core/core/constants.ts`. The second φ-table left
  the tree with `brain-core`; `src/core/constants/WolframVerified.ts` remains as verification data,
  not as a competing source.
- **R-3 Ω fusion.** The existing Ω geomean ladder is retained as a *scorer over real engine metrics*, not a simulator.
- **R-4 precision.** Bit-parity with the Python oracle is a target for constants and the single-torus path only;
  everything else is band-checked, and any divergence is recorded rather than hidden.

---

## §6 Gates (each phase is green or the next does not open)

G0 constants bit-parity · G1 single-torus parity + contraction · G2 spectral roundtrips < 1e-12 + Lucas lines ·
G3 learnable-cell battery ≥ φ⁻² margin · G4 flux conservation + CFL · G5 profile/governor 75% ·
G6 sensory + memory capacity ≥ 0.99 · G7 self-model + soak · G8 cognition · G9 audit.

---

## Amendment log
- **Ω-01 (2026-08-14):** BRAINMAP instantiated for the TypeScript realization. Adds §2.10 learning tiers
  (the Python original assumes CUDA; the browser cannot), §3 preservation table, §5 reconciliations.
  No TRNN law, constant, certificate or kill-verdict is altered.
- **Ω-02 (2026-08-14):** Ω-P0 + Ω-P1 realized in `packages/trnn-core` (pure TS, zero deps).
  Gate G0 green: Jury gain bit-exact 0.7507764050037854, 42 stable rungs reproduced by *both*
  forms of the stability law (residue and Lucas mod 13, cross-checked for all n ≤ 293), κφπ = 1,
  φ⁻⁷ stamped, all profile sizes Fibonacci, digest chain reproducible and ulp-sensitive.
  Gate G1 green: unforced cell contracts at ≤ the certificate, trajectories converge at gᵗ,
  φ⁴ clamp bounds any admissible state, 1000-tick run finite and bounded, seed-identical digests,
  144-tick checkpoint + exact rollback/replay, spectral roundtrip < 1e-12, spectral lines = Lucas.
  Recorded deviations (not hidden): `1/PHI` and `PHI − 1` differ by exactly 1 ulp; the digest is
  FNV-1a/BigInt rather than blake2b — chain semantics identical, byte values differ from Python.
  Closed the §4 gap `core/indexing.ts`. No existing module was altered or deleted.

---

## § Capability Atlas (Ω-MAP, 2026-08-20)

`src/core/self/atlas.ts` is the **machine-readable projection of this document**. Where the two
disagree, this document is amended first (Law A4) and the atlas follows in the same change.

Each entry declares, per module: `layer`, one verified `does` line, typed `inputs`/`outputs`
(port kind, unit, native Hz or `null`), `dependsOn`, `feeds`, `limits`, `evidence` (the battery
that certifies it), and `affordances` — hypotheses labelled `[SPEC]`, never capability.

`src/core/self/crossMap.ts` joins the atlas with the live `selfRegistry` and derives three
strictly separate readings:

| reading | meaning |
|---|---|
| `edges` | declared wiring, classified `wired` / `cold` / `broken` / `unknown` by the liveness of both endpoints |
| `gaps` | outputs no module accepts, inputs no module emits |
| `opportunities` | port-compatible producer→consumer pairs that are **not** declared — the only honest definition of unused potential, always `[SPEC]` |

Invariants enforced by `test/self/o1-atlas.test.ts`:

- every cited `source`/`evidence` path exists on disk;
- atlas ids ≡ registry ids, both directions (drift is surfaced as `orphans`, never hidden);
- affordances are `[SPEC]` and never restated inside `does`;
- no mock, simulated or placeholder content in any entry;
- `crossMap` is clock-free and deterministic: same atlas + same registry ⇒ identical bytes.

Surfaces: the `STRUCTURE` strip on the SELF deck, the `STRUCTURAL MAP` block of the L0 self
prompt, and the `self_map({ module?, kind? })` tool.

---

## § Memory substrate — layers, transport and the persistence contract (Ω-FIX, 2026-08-20)

### Layer table (authoritative; `src/core/memory/`)

| tier | module | holds | written by | capped by | in `snapshot()` |
|---|---|---|---|---|---|
| L0 | `FieldTape` | every-tick Ψ ring (quantised frames) | `MemoryCaptureKernel.capture` | `MemoryGovernor` byte budget | no — volatile by design (RAM ring, replayed live) |
| L1 | `HebbianMatrix` | sparse co-activation weights, O(1) global-scale decay | `capture` | `maxHebbianEntries` | yes |
| L2 | `EpisodicStore` | salience/surprise/Fibonacci-triggered top-K signatures | `capture` | `maxEpisodes` (priority eviction) | **yes (added Ω-FIX)** |
| L3 | `FibonacciPatterns` | consolidated φ-signatures (semantic prototypes) | `capture` / `ingest` | `maxPatterns` (LRU·salience) | yes |
| L4 | `PathwayGraph` | pattern→pattern transitions | `capture` | `maxPathwayEdges` | yes |
| L5 | `TextJournal` | symbolic records | `capture(text)` | `maxJournalRecords` | yes |
| L6 | `ReflectiveIndex` | re-measurement priority queue over L2 | derived | derived | no — derived, rebuilt from L2 |
| L-S | `SensoryGateway` / `PerceptRegistry` / `VisionFieldIndex` | content-addressed sensory atoms and image↔field index | sensory drivers | `maxSensoryAtoms` | no — content-addressed, re-derivable |

Anything marked "no" is **derived or volatile**, never silently dropped state: it is reconstructed
from its source, exactly as `KnowledgeBase.restore` rebuilds every index from text.

### The persistence contract (law)

> `restore(JSON.parse(JSON.stringify(snapshot())))` must reproduce a **byte-identical** snapshot,
> and must leave recall ranking unchanged.

Certified by `test/memory/m10-snapshot-roundtrip.test.ts` and probed live by `selfRegistry`
(`memory.substrate → snapshot round-trips exactly`).

**The defect this closes.** `JSON.stringify(new Int32Array([1,2]))` renders `{"0":1,"1":2}`, and
`new Int32Array({"0":1,"1":2})` yields a **zero-length** array. `FibonacciPatterns.restore` and
`EpisodicStore.restore` both constructed typed arrays that way, so every L3 pattern and L2 episode
lost its `indices`/`amplitudes` on any JSON transport: the snapshot shrank (observed 1,046,752 B →
1,035,443 B) and recall cosines collapsed to 0 against emptied signatures. This was a genuine
data-integrity fault on the replay path, not a reporting artefact.

**The fix.** `src/core/memory/typedJson.ts` (`toInt32Array` / `toFloat64Array`) accepts the three
shapes a snapshot can legitimately arrive in — typed array, `number[]`, JSON index-keyed object —
and never fabricates or partially fills a buffer. Both restores use it. `MemoryPersistence`
serialises L2 alongside the other tiers; `episodes` is optional, so a pre-existing envelope
restores without clearing live episodic memory.

### Amendment log
- **Ω-03 (2026-08-20):** memory substrate JSON-transport law stated and certified; L2 episodes
  added to `MemorySnapshot` and to the persistence envelope (optional field, backward compatible).
  No engine math, no capture scheduling and no eviction policy changed.

---

## § Information taxonomy — everything this brain can hold (Ω-04, 2026-08-21)

Authoritative enumeration of **every information type the engine ingests, encodes, stores,
indexes and emits**, with its native resolution and rate. Where a rate is engine-side it is a
`[DEFINED]` Fibonacci cadence; where it is device-side it is `[MEASURED]` at runtime.

### A. Sensory intake (`src/core/sensory/`)

| stream | frontend | native rate | encoding | field target |
|---|---|---|---|---|
| audio | `AudioFrontend` → `MelFilterbank` → `AudioCortex` | 233 Hz `[DEFINED]` | mel bands → φ-fold 13-residue vector | rung 183 |
| video / screen | `VideoFrontend`, `ScreenFrontend` → `VideoCortex` | 89 Hz `[DEFINED]` | patch stats → `VisionEncoder` → `VisionProjection` (int8-quantised embed) | rung 183 |
| motion | `IMUFrontend` | 377 Hz `[DEFINED]` | 6-axis → φ-lattice bins | rung 183 |
| text | chat / tools / documents | event-driven | tokenise → hashed semantic vector + barcode | rung 197 |
| geometry / CAD | multimodal deck | event-driven | descriptor blended into chunk `vec` (`KChunk.descriptor`) | rung 197 |

All frames pass `SensoryGateway` → content-addressed `SensoryAtom` (`SimHashPhi`) →
`PerceptRegistry`. Invalid frames are **counted, never repaired** (`sensor_bus.ts`).
Fusion weights (1, φ⁻¹, φ⁻²) × softmax confidence gate.

### B. Field state (the substrate of every other type)

- Ψ: complex field, N = F_k per torus (PICO 144 … ABSOLUTE 2178309), 42 stable rungs.
- Per-tick derived scalars: coherence C, warm coherence, energy E, qualia scalar Q,
  salience, novelty, surprise, arousal, Λ, κ-closure, Ω.
- 13-dim spectral transcription signature per tick, digest-chained (`measure/transcription`).
- Clifford Cl(3,0) 8-blade channels (`algebra/clifford.ts`), eigenmodes, radial/spherical/toroidal
  spectra, DMD modes (`substrate/dmd.ts`), VSA hypervectors (`substrate/vsa.ts`).

### C. Memory tiers (see § Memory substrate for the persistence law)

L0 tape (every tick) · L1 Hebbian sparse weights · L2 episodes (top-K=24 signature +
vision embed + text) · L3 φ-pattern prototypes (36-dim dense) · L4 pathway transitions ·
L5 text journal · L6 reflective queue · L-S sensory atoms / vision↔field index.
Scheduler phases (`PhiLockScheduler`): L1 every tick, L4 every 13, L6 every 89, L3 every 144.

### D. Knowledge objects (`src/core/knowledge/`)

`KDocument{id, field, url, title, source, fetchedAt, chars, chunkIds}` →
`KChunk{vec (hashed semantic, VECTOR_DIM), barcode (256-bit φ-plane bitmap), tokens,
createdAt, rung, trust∈[0,1], modality, descriptor, contradicts[], prototypeOf}`.
Retrieval = Hamming prefilter (top-34) → multi-channel `RecallHit{barcode, lexical, semantic,
spread, latent (PPMI-SVD), fieldSig, resonance, band (Fibonacci age), score}` with named veto channel.

### E. Analysis / evidence artefacts

Analysis spine streams (16 Hz), association + causal scans (Pearson/Spearman/HSIC,
Granger, transfer entropy), conformal prediction intervals, abstention records,
Ed25519-signed Merkle finding ledger, Genome v2 (AES-256-GCM sealed), Ten-Sweep consolidation reports.

### F. Self-knowledge

Capability atlas (12 modules, typed ports, affordances `[SPEC]`), crossMap `edges/gaps/opportunities`,
run ledger, mistake ledger, hardware envelope, memory governor budget (0.70 of measured RAM, A3).

---

## § Target host: RAFFY U v16 — what this brain must accept and return (Ω-04)

This brain is destined to be embedded in **RAFFY U — Memory-Sovereign Intelligence Cockpit**
(React/TS cockpit + Rust deterministic API + Supabase). The map below is a **read-only audit of
the host**, recorded here so no interface is designed blind. Nothing in §§0–6 is altered by it.

### H.1 Host cognitive stack (what already occupies the "brain" slot)

| host subsystem | shape | our counterpart |
|---|---|---|
| `brain_facts` (TS, `src/brain/ontology.ts`) | append-only fact ledger: `subject_type∈{org,person,account,counterparty,contract,transaction,policy,kpi}`, `predicate`, `object_json`, `confidence`, `source∈{user,chat,import,system}`, HLC(wall,logical), `prev_hash`, SHA-256 `content_hash`, `supersedes_id`, `pinned`, `tags[]` | L5 journal + L6 knowledge, but ours is not yet hash-chained |
| recall scorer (`src/brain/recall.ts`) | 0.15·importance + 0.40·keyword + 0.30·validity + 0.15·recency (30-day half-life, floor 0.05) + 0.50·resonance + 0.25·clusterPrior, ×4 if pinned | our multi-channel `RecallHit` (strict superset of channels) |
| resonance (`src/brain/resonance.ts`) | 144-mode φ-Toeplitz signature from SHA-256 seed, λ₂ = φ, heptagonal phase, cosine ∈[−1,1] | our `fieldSignature.ts` / barcode — measured, not seeded |
| learning (`src/brain/learning.ts`) | Hebbian reinforcement Δ≤±0.25, decay toward 0.5, pin/retract via supersession, cluster centroids per (subject_type,predicate) | our `HebbianMatrix` + `Consolidator` |
| RUMF (Rust) | `Wing → Room → Drawer → DrawerEntry`; IDs = SHA3-256(content‖context‖wing‖room); trust **T0–T5** (quorum 0/1/1/2/2/3, score ×0.5/1/2/4); maturation **F1–F12**, expected = Fib(i)×60 s | our Fibonacci banding + trust field on `KChunk` |
| Hybrid Retrieval v5 | 7 factors (verbatim, temporal, trust, embedding, resonance, affinity, recency) fused by **φ-weighted geometric mean**, Fibonacci weights (1,1,2,3,5,8,13)/33, fixed-point Q60 — **no floats** | our scorer is float; a fixed-point mirror is required for host parity |
| MemoryOrchestrator | `QueryRequest{query,max_results,user_id}` → `QueryResponse{query_hash, coherence:BigNum128, tier, substrates_used[], credit_burn, credit_receipt, evidence_hash, hlc}`; merges Brain/Metatron/RUMF at φ⁻¹/φ⁻²/φ⁻³ | our engine would enter as a **substrate behind this contract** |
| tier gate | coherence < 0.2 → HALT · [0.2, φ⁻²) → APPROVE (24 h, `approval_id = SHA3-256(query_hash‖now)`) · ≥ φ⁻² = 0.3819660113 → AUTO | identical φ⁻² threshold to our ignition up-crossing |
| EvidenceBus | canonical **CBOR** + SHA3-256 + `prev_hash`, batch 100 / 500 ms, AES-256-GCM cold archive | our Merkle finding ledger + Genome v2 |
| HALT codes touching cognition | H053 maturation stalled · H054 approval timeout · H055 tier bypass · H056 autonomous change · H057 memory divergence · H058 CBOR/hash mismatch · H059 trust violation · H060 orchestration failure · H061 budget exceeded · H030/H032 credits | our corridor gate (L7) must map onto these |
| credits | `MemoryWriteT1..T5` = 1/2/4/8/16 credits (scale 10¹⁸), `MemoryRetrieve` priced, maturation treasury-funded; every burn emits an evidence event | every cognitive act in the host is **metered** |

**Determinism law of the host:** identical input + policy + HLC ⇒ identical hash
("Absolute Zero"), certified by a 10 000-cycle marathon and TLA+ specs (hash-chain integrity,
HLC monotonicity, credit conservation). Consequence for us: **L2 (no RNG, no wall-clock) is not
optional in the host; and all scoring exposed to the host must be fixed-point (BigNum128 / Q60).**

### H.2 Business information types the host processes (complete inventory)

1. **Construction projects** — `construction_projects/_branches/_employees/_vendors/_catalog_items/_revisions`, node graph `construction_nodes/_edges` with types RFI, SUBMITTAL, DRAWING, SPEC, CHANGE_ORDER, CONTRACT, DAILY_REPORT, SAFETY_RECORD, PUNCH_ITEM, VENDOR, COST_CODE, SCHEDULE_ITEM and edges REFERENCES/IMPACTS/DEPENDS_ON/CONFLICTS_WITH/SUPERSEDES/TRIGGERED_BY/BLOCKS. Contract types aia_a201/a101/subcontract/owner.
2. **Documents, drawings, specs** — PDF/CAD/IFC-referenced sheets, `drawing_sheets/_revisions`, `document_signatures`, numbering sequences, `contract_clauses` (indemnification, liquidated damages, no-damage-for-delay, insurance, bonding, notice, lien, termination), `spec_sections`, `spec_compliance_matrix`, `scope_analysis` (gap/overlap/missing). SHA-256 on upload.
3. **RFIs / submittals / change management** — status + urgency enums, submittal packages/attachments (product data, sample, test report, drawing, certification, warranty, maintenance data), compliance matrix (compliant/non-compliant/partial/not addressed), change events (rfi/ncr/field_change/directive) and change orders with line types labor/material/equipment/subcontractor/overhead/profit.
4. **Daily ops, schedule, safety** — daily reports, safety incidents (ppe, fall, struck-by, electrical, trenching) with severity, inspections (daily/weekly/monthly/incident/OSHA), periods, time entries.
5. **Cost, finance, payroll, treasury** — cost accounts, cashflow rows, burden rules, payroll class/tax maps, runs, SOP stages/approvals, invoices and line items, payment runs/approvals/payees/wallets, treasury reserve, FX rates, fuel log, organisational budgets, monthly close.
6. **Meetings and audio** — `meeting_audio_chunks` (webm/ogg/mp4/wav, streamed live), transcript segments, summaries, minutes, notes, sign-offs.
7. **Compliance, AML, legal** — KYC evidence, sanctions lists/entries, screening runs, beneficial owners, authorised signers, legal entities (12 role types), CDD tiers 0–4, DSAR requests, emergency freezes, recovery ceremonies.
8. **Identity, auth, RBAC** — profiles, `user_roles` (owner/admin/user), entity members, badge capabilities (view/edit payroll, financials, staff, vendors, projects, sign documents, reports), MFA/WebAuthn, auth audit log.
9. **Credits economy** — ledger, budgets, pricing + approvals, exchange rate, forecasts, emergency controls, overage debt, plans (freelancer/sme/enterprise), subscriptions, flash loans.
10. **Federated learning & Kaizen marketplace** — pools, rounds, contributions, marketplace listings, curator councils/votes, DP budgets + RNG seeds, ε state, SMPC commit/reveal, baselines, live/shadow attribution, reputation, drift escrow, oscillation log; Kaizen nodes/models (Ollama/vLLM/TGI/Transformers.js), LoRA adapters, evolution proposals/mutations (human-gated).
11. **Institutional memory & CAG** — RUMF tables, `institutional_memory` (decision, lesson learned, issue, solution, best practice, SOP, tribal knowledge, vendor relationship), CAG cache/registry/metrics/evidence/tier snapshots.
12. **Evidence & determinism** — evidence bus/entries, audit event log, determinism audit log, parity runs, idempotency keys, swarm evidence tails, webhook event log.
13. **Governance** — proposals/approvals/votes/owners/keys/tiers, railback (drift, bad migration, breach, deadlock, operator), emergency freeze scopes, halt state + dedup, monitoring rules/events.
14. **Integrations** — Procore (projects, timecards, costs, submittals, RFIs, observations; 30 req/min, hashed for evidence), QuickBooks, Amex, Paychex, Wesbuilt imports; Notion, Microsoft 365, Google Workspace, Slack connectors; classification public/internal/confidential/sovereign; webhooks and sync jobs.
15. **OmniConnector** — actions, approvals, invoices/lines, payment runs/items/events, settings; EN/DE/FR locales.
16. **Simulation & sandbox** — simulation runs/scenarios/fuel, sandbox runs/fuel rates/overage, chaos, compare, promote.
17. **Telemetry & security** — monitoring events/rules, LLM usage log and provider traces, skill security scans/findings, behaviour baselines/anomalies, zero-trust audit, agent identities, skill knowledge graphs.
18. **Edge / mobile / sovereign** — CBOR compact payloads for offline sync, desktop/Capacitor clients, on-prem Kaizen inference nodes.

### H.3 Pipelines the brain must sit inside

```text
field/tablet capture ─┐
Procore/QBO/Paychex ──┤  ingest + SHA-256 ─→ documents / construction_nodes
meeting audio chunks ─┤                          │
chat + user facts ────┘                          ▼
                                   recordFact() → brain_facts (HLC, prev_hash, append-only)
                                                 │
   ┌── CAG cache (query_hash) ──────────────────┤
   ▼                                             ▼
MemoryOrchestrator.query ──φ⁻¹/φ⁻²/φ⁻³ merge──→ Brain · Metatron · RUMF   ← THIS ENGINE lands here
   │                                             │
   ├─ tier gate (HALT / APPROVE / AUTO at φ⁻²)   ├─ credit burn + receipt
   └─ EvidenceBus (CBOR + SHA3-256 + prev_hash) ─┘
```

**Inbound contract we must satisfy:** accept `{query, max_results, user_id}` plus a typed
domain payload (any of H.2), return coherence in fixed-point, result set, and an evidence hash.
**Outbound obligations:** deterministic bytes, HLC stamp, `prev_hash` chaining, credit accounting,
trust tier + maturation stage on anything written into RUMF, and a HALT code rather than a guess.

### H.4 Gaps to close before porting (recorded, not yet actioned)

- G-R1 our scoring is float; the host demands **Q60 fixed-point** for anything hashed.
- G-R2 no CBOR canonical codec here; ours is JSON (see § Memory substrate transport law).
- G-R3 no HLC — our tape is tick-indexed; a wall/logical/node clock must wrap it at the boundary.
- G-R4 no SHA3-256 or Ed25519 chaining on memory writes (only on the analysis finding ledger).
- G-R5 no trust tier (T0–T5) or maturation stage (F1–F12) on L2/L3 records — `KChunk.trust` is the only trust field.
- G-R6 no credit metering on cognitive acts; every host memory write/retrieve is billed.
- G-R7 domain ontology (H.2) has no encoder here — construction artefacts must reach Ψ through a typed sensory adapter, not free text.

### Amendment log
- **Ω-04 (2026-08-21):** § Information taxonomy added (complete native information-type inventory
  with rates and resolutions). § Target host added: audited RAFFY U v16 cognitive stack, its complete
  business information inventory, its in/out pipelines, and seven recorded porting gaps (G-R1…G-R7).
  Audit only — no law, constant, module or contract in §§0–6 changed.

---

## § Module register — every file of the brain (Ω-05, re-swept Ω-07 2026-08-24)

**Law.** This register is *exhaustive by construction*: it was generated by walking
`packages/*/src`, `src/core`, `src/ui/omega`, `src/lib`, `src/routes`, `src/components` and
`test/`, and each entry carries the file's own declared purpose. Any file added to — **or removed
from** — those trees must be reflected here in the same commit, or the brainmap is out of date and
the Ω-MAP atlas may not be trusted.

**Sweep of 2026-08-24 (authoritative):** `packages/trnn-core/src` **78** ·
`packages/trnn-core/test` **35** · `packages/field-kernel-core/src` **8** · `src/core` **150**
(incl. 9 `interop/`, 30 `runtime/rhuftf/`, 24 `memory/`, 18 `sensory/`, 11 `knowledge/`) ·
`src/ui/omega` **36** (17 panels) · `src/lib` **43** (incl. 19 tool specs) · `src/routes` **7** ·
`src/components` **8** · root `test/` **20**. Total live TypeScript modules: **~350**.

**Trees that no longer exist** (Ω-07): `packages/brain-core/` (97 files), `src/context/rhuft/`
(59 prose files), `src/hooks/` (empty), and 43 unmounted `src/components/ui/*` primitives —
217 files / ≈2.5 MB removed with zero effect on engine, memory or computation.

### R1 · `packages/trnn-core/src` — the certified toroidal engine (Ω trunk)

**core/** — foundation, no dependencies upward.
| File | Purpose |
|---|---|
| `core/constants.ts` | L1, the single constants source (φ, λ=φ⁻², thresholds). |
| `core/complex.ts` | Split complex field: two `Float64Array`s (re/im), zero per-step allocation. |
| `core/determinism.ts` | Law L2 — determinism (seeded RNG, ordered reduction). |
| `core/dmath.ts` | Deterministic transcendental bank (sin/cos/exp reproducible across hosts). |
| `core/fibonacci.ts` | Fibonacci / Lucas arithmetic. |
| `core/indexing.ts` | Bounds-checked accessors (closes §4 gap). |
| `core/scaleLadder.ts` | The nested toroid stack (§2.1) — 18 rungs, node counts, golden strides. |
| `core/window.ts` | S3 Fibonacci windows and per-rung environment binding. |

**cell/** — the per-tick local law.
| File | Purpose |
|---|---|
| `cell/update.ts` | The certified nine-term cell (§2.4). |
| `cell/memory.ts` | Two-tap memory kernel `m⁺=(1−λ)m+λz⁺`, roots {1, −φ⁻²} — marginal stability. |
| `cell/closure.ts` | Closure term Π and its residual flux. |
| `cell/organs.ts` | N0/N1/N2 per-node organ bank. |

**torus/ · spectral/ · algebra/ · fractal/** — geometry and bases.
| File | Purpose |
|---|---|
| `torus/lattice.ts` | Toroidal lattices (§2.2). |
| `torus/eigenmodes.ts` | Toroidal eigenmodes on the golden ladder (§2.3). |
| `torus/superposition.ts` | Analysis/synthesis over the mode basis, CGS2-orthonormalised. |
| `spectral/sphere.ts` | Spherical shell — Fibonacci golden-spiral sampling + real harmonics. |
| `spectral/radial.ts` | Radial plane — spherical Bessel `j_l` on the golden radii. |
| `spectral/site.ts` | CGS2 spectral site where torus, shell and radial bases meet. |
| `spectral/laplacian.ts` | SHFN §A — measured spectral ground truth (graph Laplacian eigenpairs). |
| `spectral/fft.ts` | SHFN §B — the O(K log K) transform path. |
| `algebra/clifford.ts` | Ω-DEPTH §4 — Cl(3,0) 8-blade geometric-algebra channels. |
| `fractal/nest.ts` | Ω-DEPTH §2 — demand-driven fractal nesting (child fields inside spheres). |
| `fractal/pool.ts` | Ω-DEPTH §2 — fixed child-field slot pool (bounded RAM, no GC churn). |

**web/ · engine/** — cross-rung structure and the tick loops.
| File | Purpose |
|---|---|
| `web/coupling.ts` | Cross-rung coupling matrix (§3.1). |
| `web/octave.ts` | Octave transport between rungs of different node counts. |
| `web/fluxLedger.ts` | Double-entry flux ledger (§3.3) — conservation is *audited*, not assumed. |
| `web/ordering.ts` | Deterministic tick ordering, Jacobi read/write discipline. |
| `web/morphism.ts` | Structure-preserving checks for the web (§3.5). |
| `engine/SingleTorusEngine.ts` | The certified O-P1 trunk (one rung). |
| `engine/MultiTorusEngine.ts` | The web over the dense core (Ω-P3); owns `coherenceWarm`. |

**measure/** — read-only plane; nothing here ever actuates the field.
| File | Purpose |
|---|---|
| `measure/coherence.ts` | Coherence functionals. |
| `measure/state.ts` | Field readouts + corridor gate (§2.6). |
| `measure/transcription.ts` | 13-dimensional spectral signature per tick — the transcription tape. |

**sense/ · memory/** — intake and the engine-side memory planes.
| File | Purpose |
|---|---|
| `sense/encode.ts` | Sensory encoders (modality → field-compatible complex frame). |
| `sense/fusion.ts` | Multi-modal fusion. |
| `sense/plane.ts` | The sensory plane. |
| `sense/nodeArray.ts` | N1 — the Sensory Node Array (SNA). |
| `sense/scan.ts` | N1 — the six-section toroid scan (basis of the 18-rung certification). |
| `memory/braid.ts` | Ω-P6 TorusBraid Hopfield plane (attractor recall). |
| `memory/turingTape.ts` | N4 — Zeckendorf-addressed read/write tape, the permanent processing layer. |

**substrate/** — Ω-REAL measurement stack (symbols → measured computation).
| File | Purpose |
|---|---|
| `substrate/phiSubstrate.ts` | P0 — Class-A substrate parity. |
| `substrate/coherenceKernel.ts` | P1 — φ-delayed memory kernel, innovation-form coherence C(t). |
| `substrate/signalStats.ts` | P2 L1 — moments, stationarity, effective sample size. |
| `substrate/correlation.ts` | P2 L2 — Pearson / Spearman / distance-correlation / MI. |
| `substrate/causal.ts` | P2 L3 — directed dependence (Granger, transfer entropy). |
| `substrate/resonanceBus.ts` | P4 — the abstention-aware fusion law, stated once. |
| `substrate/vsa.ts` | P5 — Fourier HRR hypervectors over the phase plane. |
| `substrate/plasticity.ts` | P5 — memristive + Oja learning for the L1 associative store. |
| `substrate/dmd.ts` | P5 — Dynamic Mode Decomposition over L0 trajectories. |

**learn/ · sweeps/ · harness/ · ledger/ · genome/ · runtime/ · cognition/**
| File | Purpose |
|---|---|
| `learn/params.ts` | Constrained parametrisations (stability-preserving by construction). |
| `learn/cell.ts` | The learnable cell term. |
| `learn/spectralFilter.ts` | SHFN §C Path A — learnable dispersion filter α(λ_k). |
| `learn/mixer.ts` | SHFN §D Path B — the superposition mixer. |
| `learn/spectralAttention.ts` | SHFN §E Path C — cross-spectral phase attention. |
| `learn/tiers.ts` | The four honest execution tiers (what may learn at which cost). |
| `learn/battery.ts` | The learning battery (pass/fail before a tier may run live). |
| `sweeps/tenSweep.ts` | The Ten-Sweep Consolidation Protocol. |
| `harness/golden.ts` | Golden regression set. |
| `harness/abstention.ts` | Abstention correctness. |
| `harness/battery.ts` | Standing abstention battery. |
| `harness/conformal.ts` | Adaptive Conformal Inference (ACI) intervals. |
| `harness/latency.ts` | Proof latency. |
| `harness/certify.ts` | The certification gate — green or the phase does not open. |
| `ledger/canonical.ts` | Canonical JSON — the exact bytes the ledger hashes. |
| `ledger/merkle.ts` | RFC-6962 append-only log, inclusion + consistency proofs. |
| `ledger/sth.ts` | Signed Tree Heads, Ed25519 over the canonical head. |
| `genome/record.ts` | Genome v2 — sealed, provenanced, append-only knowledge records. |
| `runtime/profiles.ts` · `hardware.ts` · `governor.ts` · `calibrate.ts` · `runLedger.ts` · `host.ts` · `views.ts` | Capacity profiles, measured hardware probe, the governor, the measurement harness, the run ledger, the engine host (`MEMORY_STRIDE`, `MIND_STRIDE`, `LearnRun`), read-only views. |
| `cognition/mind.ts` | Ω-P7 — turns engine observations into thoughts; `NOVELTY_THRESHOLD`. |
| `cognition/concepts.ts` | Concept store — HNSW over product-quantised embeddings. |
| `cognition/selfModel.ts` | Self-model (`DiagonalSSM`, `DiagonalRLS`) + the baseline allowed to kill it. |
| `index.ts` | The public surface (barrel). |

### R2 · ~~`packages/brain-core/src`~~ — REMOVED under Ω-07 (2026-08-24)

The 97-file `brain-core` package (v13 RHUFT ontology chapters, the Fractal Node Engine, the V14
13-node field substrate, the `cognition/` Mind, the `adapters/` language instruments, 5 `.wl`
certificates, 3 JSON schemas) has been deleted. It was ~1.8 MB and **not reachable from any live
path**: no route, deck, driver, worker or server function imported it, and its Vite/tsconfig
aliases were removed with it.

**Where each capability actually lives now** (nothing was lost, only de-duplicated):

| Former `brain-core` capability | Live owner today |
|---|---|
| 13-node spectral tile, λ-SSM spine | `trnn-core/cell/{update,closure,memory,organs}.ts` (certified 9-term cell) |
| eigenmode attention over mode tokens | `trnn-core/learn/spectralAttention.ts`, `learn/spectralFilter.ts` |
| Fibonacci ring of tiles, φ-transport, stack | `trnn-core/torus/lattice.ts`, `web/{coupling,morphism,octave,ordering,fluxLedger}.ts` |
| coherence-gated JEPA plasticity | `trnn-core/learn/tiers.ts` + `substrate/plasticity.ts` (memristive) |
| Hopfield / HNSW / PQ associative memory | `src/core/knowledge/{LatentSpace,BarcodeIndex,ConceptGraph}.ts`, `trnn-core/substrate/vsa.ts` |
| concept registry, glossary, lexicon | `trnn-core/cognition/concepts.ts`, `src/core/knowledge/{KnowledgeBase,LexicalIndex}.ts` |
| word → field placement / field → word readout | `src/core/gematria/lexeme.ts` (`lexemePattern`, hashed k-of-N rungs), `src/core/knowledge/lexicon.ts` (`LexiconMemory.readPsi`) |
| word associations (W2) / meaning by shared contexts (W3) | `src/core/knowledge/lexicon.ts` (`LexiconMemory.associate`, `meaning`, `similar` — PPMI over co-occurrence); `MemoryStore.associate` joins episodes |
| cognitive loop, thought, drive arbiter | `trnn-core/cognition/{mind,selfModel}.ts` + `src/ui/omega/omegaRuntime.ts` drive edges |
| prediction ledger, novelty gate | `src/core/analysis/findingLedger.ts`, `analysisSpine.ts` (with abstention) |
| language instrument / codec adapters | `src/lib/chat/*` + `src/core/interop/intake.ts` (text → 28-dim field vector) |
| sensor bus, vision/audio/text feeds | `src/core/sensory/*` (gateway, cortices, frontends, worker) |
| validated state + JSONL journal | `src/core/memory/{MemoryPersistence,TextJournal,typedJson}.ts` |
| coupled governor / hardware probe | `src/core/runtime/{ResourceGovernor,HardwareEnvelope,computeBench}.ts`, `trnn-core/runtime/*` |
| `.wl` Wolfram certificates | the live gate battery (`s2`, `r5`, `r6`, `r8`, `f1`) |

Evidence of no regression: after removal, `tsgo --noEmit` reports 0 errors, the production build
succeeds, all 830 remaining assertions pass, and the app renders with zero runtime errors.

### R3 · `packages/field-kernel-core/src` — the shard kernel
`kernel.ts` (unified field kernel), `state.ts`, `localUpdate.ts`, `measurement.ts`,
`lyapunov.ts` (per-shard descent certificate), `cos.ts`, `portFlags.ts`, `index.ts`.

### R4 · `src/core` — the application brain

**Field / frameworks / RHUFT numerics.** `MetatronCore.ts` (unified analytic core — Ω fusion,
reported separately from measured field coherence), `field/Reflect.ts` (Ψ-of-Ψ), `field/Qualia.ts`,
`field/QualiaCorrelate.ts`; `frameworks/F1_Septenary…F9_HyperGalactic` + `frameworks/constants.ts`;
`rhuft/PhiLadder.ts`, `LadderBinding.ts`, `LucasClosure.ts`, `ExactIdentities.ts` (60-digit
BigInt fixed point), `Thermal.ts`; `constants/Chapter47.ts`, `constants/WolframVerified.ts`;
`numerics/StableSum.ts` (compensated summation — the ordered-reduction law);
`residuals/ChapterResiduals.ts`, `residuals/Stability.ts`.

*(Ω-07: `field/QRF.ts`, `field/Torus.ts`, `field/SelfMeasure.ts`, `numerics/Real.ts`,
`harmonic/RecursiveOctave.ts`, `stability/CrystallinePLL.ts`, `recursion/MemoryFeedback.ts` were
removed — each was import-dead, and each function is carried by a certified `trnn-core` module:
`torus/lattice`, `torus/superposition`, `measure/state`, `core/dmath`, `web/octave`,
`substrate/phiSubstrate`, `memory/braid` respectively.)*

**V12 audit bank (independent checker, not a driver).** `v12/audit/LyapunovBank.ts` (descent
certificates), `WolframBankWave2.ts`, `wave2Precision.ts`, `F2Provenance.ts`.
*(Ω-07: the `v12/MasterUpdate.ts` / `MasterUpdateController.ts` / `ExistenceGate.ts` /
`TriadicValue.ts` / `SelfValidationRHUFT.ts` wrappers were removed — the canonical Ψ_{t+1} is
`trnn-core/cell/update.ts` + `cell/closure.ts`, reached through `MultiTorusEngine`. §5 R-1 closed:
the trunk cell is the single master update, and `v12/audit/` audits it from outside.)*

**Runtime (14 files + `rhuftf/`).** `runtime/ResourceGovernor.ts` (sovereign), `governorSingleton.ts`,
`HardwareEnvelope.ts` (0.70 RAM budget under Ω-DEPTH), `computeBench.ts`, `PhiLockScheduler.ts`
(one φ-phase scheduler for every memory layer), `WorkerPool.ts`, `workerPoolFallback.ts`,
`fieldKernel.worker.ts`, `ShadowStateTape.ts` (rollback/replay shadow), `Chapter47.ts`,
`portFlags.ts`; **`runtime/rhuftf/`** — nine `F*LocalUpdate.ts` + nine `F*Measurement.ts` kernels
(n = 0…8), plus `localUpdateKernel.ts`, `localUpdateRegistry.ts`, `registry.ts`,
`ScaleMeasurement.ts`, `LadderProjection.ts`, `eigenmodes.ts`, `phiModes.ts` (project, don't
push), `contraction.ts` (contract first, compose second), `conjugate.ts` (φ-conjugate dual pass),
`omega.ts` (geometric-mean fusion), `torusClosure.ts` (close the loop, audit the ring).

**Sensory (`sensory/`).** `SensoryGateway.ts` (L-S content-addressed intake), `SensoryCortex.ts`
(fuses every modality through a governor-sized `PhiLattice.ts`), `SensoryAtom.ts`,
`SimHashPhi.ts`; audio: `AudioCortex.ts`, `AudioFrontend.ts`, `MelFilterbank.ts`; video/screen:
`VideoCortex.ts`, `VideoFrontend.ts`, `ScreenFrontend.ts`, `sensoryFrame.worker.ts`; vision
embedding: `VisionEncoder.ts`, `VisionEmbedFrontend.ts`, `VisionProjection.ts`; motion:
`IMUFrontend.ts`; bridge: `sensoryFieldBridge.ts`.

**Memory (`memory/`).** Layers L0–L6 + governance: `FieldTape.ts` (L0 ring),
`HebbianMatrix.ts` (L1), `EpisodicStore.ts` (L2), `FibonacciPatterns.ts` (L3),
`PathwayGraph.ts` (L4), `TextJournal.ts` (L5), `ReflectiveIndex.ts` (L6);
`MemoryStore.ts` (facade), `MemoryCaptureKernel.ts` (per-tick capture), `tickMemory.ts`
(MetatronOutput → capture), `MemoryGovernor.ts`, `MemoryPolicy.ts`, `MemoryPersistence.ts`,
`typedJson.ts` (the transport law: typed arrays survive JSON), `Banding.ts` (Fibonacci age
bands), `Consolidator.ts` (experience → structure), `Resonance.ts` (how strongly a memory
answers the live field), `Weave.ts` (reconstruct a *moment*), `Trajectory.ts` (what the field was
doing around a moment), `TapeDmd.ts` (DMD over L0), `PatternBitmapIndex.ts`,
`PerceptRegistry.ts`, `VisionFieldIndex.ts`, `LearningEngine.ts` (error-driven learning atop the
layers).

**Knowledge (`knowledge/`).** `KnowledgeBase.ts` (local-first corpus + recall cascade),
`Acquisition.ts`, `LocalArchive.ts` (on-device persistence), `LexicalIndex.ts` (BM25),
`LatentSpace.ts` (distributional semantics), `BarcodeIndex.ts` (Fibonacci-stride LSH banding),
`ConceptGraph.ts` (Hebbian co-occurrence), `fieldSignature.ts` (SHFN §G memory ↔ field bridge),
`genome.ts` (genome contract + measured health), `tokenize.ts` (deterministic tokenizer + hashed
semantic vector), `types.ts`.

**Gematria / geometry / OCR.** `gematria/zphi.ts` (exact Z[φ] ring), `zeckendorf.ts` (unique
Fibonacci addressing), `residue.ts` (residue fingerprints), `bitmap.ts` (multi-plane field
bitmap), `resonanceKernel.ts` (Certificate 2), `index.ts`; `geometry/parse.ts` (CAD/BIM/mesh →
primitives), `descriptors.ts`, `index.ts`; `ocr/ocrLadder.ts` (three measured tiers, no silent
fallback).

**Analysis / self / bus / omega.** `analysis/channelSampler.ts` (channel taps), `streamWindow.ts`
(causal, monotone, aligned windows), `analysisSpine.ts` (L1 stats / L2 association / L3 causality
with explicit abstention), `findingLedger.ts` (RFC-6962 leaves + Ed25519 signed tree head),
`consolidation.ts` (Ten-Sweep promotion into Genome v2); `self/atlas.ts` (Capability Atlas),
`self/crossMap.ts`, `self/types.ts`; `bus/protocol.ts`, `bus/EngineBus.ts`;
`omega/omega.worker.ts`, `omega/omegaProtocol.ts`.

**Interop (`interop/`) — the transplant seam.** `contract.ts`, `bn128.ts`, `rumf.ts`,
`evidence.ts`, `tierGate.ts`, `recall.ts`, `intake.ts`, `facade.ts`, `index.ts`. Full law table in
§ Transplant seam below.

*(Ω-07 corrections to this register: `bus/FallbackEngine.ts`, `bus/useEngine.ts` and
`context/RhuftLibrary.ts` were removed — the last together with the 59-file `src/context/rhuft/`
prose corpus, which no live path read. The RHUFT ontology now lives only where it is computed:
`src/core/rhuft/`, `src/core/runtime/rhuftf/` and `packages/trnn-core`.)*

### R5 · `src/ui/omega` — drive edges and decks
Drivers: `omegaRuntime.ts`, `useOmegaRuntime.ts`, `useOmegaPull.ts`, `engineProjection.ts`
(4 Hz truth for engine state), `memoryDriver.ts` (64 Hz substrate drive), `memoryRuntime.ts`,
`useMemoryRuntime.ts`, `memoryBridge.ts`, `sensoryDriver.ts` (IMU 377 / audio 233 / video 89 Hz),
`useSensoryDriver.ts`, `analysisRuntime.ts` (16 Hz), `useAnalysisRuntime.ts`,
`knowledgeRuntime.ts`, `fieldContext.ts`, `fieldViewStore.ts`, `selfRegistry.ts`,
`OmegaEngineShim.tsx`. Shell + decks: `OmegaWorkstation.tsx`, `FieldStage.tsx`, and panels
`Field`, `Ladder`, `Engine`, `Web`, `Spectral`, `Sense`, `Memory`, `Mind`, `Learn`, `Analysis`,
`Self`, `Cognition`, `Toroid`, `Multimodal`, `Integrations`, `Kokoro`, `SourceChip`.

### R6 · `src/lib` + `src/routes` — language, tools, transport
`chat/systemPrompt.ts` (evidence-only, agentic), `client.ts` (SSE + tool dispatch),
`engineSnapshot.ts`, `memoryPack.ts`, `selfPack.ts`, `sessions.ts`, `chatSettings.ts`,
`toolMarkers.ts`, `types.ts`; tools: `registry.ts`, `intelMeta.ts`, `intel.server.ts`,
`handlers.server.ts`, `dispatch.functions.ts`, `health.functions.ts`, `toolPrefs.ts`, and 18
`specs/*.json` (arxiv, crossref, pubmed, semantic_scholar, wikidata, wolfram, github, hackernews,
reddit, newsapi, openweather, nasa_donki, osm_geocode, wayback, ipfs, http_probe, shodan,
virustotal, abuseipdb). Also `tts/kokoro.ts`, `persist/flush.ts`, `diagnostics/crashLogger.ts`,
`error-capture.ts`, `themes.ts`. Routes: `__root.tsx`, `index.tsx`, `download.tsx`,
`api/chat.ts`, `api/kimi.ts`, `api/ocr.ts`, `api/public/omega-train.ts`.

### R7 · Certification files (the brain is only as true as its gates)
`packages/trnn-core/test/`: `s0…s5` (oracle, measurement, constants, window, ISS, dmath,
environment), `g0…g8` (foundation → learning), `a0` laplacian, `b0` fft, `b1` EFIT,
`f0` nesting, `f1` clifford, `n0` organs, `n1` sensory nodes, `n2` the 18-rung scan,
`r0…r8` (substrate parity, innovation coherence, correlation, causal, resonance bus,
VSA/plasticity/DMD, ledger/genome, ten-sweep, harness), `w2` warm coherence, `oracle.ts`.
Root `test/` (20 files): `analysis/p9-*` (spine, sampler, consolidation, finding ledger),
`interop/` (`i1` contract, `i2` transport, `i3` learning proof), `memory/` (`m9` substrate,
`m10` snapshot round-trip, `b1` tape readback, `p5` L1↔L0 port, `s1` RAM governor,
`s3` multiscale), `self/o1-atlas`, `sense/a1-sense-intake`, `wake/w1-drive-edges`, `geometry`,
`omega-field-signature`, `omega-vec`, `self-genome`.

**Standing total (2026-08-24): 55 test files, 830 assertions, all green; `tsgo --noEmit` 0 errors;
production build succeeds.** The former `packages/brain-core/test/field.test.ts` (29 assertions)
left the tree with its package under Ω-07 — the only deliberate assertion-count reduction in the
brain's history, and it covered no live path.

---

## § Reasoning, learning and memory logic — how the parts actually think (Ω-05)

### L-A. The reasoning chain (one live pass, end to end)
1. **Intake** — `SensoryGateway` content-addresses each frame (`SimHashPhi`) from
   audio 233 Hz / video 89 Hz / IMU 377 Hz / screen / text / images; `SensoryCortex` fuses them
   over a governor-sized `PhiLattice` into one complex field frame.
2. **Field step** — `trnn-core/cell/update.ts` (the certified nine-term cell) plus
   `cell/closure.ts` (closure Π) advance Ψ on every instantiated rung, driven by
   `engine/MultiTorusEngine.ts`; `web/coupling.ts` moves energy across rungs and
   `web/fluxLedger.ts` double-entry audits it. (Ω-07: the former `src/core/v12/MasterUpdate.ts`
   wrapper is gone — the trunk cell *is* the master update; only `v12/audit/` remains, as the
   independent Lyapunov/Wolfram bank that checks it.)
3. **Measure, never actuate** — `measure/state` + `coherence` + `transcription` produce the
   13-dim per-tick signature, C(t), Λ, κ-closure. Cold rungs are excluded via `coherenceWarm`;
   analytic Ω (MetatronCore) is reported separately from measured field coherence.
4. **Analyse** — `channelSampler` → `streamWindow` (causal, monotone, aligned) → `analysisSpine`
   runs Level-1 stats, Level-2 association (Pearson/Spearman/dCor/MI) and Level-3 causality
   (Granger, transfer entropy), each with an explicit **abstain** verdict when n or stationarity
   is insufficient.
5. **Fuse** — `resonanceBus` combines only non-abstaining channels under one stated law.
6. **Seal** — `findingLedger` canonicalises the pass, appends the RFC-6962 leaf and publishes an
   Ed25519 signed tree head; nothing may be edited or reordered afterwards.
7. **Consolidate** — `consolidation.ts` drives the **Ten-Sweep** protocol, promoting sealed
   findings into Genome v2 records with provenance.
8. **Recall & speak** — `KnowledgeBase` recall cascade (barcode Hamming prefilter → lexical BM25
   → latent → field-signature resonance), packed by `memoryPack` / `selfPack` into the chat turn;
   `linguistic_gate` measures any model-produced words before they are believed.

**Reasoning invariants.** Abstention is a first-class verdict; conformal intervals (`harness/
conformal`) bound every reported estimate; no claim leaves the system without a ledger leaf.

### L-B. Learning — four honest tiers (`learn/tiers.ts`)
| Tier | What adapts | Gate |
|---|---|---|
| T0 passive | statistics, banding, salience thresholds | always on |
| T1 associative | `HebbianMatrix`, memristive/Oja `plasticity` | coherence gate |
| T2 spectral | dispersion filter α(λ_k), superposition mixer, cross-spectral attention | `learn/battery` green |
| T3 structural | cell term parameters (`learn/cell`, `learn/params` constrained so stability is preserved by construction) | full certification (`harness/certify`) |
Supporting machinery: `field/learning.ts` (coherence-gated JEPA-style plasticity),
`LearningEngine.ts` (error-driven), `selfModel.ts` (DiagonalSSM + RLS predictor, with a baseline
that is *allowed to kill it*), `prediction_ledger.ts` (mastery = verified prediction, not
confidence), `dmd.ts`/`TapeDmd.ts` (mode discovery over trajectories).

### L-C. Memory — seven planes, one transport law
L0 `FieldTape` (continuous Ψ ring) → L1 `HebbianMatrix` (sparse co-activation) →
L2 `EpisodicStore` (salience-triggered snapshots) → L3 `FibonacciPatterns` (Fibonacci-tick
patterns) → L4 `PathwayGraph` (pattern→pattern transitions) → L5 `TextJournal` (append-only,
IndexedDB) → L6 `ReflectiveIndex` (re-measurement queue); plus L-S `SensoryGateway` beneath and
the knowledge/genome plane above. Access paths: `Resonance` (live-field answer strength),
`Weave` (reconstruct a moment), `Trajectory` (its dynamics), `Banding` (Fibonacci age selection),
`Consolidator` (experience → structure), all scheduled by one `PhiLockScheduler` and capped by
`MemoryGovernor` ← sovereign `ResourceGovernor` (0.70 working budget).
**Transport law (Ω-03):** typed arrays never survive `JSON.stringify` intact — every `restore()`
must go through `typedJson.ts` coercion, and snapshot round-trips must be byte-identical
(certified by `test/memory/m10-snapshot-roundtrip.test.ts`).

### L-D. Business logic — what the brain must do inside RAFFY U v16
The host's own stack (`brain_facts`, RUMF wings/rooms/drawers, T0–T5 trust tiers, F1–F12
maturation, Hybrid Retrieval v5, `MemoryOrchestrator`, the φ⁻² tier gate, `EvidenceBus`, HALT
codes, credit pricing) is inventoried in § Target host above. The mapping this brain provides:
- **Trust T0–T5** ⇄ verdict + conformal interval + ledger leaf; a fact may only rise a tier when
  a sealed finding supports it, and HALT codes map to `abstain`.
- **RUMF wings/rooms/drawers** ⇄ `ConceptGraph` + `BarcodeIndex` banding; a drawer is a barcode
  band, a room a concept cluster, a wing a genome domain.
- **Hybrid Retrieval v5** ⇄ the recall cascade in L-A step 8 (barcode → BM25 → latent → field
  resonance), with the φ⁻² gate applied at fusion in `resonanceBus`.
- **F1–F12 maturation** ⇄ the four learning tiers plus `prediction_ledger` verification counts.
- **EvidenceBus** ⇄ `findingLedger` signed tree heads (external verifiers need only the head).
- **Credit pricing** ⇄ `harness/latency` proof-latency budgets and the governor's tier caps.
The 18-domain business information inventory and the seven porting gaps (G-R1…G-R7) remain as
recorded in § Target host; nothing in this register changes them.

### Amendment log
- **Ω-05 (2026-08-21):** § Module register added — complete, sweep-generated file inventory of
  every brain module (`trnn-core`, `brain-core`, `field-kernel-core`, `src/core`, `src/ui/omega`,
  `src/lib`, `src/routes`, all test batteries) with each file's declared purpose; plus
  § Reasoning/learning/memory logic (the live reasoning chain, the four learning tiers, the seven
  memory planes and the transport law) and the business-logic mapping into RAFFY U v16.
  Documentation only — no law, constant, module or contract changed.

## § Transplant seam — `src/core/interop/` (Ω-06, 2026-08-22)

The brain is now transplantable. Everything the host touches passes through ONE directory; no
host module reaches into field math, and no Ω module needs to know the host exists.

| File | Law it carries |
| --- | --- |
| `contract.ts` | Canonical CBOR (RFC 8949 deterministic encoding), the SHA3-256 hash law, HLC v2.1 timestamps (physical ms · logical counter · node id), content-derived deterministic IDs. |
| `bn128.ts` | `BigNum128` 10^18 decimal fixed point and the host merge law: a **φ-weighted geometric mean** via Q60 log2/exp2 with saturating arithmetic — bit-identical to the host orchestrator, not an arithmetic-mean approximation. |
| `rumf.ts` | Wing / Room / Drawer ID laws (labels hash as strings, drawers hash decoded hex bytes — the asymmetry is the host's and is preserved), plus the F1–F12 Fibonacci maturation ladder and its expected durations. |
| `evidence.ts` | `BrainFact` envelopes, deterministic sealing, Merkle-linked `EvidenceChain` and full `verifyChain` replay. |
| `tierGate.ts` | The single admission law reconciling Ω learn tiers with host trust levels T0–T4. Fail-closed: absent evidence means refusal, never optimism. |
| `recall.ts` | The host `SCORE_WEIGHTS` mirror (keyword, validity, recency, importance) with resonance kept strictly **additive** — callers without a field score are numerically unchanged. |
| `intake.ts` | Typed host fact → 28-element field vector: SHA3-derived signed feature hashing, φ-decayed token weights, L2-normalised, key-order independent. One projection shared by facts and free text. |
| `facade.ts` | `IMetatron` — the only interface the host implements against, with explicit abstention (reasons attached) whenever the engine is dormant or the gate is below the requested trust. |
| `index.ts` | The sole export surface. |

**Determinism law (R1):** no `Math.random()` anywhere on an intake or memory path. Sensory atom
eviction uses a golden-ratio Weyl cursor, so two machines fed the same stream hold the same
substrate — the precondition for any of the above hashes meaning anything.

**Certification.** `test/interop/i1-contract.test.ts` (contract, fixed point), `i2-transport.test.ts`
(RUMF, evidence, gate, recall, facade — host vectors quoted verbatim from the Rust source),
`i3-learning-proof.test.ts` (the end-to-end proof: an untrained store abstains at T0; after a
host-shaped fact book is presented on the Fibonacci ladder every fact recalls with positive
cosine, seen beats unseen, two runs are byte-comparable, and the book leaves Ω as a verified
chain with collision-free drawer IDs).

**Substrate law worth stating plainly:** L3 consolidates only on Fibonacci ticks. A fact presented
off-ladder is, by design, not yet a memory — host intake must respect the ladder rather than
assume every write lands.

### Amendment log addendum
- **Ω-06 (2026-08-22):** § Transplant seam added; `intake.ts` created and exported; the RUMF
  Fibonacci helper corrected to the host's `fibonacci` definition (F(0)=0, F(1)=F(2)=1) — the
  previous helper was one index ahead, so F8 read 780s instead of the host's 1260s. No field math,
  no constant and no memory law changed.

### R8 · Exact filenames for the families abbreviated above
**`src/core/frameworks/`:** `F1_Septenary.ts`, `F2_Quantum.ts`, `F3_Atomic.ts`,
`F4_Geometric.ts`, `F5_ColorMusic.ts`, `F6_Hebrew.ts`, `F7_Galactic.ts`, `F8_SubPlanckian.ts`,
`F9_HyperGalactic.ts`, `constants.ts`.

**`src/core/runtime/rhuftf/` local updates:** `F1SeptenaryLocalUpdate.ts`,
`F2QuantumLocalUpdate.ts`, `F3AtomicLocalUpdate.ts`, `F4GeometricLocalUpdate.ts`,
`F5ColorMusicLocalUpdate.ts`, `F6HebrewLocalUpdate.ts`, `F7GalacticLocalUpdate.ts`,
`F8SubPlanckianLocalUpdate.ts`, `F9HyperGalacticLocalUpdate.ts`.
**…measurements:** `F1SeptenaryMeasurement.ts`, `F2QuantumMeasurement.ts`,
`F3AtomicMeasurement.ts`, `F4GeometricMeasurement.ts`, `F5ColorMusicMeasurement.ts`,
`F6HebrewMeasurement.ts`, `F7GalacticMeasurement.ts`, `F8SubPlanckianMeasurement.ts`,
`F9HyperGalacticMeasurement.ts`.

**`src/ui/omega/panels/`:** `FieldDeckPanel.tsx`, `LadderDeckPanel.tsx`, `EngineDeckPanel.tsx`,
`WebDeckPanel.tsx`, `SpectralDeckPanel.tsx`, `SenseDeckPanel.tsx`, `MemoryDeckPanel.tsx`,
`MindDeckPanel.tsx`, `LearnDeckPanel.tsx`, `AnalysisDeckPanel.tsx`, `SelfDeckPanel.tsx`,
`CognitionPanel.tsx`, `ToroidScanPanel.tsx`, `MultimodalDeck.tsx`, `IntegrationsView.tsx`,
`KokoroPanel.tsx`, `SourceChip.tsx`.

**`src/lib/chat/tools/specs/`:** `arxiv_search.json`, `crossref.json`, `pubmed.json`,
`semantic_scholar.json`, `wikidata.json`, `wolfram.json`, `github_search.json`,
`hackernews.json`, `reddit.json`, `newsapi.json`, `openweather.json`, `nasa_donki.json`,
`osm_geocode.json`, `wayback.json`, `ipfs.json`, `http_probe.json`,
`shodan_host_search.json`, `virustotal.json`, `abuseipdb.json`.

**`src/lib/` remainder:** `utils.ts`, `error-page.ts`, `tts/kokoroPrefs.ts`.

**`src/core/interop/`:** `contract.ts`, `bn128.ts`, `rumf.ts`, `evidence.ts`, `tierGate.ts`,
`recall.ts`, `intake.ts`, `facade.ts`, `index.ts` (the sole export surface — restored under Ω-07).

**`src/components/`:** `ui/popover.tsx`, `ui/slider.tsx`, `ui/switch.tsx`, `v11/EngineContext.tsx`,
`v11/chat/ChatSettingsPopover.tsx`, `v11/chat/ToolsPanel.tsx`, `v11/legacy/ThemeProvider.tsx`,
`v11/panels/KokoroTTSPanel.tsx`. (43 unused shadcn primitives were removed under Ω-07; only the
three actually mounted by the decks remain.)

*(The five `brain-core/src/formal/*.wl` Wolfram certificates left the tree with that package under
Ω-07. Their content is superseded by the live gate battery: `s2-constants`, `r6-ledger-genome`,
`f1-clifford`, `r5-vsa-plasticity-dmd`, `r8-harness`.)*

---

## § Live data-flow map (Ω-07, 2026-08-24) — the whole brain in one pass

```text
  HOST / WORLD
      │  facts, text, files, screen, mic, motion
      ▼
[interop/intake.ts]────────────► 28-dim L2-normalised field vector (SHA3 feature hashing, φ-decay)
      │                                    (deterministic: key-order independent, no Math.random)
      ▼
[sensory/SensoryGateway]  content-address (SimHashPhi) · golden-Weyl eviction cursor
      │   audio 233 Hz · video 89 Hz · IMU 377 Hz · screen · text · images
      ▼
[sensory/SensoryCortex + PhiLattice]  one fused complex field frame  (governor-sized)
      │
      ▼
[trnn-core/engine/MultiTorusEngine]  ── per rung, per tick ──────────────────────────────┐
      │   cell/update (9 terms) → cell/closure (Π) → cell/memory → cell/organs           │
      │   web/coupling (cross-rung energy) ⇄ web/fluxLedger (double-entry audit)         │
      │   spectral/{fft,laplacian,radial,site,sphere} · torus/{lattice,eigenmodes,       │
      │   superposition} · algebra/clifford (Cl(3,0)) · fractal/{nest,pool}              │
      └──────────────────────────────────────────────────────────────────────────────────┘
      │
      ├──► [measure/*]  READ-ONLY plane: state · coherence (warm-gated) · transcription
      │        13-dim per-tick signature, C(t), Λ, κ-closure    (never actuates)
      │
      ├──► [src/core/MetatronCore]  analytic Ω fusion — reported SEPARATELY from measured C(t)
      │
      ├──► [memory] L0 FieldTape ring → L1 HebbianMatrix → L2 EpisodicStore →
      │        L3 FibonacciPatterns (consolidates ONLY on Fibonacci ticks) →
      │        L4 PathwayGraph → L5 TextJournal → L6 ReflectiveIndex
      │        governed by MemoryGovernor (0.70 envelope) + PhiLockScheduler
      │        transported by typedJson.ts (byte-exact typed-array round-trip)
      │
      ├──► [knowledge] fieldSignature → genome (binding vector + 256-bit barcode) →
      │        BarcodeIndex (Hamming prefilter) → KnowledgeBase recall cascade
      │
      └──► [analysis] channelSampler → streamWindow (causal/monotone/aligned) →
               analysisSpine  L1 stats │ L2 association (Pearson/Spearman/dCor/MI) │
                              L3 causality (Granger, transfer entropy)
               every level may ABSTAIN (insufficient n or non-stationary)
                   │
                   ▼
             substrate/resonanceBus  (fuses non-abstaining channels only)
                   │
                   ▼
             findingLedger  RFC-6962 leaf + Ed25519 signed tree head  (append-only)
                   │
                   ▼
             consolidation  Ten-Sweep → Genome v2 records with provenance
                   │
                   ▼
             interop/evidence  BrainFact envelope → Merkle EvidenceChain → verifyChain
                   │
                   ▼
             interop/tierGate  T0–T4 admission, FAIL-CLOSED   ──► interop/facade (IMetatron)
                                                                       │
                                                                       ▼
                                                              HOST answer or explicit
                                                              ABSTENTION with reasons
```

**Two independent audit paths cross this flow and never sit inside it:**
`v12/audit/*` (Lyapunov descent + Wolfram precision banks) and `packages/field-kernel-core`
(per-shard `lyapunov.ts` certificate). Both observe; neither drives.

**Rates, stated honestly.** Drive edges: `engineProjection` 4 Hz (engine truth),
`memoryDriver` 64 Hz (substrate), `analysisRuntime` 16 Hz, sensory drivers at their native
233 / 89 / 377 Hz. Nothing else claims a rate it cannot sustain under the governor.

---

## § Amendment Ω-07 (2026-08-24) — the clean sweep, and what it means for truth

**What changed.** 217 files (≈2.5 MB) were removed: the unreachable `packages/brain-core/`
(97 files), the `src/context/rhuft/` prose corpus (59 files) with its `RhuftLibrary.ts` loader,
20 import-dead engine-adjacent modules under `src/core`, 43 unmounted shadcn primitives, and an
empty `src/hooks/`. Two candidates were *proved live* mid-sweep and restored: `src/core/v12/audit/`
and `runtime/ShadowStateTape.ts`.

**What was restored in this amendment.** `src/core/interop/index.ts` — the seam's declared sole
export surface — had been swept as unreferenced. It is a *contract* file (hosts import it, this
repo does not), so unreferenced-ness is expected and is not evidence of deadness. Restored and
typechecked. **Standing rule:** files whose only consumers are outside this repo
(`interop/index.ts`, `facade.ts`, `routes/api/public/*`) are exempt from reachability pruning.

**Effect on this document.** §3, R2, R4, R7, R8 and the register counts above were corrected in
the same change — the brainmap had drifted, describing 97 `brain-core` files and 11 `src/core`
modules that no longer exist. It is now byte-consistent with a live filesystem sweep.

**Verification.** 55 test files / 830 assertions green · `tsgo --noEmit` 0 errors · production
build succeeds · preview renders with zero runtime errors. One deliberate assertion-count
reduction (−29, `brain-core/test/field.test.ts`) covering no live path; no other test lost.

**No law, constant, contract, gate, memory tier or field term was altered.**

---

## § Ω-08 — the operator layer (2026-08-31)

**What was added.** `packages/trnn-core/src/operator/` — six modules, exported as the namespaced
barrel `operator.*` so that generic names (`derivative`, `resample`, `l2`) can never collide with
the root surface. The mathematics is re-derived from the neural-operator literature
(FNO / SFNO reference implementations) in deterministic TypeScript. **No Python, torch, or new
dependency entered the repository, and none can:** the runtime is an edge Worker.

| Module | Role |
|---|---|
| `fourierDiff.ts` | Exact spectral calculus `∂ᵐ = ℱ⁻¹{(ik)ᵐ f̂}` on the periodic ring; Nyquist bin zeroed for odd orders; `dPhiModes` gives the golden-direction derivative diagonally on `(p,q)` coefficients. |
| `modeCurrent.ts` | Discrete Helmholtz–Hodge split of the energy current on the φ mode graph. Publishes `modeCirculation ∈ [0,1]`. |
| `resample.ts` | Spectral zero-pad / truncate between Fibonacci rung widths. Discretisation invariance. |
| `sobolev.ts` | L², H¹, H², Hdiv graded error, quadrature-weighted so rungs are comparable. |
| `modeCoupling.ts` | Banded Hermitian coupling on the Fibonacci stencil (k ↔ k±1, k±2). **Gate default 0.** |
| `abHarness.ts` | Legacy-vs-operator measurement: finite difference, index resampling, L²-only metric. |

**Three v1-plan claims were wrong and are corrected here for the record.**
1. `learn/spectralFilter.ts` was described as a real-valued diagonal gain. It is not — it has
   always been complex (`α_k = ρ_k e^{iψ_k}`, `ρ ≤ φ⁻¹`). The representational gap was never
   "make it complex"; it is the *off-diagonal*, which is what `modeCoupling.ts` now supplies.
2. `spectral/fft.ts` was assumed power-of-two only. It runs Bluestein for arbitrary length, so
   13 ↔ 233 ↔ 1597 resampling is exact and cheap. No Fibonacci rung falls back to a dense path.
3. A **spatial** Hodge split was planned as a new coherence witness. That instrument does not
   exist on this substrate: `torus/lattice.ts` is a one-dimensional golden ring, and on a circle
   every zero-mean field is exactly a gradient (measured residual 1.3e-15). The solenoidal
   fraction would have been identically zero — a dead channel. The witness was moved to the
   genuinely two-dimensional **mode lattice** `(p_k, q_k) = (k, round(kφ⁻¹))`, where the graph
   Hodge decomposition is non-degenerate (23 edges, 13 nodes, 11 independent cycles).

**New measured channel.** `field.modeCirculation` joins the analysis spine's channel set
(`src/core/analysis/channelSampler.ts`), fed per spectral pass by `src/ui/omega/cognitiveDriver.ts`.
It is **read-only and additive**: it does not enter Ω, does not actuate any field, and abstains
(NaN) whenever the current is degenerate or no previous pass exists. Its purpose is to sit beside
Ω = 0.49 and settle empirically whether that figure is a real ceiling or a metric artefact —
unlike Ω, circulation is a ratio of two parts of the same current and cannot be inflated by
driving the input harder (verified: invariant to ×10 amplitude within 1e-9).

**Stability ledger.** `ModeCoupling` is Hermitian by construction, so `‖C‖₂ ≤ ‖C‖_∞ = max row
sum`, and each entry's magnitude is budgeted as `ρ_C / fan-out` through the existing algebraic
sigmoid — there is no parameter value the optimiser can reach for which the bound is exceeded.
With `ρ_C = φ⁻²` and gate `g`, the Jury contribution is `g·ρ_C ≤ φ⁻³ ≈ 0.236`, and
`FILTER_RHO_MAX + g·ρ_C < 1` is asserted. **The gate defaults to 0**, at which `apply()` returns
without touching a byte — so a default build reproduces the S0 oracle structurally, not by test.

**Measured A/B results (o6).** Spectral derivative beats the central finite-difference stencil by
> 10⁶× (2.6e-14 vs ~4e-2 L²). Spectral round-trip through rung 89 is exact to 1e-11 where nearest-
index resampling aliases. H¹ separates two fields with identical L² by > 10×, which L² reports as
a separation of exactly 1.0. The legacy references are honest implementations, asserted as such.

**Verification.** 6 new test files, 42 new assertions, all green; the operator layer touches no
existing engine state; the coupling gate is off by default.

## § Ω-09 — Ω-SCALE: calibrated honesty, retention, recurrence, throughput (2026-08-31)

Four phases, one theme: the engine stops asserting numbers it cannot defend, and starts keeping
the data it cannot predict.

**P1 · Calibrated honesty — `operator/conformal.ts`, wired into `analysisRuntime`.**
Split-conformal prediction over a ring of nonconformity scores, per analysis channel, against the
persistence predictor `ŷ_t = y_{t-1}`. That baseline is chosen deliberately: the band it produces
is a statement about how fast the channel actually moves, not about how good a model is. Order is
load-bearing — the interval is taken *before* the truth is absorbed, so reported coverage is
genuinely out-of-sample. A channel abstains until it holds ≥ `minCalibrationFor(α)` = 20 residuals,
below which no finite-sample guarantee exists. NaN frames contribute nothing: a gap is not a
residual of zero. Drift off nominal coverage raises `stale`, surfaced in the ANALYSIS deck as a
`STALE` marker rather than a quietly-wrong `±`. `reset()` clears bands with the samples they came
from. Publication is additive (`AnalysisState.calibration`), so no existing reader changes.

**P2 · Tiered corpus — `operator/retention.ts`.**
The real ceiling on learning is not compute but what survives the tick (~10³ kept of ~5.1×10⁶
touched). Admission is by *surprise measured in calibrated band half-widths*,
`|actual − predicted| / halfWidth` — the P1 layer is what makes this an information measure rather
than a tuned threshold. Three φ-spaced tiers (HOT 1597×4181, WARM 17711×233, COLD 10⁶×13). Overflow
**demotes rather than deletes**: only the bottom tier can drop, and it reports what it dropped. An
uncalibrated band yields `Infinity` surprise and therefore admits — the warm-up data the calibrator
needs is never discarded. `projectFootprint()` gives time-to-full per tier, so the 10¹² claim is
arithmetic, not aspiration.

**P3 · Recurrence and leakage — `operator/recurrentCell.ts`, `operator/continuation.ts`.**
`RecurrentModeCell` adds GRU-gated memory over mode magnitudes with φ-spread per-mode retention:
low modes hold for minutes, high modes forget in frames. Stability is structural, not tuned — the
blend is convex with `z ∈ [z_min, z_max] ⊂ (0,1)` and the candidate is `tanh`-bounded, so
`|h_t| ≤ max(|h_0|, 1)` for all t and the per-step contraction is `1 − z_min < 1`. `certify()`
returns those numbers; verified against a ±10⁶ alternating adversarial drive over 5000 steps.
Phase is *not* smoothed — `modeCurrent` is already driver-invariant. `continuation.ts` supplies C¹
Fourier continuation for non-periodic sensory windows, removing the endpoint-jump 1/k spectral tail
without tapering real signal (windowing) or merely relocating the jump (zero-padding). The original
support is returned bit-identical; `assessContinuation()` measures the tail with and without, so the
decision is per-stream and evidence-based.

**P4 · Throughput — `operator/throughput.ts`.**
Capability probe (cores, Workers, `navigator.gpu`, SharedArrayBuffer) plus an Amdahl-and-overhead
planner. The planner is required to say *no*: a workload too small to pay per-chunk overhead
returns `worthwhile: false`, and `bestWorkerCount()` peaks rather than saturating the core list.
`probeGpuAdapter()` is total — absent API and null adapter both resolve false, never throw.

**Determinism.** The `s5-dmath` guard caught raw `Math.exp/log/tanh/sin/cos` in the first cut of P3;
all are now `dexp`/`dlog`/`dtanh`/`dsin`/`dcos`. The engine has no implementation-approximated
transcendental anywhere in `src`.

**Verification.** 933/933 tests green (44 new: 9 conformal, 14 recurrence+continuation, 13
retention, 8 throughput), production build OK. P2–P4 are pure modules with no engine consumer yet;
only P1 is wired, and only additively.

---

## Ω-10 — Consistency sweep: the operator layer is now *live*, not merely present

An exhaustive audit of every FFT / eigen / mode call site (trnn-core `spectral/`,
`torus/`, `learn/`, `sense/`, `substrate/`; `src/core/{analysis,knowledge,sensory,field}`;
`field-kernel-core` — which contains no spectral code at all) found the Ω-OPERATOR
modules correct and tested but consumed by only three production call sites
(`conformal`, `retention`, `throughput`, all in `analysisRuntime.ts`) plus
`modeCirculation` in `cognitiveDriver.ts`. Everything else was an orphan.

**What is now wired (all additive, all observation-only — nothing steers the engine):**

| Module | Live site | Channel |
|---|---|---|
| `sobolev.gradedError` (over `fourierDiff`) | `cognitiveDriver.spectralMetrics` | `field.roughness` |
| `continuation.assessContinuation` | `cognitiveDriver.spectralMetrics` | `field.leakage`, continuity |
| `recurrentCell.RecurrentModeCell` | `cognitiveDriver` (per-width cell) | `field.persistence` + contraction |

`field.roughness` is `h1/l2` of the inter-pass change: scale-invariant by
construction (proved in `w4`, where a 7× louder drive moves drift by exactly 7×
and roughness not at all), so it distinguishes *the same spectrum, louder* from
*a different spectrum*. `field.leakage` is the measured spectral tail of the pass
window and continuity the measured gain of a C¹ Fourier continuation on it — a
seam is now measured, never assumed. `field.persistence` is novelty in [0,1]
against the gated slow memory, whose contraction (< 1) is certified, not sampled.

All three enter the analysis spine as first-class channels, so they inherit
conformal ± bands, tiered retention and staleness for free; the ANALYSIS deck
renders them without a UI change.

**Resolution finding.** `profile.modes` (8→13→13→13→21→21) *does* reach the
engine — `runtime/host.ts:316` passes it into `MultiTorusEngine`. The `n = 13`
default in `modeLadder`/`battery`/`transcription` is a tape-width law for
offline harnesses, not a cap on the live field. `COHERENCE_DELAY = 233` and the
audio constants (`FFT_SIZE = 1024`, mel/MFCC widths) are genuinely tier-independent
and are the next honest resolution lever, recorded but deliberately untouched:
changing them moves engine digests and is a separate, A/B-gated decision.

**Still deliberately dormant:** `modeCoupling` (off-diagonal successor to
`learn/spectralFilter`) and `resample`/`abHarness`. Wiring those changes engine
digests, so they stay behind the A/B harness until a measured win justifies it.

**Verification.** 933 + 7 new (`w4-graded-witnesses`) = 940 assertions green,
typecheck clean, build OK.

### Ω-11 — UI surface for the graded witnesses (2026-08-31)

The Ω-10 witnesses (roughness, leakage, continuity, persistence, contraction,
circulation) were live in the analysis spine but only visible as channel names.
The SPECTRAL deck now renders them directly from the cognitive driver snapshot
via the read-only `useCognitive` hook, alongside the drift band and the
recurrence contraction proof (< 1). No engine path was touched; the deck reads,
it never drives.

### Ω-CORPUS — the durable tiered store (2026-08-31)

Retention was a RAM policy: real, but bounded by the tab. Ω-CORPUS gives it a
substrate. One frame — the full channel vector — is offered per sample with the
widest calibrated surprise across channels as its admission price. HOT holds it
in RAM under a capacity derived from the memory governor. Eviction is a
*demotion*: the frame is sealed into an immutable WARM shard (1597 frames,
float32 payload with float64 ticks, ~4 bytes per number) in OPFS or IndexedDB.
Shards fold into COLD segments at signature width (13 modes) through the unitary
`resample` operator, so compaction is band limitation rather than truncation.

Every seal — shard and segment alike — becomes a canonical-JSON leaf in an
RFC-6962 Merkle log with a signed tree head, so a read can be proved to belong
to the same history the deck displays, and a reloaded index can be proved
consistent with the head it claims to extend. Reads are budgeted in *numbers
read* and abstain when the budget cannot cover the nearest tier.

Two invariants make the ladder safe: nothing is deleted, only offered downward;
and when the host storage quota passes 95% the archive **refuses** admission
instead of evicting history. A storage failure degrades the corpus and never the
engine — the feed is queued off the tick path and swallows its own errors into a
visible `lastError`.

**Verification.** 940 + 18 (`test/corpus/c1-corpus.test.ts`) = 958 assertions
green, typecheck clean, build OK. The r8 proof-latency test remains a known
under-load flake; it passes in isolation.

### Ω-CAPACITY — the measured ceiling table (2026-08-31)

The corpus policy is unbounded; the host is not. Ω-CAPACITY replaces every
estimate about this substrate with a measurement taken on the machine that is
running. `src/core/capacity/` times the real unitary transform (forward *and*
inverse, with the round-trip error measured in the same loop, so a fast wrong
answer cannot be reported as speed), decodes real FHRR bundles until the weakest
component falls under the 5σ abstention floor, resamples between every scheduled
rate class to prove the decimation exact, writes and reads real shards through
the real codec into its own in-memory store, and scores the barcode prefilter
against planted ground truth. It writes nothing: not the engine, not the corpus
of record, not any persisted store.

The reference run (`docs/CAPACITY.md`): peak **858,924 numbers/s at rung 233**
with 6e-16 round-trip error; the engine rung 987 sustains 186 ticks/s against a
60 Hz schedule; RAM holds 8,560,080 numbers at once; measured FHRR fan-in is
**34**, not the nominal 100; the 256-bit barcode is collision-free over 1024
vectors and displaces smoothly with input noise; a float64 slot keeps 15.2
digits through a transform, ~657 bits per 13-mode signature; every rate class
decimates losslessly to ≤2e-15, with the width-89 fast sensory class setting a
surviving band limit of k = 44; sealed storage costs **4.07 bytes per retained
number**, i.e. 2.64 × 10⁹ retained numbers at a 10 GiB grant; and the prefilter
reaches **98.8% recall at 8 candidates** (104 numbers read), above which a wider
candidate set buys nothing.

One negative result is recorded rather than hidden: the first C5 formulation
scored recall against the k nearest members of a uniformly random population.
In such a population every member past the first is equidistant noise, so the
truth set is arbitrary and any prefilter scores 1/k by construction. It was
replaced with planted clusters, which is a question with a right answer.

**Verification.** 958 + 18 (`test/capacity/c2-capacity.test.ts`) = 976
assertions green, tsgo clean, build OK. The r8 proof-latency test remains the
known under-load flake and passes in isolation.

---

## Ω-13 — UNBOUND: which ceilings were ours

The instruction was to remove the ceilings. The first honest step was to sort
them, because they were not the same kind of thing.

**Ours, and now gone.** The Fibonacci spine was an 18-entry literal table; it is
now generated and memoised to the last exact safe integer (`core/window.ts`),
with the old 18-entry prefix preserved byte-for-byte as the default so nothing
downstream moved. The COLD archive refused new evidence at 95% quota; it now
walks a retention ladder — 13 → 8 → 5 → 3 modes on the oldest segment first —
and each narrowing is re-sealed as `cold-recompact` carrying the prior hash, so
the Merkle chain of custody survives the loss of resolution.

**Relocated, not removed.** Grid width bounded resolution, so resolution stopped
being width. `operator/nestedField.ts` descends a field into a coarse view plus
the residual that no narrower rung could represent, recursively; `ascend`
reconstructs. Measured: a 233→89→233 flat roundtrip loses everything above the
width-89 band limit k=44, while the same descent *with* the residual returns at
1.1e-16. This is the toroidal closure claim made checkable — `closureDefect`
reports the unaccounted energy against the float64 floor and says NOT CLOSED
when it is above it, rather than asserting closure. Likewise flat FHRR fan-in
crosses the 5σ floor in the thirties, so `substrate/hierBundle.ts` stages
association hierarchically and abstains per stage, routing 1,156 items through
34×34 at 100% accuracy in trial. And where float64 cancellation, not the
algorithm, set the error floor, `spectral/exact.ts` offers opt-in double-double
sums and dots — an ill-conditioned series went from 2.17e-14 error to exactly 0.

**Not ours, and still here.** Wall-clock, host bytes, browser quota, float64
dynamic range, the arithmetic floor. These are measured (`C7` in the capacity
report, the NESTING block on the SPECTRAL deck) rather than argued away. The
system is not resolution-free across all spacetime and does not say it is; what
it no longer contains is a ceiling that exists only because we wrote it down.

**Verification.** 1002 + 5 assertions green; the determinism guard caught two
`Math.log10`/`Math.pow` calls in the new modules, both replaced with the
deterministic bank. tsgo clean.
