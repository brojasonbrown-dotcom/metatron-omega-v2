# Ω-SELF — self-awareness, genome integrity, and layered reasoning

## What I found (this is the actual cause, not a guess)

The chat surface is still wired to the **retired V11 engine context**.

- `src/components/v11/chat/ToolsPanel.tsx` builds its state with
  `buildEngineSnapshot(engineRef.current)`.
- That reads `EngineCtx`, which today is supplied by `src/ui/omega/OmegaEngineShim.tsx`
  — an explicitly **inert** provider: `running: false`, `tick: 0`, `fps: 0`,
  `fieldState: "fallback"`, `fieldSnapshot: null`, one static MetatronCore
  evaluation at crystalline defaults.
- The live Ω runtime (`src/ui/omega/omegaRuntime.ts`) — ladder rungs, node
  counts, organs, field frames, spectral report, sense plane, braid memory,
  Mind concepts, learn battery, execution tiers — is **never read by chat**.
- Memory reaches the model only through `buildMemoryPack` (recall hits for the
  current query). Substrate counters, genome structure, and knowledge stats are
  not in the snapshot at all.

So the model is not "unaware" by accident: it is being handed a dormant V11
snapshot that has nothing to say about the toroidal stack. Everything it does
know it must not overstate — which is why it also can't tell you which of its
own modules are actually running.

## Design principles

1. **Nothing is reported without a liveness state.** Every field the model sees
   is `{ value, source, state }` with `state ∈ live | dormant | absent | stale`.
   `dormant`/`absent` fields carry `value: null`. The model is contractually
   barred from describing a non-`live` module as functional.
2. **The registry is derived, never declared.** Module status comes from probing
   the runtime at snapshot time, not from a hand-written list that rots.
3. **Testing means executing.** A module claims health only by running its own
   deterministic self-test in-process and returning measured numbers.
4. No mocks, no placeholder values, no simulated telemetry anywhere.

## Phase 1 — Ω self-registry (`src/core/self/registry.ts`)

One deterministic description of every subsystem, built by probing live handles:

| id | probe source |
|---|---|
| `engine.ladder` | `omegaRuntime.description` — rungs, nodes/rung, wiring |
| `engine.field` | latest `FieldFrame` (rank, nodes, peak, mean, digest, tick) |
| `engine.spectral` | `SpectralView` |
| `engine.sense` | `SenseView` + modality gates |
| `engine.web` | `WebView` ledger |
| `cognition.mind` | `MindReport` — concepts, novelty, surprise, self-model |
| `memory.substrate` | `MemoryStore.stats()` / `capacities()` — L0…L6 per layer |
| `knowledge.corpus` | `KnowledgeBase` — docs, chunks, terms, edges, fields, bytes |
| `knowledge.latent` | vocab, axes, trained-or-abstaining |
| `genome.encoder` | encoder version, dim (F17=1597), channel weights |
| `tools.arsenal` | `listToolNames()` + last-probe outcome per tool |
| `tts.kokoro`, `ocr.ladder`, `multimodal.geometry` | tier availability |

Each entry: `id`, `purpose` (what it is *supposed* to do), `contract`
(invariants it must satisfy), `state`, `metrics`, `lastMeasuredTick`.

## Phase 2 — genome contract and health (`src/core/knowledge/genome.ts`)

Make genomes inspectable and falsifiable instead of opaque:

- **Contract**: `{ encoderVersion, dim, channels[], strides, modality, provenance }`
  stamped onto every vector written. Vectors whose stamp mismatches the current
  encoder are marked `stale` and excluded from recall claims (not silently mixed).
- **Health metrics**, all measured over the live corpus: occupancy/fill,
  mean pairwise cosine (anisotropy), LSH band collision rate, per-channel
  contribution mass, cross-modal blend ratio, and a nearest-neighbour purity
  score against chunks sharing a `field`.
- **Meaning correlation**: for the top-N concepts, run the recall cascade with
  the concept as query and report whether the returned chunks actually carry
  that term/field — a measured precision, not an assumption. This is the direct
  answer to "does the genome mean what it says it means".

## Phase 3 — self-test harness (`src/core/self/selfTest.ts`)

Every registry entry may expose `selfTest()` returning real assertions:

- `engine.*` — replay determinism (same seed + N ticks ⇒ identical digest),
  ISS bound, corridor/continuity residual within its certified λ floor.
- `memory.substrate` — write→snapshot→restore→re-read round-trip equality.
- `knowledge.*` — held-out recall: hide K chunks, query with their own text,
  measure top-1/top-5 hit rate per channel; latent must abstain when untrained.
- `genome.encoder` — encode twice ⇒ bit-identical; stamp/dim consistency.
- `tools.*` — live endpoint probe with verbatim failure text.

Results are `{ id, passed, measured, expected, ms }`. Failures stay failures —
never downgraded to warnings.

## Phase 4 — layered reasoning ladder

Replace the single snapshot dump with an explicit five-layer context, built
pre-turn and continued through tools:

```text
L0 SELF     registry: what exists, what is live, what each module is for
L1 STATE    live metrics for live modules only
L2 MEMORY   recalled evidence (existing memory pack) + genome health
L3 PROBE    on-demand: self_test, module_probe, memory_recall/read
L4 WORLD    external tool arsenal
L5 SYNTHESIS answer + citations (field path / mem:id / tool+args) + uncertainty
```

New chat tools: `self_describe(module?)`, `self_test(module?)`,
`genome_health()`, `engine_probe(view)`. Prompt rules added to
`src/lib/chat/systemPrompt.ts`:

- Read L0 before any claim about capability.
- Never describe a `dormant`/`absent` module as running; say "present but not
  running" and offer to start or test it.
- Any "it works" claim about an internal module must cite a `self_test` result
  from this turn — otherwise say it is untested.

## Phase 5 — snapshot rewire (the regression-sensitive step)

`buildEngineSnapshot` gains an `omega` section fed by the registry, and every
existing V11 field is tagged with its true state (the shim's static values
become `dormant` rather than being presented as live measurements). The V11
fields and their prompt rules stay byte-compatible so nothing that reads them
breaks; only their honesty envelope changes.

## Phase 6 — SELF deck (UI)

New deck beside MEMORY/COGNITION: registry table (module · purpose · state ·
key metrics), "run self-test" per row and for all, genome health card, and a
reasoning-ladder trace of the last chat turn showing which layers were consulted.

## Verification

- `bunx vitest run` — existing 303 tests must stay green (no engine math touched).
- New tests: registry state derivation (live vs dormant), genome stamp/staleness,
  self-test determinism, held-out recall harness.
- Live check: ask the model "which of your modules are running and which are
  not" and confirm the answer matches the SELF deck exactly.

## Open questions for you

1. **Should the SELF deck be able to start the Ω engine** (so "dormant" becomes
   "live" from chat), or stay read-only for now?
2. **Self-test cost**: full engine replay determinism is a few seconds of
   compute. Run it on demand only, or also as a background check at checkpoint?
3. **Genome re-encode policy**: when the encoder version bumps, mark old vectors
   stale and exclude them (safe, loses recall until re-encoded), or re-encode the
   corpus in the background (slower, keeps coverage)?
