# Ω-CAD/BIM · Multimodal Acquisition and Descriptor Learning

## What I checked first

- `src/core/knowledge/Acquisition.ts` — the learning loop searches through 9 keyless channels but **fetches through exactly one tool**: `web_fetch`. Every document that is not plain HTML text is dropped as "thin content".
- `src/lib/chat/tools/intelMeta.ts` — 154 tools across 11 categories. There is **no CAD, BIM, geometry or OCR category**, and the only vision tool is `locate_anything` (Grounding-DINO via HF).
- `src/core/sensory/` — a full vision stack already exists (`VisionEncoder`, `VisionProjection`, `SimHashPhi`, `PhiLattice`, `VideoCortex`) but it is wired to live camera/screen frames, not to the knowledge base.
- The uploaded `Unlimited-OCR-main.zip` is Baidu's OCR **model repo**: `infer.py` plus an sglang GPU wheel. It is Python + CUDA. It cannot run in this app's Cloudflare Worker runtime or in the browser — so no, OCR-Unlimited is **not** implemented here today, and it cannot be dropped in as-is. The plan below gives it a real home as an optional sidecar, alongside two tiers that work with zero setup.

## Goal

Give the brain three new abilities, all feeding the same genome/recall substrate:

1. Read CAD/BIM documents (drawings, models, schedules) instead of only HTML.
2. Describe geometry with **deterministic** descriptors — line strength, densities, spatial layout, topology, φ-octave scale-space — so the learning is reproducible, not model-dependent.
3. Use a vision LLM only as a *labeller* on top of those descriptors ("this cluster of lines is a door swing"), with lower trust than the measured features, so the two never get confused.

## Phase 1 — Acquisition becomes multi-tool

Today: `fetchCycle` calls `web_fetch` on everything.

Change it to a **typed adapter table**. Each frontier item is classified by URL/extension/content-type, then routed:

| Kind | Adapter |
| --- | --- |
| HTML/text | `web_fetch` (unchanged) |
| PDF (papers, spec sheets, drawing sets) | pdf text extraction → OCR ladder for image-only pages |
| Image (`.png/.jpg/.tif`, drawing scans) | OCR ladder + descriptor pipeline (Phase 3) |
| CAD vector (`.dxf`, `.svg`, `.step`) | parser → geometry graph → descriptors |
| BIM (`.ifc`) | schema-aware parser → entity/property extraction |
| Mesh (`.stl/.obj/.gltf`) | topology + shape descriptors |
| Structured (JSON/GraphQL sources) | direct tool result ingest, no fetch |

Failures stay failures — the loop never invents content, matching the existing contract. Per-adapter counters land in the run state so the panel shows which tools are actually feeding the corpus.

## Phase 2 — CAD/BIM tool arsenal

New `cad` and `bim` categories in the tool registry, keyless where possible:

- **buildingSMART bSDD** — official IFC/BIM classification dictionary API (free, no key). Classes, properties, units — the vocabulary the brain needs to know what an IFC entity *means*.
- **IFC schema reference** — IFC4/4.3 entity + property-set lookup.
- **Speckle** — open-source AEC data platform GraphQL API for public streams.
- **OpenStreetMap 3D buildings** via the existing `overpass` tool — real building footprints/heights.
- **Thingiverse / Printables** search — open mesh models for descriptor training material.
- **NIST STEP / CAx-IF test suites** — canonical STEP files, ideal deterministic training fixtures.
- **Wikidata + Crossref/arXiv** (already present) scoped to CAD/BIM/geometry queries.
- Key-gated, only if you want them later: Autodesk Platform Services, Onshape, BIMobject.

Plus a query plan variant: when the field is CAD/BIM-flavoured, seed queries expand into standards (IFC, COBie, ISO 19650), geometry kernels (OpenCascade, CGAL), and drawing conventions.

## Phase 3 — Deterministic geometry descriptors

New `src/core/geometry/` module. Every descriptor is exact arithmetic over the existing Kahan/`dmath` primitives, so results are bit-reproducible:

