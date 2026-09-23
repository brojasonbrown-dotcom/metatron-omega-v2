# Ω-MEMORY — one complete memory architecture

Goal: finish the memory system so recall is **multi-modal, resonance-scored, age-fair, provenance-aware and budgeted**, reusing what already exists. No parallel stack, no duplicate store, no engine regression.

## 0. What already exists (keep, do not rebuild)

| Layer | File | State |
|---|---|---|
| L0 field tape | `src/core/memory/FieldTape.ts` | done |
| L1 Hebbian | `HebbianMatrix.ts` | done |
| L2 episodic | `EpisodicStore.ts` | done |
| L3 φ-patterns | `FibonacciPatterns.ts` | done |
| L4 pathways | `PathwayGraph.ts` | done |
| L5 journal | `TextJournal.ts` | done |
| L6 reflective | `ReflectiveIndex.ts` | done |
| L-S sensory / percepts / vision | `src/core/sensory/*`, `PerceptRegistry.ts`, `VisionFieldIndex.ts` | done |
| Knowledge cascade C0–C4 | `src/core/knowledge/KnowledgeBase.ts` | done |
| Persistence | `LocalArchive.ts` (OPFS), `MemoryPersistence.ts` | done |
| Capture orchestration | `MemoryCaptureKernel.ts` + `PhiLockScheduler` | done |

Everything below **extends these files**. Nothing in `packages/trnn-core` is touched — engine determinism is untouched by design.

## 1. Gaps found (measured, not assumed)

1. **No resonance score.** Recall ranks on text channels only; live field state (cosine to Ψ, coherence, closure γ) never weights a hit. The reference project solves this with a geometric-mean resonance; we have the telemetry already and do not use it.
2. **No age fairness.** Top-N flat cut means old-but-decisive material is silenced forever. Reference uses Fibonacci-banded quotas per age band.
3. **No cross-scale binding.** Memories are not tagged with the rung/scale that was dominant at capture, so a memory formed at rung 3 cannot be linked to its φ-ratio partner at rung 8.
4. **No multi-modal weave.** Text, journal, episode, percept and vision hits are separate queries; one cue does not reconstruct the whole moment.
5. **No provenance / contradiction ledger.** Nothing records where a chunk came from, or that two chunks disagree.
6. **No unified tuning dial.** `MemoryPolicy.ts` exists but is not φ-derived across recall depth, sweep rate, η and chunking, and is not exposed as one control.
7. **No consolidation plane.** Nothing clusters near-duplicate chunks into prototypes or compacts sub-floor material, so the corpus grows monotonically.

## 2. Design — five planes over the existing layers

Adopting the plane separation from the uploaded memory plan, mapped onto our files:

- **A Data** — existing L0–L6 + knowledge corpus. Unchanged.
- **B Retrieval** — new `RecallCascade` wrapper that fuses knowledge hits with episodic/percept/vision hits and applies resonance + banding.
- **C Write** — `MemoryCaptureKernel` gains scale tagging and a write gate driven by policy.
- **D Consolidation** — new background pass on a φ-lock phase: prototype clustering, decay, compaction.
- **E Governance** — `MemoryPolicy` becomes the single φ-derived dial; `MemoryGovernor` keeps the byte budgets.

## 3. Work items

### M1 — Resonance scoring (`src/core/memory/Resonance.ts`, new)
Geometric mean over four measured channels, so one dead channel vetoes:
`R = (fieldCos · coherence · closureγ · recencyφ)^(1/4)`, each channel abstaining (excluded) when unmeasurable rather than scoring 0. Floor = the emergent residual constant already in `WolframVerified.ts`. Sub-floor memories decay faster; matching memories decay slower.

### M2 — Scale banding
Every stored item gains `rung` (0..17) and `bandEnergy` at capture time, read from the live ladder snapshot. `crossScaleAffinity(a,b)` links items whose rungs sit at a φ-ratio, giving recall a legitimate long-range hop that is not lexical.

### M3 — Fibonacci age banding (`fibonacciBandedSelect`)
Replace the flat top-N in `KnowledgeBase.recall` and `MemoryStore.recall` with band quotas 1,1,2,3,5,8,13,21… per age band. Guarantees ≥1 slot per band; recency still dominates by quota shape, never by exclusion.

