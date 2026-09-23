# Memory Reactivation + Deterministic Gematria/Bitmap Resonance Learning

## What I found (verified)

- The memory substrate is fully built and unused in the current shell. `src/core/memory/` has 15 modules (FieldTape, HebbianMatrix, EpisodicStore, FibonacciPatterns, PathwayGraph, TextJournal, ReflectiveIndex, PerceptRegistry, VisionFieldIndex, MemoryCaptureKernel, MemoryGovernor, MemoryPersistence).
- `tickMemory()` (`src/core/memory/tickMemory.ts`) is the real pipeline: toroidal Ψ projection → fused multimodal ΔΨ injection → percept upsert/binding → qualia correlate → `store.capture()`. It is called **only** from the legacy `src/components/v11/Workstation.tsx`, never from the V13 shell that renders at `/`.
- `src/ui/v13/V11EngineBridge.tsx` constructs a `MemoryStore` but hardcodes `memoryEnabled: false`, `memoryStatus: "disabled"`, `memoryRefresh: 0`, and no-op `saveMem/loadMem/clearMem`. That is exactly why every memory readout is dead.
- There is no memory tab in `CenterWorkbench.tsx` (tabs: field, brain, tune, tools, integrations, runs). The only viewer is the legacy read-only `src/components/v11/legacy/MemoryPanel.tsx`.
- Gematria/hashing pieces already exist and are not yet unified: `SimHashPhi` (64-bit φ-projection SimHash + Hamming + bucketKey), `F6_Hebrew` (gematria framework), `PerceptRegistry` (φ⁴ promotion thresholds), `VisionFieldIndex` (89-dim cosine index), plus the design doc `packages/brain-core/src/GEMATRIA_ENGINE_PLAN.md` (digital roots base-b, Z[φ] exact ring, Zeckendorf addressing, residue fingerprints) which has **no TypeScript implementation** in `src/`.

## Goal

1. Make memory genuinely live in the V13 shell with real-time metrics — no engine regression.
2. Add a Memory tab that shows the substrate and the stored memories.
3. Build a deterministic Bitmap + Gematria Field Resonance layer on top of the existing hashing/index code, and wire a learning loop that uses it.

## Phase 1 — Reactivate the pipeline (no new math)

- Add a memory driver in the V13 shell: a single subscriber to the snapshot store that calls `tickMemory(out, store, tick)` on the same 2 Hz metatron cadence the bridge already uses, gated by a `memoryEnabled` toggle (default on, persisted).
- Replace the hardcoded stubs in `V11EngineBridge` with real values: `memoryEnabled`, `memoryStatus`, an incrementing `memoryRefresh`, and `saveMem/loadMem/clearMem` bound to `MemoryPersistence`.
- Apply `computeMemoryCaps()` to the store via `applyCaps()` after the hardware probe resolves, and re-apply when the Brain Deck budget changes (respecting the existing opt-in `governEngine` flag so nothing changes silently).
- Publish memory stats through the same `useSyncExternalStore` pattern used by `snapshotStore`, with a shallow comparator, so panels never re-render at tick rate.

## Phase 2 — Memory tab

New `MEMORY` tab in `CenterWorkbench` containing:

- **Substrate**: per-layer utilization bars (tape/hebbian/patterns/pathway/journal/episodes/sensory) vs governor caps, `‖W‖_F`, capture cadence, last salience, fired scheduler jobs.
- **Stored memories**: sortable list of φ-patterns (tick, Fib index, ‖Ψ‖, poloidal/toroidal, hash), episodes, percepts (name, modality, reinforcements, recognition tier), pathway transitions, journal tail.
- **Recall probe**: enter/click a cue, run `store.recall()`, show top-N matches with resonance scores and successor edges.
- **Persistence**: save / load / clear with byte-size readout.

The legacy `MemoryPanel` is retired from the new surface (kept only for the v11 route) so there is one source of truth.

## Phase 3 — Deterministic bitmap + gematria resonance (new, additive)

New folder `src/core/gematria/` — pure, deterministic, no engine coupling:

