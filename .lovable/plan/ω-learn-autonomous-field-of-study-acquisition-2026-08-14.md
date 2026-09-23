# Ω-LEARN — Autonomous Field-of-Study Acquisition

Merge LEARN + MEMORY into one cognition deck, then build a real learning machine behind it: type a field of study, flip the toggle, and the brain acquires it — searching, reading, crawling, parsing documents and CAD/BIM models, distilling to structured knowledge, and folding that knowledge into the Ω memory substrate as resonant field state.

Current state confirmed by reading the code: `LEARN` (`LearnDeckPanel`) shows Ω-P8 gain certificates and the held-out battery; `MEMORY` (`MemoryDeckPanel`) shows the 8-layer substrate driven by `memoryRuntime.ts` over IndexedDB. There is a 135+ tool arsenal in `intelMeta.ts` dispatched by `dispatch.functions.ts`, an LLM route at `src/routes/api/kimi.ts`, and no backend yet (`src/integrations` does not exist).

## Stage 0 — Tab merge (no behaviour change)

One `LEARN` tab replaces both. Inside it, a segmented sub-deck bar:

```text
LEARN
├─ ACQUIRE    (new — topic field + activation toggle + live run)
├─ CORPUS     (new — sources, documents, extracted facts)
├─ SUBSTRATE  (existing MemoryDeckPanel, unchanged)
└─ CERTIFY    (existing LearnDeckPanel, unchanged)
```

Both existing panels move as-is — zero regression to the Ω-P8 certificates or the memory runtime. The `MEMORY` tab id is retired but deep-links to `learn#substrate`.

## Stage 1 — Cloud backend

Enable Lovable Cloud. Schema (each table with explicit grants + RLS, owner-scoped):

- `fields` — a field of study: name, brief, status, autonomy mode, budgets, mastery score
- `sources` — every URL/file/API result: origin, kind, fetch time, hash, trust weight
- `documents` — normalised text + metadata, chunked
- `chunks` — text chunk + embedding vector + Zeckendorf/gematria address + bitmap fingerprint
- `facts` — extracted triples/claims with provenance, confidence, contradiction links
- `concepts` — the ontology the brain builds for the field, with edges
- `runs` / `run_steps` — full audit trail of every tool call, token, and cost
- `artifacts` — uploads and generated CAD/BIM/3D files in Cloud storage

Vector search via pgvector; hybrid BM25 + vector + the existing bitmap LSH retrieval.

## Stage 2 — The acquisition loop

A server-side orchestrator (server function for interactive runs, `/api/public/*` job endpoint for continuous runs so learning survives a closed tab).

```text
PLAN → SEARCH → FETCH → PARSE → DISTIL → VERIFY → INTEGRATE → CRITIQUE → (loop)
```

- **PLAN** — LLM decomposes the field into a syllabus: subfields, key questions, canonical sources, success criteria. Stored as the run's curriculum so progress is measurable, not vibes.
- **SEARCH** — fans out across the existing arsenal (Wikidata, Crossref, Semantic Scholar, arXiv, PubMed, Europe PMC, news, HN, Reddit, GitHub, Wayback) plus the new business/CAD tools below.
- **FETCH** — web reading and scraping through the gateway scrape route, HTTP probe, sitemap/robots-aware crawl with per-domain rate limits, link following bounded by depth and relevance score, and a grep/regex pass over raw text.
- **PARSE** — HTML→markdown, PDF/DOCX/XLSX/PPTX via document parsing, CSV/JSON tables, and the CAD/BIM parsers below.
- **DISTIL** — chunk, embed, extract claims + entities + relations with citations. Every fact carries a source id; nothing enters the corpus uncited.
- **VERIFY** — cross-source agreement scoring, contradiction detection, recency and trust weighting, numeric sanity checks through Wolfram. Low-confidence facts get quarantined, not stored as truth.
- **INTEGRATE** — write to Cloud, then drive the Ω substrate: each chunk becomes a bitmap fingerprint / Zeckendorf address, folded through `tickMemory` + `LearningEngine.observe` so the field state actually carries the knowledge, and the retained RAM barcode is what retrieval resonates against.
- **CRITIQUE** — the LLM self-tests against the curriculum (generated Q&A held out from ingest), scores mastery per subfield, and emits the next round of gaps. This is the loop condition.

