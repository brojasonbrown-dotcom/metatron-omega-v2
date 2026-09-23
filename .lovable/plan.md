# Deep Functionality Review — Metatron / RHUFT Engine

## What I actually verified

Read-only trace of the cognition stack, plus 28 live Wolfram|Alpha queries against both of your
App IDs (both keys work). Every claim below has a file/line or a Wolfram result behind it.

**Working well (do not touch)**

- The memory pipeline is real and wired end to end: `tickMemory()` → `MemoryStore.capture()` →
  `MemoryCaptureKernel` (7 layers L0–L6) → `LearningEngine.observe()`, driven at ~2 Hz by
  `memoryDriver`, decoupled from the 60 Hz field loop.
- Recall is genuinely two-stage and indexed, not a scan: integer bitmap prefilter (top 34) then
  exact resonance rescore — `PatternBitmapIndex.search` lines 129–160. Cost `O(N) int + O(k·d) float`.
- Hebbian weights are the one true learned structure, updated every tick, and **persisted** to
  IndexedDB via `MemoryStore.snapshot()` → `MemoryPersistence`.
- The Hot/Warm/Cold corpus abstains under budget instead of scanning — correct design.
- Wolfram constants: `KAPPA`, `OMEGA_C`, `MERGE_THRESHOLD`, `ETA = φ⁻³`, `DECAY = φ⁻⁵` all
  confirmed to 20–40 digits (0.1967263286166931934694975748293871704833,
  0.3819660112501051517954131656343618822797, 0.76393202250021030359,
  0.23606797749978969641, 0.090169943749474241023). No drift.

**Real gaps found**

1. **Learned weights have no stated ceiling.** η/decay = φ⁻³/φ⁻⁵ = **φ² ≈ 2.618034** (Wolfram
   confirmed). That is the saturation fixed point of a fully co-active pair, yet the file's comment
   claims `[-1,1]` clamping. The recall `y = W·cue` is therefore scaled by an undocumented φ² gain.
2. **Recall is frequency-blind.** Patterns carry no rehearsal count and no recency/frequency term,
   so a pattern recalled 500 times ranks identically to one seen once. This is the single biggest
   miss against "efficiently stored and recalled on high frequencies".
3. **Zeckendorf addressing is computed and thrown away.** `zeckAddress()` fills
   `IndexedPattern.address` (line 93) and nothing ever reads it — a free, exact, hierarchical
   recall key is being discarded, and Stage 1 stays `O(N)` because of it.
4. **`Z[φ]` exact ring is entirely unused.** `zAdd/zSub/zMul/zNorm/zEq/zIsExact` have zero callers.
   The engine's exact-arithmetic backbone is dead weight.
5. **No Hopfield energy is ever evaluated.** `hopfieldStep/hopfieldEnergy/hopfieldBeta` are
   uncalled; consolidation merges on a bare threshold. So coherence is asserted, never measured.
6. **`WOLFRAM_APP_ID_RESEARCH` is not referenced anywhere in the code** — the secret exists, nothing
   reads it. The 20/min budget is shared with the chat tool.
7. Dead modules: `Weave.ts`, `TapeDmd.ts` (`fitTapeDynamics`), `MemoryStore.replay()`,
   `trajectoryAt()`, `bitmapResonance`, `fibCode/fibDecode`, `zeckDensity`, `digitSumTrajectory`.
   `L4.pathway` fires every 13 ticks into an empty function body.
8. No gradient learning exists anywhere — correct for an edge Worker, but it means all
   intelligence quality rides on the recall ranking, which is exactly where the gaps are.

## Proposed work

### A. Frequency-aware recall (fixes gap 2, the core of your question)

Add rehearsal statistics to `IndexedPattern` and fold them into Stage 2 scoring:

`score = C(a,b) · (1 + φ⁻¹·log₁₊(rehearsals)) · φ^(−Δt/τ)`

