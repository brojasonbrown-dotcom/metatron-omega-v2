# METATRON V14 — Unified Brain Architecture

Goal: merge the uploaded `brain v14` computational stack into the existing V13 workstation without losing anything from either side, make it genuinely hardware-adaptive (laptop to cluster), and let a user choose to run the brain **in the browser**, **locally on their own machine**, or **hosted**.

---

## 1. What each side contributes

**Keep from the current brain (V13, in this project)**
- φ-ladder shard physics kernel (`@metatron/field-kernel-core`): `runShardKernel`, `fastCos/vCos`, state tuple, measurement operators, Lyapunov energy, local-update registry.
- Sensory stack: `PhiLattice`, `SensoryCortex` (predictive coding, habituation, 89-D cross-modal bind space), audio/video/IMU/screen/vision-embed frontends, `SensoryGateway` + SimHash dedupe.
- Memory stack: Hebbian matrix, episodic store, pathway graph, field tape, memory governor/policy/persistence.
- Runtime: `ResourceGovernor` + `HardwareEnvelope`, `WorkerPool`, φ-lock scheduler, shadow state tape, port kill-switches.
- V12 audit layer: master update controller, existence gate, Wolfram-verified constant banks, Lyapunov bank.
- The whole V13 UI: telemetry, spectral, kernel, replay scrubber, workbench, chat/Kimi, Kokoro TTS.

**Adopt from the uploaded v14 archive**
- `RHUFTFrameworks.ts` (~7k lines) + `frameworks.ts` — the deepest framework catalogue in either tree.
- Fractal node engine: `fractal_node.ts`, `fractal_node_engine.ts`, `membrane_stabilizer.ts`, `torus_recurrence.ts`, `interdimensional_flow.ts`, `sphere_geometry.ts`, `scale_mapper.ts`.
- Measurement/law modules absent here: `BurdenTracker`, `ContinuityLaw`, `DimensionalStability`, `InterferenceStructure`, `MultiscaleClosure`, `MultiscaleStabilization`, `NecessityComplexity`, `PerfectionDeficit`, `RecursiveSelfMeasurement`, `GeometricReflection`, `SpherePrinciple`, `information_density`, `existence_detector`, `resonance_finder`, `actualization_engine`, `temporal_engine`, `complementary_field`, `self_measurement`.
- Cognition layer (this project has no equivalent): `cognitive_loop`, `concept_registry`, `drive_arbiter`, `hnsw_index`, `hopfield`, `pq_codec` (SQ8), `lexicon`, `glossary`, `linguistic_gate`, `prediction_ledger`, `instrument_router`, `visual_memory`, `memory_store`, `thought`.
- Adapters: `mind_bridge`, `llm_tool`, `kimi_k3_tool`, `ollama_supervisor` (local models), `language_codec/instrument`, `voice_out`, sensor bus + codec.
- Governance & schemas: `hardware_governor` (φ⁻² ≈ 35% budget), `worker_pool`/`worker_script`/`compute_worker`, JSON schemas + `schemas/validate.ts`.
- Docs/proofs: `MASTER_PLAN_V3.md`, `GEMATRIA_ENGINE_PLAN.md`, `FIXES.md`, the five Wolfram `.wl` certificates.

Explicitly dropped: the archive's `node_modules`, `dist/metatron-v8.js`, `package-lock.json`, and the poisoned `mind_state/quarantine-*` snapshot (kept only as an audit artifact, never loaded).

---

## 2. Target architecture

```text
                      ┌─────────────────────────────┐
                      │   V13/V14 Workstation UI    │
                      │  telemetry · workbench ·    │
                      │  chat · Brain Control Deck  │
                      └──────────────┬──────────────┘
                                     │ SnapshotStore (unchanged contract)
                      ┌──────────────┴──────────────┐
                      │        Engine Bus           │
                      │ pluggable transport layer   │
                      └───┬──────────┬──────────┬───┘
       in-browser ────────┘          │          └──────── remote
   Worker/WASM pool          local daemon           hosted worker
   (fallback engine)      (Node, WS, ollama)      (server functions)
                                     │
                      ┌──────────────┴──────────────┐
                      │       BRAIN CORE (shared)   │
                      │ L0 kernel  φ-ladder physics │
                      │ L1 fractal node tree        │
                      │ L2 laws & measurement       │
                      │ L3 sensory cortex           │
                      │ L4 memory (Hebb/HNSW/Hopf.) │
                      │ L5 cognition loop + drives  │
                      │ L6 language / tools / TTS   │
                      │ L7 audit · Lyapunov · certs │
                      └─────────────────────────────┘
```

One brain package, three hosts. Every layer is transport-agnostic and imports nothing host-specific.

---

## 3. Scaling model (the part that must go beyond one machine)

**Coupled resource Lagrangian.** The archive's plan proves tree census (`b(d)=min(Fib(d+1),13)` → 41@d5, 281@d6, 3401@d7, 43961@d8) collides with the F₂₁ = 10946 concept cap at depth 8. So depth ceiling and memory cap become one governed budget, never two independent knobs.

**Tiers, auto-detected, all user-overridable:**
1. `MICRO` — single thread, depth ≤ 5, SQ8 memory, no vision embeds. Phones/low-end.
2. `STANDARD` — worker pool = cores−1, depth ≤ 7, full sensory.
3. `WORKSTATION` — full pool + SIMD/WASM kernel, depth ≤ 8, float64 tier.
4. `CLUSTER` — shard the fractal tree across N remote nodes over the Engine Bus; each node owns a subtree, root merges by tree-traversal order (deterministic). Adding nodes raises the depth ceiling instead of the per-node load.

