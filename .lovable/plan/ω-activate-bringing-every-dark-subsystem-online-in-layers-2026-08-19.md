# Ω-ACTIVATE — bringing every dark subsystem online, in layers

The audit found three distinct failure classes, and they need different treatments:

1. **Producers missing** — a consumer is live and tested, but nothing feeds it (sensory pipeline).
2. **Capability built, never invoked** — the module runs correctly when called, and no caller exists (fractal nesting, Clifford, spectral filter, Weave, FieldTape readback, proof banks).
3. **Whole parallel architectures** — a second engine and a second mind that no entry point loads (RHUFT-F/v12, `packages/brain-core`). These are a *decision*, not a wiring job.

The plan activates them bottom-up: data in, then data out, then certificates, then depth, then the parallel engines. Every layer is gated by its own test battery and a bit-identical baseline check, so no layer can silently perturb the ones below it.

## Ground rules for every task

- **Default-off gains.** Any activation that touches the tick math lands behind a runtime flag whose default value reproduces the current digest byte-for-byte. Activation is then a flag flip with a measured before/after, never an unannounced behaviour change.
- **Digest guard.** Each layer adds a regression asserting the 3200-tick digest of a reference rung is unchanged with the flag off.
- **Registry entry per subsystem.** Nothing counts as "activated" until `selfRegistry.ts` probes it and can report `absent | dormant | live | stale` with real measured metrics. Dark clusters are currently invisible rather than red; that is the root defect behind the false self-picture.
- **No new dormancy.** Every task ends with the reachability scan re-run; the unreachable count must go down, never up.

---

## Layer A — Senses: give the cortex something to eat

`SensoryGateway` is live and wired through `tickMemory` (`consumeAllForMemory` → `injectPsiFused` → `percepts.upsert` → binding), but no code ever calls `gateway.ingest(feature, modality, tick)`. Percepts, `visionField`, cross-modal binding and arousal are therefore structurally complete and permanently zero.

- **A1 — Sensory bus.** A single `sensoryDriver` singleton in `src/ui/omega/`, mirroring the existing `memoryDriver` shape: owns frontend lifecycles, holds one shared tick clock, and is the only thing allowed to call `ingest`. Permission-gated, fully functional with zero devices attached.
- **A2 — IMU channel (377 Hz).** Lowest risk, no permission prompt on most devices. Wire `IMUFrontend` → driver → gateway. Prove: percept count rises, `stats()` reports non-zero, `arousal` becomes finite.
- **A3 — Audio channel (233 Hz).** `AudioFrontend` + `MelFilterbank` + `AudioCortex`. Explicit user opt-in, hard mute path, no buffering of raw audio beyond the mel window.
- **A4 — Video/screen channel (89 Hz).** `VideoFrontend`/`ScreenFrontend` + `VideoCortex` + `VisionEncoder`/`VisionEmbedFrontend` → `visionField.append`. Opt-in, frame-rate capped, embeddings only — no raw frames retained.
- **A5 — Move intake off the main thread.** Adopt the orphaned `sensoryFrame.worker.ts` as the driver's compute side once A2–A4 are proven inline; keeps mel/vision math out of the render loop.
- **A6 — Sense deck.** Extend the existing sense panel with per-modality live state, rate, atom count, arousal, and an explicit consent control per channel.
- [x] **A7 — Battery `s-sense`.** Synthetic frame injection proves: deterministic atom hashing, cap/eviction correctness, fused Ψ injection is norm-preserving, and a zero-device build behaves exactly as today.

## Layer B — Memory readback: make stored state do work

