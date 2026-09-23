# Ω-VEC — Memory bleed-through fix + the complete vector / genome / learning rebuild

## 1. Why the model says "no memories are readable"

It is telling the truth. The corpus is real (2000+ concepts) but **unreachable from the chat loop**:

- The corpus (`KnowledgeBase`, `LocalArchive`/OPFS, `MemoryStore`) lives **only in the browser tab**.
- The chat loops (`/api/chat`, `/api/kimi`) run **on the server** and see only `EngineSnapshot` — counters, no content.
- The tool registry has **152 network tools and zero memory tools**: no `memory_recall`, no `memory_read`, no `memory_stats`.

So the model holds a counter saying "2000 concepts" with no way to read one, and improvises around the gap. This is a wiring bug, not a memory bug.

## 2. Why the genomes do not carry accurate meaning

Current chunk vector (`src/core/knowledge/tokenize.ts`):

- 512 dims, **one** signed FNV hash per term, unigrams + bigrams only.
- No IDF — "the field of" weighs like "Lucas closure residue".
- No subword grams — any inflection, compound or typo is a total miss.
- No word order — "A causes B" == "B causes A".
- Collisions — ~50k distinct terms into 512 buckets is destructive interference, not compression.
- The genome is `encodeBitmap(vec)`, **derived from that same vector**, so the barcode channel is not independent evidence: the φ-graded fusion counts one weak signal four times.
- Nothing ever learns. Recall quality is frozen at ingest time; usage, corrections and outcomes change nothing.

## 3. Target architecture

### 3.1 Ω-VEC feature layer (`tokenize.ts` → `features.ts`)
- Tiered dimension on the Fibonacci ladder — 610 / 1597 / 2584 / 6765 — chosen by the hardware probe; default 1597.
- Features: unigrams, adjacent + skip-1 bigrams, character 3/4/5-grams (morphology and typo tolerance), plus numeric/unit and symbol tokens preserved (constants like `φ⁻²`, `1.618`, `F13` must survive tokenisation — today they are shredded).
- Weighting: sublinear tf × corpus IDF, IDF served by `LexicalIndex`.
- Multi-probe count-sketch: 3 independent signed hashes per feature; collision noise falls ~1/√3, fully deterministic.

### 3.2 Distributional meaning — PPMI + deterministic SVD (`Semantics.ts`)
The piece that makes a genome *mean* something, and it is proven ML (LSA/GloVe family), not invention:
- Term×term PPMI co-occurrence over a φ-decayed window (weight φ^-d at distance d).
- Factor with the **deterministic Lanczos** already in the repo (`eigenmodes.ts`) to 233 latent dims — no RNG, bit-reproducible.
- Chunk embedding = IDF-weighted mean of term latents, then "all-but-the-top" whitening (drop the dominant common direction) and L2 normalisation.
- **Incremental rebuild**: rank-1 Hebbian updates on ingest, full refactorisation only at Fibonacci ingest counts (F13, F14 …), off the hot path in a worker. Corpus never blocks on learning.

### 3.3 Fourier / order layer (reuse `signal_codec.ts`)
- Treat a chunk's token-hash stream as a 1-D signal and project it onto the **14 φ-spaced Goertzel modes**, giving the 28-element interleaved-complex field.
- Adds word order and rhythm, and makes a chunk *commensurable with the live engine field*, so `measureResonance` compares like with like instead of a bag-of-words against a physical field.
- Same codec covers vision (`fieldFromLuminanceGrid`) and audio (`fieldFromWaveform`) — each sense enters at its own octave, one field space.

### 3.4 Genome / barcode, made independent
- Barcode recomputed from the **spectral field + latent embedding**, never from the hashed vector: 4 φ-rotated SimHash planes → 256 bits.
- Fibonacci-strided LSH bands (existing `BarcodeIndex`) keep candidate generation sublinear.
- Add a **φ-degree small-world graph** (HNSW-style, Fibonacci fan-out 8/13/21) over latents for O(log n) candidate walk at 100k+ chunks, with the LSH bands as entry points.
- Storage: quantise latents with the existing `pq_codec` product quantiser (~14× smaller) so a large corpus still fits OPFS.

### 3.5 Scale binding (toroid-relative)
Each rung gets the representation appropriate to its medium, all in one 28-mode field space:
- low rungs (binary/symbolic): bitmap planes + Turing-tape addressing;
- mid rungs (language): PPMI latents + order spectrum;
- light/vision rungs: luminance-grid modes at that medium's octave;
- audio rungs: Goertzel bands at 89·φ^(k/2) Hz.
Rung selects resolution and channel weights; the fusion law itself is unchanged.