**Autonomy**: toggle ON = continuous loop until stopped or budget hit. `SINGLE PASS` button = one bounded sweep with a report. Budgets (pages, depth, tokens, wall-clock, cost) are UI-editable and hard-enforced server-side; every run is pausable and resumable.

## Stage 3 — Tool expansion

New tools registered in the same `intelMeta`/dispatch pipeline, so they appear in the TOOLS catalog and are callable by the LLM:

- **Business & registries** — SEC EDGAR full-text + filings, Companies House, OpenCorporates, GLEIF LEI, World Bank / IMF / OECD / Eurostat statistics, FRED, UN Comtrade, patents (EPO OPS / PatentsView), standards metadata (ISO/IEC catalogues).
- **Business knowledge** — open management/strategy literature via the scholarly tools, plus structured frameworks (org design, lean/six-sigma, PMBOK process maps) captured as concept graphs rather than prose.
- **CAD / BIM / 3D — read**: IFC (BIM: spaces, storeys, elements, quantities, schedules, property sets), STEP/IGES, DXF/DWG-export, OBJ/STL/PLY/glTF, point clouds; extract geometry stats, topology, BOM/quantities, and material data as structured facts.
- **CAD / BIM / 3D — generate**: parametric emission to OpenSCAD, DXF, glTF and IFC, evaluated by re-reading the output (closed learning loop: generate → parse → score → correct).
- **3D viewport** — an in-app viewer to inspect uploaded or generated models, with the extracted quantities overlaid.
- **Your documents** — upload contracts, plans, spreadsheets, drawings straight into a field; they get the highest trust weight and are learned first.

Open-source/API sources are used directly where they are free and open; nothing is fabricated, and any tool lacking a key shows as unavailable rather than silently degrading.

## Stage 4 — ACQUIRE UI

- Topic/field text input with a saved-field selector and per-field brief.
- Large activation toggle: `LEARNING ACTIVE` (continuous) with live pulse, plus `SINGLE PASS`.
- Live run console: current phase, tool calls streaming with results, pages fetched, chunks written, facts extracted, contradictions flagged, spend.
- Curriculum tree with per-subfield mastery bars, driven by the CRITIQUE self-tests.
- Corpus browser: sources, documents, facts with citations, concept graph, artifact/3D previews.
- Stop, pause, resume, and a full run audit trail in RUNS.

## Stage 5 — Verification

Deterministic-first: identical inputs produce identical chunking, addressing and fingerprints. Tests cover the parser set, the dedup/contradiction logic, budget enforcement, and substrate integration. The existing Ω-P8 certificate battery and the 249 core tests must stay green — the acquisition layer sits above the engine and never mutates certified cell math.

## Technical notes

- Orchestrator is server-side only; keys never reach the browser. Interactive control via `createServerFn`, continuous jobs via `src/routes/api/public/omega-learn.ts` with caller verification.
- LLM calls go through the existing gateway path with streaming, tool-calling, and strict schemas for fact extraction.
- Crawling respects robots.txt, per-domain concurrency caps and backoff; every fetch is hashed and cached so re-runs are cheap and reproducible.
- Substrate integration reuses `memoryRuntime`, `MemoryStore`, `tickMemory` and `LearningEngine` as-is — no rewrite of memory math in this plan.

## Next after this plan

You mentioned supplying additional math and memory algorithms. This plan deliberately keeps the memory/learning math untouched so it is a clean substrate to upgrade: once ACQUIRE is feeding real corpora, we replace the retrieval, resonance and consolidation algorithms as a separate, measurable step with before/after mastery numbers.
