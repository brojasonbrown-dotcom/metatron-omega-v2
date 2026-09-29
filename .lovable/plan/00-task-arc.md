The single rule that governs every task below: a change lands only after its
   replacement passes, and the full suite is green (your roadmap.md rule). No
   task ships in the same commit as a deletion that depends on it. Work goes
   through git to the Lovable-connected repo (free, two-way sync), not Lovable
   freeform chat.

   ────────────────────────────────────────────────────────────────────────────

   P0 — Foundation & governance

   • P0.1 Baseline capture. One active branch; run Vitest + tsgo typecheck +
     production build; record the green baseline (currently ~883/883) and a
     clean build-errors.log. If not green, fix that before anything else.
   • P0.2 Gate discipline. Codify the per-phase gate as a script (typecheck →
     suite → build → error-log) and run it after every task, not every phase.
   • P0.3 Determinism freeze. Pin the canonical-constant source
     (packages/trnn-core/src/core/constants.ts), dpow/dmath, and the Neumaier
     kernels. Declare them frozen so later refactors can't silently change
     bit-parity.
   • P0.4 Branch/versioning policy. Decide staging vs prod branch under
     Lovable's "one branch at a time" limit; document the sync boundary so a
     manual edit is never clobbered by a Lovable regeneration.

   P1 — Rigor: strip lore & dead code (clean substrate first)

   • P1.1 Delete numerology constants inside F1–F9 ("1495 = 5×13×23", "314 ≈
     100π", "φ¹⁵ within 10%"). Keep closureResidual + wave2() (they have
     witnesses). Ref: your metatron-rhuft-rigour-audit…2026-09-23.md.
   • P1.2 Delete confirmed-dead code: Weave.ts, TapeDmd.ts,
     MemoryStore.replay(), trajectoryAt(), bitmapResonance, fibCode/fibDecode,
     zeckDensity, digitSumTrajectory, empty L4.pathway body, Z[φ] exact ring if
     still uncalled.
   • P1.3 Move F-layer "coincidence commentary" into inert lore blocks; make
     metatronWitnessCoherence the only scored aggregate and delete
     metatronCoherence (not just mark it diagnostic).
   • P1.4 Strip mysticism labels (rename, zero numeric change):
     chakra→septenary, pineal→phaseField, qualia→coherenceCorrelate,
     soul/consciousness framing removed. Typecheck-gated.
   • P1.5 Delete the gematria meaning layer; keep lexeme.ts injective encoding
     as a token-address scheme. Remove F6_Hebrew letter routing, Chapter47.ts,
     solfeggio/432Hz constants.
   • P1.6 Extract real kernels (dmd, vsa, spectralAttention, field kernel) into
     a lore-free @metatron/runtime, extending — not replacing — the
     @lovable.dev/vite-tanstack-config aliases.

   P2 — Information processing correctness (input → field → meaning)

   • P2.1 Word→field actually wired: route FieldSignatureEncoder → a
     tickMemory() text channel so language becomes field structure, not a
     journal label. (Your plan's Step 1; the encoder exists but is wired only
     into document retrieval.)
   • P2.2 Gematria as exact address only: Zeckendorf address read by
     PatternBitmapIndex (currently computed at line 93 and never read), turning
     Stage-1 recall from O(N) into a bucketed lookup. Meaning stays spectral,
     never numeric.
   • P2.3 Frequency-aware recall: fold rehearsal stats into Stage-2 scoring (C·
     (1+φ⁻¹·ln(1+rehearsals))·φ^(−Δt/τ), τ=34) so frequently-reinforced
     patterns actually outrank.
   • P2.4 Scale-matched sensing: derive rung widths from real sensor passbands
     + Nyquist (AudioFrontend/MelFilterbank, VisionEncoder, IMUFrontend,
     ScreenFrontend); mark unsensed rungs inferred (never scored as measured).
   • P2.5 Toroidal closure as admission test: a rung is enabled only when its
     ring residual is non-increasing over a Fibonacci window; non-closure is
     reported as measurable leakage.
   • P2.6 Coherence gate measured, not asserted: bound the Hebbian ceiling
     (η/decay = φ²), wire hopfieldEnergy, and admit an action only on ΔE ≤ 0, K
     ≥ Ω_c, and non-increasing ring residual — with the failing number printed.