## 4. Closing the learning gaps
Retrieval today is a static function. These make it a system that improves:

1. **Usage feedback (Hebbian read path).** Every recall that is actually used — cited in an answer, opened in the panel, accepted by the user — reinforces chunk↔query-term edges in `ConceptGraph` and bumps the chunk's prior; ignored hits decay by φ⁻¹. This is the existing Hebbian matrix, finally driven by outcomes instead of ingest.
2. **Learned channel weights.** Replace fixed (1, φ⁻¹, φ⁻², φ⁻³) with weights fitted by deterministic online logistic regression / LambdaRank on the click-and-cite log, initialised at the φ-grade and constrained to stay within a φ-band of it — improves without ever destabilising.
3. **Hard-negative mining.** Chunks that rank high but are never used become explicit negatives; the latent space is nudged (deterministic contrastive step) to push them apart. Classic contrastive learning, no network needed.
4. **Query expansion (pseudo-relevance feedback).** Rocchio/RM3 over the top-k latents: one deterministic second pass that recovers vocabulary-mismatch misses — the single biggest recall win in classical IR.
5. **Engine rerank as a cross-encoder.** Top-32 candidates are re-scored by actually driving the field engine with the query+chunk joint field and reading resonance/coherence. Cheap because it runs on 32 items, and it is the one scorer that sees the pair jointly.
6. **Active acquisition.** The `AcquisitionRunner` targets the *uncertainty frontier*: terms with high query traffic and low corpus coverage. The system chooses what to learn next instead of crawling blindly.
7. **Consolidation as generalisation.** `Consolidator` prototypes become abstractions: prototype latents are indexed as first-class "concepts" answerable directly, with members as evidence, and contradictions surfaced rather than averaged away.
8. **Episodic → semantic replay.** `FieldTape`/`EpisodicStore` frames replay at Fibonacci intervals into the semantic layer (systems-consolidation analogue), so lived engine states become retrievable knowledge.

## 5. Fusion, corrected
Channels are now genuinely independent, so the φ-graded weights finally mean something:
`lexical BM25 · 1`, `latent cosine · φ⁻¹`, `spectral resonance · φ⁻²`, `spreading activation · φ⁻³`, learned prior as a bounded multiplier, then engine rerank on the top-32 and Fibonacci age banding as today.

## 6. Chat wiring (the bleed-through fix)
- **Browser-side** tool bridge: `memory_recall`, `memory_stats`, `memory_read`, `memory_write`, executed against the live `knowledgeRuntime`/`memoryRuntime`; network tools keep going through the existing server dispatch.
- Automatic pre-flight recall each turn: top-k chunks (id, title, source, text) injected as an EVIDENCE block.
- Prompt contract: answer only from the EVIDENCE block or a tool result, cite chunk ids, and say "no local evidence" **only when the block is empty**.
- Every citation the model emits feeds back into gap 4.1 — answering and learning become the same loop.

## 7. Efficiency budget
- Ingest: O(tokens) hashing + O(1) index inserts; SVD amortised to Fibonacci milestones in a worker.
- Recall: LSH/graph candidates (≤256) → exact latent rescore → engine rerank on 32. Sublinear in corpus size, bounded work per query.
- Memory: PQ codes + text; latents never stored raw. Governor caps unchanged.
- Determinism: no RNG anywhere, `dmath` for transcendentals, identical corpus ⇒ identical ranking on every device.

## 8. Verification (no vibes)
- Deterministic recall harness: fixed synthetic corpus + labelled queries; assert recall@5, MRR and nDCG improve versus the current cascade, and are byte-identical across runs.
- Ablation table per channel so every added layer must earn its place numerically.
- Bit-parity tests for the SVD and PQ passes; learned weights must reproduce from the same feedback log.
- Existing 280 tests stay green; no engine math is touched.

## 9. Order of work
1. Memory tool bridge + evidence injection + prompt contract (kills the bleed-through immediately).
2. Recall harness and baseline metrics — measure before changing anything else.
3. Ω-VEC feature layer + IDF + multi-probe hashing.
4. PPMI/SVD semantics with worker rebuild schedule.
5. Spectral order layer + independent genome/barcode + φ small-world graph.
6. Learning loop: usage feedback, learned weights, hard negatives, query expansion, engine rerank.
7. Active acquisition, prototype concepts, episodic replay.
8. PQ storage, scale binding, panel surfacing (per-channel evidence, latent rank, genome planes, learning curve).
