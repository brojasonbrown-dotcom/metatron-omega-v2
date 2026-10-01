# FROZEN — determinism freeze (P0.3, 2026-10-01 UTC)

These files compute values that reach engine state. A change to any of them can break bit-for-bit reproducibility, so each one is pinned by a SHA-256 digest. The digest is taken over normalised text: CRLF becomes LF and trailing whitespace is stripped, so formatting-only noise does not trip it.

`test/determinism/p0-frozen.test.ts` reads the table below, which is the only place the digests live. Editing a frozen file is allowed only in a task whose plan names that file. That task updates its row here, in the same diff, with the reason.

<!-- frozen-table:start -->

| File                                           | SHA-256                                                            | Role                                          |
| ---------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------- |
| `packages/trnn-core/src/core/constants.ts`     | `4e0f6a24297142a5757210fd3a565ede80bf84cff61ef7a1c0d7ed3354fbc17c` | certified cell gains, φ constants             |
| `packages/trnn-core/src/core/dmath.ts`         | `066541c47f2ca61c89eaf3c3d9e5fcf6dab1aa4b536d77f6c593a125996ef514` | deterministic transcendentals (dpow, dsin, …) |
| `packages/trnn-core/src/core/determinism.ts`   | `8cb856758305c2dd990d5ff10de58518a3ef72f0b0fcf990002bb13ea428615b` | state digest                                  |
| `packages/trnn-core/src/substrate/dmd.ts`      | `375c5a16d4fef8f0c2a36c0055f306734055df7de9bb6a9399acb25fcf084b50` | DMD core math                                 |
| `packages/trnn-core/src/substrate/vsa.ts`      | `dbc6154ab9dc4210c294c8572878417ed9c20083abbddcf5b91bf090a5cedcc6` | VSA core math                                 |
| `packages/trnn-core/src/spectral/laplacian.ts` | `14a94df1a38b4c9cf6f284cbf6ebce1c2c9318048a86d86ca78ad189a04d5ccc` | Neumaier kernel (inner products, matvec)      |
| `packages/trnn-core/src/web/fluxLedger.ts`     | `7febea39600bd829475b1d1202920f951bf0df473a9c9fa9431908deefefa3d6` | Neumaier kernel (flux ledger)                 |
| `src/core/numerics/StableSum.ts`               | `f20fab3f2e2732f2e3fd6138371e7583c6511c96dae370104bd00b96146c9d20` | Neumaier kernel (shared NeumaierSum)          |
| `src/core/runtime/rhuftf/contraction.ts`       | `d55bcdd3b7137f8eab75e022ddf2918aa411448ffe7d9970ebe465fc0206b933` | Neumaier kernel (contraction mean)            |
| `src/core/runtime/rhuftf/localUpdateKernel.ts` | `a5d0eee0d32a3c6b2ef209939a0835ae0a30fa832d5ae247e197fb8a7f8fe4a5` | Neumaier kernel (local update norms)          |
| `src/core/residuals/ChapterResiduals.ts`       | `55e4d7f2d6109e3824b624907dbb4e5e8718117839ebb9f435583f3f3464d08a` | Neumaier kernel (inlined)                     |

<!-- frozen-table:end -->

Files that only _call_ `NeumaierSum` (`fieldSignature.ts`, `geometry/descriptors.ts`) are consumers, not kernels. The parity test covers them through the shared kernel.

## Behaviour parity

Digests catch edits to the files. They miss changes in behaviour that come from a dependency or the runtime. The same test therefore pins the exact IEEE-754 bit patterns of dsin, dcos, dexp, dlog, dlog1p, dpow, dpowi, datan2, dtanh and neumaierSum at fixed inputs.

## Finding (report only; dmath is frozen)

- `dmag(1e200, 1e200)` returns `Infinity`. The true value is about 1.414e200, so `dmag` squares its inputs before the square root and overflows above about 1.3e154. Engine fields are clamped well below that, so no live path is known to hit it. A fix (scaled hypot) needs its own task, which must re-pin this file.