**Precision ladder:** exact `Z[φ]` integer arithmetic for n ≤ 76, float64 to k = 1435, arbitrary-precision fallback above — chosen per-operation, surfaced in telemetry.

**Memory ladder:** float32 → SQ8 quantized (4× headroom) → product-quantized → disk/IndexedDB spill, driven by measured RAM, not constants.

---

## 4. Brain Control Deck (new UI)

A real configuration surface, not decoration. New workbench tab with:
- **Hardware probe readout** — cores, threads, measured RAM, WASM SIMD, WebGPU, storage quota, measured tick latency.
- **Tier selector** — Auto / Micro / Standard / Workstation / Cluster, with live "what this changes" diff.
- **Sliders with real bindings** — resource budget % (default φ⁻² = 0.382), tree depth ceiling, worker count, memory cap, precision tier, tick cadence (declared 146 ms, measured value shown alongside — never claimed exact).
- **Mode toggle** — `EFFICIENT` vs `TRAINING` (deeper trees, full-rate senses, capture everything, models warm-pinned), bounded by the depth-8 collision law.
- **Runtime location picker** — Browser / Local daemon / Hosted, with connection status and one-click failover.
- **Per-subsystem kill switches** — reuse the existing `portFlags` registry so any layer can be disabled live.
- **Live budget meter** — projected vs actual RAM/CPU, node census, eviction rate.

Every control writes to a single `BrainConfig` object that the governor consumes on the next tick; changes are visible in telemetry within one cadence.

---

## 5. Run locally vs hosted

- **Browser (default):** everything runs in workers; no install, no keys needed for the physics. Persistence in IndexedDB.
- **Local daemon:** a small Node package (`brain-daemon`) shipped from the archive's `run_mind.ts` / `worker_pool.ts` / `ollama_supervisor.ts`. Serves a WebSocket the Engine Bus connects to; unlocks all cores, larger RAM budget, local LLM via Ollama, whisper.cpp STT sidecar, file-system persistence. The UI shows a copy-paste install command and a live "daemon detected" chip. The existing Electron packaging path can wrap this into a desktop app.
- **Hosted:** the current server-function path (chat, Kimi, tools) plus an optional remote compute node for cluster mode.

The transport is chosen at runtime; the brain code is identical in all three.

---

## 6. Delivery order

| Phase | Work | Gate |
|---|---|---|
| 0 | Vendor archive sources into `packages/brain-core/*` (no `node_modules`, no dist, quarantine excluded); strip `.ts` import extensions; typecheck clean | build green, zero behavior change |
| 1 | Unify constants: single φ/Fibonacci/precision-horizon source; reconcile `core/constants.ts` with `field-kernel-core` | constants parity test |
| 2 | Fractal node tree + laws layer wired behind a port flag, off by default | tick with tree on/off, no regression |
| 3 | Coupled governor (depth ⊗ memory) replacing both independent ceilings | depth-8 collision provably unreachable |
| 4 | Memory upgrade: HNSW + SQ8 + Hopfield + concept registry into existing memory stack | recall ≥ baseline −2%, log-scale retrieval |
| 5 | Cognition loop + drive arbiter + prediction ledger on the tick | thoughts appear in journal with provenance hashes |
| 6 | Language/tool/instrument routing merged with existing chat + tool registry | existing tools unaffected |
| 7 | Brain Control Deck UI + `BrainConfig` plumbing | every control measurably changes runtime |
| 8 | Engine Bus transports: browser / local daemon / hosted + failover | switch host live, state survives |
| 9 | Cluster sharding + deterministic merge | 2 nodes reproduce 1-node result bit-for-bit at same depth |
| 10 | Wolfram certificates as CI checks; regret bounds per memory substrate | all certs print True |

---

## 7. API keys

The app's tool arsenal reads these environment variables (all free tiers):

`MOONSHOT_API_KEY` (Kimi), `OPENAI_API_KEY`, `WOLFRAM_APP_ID`, `WOLFRAM_APP_ID_RESEARCH`, `SHODAN_API_KEY`, `ABUSEIPDB_API_KEY`, `VIRUSTOTAL_API_KEY`, `GITHUB_TOKEN`, `HF_TOKEN`, `NASA_API_KEY`, `NASA_FIRMS_KEY`, `NEWSAPI_KEY`, `OPENAQ_API_KEY`, `OPENWEATHER_API_KEY`. The archive additionally references `KIMI_K3_API_KEY`.

Note: stored secret **values** cannot be read back or displayed — they are write-only to the runtime. New ones can be added at any time; the tools that lack a key are shown as locked in the Tools catalog rather than failing silently.

---

## 8. Technical notes

- New code lands in `packages/brain-core/` as a workspace package with the same import-path discipline as `field-kernel-core`; `src/core/**` gets thin re-export shims so no existing import path breaks.
- Node-only APIs (`node:worker_threads`, `node:fs`) are confined to the daemon package; the browser build uses the existing `WorkerPool`/`workerPoolFallback`.
- Nothing under `src/routes/api` gains unauthenticated write endpoints; the daemon connection is local-only by default.
- Determinism is preserved: no RNG in physics paths, worker results merged in traversal order.