- [x] **B1 — FieldTape readback.** `FieldTape` is write-only today; nothing ever reads a frame. Add `readRange`, `nearest`, and a trajectory iterator, then expose replay through the memory runtime.
- [x] **B2 — Trajectory recall.** Use B1 to answer "what was the field doing when this episode formed" — attach a short pre/post window to episodic recall.
- **B3 — Weave activation.** `memory/Weave.ts` (`weave`, `Strand`, `Moment`) has zero callers. Drive it from the percept stream A2–A4 produces, binding modalities across a φ-scaled temporal window.
- **B4 — MemoryFeedback (pineal loop).** `recursion/MemoryFeedback.ts` is gated by an `EngineCtx` flag hardcoded `false` with a no-op setter. Give it a real setter, run Ψ_memory = λ·Ψ_{t−τ} behind λ=0 default, and keep `saturationBias` + quarantine as the stability guard.
- **B5 — Retrieval knobs.** Put `Resonance.crossScaleAffinity`, `Banding.bandQuota`, `Consolidator.prunableKeys` and `MemoryGovernor.memoryPressure` on the live recall/eviction path they were written for; they are currently test-only references.
- **B6 — Battery `s-readback`.** Tape round-trip fidelity, weave binding correctness, feedback at λ=0 is a strict no-op, eviction under pressure stays within budget.

## Layer C — Certificates: let the self-test cite live proofs

The proof banks exist and are never evaluated, which is why claims about κ-closure and Lyapunov floors have no runtime backing.

- **C1 — Proof runner.** One idle-time evaluator for `PhiLadder.LADDER_PROOF`, `LucasClosure.proveClosure`/`boundaryFlux`, `LadderBinding.proveBindings`, `ExactIdentities.identityBank`, `Thermal.thermalReport`/`chargeReport`. Cached per session, recomputed on resolution change.
- **C2 — Registry surface.** Each bank becomes a `selfRegistry` module with pass/fail and measured residuals, so the self-test reports certificates instead of adjectives.
- **C3 — Blind self-measurement.** Wire `SelfMeasure.ignitionScore` / `BLIND_SELF_MEASUREMENT` so the machine's own coherence claim is a measurement, not a narrative.
- **C4 — RhuftLibrary search.** Expose chapter search over the 38 phenomena + 16 technical documents to the knowledge runtime, so questions about its own physics hit local sources instead of returning lexical noise.
- **C5 — Metatron memo hygiene.** `resetMetatronMemo`/`metatronMemoStats` are never called, so nothing invalidates the 8-entry LRU on a resolution change. Invalidate on profile/rank change and report hit-rate.
- **C6 — Battery `s-certs`.** Every bank evaluates finite, residuals within their documented floors, cache invalidation proven.

## Layer D — Depth: make Ω-DEPTH actually descend

`fractal/nest.ts`, `fractal/pool.ts`, `algebra/clifford.ts` and `learn/spectralFilter.ts` are exported, certified, and have zero non-test callers. Depth exists; the engine does not descend.

- **D1 — Host hook points.** Add explicit pre/post-step extension points in `runtime/host.ts` so depth modules attach without editing the tick body.
- **D2 — Fractal nesting live.** `NestedField` + `FieldPool` driven from convergence hot-nodes: demand-driven children at 89/233 nodes, φ-scaled LRU recycling, norm-preserving restrict/prolong. Default `maxDepth = 0` (identical to today).
- **D3 — Clifford channels live.** `applyBladeGain`/`rotorFromPlane`/`applyRotor` on the carrier, `bladeGain = 0` default, which the existing gate test already proves collapses to the scalar path.
- **D4 — Spectral filter live.** `SpectralFilter` + `diffusionTarget` as the learnable operator on the eigenbasis, gain 0 by default.
- **D5 — RAM honesty under depth.** Depth allocation participates in the `MemoryGovernor` shedding ladder so nesting can never starve the memory stores.
- **D6 — Battery `s-depth`.** All gains at 0 reproduce the reference digest exactly; gains raised produce bounded, ISS-stable trajectories; pool recycling holds its ceiling under sustained pressure.

## Layer E — Geometry and acquisition completeness