● P2 — Information Processing Correctness (input → field → meaning)

   Scope: make language actually compute in the engine — placed uniformly,
   carrying its own identity, habituating on repetition, respecting word order,
   and recalled by real signal rather than length or coincidence. This is the
   phase where your Wolfram findings become the acceptance criteria.

   Preconditions (must be landed first): P0 (baseline + gate discipline) and P1
    (lore removed, metatronWitnessCoherence is the only scored path).
   Specifically P1.5 must keep lexeme.ts as a token-address scheme while
   deleting the gematria meaning layer — that's the exact file P2.2 edits.

   ────────────────────────────────────────────────────────────────────────────

   0. Baseline — capture before you touch anything

   These are your before numbers. Freeze them as a single metrics block so
   every later change is scored against them, not against vibes:

   ┌────┬────────────────┬───────────────────────┬────────────────────────────┐
   │ ID │ Metric         │ Before (your Wolfram  │ Target after P2            │
   │    │                │ run)                  │                            │
   ├────┼────────────────┼───────────────────────┼────────────────────────────┤
   │ M0 │ Rung occupancy │ 51/55 used, 151 on    │ 55/55, max ≤ ~2× mean      │
   │    │                │ one rung              │ (uniform)                  │
   ├────┼────────────────┼───────────────────────┼────────────────────────────┤
   │ M1 │ Position bias  │ 6.849/letter (log_φ   │ 0 (position independent of │
   │    │                │ 27)                   │ length)                    │
   ├────┼────────────────┼───────────────────────┼────────────────────────────┤
   │ M2 │ Energy spread  │ 5.5 / 6.48            │ ≥ 6.0 / 6.48               │
   ├────┼────────────────┼───────────────────────┼────────────────────────────┤
   │ M3 │ Field          │ 3×10⁻¹⁵               │ unchanged (must not        │
   │    │ precision      │                       │ regress)                   │
   ├────┼────────────────┼───────────────────────┼────────────────────────────┤
   │ M4 │ Identity       │ needs ~1417 dims,     │ identity in memory layer,  │
   │    │ capacity       │ field has 89          │ field = context            │
   └────┴────────────────┴───────────────────────┴────────────────────────────┘

   Exit rule: a sub-task is "done" only if its gate is green and its metric
   beats the before value. Anything that doesn't measurably improve is
   reverted, per your own rule.

   ────────────────────────────────────────────────────────────────────────────

   Execution order (dependency-driven)

   P2.2 → P2.1 → P2.8 → P2.7 → P2.3 → P2.4 → P2.5 → P2.6

   Placement first (the field must be well-posed before identity is injected),
   then identity, then semantics, then recall, then the scale/closure/gate
   measurement stack.

   ────────────────────────────────────────────────────────────────────────────

   P2.2 — Fix torus placement (smallest, highest-certainty, do first)

   • Goal: kill the length-dominance you measured. Position a word by its full
     code, uniformly over all rungs.
   • Files: src/core/gematria/lexeme.ts — function lexemeTorus() only.
   • Changes:
       • Major circle: replace rung = top % rungs (where top = maxZeckIndex(v)
         ≈ 6.849·length) with rung = floor(frac(v·φ⁻¹)·rungs).
       • Minor circle: replace minor = 2π·frac(v·φ⁻¹) with 2π·frac(v·φ⁻²) — a
         second, independent irrational rotation so the two coordinates don't
         correlate.
       • Keep top/zeck in the returned struct as the address (reversible recall
         key) — it stays, it just stops being the position.
       • Fix the doc comment: the current claim "one is a Zeckendorf class, the
         other an equidistributed phase" is the exact falsehood. New text:
         "major = equidistributed φ⁻¹ rotation (uniform over rungs); minor =
         independent φ⁻² rotation."
       • Determinism: frac(x) = x − floor(x) and (v·φ⁻¹) % 1 are exact IEEE ops
         for non-negative floats — no Math.pow, no per-engine divergence. Route
         φ⁻¹/φ⁻² through zphi constants only.
   • Tests: test/memory/w5-torus-placement.test.ts — (a) a ~1191-word corpus
     uses all 55 rungs; (b) max-per-rung within a chi-square bound of uniform;
     (c) two same-length words no longer collide in rung by default; (d)
     byte-identical output across two runs.
   • Gate: lint → typecheck → vitest → build, all green. Metric: M0 and M1 beat
     baseline.

   P2.1 — Identity into the field (the core of fix b)

   • Goal: the field carries each word's identity signature (from the
     word-memory layer), not a length-based rung — so a word co-activates with
     sound and image in the same Hebbian pass.
   • Files: src/core/memory/tickMemory.ts,
     src/core/memory/MemoryCaptureKernel.ts, src/core/memory/MemoryStore.ts;
     reuse src/core/knowledge/fieldSignature.ts (FieldSignatureEncoder).
   • Changes:
       • In tickMemory.ts, after sensory injection and before the qualia
         correlate, add a text/identity channel: run
         FieldSignatureEncoder.encode(text) → unit-norm signature (89/233
         modes), and write it into the Ψ the Hebbian L1 runs on.
       • Keep MemoryCaptureKernel's text as a recallable journal label and add
         the signature as the field structure — label = fast key, signature =
         spectral identity. Locate the exact injection site first (the existing
         audit cites ~lines 233/258/272 in MemoryCaptureKernel).
       • Wire recall so a hit returns the signature alongside the label (recall
         = words + field patterns).
   • Tests: test/memory/w6-identity-in-field.test.ts — perturbation is
     signature-driven (anagram / rare-word vs length-proxy don't alias), ‖ΔΨ‖
     bounded by LEXEME_GAIN, deterministic, recall returns the signature.
   • Metric: identity recall precision improves; two distinct words no longer
     alias by length.

   P2.8 — Sentence roles + stopword weighting (fix d)

   • Goal: word order and argument structure become real field structure ("A
     hits B" ≠ "B hits A"); function words carry less energy than content
     words.
   • Files: lexeme.ts (injectTextPsi, lexemeTokens); new
     src/core/knowledge/roles.ts if the role channel needs its own module.
   • Changes:
       • Encode "who does" (subject) vs "who receives" (object) as distinct
         residue channels or a dedicated slot — not by position.
       • Down-weight stopwords by inverse-document-frequency so "the" carries
         materially less energy than "neuron".
       • Deterministic, bounded, no semantic claims — structural role +
         frequency weighting only.
   • Tests: test/memory/w7-roles.test.ts — subject/object swap produces
     distinct structures; stopword contribution below a set threshold vs a
     content word.
   • Metric: role decode accuracy > chance; stopword energy share drops.

   P2.7 — Habituation + associative strengthening (fix c, net-new)

   • Goal: repetition does two different real things — a repeated word's field
     response habituates (short-term depression), while its co-occurrence link
     strengthens (Hebbian LTP). This is the standard STD/LTP pairing, and today
     it's entirely absent.
   • Files: field-update path in tickMemory.ts/MemoryCaptureKernel.ts;
     src/core/memory/HebbianMatrix.ts, Consolidator.ts.
   • Changes:
       • Track per-token repetition count; on repeat, scale injection amplitude
         down monotonically (amp ← amp·φ⁻¹ per repeat, bounded floor).
       • Keep existing Hebbian co-activation and make the co-occurrence weight
         grow with joint repeats — verify and wire to the repetition counter.
       • Bound both (no runaway potentiation/depression); deterministic.
   • Tests: test/memory/w8-habituation.test.ts — repeated word shows
     monotone-decreasing response; co-occurrence weight increases with joint
     repeats; both stay bounded.
   • Metric: response-amplitude-per-repeat is a decreasing curve; co-occurrence
     link strengthens.

   P2.3 — Frequency-aware recall

   • Goal: frequently-reinforced patterns actually outrank. (Roadmap marks this
     "Done" — verify it's live and scored, then measure.)
   • Files: src/core/memory/PatternBitmapIndex.ts, src/core/memory/types.ts.
   • Changes: rehearsal count on IndexedPattern; Stage-2 score = C(a,b)·(1+φ⁻¹·
     ln(1+rehearsals))·φ^(−Δt/τ), τ=34; increment on each hit.
   • Tests: capacity harness — a 500×-rehearsed pattern outranks a once-seen
     pattern at equal raw similarity.
   • Metric: hit-rate before/after.

   P2.4 — Scale-matched sensing

   • Goal: rungs are measured only when a real frontend covers their band
     edge-to-edge at ≥2× Nyquist; everything else is inferred and never scored.
     (Partially done — complete + verify.)
   • Files: src/core/runtime/rhuftf/ScaleMeasurement.ts, registry.ts, sensor
     frontends.
   • Tests: test/scales/s1-scale-binding.test.ts.
   • Metric: exactly the rungs a real sensor covers are marked measured; the
     rest report NaN octaves, not 0.

   P2.5 — Toroidal closure as admission test

   • Goal: a rung is enabled only when a full Fibonacci window of ring
     residuals is non-increasing; a non-finite residual clears the window
     rather than averaging into it. (Mostly done — verify + surface the
     per-rung leakage.)
   • Files: src/core/runtime/rhuftf/torusClosure.ts (RingWindow).
   • Tests: test/scales/ — a non-closing rung is rejected with a concrete
     violating index.
   • Metric: closure is reported as measurable leakage, not asserted.

   P2.6 — Coherence gate, measured not asserted

   • Goal: an action/admission fires only on three measured numbers — ΔE ≤ 0, K
     ≥ Ω_c = 0.381966…, and non-increasing ring residual — with the failing
     number printed.
   • Files: src/core/MetatronCore.ts, Consolidator.ts, src/core/rhuft/*.
   • Changes: bound the Hebbian ceiling (η/decay = φ² = 2.618034…), wire
     hopfieldEnergy, enforce the gate.
   • Tests: test/memory/ — a merge that raises energy is rejected; a
     sub-threshold action is rejected with the failing value.
   • Metric: gate rejections are explainable by a single printed number.

   ────────────────────────────────────────────────────────────────────────────

   Exit criteria for P2 (all must hold)

   1. Every sub-task gate green — the full suite never ships red; the count
      drops only where a plan explicitly says so.
   2. M0–M4 all beat their before values, recorded in docs/CAPACITY.md.
   3. Determinism intact — two runs byte-identical on every touched path.
   4. No lore-scored path was introduced; all new scoring flows through
      metatronWitnessCoherence or a measured residual.

   Prompt discipline (so Lovable doesn't clobber it)

   • One sub-task = one prompt = one commit. Use the P0 context sheet's
     template, @file the exact files, and name the commit P2.x <title>.
   • Every prompt ends by running lint → typecheck → vitest → build. A red gate
     blocks the next prompt.
   • Prefer git edits (free) for these surgical changes; reserve Lovable chat
     only for edits you can't make by hand.


   P3 — Memory: store & recall correctness

   • P3.1 Memory pipeline trace: confirm tickMemory() → MemoryStore.capture() →
     MemoryCaptureKernel (L0–L6) → LearningEngine.observe() end-to-end,
     decoupled at ~2Hz from the 60Hz field loop.
   • P3.2 Recall abstention audit: verify PatternBitmapIndex.search and
     CleanupMemory.query never return a "confident" match below chance — the
     z-score + margin gates must hold under load.
   • P3.3 Consolidation correctness: Consolidator.mergeAdmissible (energy +
     Ramsauer separation, β = φ/√d) rejects merges that raise energy; verify
     norm-independence.
   • P3.4 Persistence correctness: MemoryPersistence round-trip (typed JSON,
     snapshot) is bit-exact; no float drift across save/load.
   • P3.5 Corpus tiering: ColdArchive/HotCache/WarmShards eviction/promotion is
     correct and bounded; no silent recall from evicted shards.
   • P3.6 Server-side persistence (enterprise): move the browser-only IndexedDB
     state to a durable backend (Cloudflare D1/R2/KV) with a migration path and
     atomic snapshots.

   P4 — Learning signal & intelligence

   • P4.1 Trainable readout: expose DiagonalRLS (already in selfModel.ts) as
     the reservoir-computing readout y = W_out·[reservoir state].
   • P4.2 First external task + loss: next-step forecasting (score DMD
     predict()) or audio event classification (score the Mel-filterbank
     frontend).
   • P4.3 Benchmark harness: report MAE / accuracy / recall on held-out data
     (not oracle hashes), writing to docs/CAPACITY.md.
   • P4.4 DMD into a control/prediction loop: use fitDmd growth/spectral-radius
     for real stability monitoring, not just mode display.
   • P4.5 VSA relational memory: wire encodeRecord/decodeRole into knowledge/
     so role/filler queries become algebraic ops.
   • P4.6 De-sacralize φ: treat φ-spacing as a basis; add a learnable/measured
     basis so the readout can generalize.

   P5 — Sensory & multimodal ingestion

   • P5.1 Audio path: AudioCortex/MelFilterbank correctness against Nyquist;
     latency budget.
   • P5.2 Vision path: VisionEncoder/VisionEmbedFrontend (transformers.js)
     embedding quality + determinism.
   • P5.3 IMU/Screen frontends: passband binding and abstention when below
     Nyquist.
   • P5.4 OCR (tesseract.js): accuracy + queueing (ocrLadder), and the
     legal/compliance boundary for ingested text.
   • P5.5 Multimodal fusion: word+sound+image co-activation in the same Hebbian
     pass actually binds across modalities (verify tickMemory injection order).

   P6 — Enterprise platform

   • P6.1 Auth & multi-tenancy: identity provider + per-tenant memory/engine
     isolation (RLS-equivalent); no cross-tenant recall leakage.
   • P6.2 Headless engine execution: a server/edge path to run the reservoir
     without the browser UI (queue + workers), so it isn't trapped in the
     client.
   • P6.3 Security: secrets management for tool integrations (Wolfram, newsapi,
     arxiv, virustotal, shodan, abuseipdb); SSRF guard on http_probe/web-learn;
     rate limiting per key.
   • P6.4 Deployment: Cloudflare Workers (wrangler/Nitro/TanStack Start)
     staging vs prod; cold-start + bundle budget (they already trimmed ~2.3MB).
   • P6.5 Observability: structured logging/metrics/tracing + alerting; surface
     the run ledger + Merkle proof as an audit artifact.
   • P6.6 Performance & cost: compute governor, worker pool, Wolfram token
     budget, 60Hz field-loop cost under multi-tenant load.
   • P6.7 Compliance: data retention/deletion, PII handling for OCR/web-learn,
     third-party ToS review (virustotal/shodan terms).
   • P6.8 CI/CD: GitHub Actions running typecheck + Vitest on every push;
     staging gates before prod; rollback path.

   P7 — Verification, auditability & launch readiness

   • P7.1 Wolfram verification channel: wire WOLFRAM_APP_ID_RESEARCH offline
     (separate budget, never in a tick); re-verify every surviving constant at
     40 digits; delete failures.
   • P7.2 Notebook binding: map Notebook 2 → admission test, Notebook 3 →
     sensor binding, Notebook 4 → falsification; each term cites its section.
   • P7.3 Determinism audit: prove bit-reproducibility across engines
     (dpow/Jacobi/QR) as a sellable enterprise property.
   • P7.4 Launch docs: capacity numbers, security model, deployment runbook,
     and the honest boundary of what the engine can and cannot claim.

   ────────────────────────────────────────────────────────────────────────────

   This is the complete index. Each item above is a self-contained plan we can
   open next. The dependency chain is: P0 → P1 → (P2 ∥ P3) → P4 → P5 → P6 → P7,
   with P2 and P3 parallel once the substrate is clean.