- `zphi.ts` — exact Z[φ] ring `{a,b} = a+bφ` with +,−,×, norm `a²+ab−b²`; used below the n=76 exact horizon so φ-arithmetic has zero drift.
- `zeckendorf.ts` — unique non-consecutive Fibonacci decomposition; canonical reversible address for concepts/memory slots; Fibonacci prefix code for compact ids.
- `residue.ts` — base-b digital root `dr_b(n) = ((n−1) mod (b−1)) + 1` and the multi-base residue fingerprint vector; by CRT this uniquely identifies n below `lcm(b_i−1)`, giving a reversible fingerprint instead of numerology.
- `bitmap.ts` — deterministic bitmap encoder: Ψ (or any feature vector) → fixed-width bitplane via the existing `simHash64` φ-projection, extended to a multi-plane (4×64-bit) code with Zeckendorf-indexed plane weighting. Hamming distance over planes gives an O(1) resonance proxy; `bucketKey` gives LSH bucketing for sublinear recall.
- `resonanceKernel.ts` — the certificate-2 kernel `C(a,b) = |⟨a|b⟩|²/(|a|²|b|²)`, phase-invariant and PSD, used as the exact rescorer after bitmap prefiltering.

**Two-stage recall** (this is the efficiency win): bitmap Hamming prefilter over all stored patterns → exact resonance rescore on the top candidates only. Recall goes from O(N·d) to O(N) cheap-int + O(k·d).

Honesty rule carried from the plan doc: digit patterns are data, digit meanings are not asserted. Any gematria correlation is surfaced with a collision count and null-model p-value, never as a claim.

## Phase 4 — Learning algorithms

Layered on the above, all deterministic:

- **Hopfield consolidation**: modern-Hopfield update `ξ ← X·softmax(β·Xξ)` with `β = φ/√d`, merging attractors whose resonance exceeds `1 − 1/φ³ ≈ 0.764` (both already formally verified in `cert_resonance_hopfield.wl`). This replaces unbounded pattern growth with attractor merging.
- **Predictive pathway learning**: `PathwayGraph` currently only counts transitions. Add a prediction step (predict next pattern from successors), measure surprise = 1 − resonance(predicted, actual), and use surprise to gate episodic capture and to scale the Hebbian learning rate. Learning becomes error-driven instead of cadence-driven.
- **Eligibility-trace Hebbian**: replace instantaneous co-activation with a φ⁻¹-decaying trace so temporally adjacent activations bind, not just simultaneous ones.
- **Gematria-addressed indexing**: store each pattern under its Zeckendorf address + residue fingerprint so the store gets an exact secondary index (constant-time lookup by fingerprint) alongside the resonance index.

## Regression safety

- Nothing in `src/core/v12/`, `src/core/runtime/`, `packages/field-kernel-core/`, or the worker path is modified — the field engine math is untouched.
- All new code is additive under `src/core/gematria/` plus one new panel; existing modules gain methods, never changed semantics.
- Memory driving is behind a toggle; the engine-governing link stays opt-in as it is today.
- Determinism gates: identical capture sequence ⇒ identical snapshot; Zeckendorf round-trips 1…10⁶; `dr_b` matches `n mod (b−1)`; bitmap Hamming monotonic against exact resonance on a fixed sample.

## Technical notes

- Memory tick runs on the existing 2 Hz metatron cadence, not the 64 Hz snapshot rate, so no added per-frame cost.
- Panel reads use `useSyncExternalStore` + shallow equality, matching the Brain Deck `LiveRuntime` pattern.
- Bitmaps are stored as two `Uint32Array` lanes per plane so Hamming is popcount-only, no string parsing in the hot path.
- Caps flow from `MemoryGovernor.computeMemoryCaps()` and the V14 `coupledGovernor` budget, so memory scales with the hardware tier selected in the Brain tab.

## Open question

Phases 1–2 (make memory live + visible) are quick and low risk. Phases 3–4 are the bigger build. I can ship 1–2 first and then continue, or do all four in one pass.