- **E1 — Geometry parsers.** `parseDxf/parseSvg/parseObj/parseStl/parseStepFile` have zero callers; only `describeAsset` runs, so CAD/BIM ingestion is descriptor-only. Route parsed geometry into knowledge chunks with real vertex/topology features.
- **E2 — Legacy path removal.** Delete `tickMemory.projectPsi` (flat 18-vector legacy beside the toroidal embedding) and the dead `bus/useEngine.ts` + `bus/FallbackEngine.ts`, which are the only references keeping `CrystallinePLL` and `FrameworkOrchestrator` nominally "used".

## Layer F — The parallel architectures (decision, then execution)

Two complete second architectures are dark. Each needs an explicit verdict before any wiring, because reviving them wrong is the highest-risk work in this plan.

- **F1 — RHUFT-F solver audit.** The nine `F#LocalUpdate`/`F#Measurement` pairs, `localUpdateKernel`/`registry`, `eigenmodes` (Lanczos, power iteration, Flower-of-Life adjacency, spiral Laplacian), `contraction`, `phiModes`, `torusClosure`, `conjugate`, `omega.ts`, `FrameworkOrchestrator`, `CanonicalUpdateBank`, `BrowserDriverBank`, `ShadowStateTape`, `frameworkOrchestrator.worker`. Determine per-module: superseded by the Ω engine, or a genuine capability the Ω engine lacks.
- **F2 — Revive or quarantine RHUFT-F.** Capabilities the Ω engine lacks get run inside `frameworkOrchestrator.worker` as a shadow solver whose measurements feed the registry but not the tick. Everything superseded moves to an explicitly archived namespace so it stops reading as live.
- **F3 — v12 master-update layer.** `MasterUpdate`, `MasterUpdateController`, `ExistenceGate`, `SelfValidationRHUFT`, `TriadicValue`, `F2Provenance`. Same verdict pass; `SelfValidationRHUFT` and `ExistenceGate` are the strongest revival candidates because they give the tick a per-step validity gate it currently lacks.
- **F4 — `packages/brain-core` verdict.** All 80 modules are dark: `run_mind.ts` boots Ollama, a microphone and a screen eye — a Node-only mind the browser app can never load. Choose one: (a) keep it as an explicitly Node-side companion with its own entry and documentation, (b) port the browser-viable parts (`hnsw_index`, `hopfield`, `pq_codec`, `lexicon`, `prediction_ledger`, `drive_arbiter`) into `trnn-core` where the live mind can reach them, or (c) archive it. Option (b) is the recommendation — those six modules are exactly the retrieval and cognition machinery the live mind is missing.
- **F5 — Execute the chosen verdict** for F2/F3/F4 with per-module tests, then re-run the reachability scan to confirm zero ambiguous modules remain.

## Layer G — Final audit

- **G1 — Reachability scan to zero-ambiguity.** Every module is either reachable from a live entry point or sits in an explicitly archived namespace. No third category.
- **G2 — Full regression.** Whole Vitest suite, typecheck, production build, runtime preview check with zero console errors.
- **G3 — Digest baseline re-certified** with every new flag at its default.
- **G4 — Self-report honesty check.** Ask the machine to describe itself and verify the answer matches the measured registry — no dormant subsystem may be invisible, and no live subsystem may report as fallback.

---

## Technical notes

- The sensory driver reuses the `memoryDriver` singleton pattern already proven in Ω-WAKE: one subscription to the Ω runtime, one tick clock, throttled UI publication, no per-frame React re-renders.
- Depth activation must not bypass the ISS bound. Restrict/prolong are norm-preserving by construction and already certified in `f0-nesting.test.ts`; the host hook enforces that the child contribution is scaled by the parent's contraction margin.
- Media capture stays entirely client-side. Nothing raw leaves the device: audio becomes mel bands, video becomes embeddings, and only derived atoms enter the gateway.
- Layer F is the only place where deletion is on the table, and it happens strictly after the F1/F3/F4 verdict pass — no module is removed on suspicion.

## Suggested execution order

A → B → C → D → E, each merged and certified independently, then F as its own reviewed phase, then G. Layers A–C carry effectively zero risk to the current tick because they add producers, readers and observers only. Layer D touches the tick but is default-inert. Layer F is the only phase requiring a judgement call from you.