- **Line strength / orientation** — structure tensor + a φ-spaced angular Hough accumulator (14 bins matching the existing Goertzel mode ladder). Gives dominant axes, orthogonality score, hatch detection.
- **Density fields** — multi-resolution ink/entity density on a φ-octave pyramid; ties directly into the existing scale-rung binding so a drawing is captured at the rung its detail actually occupies.
- **Spatial layout** — quadtree occupancy hashed into the same barcode format the KB already uses, so geometry is searchable by the existing LSH bands with no new index.
- **Shape moments** — radial/angular Fourier moments (rotation-invariant), reusing the per-node radial transformer maths already in `trnn-core`.
- **Topology** — connected components, loop count, Euler characteristic via union-find; for meshes, genus and boundary count.
- **Symmetry / repetition** — autocorrelation peaks (same γ machinery as `closure.ts`) to detect grids, module spacing, repeated assemblies.

Output is a fixed-width descriptor vector, projected into the existing chunk vector space so a drawing and a paragraph live in one recall cascade.

## Phase 4 — OCR ladder (three honest tiers)

A probed tier ladder, exactly like the existing LEARN-deck tier pattern — each row shows evidence or the reason it is off:

1. **Browser tier** — Tesseract WASM, offline, zero setup. Good for clean printed text and title blocks.
2. **Gateway tier** — vision model through Lovable AI Gateway. Handles rotated text, handwriting, tables, dense drawing annotation. Costs credits; surfaces gateway 402/429 states properly instead of silently failing.
3. **Sidecar tier** — the uploaded Unlimited-OCR. You run it where a GPU exists; the app probes a URL you paste (same mechanism as the existing omega-train sidecar) and uses it when reachable. This is the only way that repo can be used — it is a CUDA/sglang service, not browser code.

Every OCR result carries its tier and a confidence, stored as chunk provenance/trust.

## Phase 5 — Cross-modal genomes

The point of all of the above: one chunk can now carry both a measured descriptor and a linguistic label.

- A CAD/image chunk stores the deterministic descriptor vector **and** the caption text, with the caption tagged as model-derived (`trust < 1`) versus first-party measurement (`trust = 1`).
- A new correlation pass binds descriptor↔caption pairs into the Hebbian/concept graph, so recalling "door swing" retrieves the geometry, and recalling similar geometry retrieves the term.
- Contrastive nudging (already planned in Ω-VEC Phase 6) reuses these pairs as its positive set — the labels become free training signal for the vector layer.
- Consolidation gains a rule: two descriptors that are near-identical but carry conflicting captions are flagged as contradictions rather than silently merged.

## Phase 6 — UI

- **LEARN deck**: OCR tier ladder with probe/evidence rows; per-adapter acquisition counters (which tool fed how many chunks, how many failed and why).
- **COGNITION deck**: a drop target for local CAD/BIM/image files — everything parses on-device, nothing uploads unless you choose the gateway OCR tier.
- Descriptor readout on a recalled geometry chunk: dominant axes, density, topology, symmetry, with the caption shown separately and clearly marked as model-derived.

## Verification

- Deterministic fixtures: the NIST STEP suite and a handful of synthetic DXFs; descriptors must be bit-identical across runs and invariant to translation/rotation where the maths says they should be.
- Adapter routing tests: each file kind reaches its adapter, and unsupported kinds fail loudly rather than ingesting empty text.
- Abstention tests: with no OCR tier reachable, image ingest reports a failure instead of producing a blank chunk.
- No regression on the existing recall cascade — text-only recall scores must be unchanged when no geometry is present.

## Technical notes

- Parsers run client-side (WASM/pure TS): DXF and SVG are pure TS; IFC and mesh loading use WASM builds that work in the browser. Nothing Node-native reaches the Worker.
- Descriptors are computed in a worker so a large drawing does not stall the field stage.
- No engine, ladder or field code is touched. This is additive: a new geometry module, new adapters inside `Acquisition.ts`, new tool rows, and new panel sections.

## Sequencing

Phase 1 + 2 first (multi-tool acquisition and the CAD/BIM sources) — that alone stops the loop from being web-page-only. Then Phase 3 (descriptors), Phase 4 (OCR ladder), Phase 5 (cross-modal genomes), Phase 6 (UI) last.