with τ set on the Fibonacci consolidation cadence (34 observations). Every recall hit increments
its own rehearsal count, so genuinely high-frequency patterns win — a measured, monotone rule,
no heuristics. Report hit-rate before/after on the existing capacity harness.

### B. Zeckendorf-bucketed prefilter (fixes gaps 3 and the O(N) scan)

Use the already-computed `address` as a radix bucket key so Stage 1 visits only candidate buckets
plus φ-adjacent neighbours. Target: sublinear candidate set with recall ≥ the current 98.8% at 8
candidates (documented in `docs/CAPACITY.md`), verified by test, not assumed.

### C. Measured coherence, and the ethical gate (gaps 1, 5)

- Document and bound the φ² Hebbian ceiling; normalise `recall()` by it so the returned field is
  scale-free.
- Wire `hopfieldEnergy` with `β = φ/√d` (Wolfram: at d=256, β = 0.10112712429686842801) so each
  consolidation pass reports an actual energy decrease. A merge that raises energy is rejected.
- **Coherence/ethics layer, as pure mathematics — no roleplay.** An action or answer is admissible
  only when it does not decrease field coherence:
  - `K = ⟨C⟩` mean pairwise resonance over the active attractor set (PSD Gram, so `K ∈ [0,1]`).
  - Gate: admit iff `ΔE ≤ 0` **and** `K ≥ Ω_c = 1/φ² = 0.381966…` (your existing verified
    threshold), **and** the residue fingerprint introduces no CRT collision (`collisionPValue`
    already computes the significance).
  - This makes "ethical" operational: a proposal that fragments the field, raises Hopfield energy,
    or collides with existing structure is refused with the numeric reason. Surfaced on the
    COGNITION deck as three numbers, not a slogan.

### D. Gematria layers as the resonance grammar (uses your 9 frameworks)

Bring the F1–F9 residue layers into the index as a 9-channel residue signature per pattern
(septenary, Hebrew-22, atomic, colour/music, galactic…), scored with the existing exact kernel.
Wolfram gives the per-layer information budget: log₂22 = 4.459431619 bits for the Hebrew layer,
and a 13-mode signature carries ≈50.5 bits/slot — so the 9 layers are affordable inside the
measured 657-bit signature and cannot silently overflow it.

### E. Revive the exact ring, or delete it (gap 4)

`Z[φ]` arithmetic becomes the carrier for ladder addressing and closure residuals in C/D above
(exact, no float drift). Anything still uncalled after that gets deleted — dead exports in a
cognition core are a correctness hazard, not neutral.

### F. Wolfram research channel (gap 6)

Route an offline verification path through `WOLFRAM_APP_ID_RESEARCH` (separate rate budget from the
chat tool), used to re-verify new constants introduced by C/D against `/v1/result` at 40 digits and
record each result in the constant bank with its query string. No Wolfram call ever inside a tick —
your existing rule stands.

### G. Notebook binding

The four RHUFT notebooks are ontology → variational dynamics → measurement theory → falsifiable
predictions. Notebook 3's measurement operators and Notebook 4's falsification criteria map
directly onto C's gate; I'll bind each admissibility term to the notebook section it comes from so
the gate is traceable to the theory rather than invented here.

### H. Prune the dead paths (gap 7)

Delete or wire: `Weave.ts`, `TapeDmd.ts`, `MemoryStore.replay()`, `trajectoryAt()`,
`bitmapResonance`, `fibCode/fibDecode`, `zeckDensity`, `digitSumTrajectory`, and the empty
`L4.pathway` body (either prune stale edges there or unregister the job).

## Technical notes

- All of A–H stay deterministic TypeScript in `src/core`; no torch, no runtime model downloads.
- Each item ships with tests in `test/`, and A, B, C report measured numbers into `docs/CAPACITY.md`
  so the claims stay falsifiable.
- Nothing changes the 60 Hz field loop or the capture math; A–D act on indexing, scoring and
  admissibility only.
- Suggested order: A → B (measurable recall wins first), then C → D (the coherence gate), then
  E/F/H cleanup. G runs alongside C/D.