## Scan: non-reproducible calls (report only; removal is a later task)

These are real code lines in `packages/trnn-core/src` and `src/core`; comment mentions are excluded.

| Call          | Count | Notes                                                                                                                                                                                                                                        |
| ------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Math.random` | **0** | all 9 textual hits are comments stating it is not used                                                                                                                                                                                       |
| `Math.pow`    | 140   | none inside `packages/trnn-core`; 97 are in the F1–F9 framework files and their constants (the P1 quarantine area); 1 is inside the frozen `ChapterResiduals.ts`                                                                             |
| `Date.now`    | 51    | mostly timestamps (OCR timing, persistence, journal, hardware probes); state-reaching ones are in `MemoryStore.ts` (default `at` for heard words), `FieldTape.ts`, `LatentSpace.ts`, `KnowledgeBase.ts`, `learn/tiers.ts`, `runtime/host.ts` |

Per-file breakdown (all hits including comments; regenerate with `rg -n "Math\.(pow|random)|Date\.now" packages/trnn-core/src src/core --type ts`):

| File                                                | Call          | Count |
| --------------------------------------------------- | ------------- | ----- |
| `packages/trnn-core/src/cognition/concepts.ts`      | `Math.random` | 1     |
| `packages/trnn-core/src/core/constants.ts`          | `Math.pow`    | 3     |
| `packages/trnn-core/src/core/dmath.ts`              | `Math.pow`    | 1     |
| `packages/trnn-core/src/harness/golden.ts`          | `Math.random` | 1     |
| `packages/trnn-core/src/harness/latency.ts`         | `Date.now`    | 1     |
| `packages/trnn-core/src/learn/tiers.ts`             | `Date.now`    | 2     |
| `packages/trnn-core/src/ledger/sth.ts`              | `Date.now`    | 1     |
| `packages/trnn-core/src/runtime/calibrate.ts`       | `Date.now`    | 1     |
| `packages/trnn-core/src/runtime/hardware.ts`        | `Date.now`    | 2     |
| `packages/trnn-core/src/runtime/host.ts`            | `Date.now`    | 5     |
| `packages/trnn-core/src/substrate/causal.ts`        | `Math.random` | 2     |
| `src/core/MetatronCore.ts`                          | `Math.pow`    | 9     |
| `src/core/capacity/envelope.ts`                     | `Date.now`    | 1     |
| `src/core/capacity/residency.ts`                    | `Date.now`    | 1     |
| `src/core/constants/Chapter47.ts`                   | `Math.pow`    | 2     |
| `src/core/constants/WolframVerified.ts`             | `Math.pow`    | 2     |
| `src/core/corpus/HotCache.ts`                       | `Math.pow`    | 1     |
| `src/core/frameworks/F1_Septenary.ts`               | `Math.pow`    | 8     |
| `src/core/frameworks/F2_Quantum.ts`                 | `Math.pow`    | 16    |
| `src/core/frameworks/F3_Atomic.ts`                  | `Math.pow`    | 10    |
| `src/core/frameworks/F4_Geometric.ts`               | `Math.pow`    | 4     |
| `src/core/frameworks/F5_ColorMusic.ts`              | `Math.pow`    | 16    |
| `src/core/frameworks/F6_Hebrew.ts`                  | `Math.pow`    | 9     |
| `src/core/frameworks/F7_Galactic.ts`                | `Math.pow`    | 3     |
| `src/core/frameworks/F8_SubPlanckian.ts`            | `Math.pow`    | 14    |
| `src/core/frameworks/F9_HyperGalactic.ts`           | `Math.pow`    | 7     |
| `src/core/frameworks/constants.ts`                  | `Math.pow`    | 3     |
| `src/core/gematria/bitmap.ts`                       | `Math.pow`    | 1     |
| `src/core/gematria/zphi.ts`                         | `Math.pow`    | 1     |
| `src/core/interop/contract.ts`                      | `Date.now`    | 1     |
| `src/core/interop/contract.ts`                      | `Math.random` | 2     |
| `src/core/knowledge/Acquisition.ts`                 | `Date.now`    | 1     |
| `src/core/knowledge/KnowledgeBase.ts`               | `Date.now`    | 4     |
| `src/core/knowledge/KnowledgeBase.ts`               | `Math.pow`    | 2     |
| `src/core/knowledge/LatentSpace.ts`                 | `Date.now`    | 4     |
| `src/core/knowledge/LatentSpace.ts`                 | `Math.pow`    | 1     |
| `src/core/knowledge/LatentSpace.ts`                 | `Math.random` | 1     |
| `src/core/knowledge/LocalArchive.ts`                | `Date.now`    | 1     |
| `src/core/knowledge/lexicon.ts`                     | `Math.pow`    | 1     |
| `src/core/memory/FieldTape.ts`                      | `Date.now`    | 2     |
| `src/core/memory/MemoryPersistence.ts`              | `Date.now`    | 1     |
| `src/core/memory/MemoryPolicy.ts`                   | `Math.pow`    | 1     |
| `src/core/memory/MemoryStore.ts`                    | `Date.now`    | 5     |
| `src/core/memory/Resonance.ts`                      | `Math.pow`    | 2     |
| `src/core/numerics/StableSum.ts`                    | `Math.pow`    | 1     |
| `src/core/ocr/ocrLadder.ts`                         | `Date.now`    | 17    |
| `src/core/residuals/ChapterResiduals.ts`            | `Math.pow`    | 1     |
| `src/core/rhuft/LucasClosure.ts`                    | `Math.pow`    | 6     |
| `src/core/rhuft/PhiLadder.ts`                       | `Math.pow`    | 4     |
| `src/core/runtime/PhiLockScheduler.ts`              | `Math.pow`    | 1     |
| `src/core/runtime/computeBench.ts`                  | `Date.now`    | 1     |
| `src/core/runtime/rhuftf/F1SeptenaryLocalUpdate.ts` | `Math.pow`    | 1     |
| `src/core/runtime/rhuftf/F1SeptenaryMeasurement.ts` | `Math.pow`    | 1     |
| `src/core/runtime/rhuftf/F2QuantumLocalUpdate.ts`   | `Math.pow`    | 1     |
| `src/core/runtime/rhuftf/F2QuantumMeasurement.ts`   | `Math.pow`    | 1     |
| `src/core/runtime/rhuftf/F3AtomicLocalUpdate.ts`    | `Math.pow`    | 1     |
| `src/core/runtime/rhuftf/F3AtomicMeasurement.ts`    | `Math.pow`    | 1     |
| `src/core/runtime/rhuftf/F7GalacticMeasurement.ts`  | `Math.pow`    | 1     |
| `src/core/runtime/rhuftf/ScaleMeasurement.ts`       | `Math.pow`    | 3     |
| `src/core/runtime/rhuftf/eigenmodes.ts`             | `Date.now`    | 1     |
| `src/core/runtime/rhuftf/eigenmodes.ts`             | `Math.pow`    | 1     |
| `src/core/runtime/rhuftf/eigenmodes.ts`             | `Math.random` | 1     |
| `src/core/runtime/rhuftf/torusClosure.ts`           | `Math.pow`    | 1     |
| `src/core/sensory/AudioFrontend.ts`                 | `Math.pow`    | 1     |
| `src/core/sensory/IMUFrontend.ts`                   | `Date.now`    | 1     |
| `src/core/sensory/MelFilterbank.ts`                 | `Math.pow`    | 1     |
| `src/core/sensory/SensoryGateway.ts`                | `Math.random` | 1     |
| `src/core/sensory/SimHashPhi.ts`                    | `Math.pow`    | 1     |
| `src/core/sensory/sensoryFieldBridge.ts`            | `Date.now`    | 1     |
| `src/core/v12/audit/LyapunovBank.ts`                | `Math.pow`    | 2     |
