# Ω-MAP — a clean, unbiased structural self-map for the brain

## The problem

The machine can already answer *"is module X alive?"* (`selfRegistry` probes liveness and
metrics). It cannot answer the three questions that turn telemetry into leverage:

1. **What is this module, structurally?** — its inputs, outputs, units, native rate, and the
   modules it depends on / feeds.
2. **What could it do that it is not doing?** — declared affordances, explicitly labelled as
   unproven potential, never as capability.
3. **Which combinations are unused?** — producer→consumer pairs where both endpoints exist but
   nothing connects them; that is where actual potential sits.

Today that knowledge lives in prose (`docs/BRAINMAP.md`) and in the agent's head. The brain
itself has no structured, non-biased handle on it, so it cannot cross-correlate its own parts.

## The approach

Add a **Capability Atlas**: one static, epistemically-labelled description per module, joined at
runtime with the live registry. Static facts and measured facts stay in separate fields and are
never merged into a single confident sentence.

Cleanliness rules (enforced by the battery):
- Every atlas entry cites a real source path; a path that does not exist fails the test.
- Every atlas id must exist in the live registry, and vice versa — no orphan claims either way.
- Affordances carry `[SPEC]` and are rendered as *potential*, never as ability.
- No fabricated numbers anywhere: unmeasured is `null`, absent is `absent`.

## What gets built

### 1. `src/core/self/atlas.ts` — the vocabulary + the atlas
Per module: `id`, `layer` (sense / field / memory / knowledge / analysis / cognition / governance /
ui), `does` (one verified line), `inputs` / `outputs` (typed ports with unit and native Hz where
the rate is a real design constant, else null), `dependsOn`, `feeds`, `affordances`
(`{ what, requires, label: 'SPEC' }`), `limits` (hard constraints: determinism, RAM budget, O(n²)
estimator cost), and `evidence` (test file that certifies it).

Covered modules, matching the existing registry ids: `engine.host`, `engine.field`, `engine.web`,
`engine.spectral`, `engine.sense`, `engine.mind`, `memory.substrate` (L0–L6), `memory.sensory`,
`knowledge.corpus`, `knowledge.genome`, `analysis.spine`, `analysis.ledger`,
`analysis.consolidation`, `learn.tiers`, `runtime.governor`, `ui.workstation`.

### 2. `src/core/self/crossMap.ts` — the cross-correlation engine
Pure function `crossMap(atlas, registry)` returns:
- **edges**: `wired` (declared feed with both ends live), `cold` (declared feed, an end dormant),
  `broken` (declared feed, an end absent).
- **opportunities**: port-compatible producer→consumer pairs that are *not* declared as feeds —
  ranked by (both ends live) → (rate compatibility) → (layer distance). Each carries the concrete
  reason it is possible and what would have to be true to use it. Labelled `[SPEC]`.
- **gaps**: outputs nobody consumes, inputs nobody supplies.

Deterministic: same atlas + same registry ⇒ byte-identical result (sorted, no clock reads).

### 3. Wiring into the self pack
- `SelfPack` gains `map: CrossMap`.
- `buildSelfBlock` gains a compact **STRUCTURAL MAP** section: layer counts, wired/cold/broken
  edge counts, top unused pairings — with an explicit line stating that opportunities are
  hypotheses, not features.
- New tool `self_map({ module?, kind? })` returning the atlas entry plus its edges, gaps and
  opportunities, so the model can reason about combinations instead of guessing.

### 4. UI — `SelfDeckPanel` "STRUCTURE" strip
Three columns: **wired** (green), **cold/broken** (amber/red), **unused potential** (dim, marked
SPEC). Each row shows producer → consumer, the port, and the live state of both ends. Uses the
existing deck styling and semantic tokens.

### 5. `docs/BRAINMAP.md` amendment (Law A4: map before code)
New `§ Capability Atlas` section stating the atlas is the machine-readable projection of this
document and that the two must agree; the battery enforces the agreement.

### 6. Battery — `test/self/o1-atlas.test.ts`
- Every atlas source path exists on disk.
- Atlas ids ≡ registry ids (both directions).
- Every affordance is `[SPEC]`; no affordance appears in `does`.
- `crossMap` determinism, edge classification, and no self-loops.
- No entry contains mock/simulated content markers.

## Notes

No engine math, no field logic and no memory behaviour changes — this is a description layer over
what already exists. If a module is dormant it stays dormant; the map just makes that legible.