### M4 — Multi-modal weave (`src/core/memory/Weave.ts`, new)
One cue → one scan → strands grouped by modality (text, document, journal, episode, percept, vision). Reports its own coherence as the geometric mean of strand agreement × modality spread × resonance mass. Read-only over existing indices — no new store.

### M5 — Provenance + contradiction ledger
Extend `types.ts` `KChunk` with `source`, `fetchedAt`, `trust`, and add a `contradicts: string[]` edge set maintained by the consolidation pass when two chunks share high lexical overlap but opposite polarity terms. Recall surfaces the conflict instead of silently picking one.

### M6 — Consolidation plane (`src/core/memory/Consolidator.ts`, new)
Runs on a φ-lock phase (F13 by default): near-duplicate clustering into prototypes, Hebbian pruning below floor, journal compaction, cold-tier migration to OPFS. Every pass emits a report; nothing is deleted without a ledger line.

### M7 — One tuning dial
`MemoryPolicy` exposes `aggression ∈ 1..13` deriving recallK (Fibonacci ladder), sweep Hz, η = φ⁻⁴ at neutral, chunk/stride chars, decay factor and consolidation cadence — all closed forms of φ. Persisted, live-read, no restart.

### M8 — UI (`CognitionPanel.tsx`, existing sub-decks only)
Add to the existing decks — no new tab: RECALL shows per-channel evidence + resonance + band, SUBSTRATE shows consolidation reports and budgets, plus the single aggression dial. Existing panels keep their current readouts.

### M9 — Tests
`src/test/memory/*`: determinism (same capture sequence ⇒ identical snapshot), banding quota invariants, resonance abstention semantics, weave coherence veto, consolidation never loses a cited chunk.

## 4. Tool arsenal repair (parallel, independent of memory)

Live smoke test of all 152 tools: **106 pass, 46 fail**. Real defects, grouped:

- **Dead upstreams (replace endpoint):** `usgs_volcanoes` (404), `greynoise` (v3 community removed), `coincap`, `quotable`, `open_library`, `worldtime`, `bgpview` — swap to live equivalents or retire.
- **Wrong request shape (our bug):** `otx` (indicator type interpolated wrong), `dns_resolve` (type field), `nws_alerts` (area must be a US state code), `wikidata` (needs SPARQL, not a phrase), `exoplanet_archive` (needs ADQL), `overpass` (needs OverpassQL), `common_crawl` (index listing), `ripe_stat` (endpoint enum), `nominatim_reverse`/`open_meteo`/`open_meteo_air` (lat/lon required, must fail with a clear reason not `undefined` in the URL), `mitre_attack`, `wikipedia_geo` (error object not stringified).
- **Now key-gated:** `threatfox`, `urlhaus` (auth-key required since 2024), `imf_dataflow` (403 UA block).
- **Slow (raise timeout / cache):** `core_ac_uk`, `celestrak`, `gdelt`.
- **Missing keys:** `OPENWEATHER_API_KEY`, `VIRUSTOTAL_API_KEY`, `ABUSEIPDB_API_KEY`, `NEWSAPI_KEY` — all free tiers.
- **Add from the reference arsenal (browser-safe only):** `weather`, `air_quality`, `uv_index`, `sunrise_sunset`, `earthquakes`, `solar_weather`, `iss_position`, `nasa_apod`, `nasa_neo`, `mars_rover`, `wikipedia`, `country_info`, `patents`, `sec_edgar`, `coingecko`, `opensky`, `rdap`, `favicon_hash`. The reference's `fs_*`, `input.*`, `shell_exec`, `project.*`, desktop and clipboard tools are native-host only and are **excluded** — they cannot work in this runtime and would be dead entries.
- Every fix is verified by re-running the same live smoke harness; the target is 0 non-key failures.

## 5. Out of scope here
Self-measurement and prediction (self + past ⇒ future across all stable scales) is the **second** plan, written once memory is complete, since it consumes the weave and the scale bands defined above.
