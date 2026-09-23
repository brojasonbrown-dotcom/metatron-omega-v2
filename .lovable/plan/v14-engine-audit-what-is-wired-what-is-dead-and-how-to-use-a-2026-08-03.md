# V14 Engine Audit — What Is Wired, What Is Dead, and How to Use All of It

## Audit result (evidence-based, whole archive)

Vendoring is complete: all 65 TypeScript files from the upload are present in
`packages/brain-core/src`, plus the 4 V14 files we authored. Nothing was dropped.
Only runtime artifacts (`mind_state/*.json`, logs, the standalone `package.json`)
were left behind.

Utilisation is **not** complete. Measured by real import edges from `src/`:

| Layer | Files | Lines (approx) | Wired into app today |
|---|---|---|---|
| `config/*` (governor, brainConfig, hardwareProbe) | 3 | 430 | Yes — Brain Deck, budget, tiering |
| Laws / measurement operators (Burden, Continuity, Sphere, Perfection, Interference, Multiscale, Recursive) | 11 | ~6 300 | No |
| Node tree core (`fractal_node`, `fractal_node_engine`, `types`, `core/constants`) | 4 | ~2 500 | No |
| Field operators (actualization, complementary, existence, density, flow, membrane, resonance, scale map, torus, temporal, sphere geometry, self-measurement) | 12 | ~4 000 | No |
| `frameworks.ts` (F1–F9 catalogue) | 1 | 1 971 | No — app uses its own `src/core/frameworks/*` |
| `cognition/*` (hopfield, HNSW, PQ, concepts, lexicon, gate, drives, loop, prediction ledger, visual memory) | 14 | ~4 100 | No — `hopfield` name-matched only, not imported |
| `adapters/*` (LLM tools, sensors, voice, mind bridge) | 13 | ~2 900 | No — Node-only, needs the local daemon tier |
| `RHUFTFrameworks.ts` | 1 | 6 959 | **Dead on arrival** |
| Node runtime (`worker_pool`, `worker_script`, `compute_worker`, `run_mind*`) | 5 | ~2 000 | No — local-daemon tier only |

### Three hard findings

1. `RHUFTFrameworks.ts` (6 959 lines) imports `./v10/Toroidal`, `./v10/MesoTori`,
   `./v10/MicroTori`, `./v10/Thermodynamic`, `./v10/Molecular`, `./v10/Biological`,
   `./v10/EMFullSpectrum` — **none of which exist in the archive**. It is unreachable
   in the original project too (only a typecheck script names it). It cannot be wired
   as-is; it must be quarantined or its v10 dependencies reconstructed.
2. The browser-safe barrel `browser.ts` did not compile: 16 ambiguous `export *`
   collisions, plus real type errors in `GeometricReflection`, `SpherePrinciple`,
   `membrane_stabilizer`, `resonance_finder`. **Fixed in this pass** — the browser
   surface now typechecks clean. This was the gate blocking every wiring attempt.
3. Duplication is real, not cosmetic: vendored `frameworks.ts` overlaps
   `src/core/frameworks/F1..F9` and `src/core/runtime/rhuftf/*`. Wiring both would
   double-run physics. The V13 kernel stays authoritative; the vendored catalogue is
   used only where it adds operators V13 lacks.

## Plan

### Phase A — quarantine and truth (no behaviour change)
- Move `RHUFTFrameworks.ts` to `packages/brain-core/src/quarantine/` with a README
  recording the missing `v10/*` dependency set, so it stops appearing as live code.
- Add a repo check script that fails when a `brain-core` module has zero inbound
  edges and is not explicitly listed as daemon-only, so "unwired" can never drift
  silently again.

### Phase B — laws layer into the live tick (browser, no regression)
Run as **read-only observers** over the existing V13 field state, never as writers:
- `BurdenTracker`, `NecessityComplexity` → drives the existing coupled governor's
  complexity term with a measured burden instead of a static estimate.
- `PerfectionDeficit`, `SpherePrinciple`, `ContinuityLaw` → deficit / continuity
  telemetry, surfaced on the Brain Deck.
- `MultiscaleClosure`, `MultiscaleStabilization`, `RecursiveSelfMeasurement`,
  `InterferenceStructure`, `DimensionalStability`, `GeometricReflection` → per-scale
  closure and lock metrics feeding the existing scale ladder UI.
All behind one subsystem flag (`laws`) defaulting ON in Balanced tier and above,
evaluated on a φ-stride (every 8th tick) so the 64 Hz budget is untouched.

### Phase C — cognition substrate onto the existing memory deck
The app already has `src/core/memory/*` and the gematria kernel. Complement, do not
replace:
- `cognition/hnsw_index` + `cognition/pq_codec` → replace the linear scan in
  `PatternBitmapIndex` stage-2 with PQ-compressed HNSW recall (large win at scale).
- `cognition/concept_registry`, `lexicon`, `glossary` (browser-storage variant) →
  named concepts on top of the existing pattern store, shown in the MEMORY tab.
- `cognition/prediction_ledger` → wires directly into `LearningEngine`'s surprise
  signal to produce a real mastery metric.
- `cognition/linguistic_gate`, `drive_arbiter`, `thought`, `cognitive_loop` →
  gated behind the `cognition` subsystem flag, off by default until B and the
  index work are verified.

### Phase D — daemon tier for Node-only modules
`worker_pool`, `compute_worker`, `run_mind*`, `adapters/sensors/*`, `voice_out`,
`ollama_supervisor`, filesystem `memory_store`/`visual_memory` cannot run in the
browser or on the edge runtime. They belong to the already-designed **Local Daemon**
hosting mode: a documented `metatron-brain` local process the Brain Deck connects to
over WebSocket, with the UI degrading to browser-tier when it is absent.

### Phase E — formal certificates as live tests
`formal/*.wl` Mathematica certificates currently sit unused. Port their assertions
(φ³ = 2φ+1, gematria base closure, Hopfield energy monotonicity) into vitest cases
so the constants used by the running engine are continuously proven, not just
documented.

## Technical notes

- Everything in B and C is browser-safe and imports through
  `@metatron/brain-core/browser`; nothing in D may ever be imported from `src/`.
- No V13 engine is removed or replaced in any phase. New operators are additive and
  flag-gated, and every phase ends with a live-preview metric check.
- Ordering matters: A → B → C, with D and E parallelizable at any point after A.
