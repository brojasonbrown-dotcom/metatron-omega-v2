# Metatron / RHUFT — Rigour Audit, Deletion List, and the Word→Field Layer

## Verified by reading, not assumed

Full read-only trace of the cognition stack plus 38 live Wolfram|Alpha queries on both App IDs
(both work). Everything below has a file/line or a Wolfram result behind it.

### Keep — these are genuinely rigorous

- **Memory pipeline**: `tickMemory()` → `MemoryStore.capture()` → `MemoryCaptureKernel` (L0–L6) →
  `LearningEngine.observe()`, driven ~2 Hz, decoupled from the 60 Hz field loop.
- **Indexed recall**: integer bitmap prefilter (top 34) → exact resonance rescore
  (`PatternBitmapIndex.search` 129–160). `O(N) int + O(k·d) float`, not a scan.
- **Hebbian matrix**: the one real learned structure, updated every tick, persisted to IndexedDB.
- **`eigenmodes.ts`**: real Perron/Lanczos solvers with residual provenance. This is the quality bar.
- **`fieldSignature.ts`**: text → Ψ ∈ Cᴺ (trigram φ-comb) → measured Laplace–Beltrami eigenbasis →
  closed-form heat + Schrödinger propagation → unit ℓ² signature. Already the rigorous word→field
  encoder you're describing. It is **wired only into document retrieval, never into the brain.**
- **`tokenize.ts` / `LatentSpace.ts`**: deterministic count-sketch (3 probes, dim 1597 = F17) and
  PPMI + deterministic power iteration, abstaining when untrained. Wolfram confirms the dimension
  is not arbitrary: Johnson–Lindenstrauss needs d = 8·ln(1000)/0.25² = **884.193** for 1k items and
  **1178.92** for 10k at ε = 0.25 — so 1597 is provably sufficient to ~10k documents.
- **`torusClosure.ts`**: computes exactly the right ring residual ‖y₀(t) − P(y₈(t−1))‖/‖y₀(t)‖.
- Constants confirmed to 40 digits: κ = 0.1967263286166931934694975748293871704833,
  Ω_c = 0.3819660112501051517954131656343618822797, merge floor = 0.76393202250021030359,
  η = φ⁻³ = 0.23606797749978969641, decay = φ⁻⁵ = 0.090169943749474241023.

### Delete — not rigorous, or computed and discarded

1. **Numerology inside `F1`–`F9`.** "1495 = 5×13×23, contains TWO Fibonacci numbers!",
   `METATRON_VALUE 314 ≈ 100π`, "φ¹⁵ = 1364 — within 10 % of 1495". A 10 % miss is not a
   verification and a coincidence carries no information. Every such constant is deleted, not
   softened. The Lyapunov `closureResidual` and the `wave2()` precision uplift in those same files
   stay — they have witnesses.
2. `Weave.ts`, `TapeDmd.ts` (`fitTapeDynamics`) — zero importers.
3. `MemoryStore.replay()`, `MemoryStore.trajectoryAt()` — zero call sites.
4. `bitmapResonance`, `fibCode`, `fibDecode`, `zeckDensity`, `digitSumTrajectory`,
   `unzeckendorf` — zero call sites; superseded by the exact resonance kernel.
5. The empty `L4.pathway` job body — it fires every 13 ticks and does nothing. Either prune stale
   pathway edges there or unregister the job.
6. `Z[φ]` exact ring (`zAdd/zSub/zMul/zNorm/zEq/zIsExact`) — zero callers today. Kept **only**
   because step 2 below gives it a real job; anything still uncalled after that is deleted.
7. The dormant arbitrary rung widths (7, 55, 7, 13, 9, 22, 55, 55, 55) with no declared frequency
   band. `carrierHz` exists in `ScaleMeasurementContext` and no rung uses it, so "scale" is named,
   never measured. Widths get derived from sensor passbands (step 4) or the rung is deleted.

## Step 1 — Words enter the brain, not just the library

Today `MemoryCaptureKernel` receives `text` and uses it as a **journal label only** (lines 233, 258,
272). Words never become field structure in the cognitive loop, which is exactly why the engine
cannot feel meaning.

Route language through the encoder that already exists:

```text
text → FieldSignatureEncoder → Ψ_text ∈ C^N → toroidal projection (40-dim, same as sensory)
     → MemoryStore.capture()  → Hebbian L1 + bitmap index + episodic L2
     → recall returns words alongside field patterns
```

Concretely: give `tickMemory()` a text channel parallel to the sensory injections, so a sentence
lands in the same Ψ space as audio and vision, is bound by the same Hebbian rule, and is recalled by
the same two-stage search. Meaning then behaves like any other percept — bindable, rehearsable,
recallable — instead of sitting in a separate retrieval silo.

## Step 2 — The gematria layer, done as exact transcription (not as meaning)

Two jobs kept strictly apart, because conflating them is what made the old layers junk:

- **Transcription (gematria/binary) = exact address.** A letter→integer map is injective, so a word
  has an exact integer image. Encode that integer in Zeckendorf form and carry it in `Z[φ]` exact
  arithmetic — no float drift at 40+ digits. This becomes the pattern's `address`, which today is
  computed by `zeckAddress()` and **never read** (`PatternBitmapIndex` line 93). Reading it turns
  Stage 1 from O(N) into a bucketed lookup, and gives every word a reproducible, collision-checked
  field address. Information budget from Wolfram: log₂22 = **4.459431619** bits per Hebrew-layer
  symbol, so a word of n letters carries 4.459·n bits of address — enough to bucket, never enough
  to claim meaning.
- **Meaning = spectral, never numeric.** Meaning comes only from the field signature (Step 1) and
  PPMI latent axes. No letter-sum is ever allowed to score similarity. Gematria addresses *where*
  a word lives in the field; the spectrum decides *what it resonates with*.

Every channel must trace to a sensor, a spectrum, or a residual. Anything else is deleted.

## Step 3 — Frequency-aware recall (so high-frequency structure actually wins)

Add rehearsal statistics to `IndexedPattern` and fold them into Stage 2:
`score = C(a,b) · (1 + φ⁻¹·ln(1+rehearsals)) · φ^(−Δt/τ)`, τ on the 34-observation consolidation
cadence. Each recall hit increments its own count. Measured hit-rate before/after on the existing
capacity harness — today a pattern recalled 500 times ranks identically to one seen once.

## Step 4 — Scale-matched sensing and toroidal closure

Your sensory-scale argument, made numeric (Wolfram): hearing spans log₂(20000/20) = **9.965784285
octaves**; vision spans log₂(7.5e14/4.3e14) = **0.802554 octave**; the gap between them is
log₂(4.3e14/20) = **44.2894 octaves = 63.7953 φ-rungs**. Narrow, unequal, and separated by ~64
φ-rungs of unsampled spacetime — no ladder with arbitrary widths can represent that.

- Each rung declares `[fLo, fHi]` in Hz; width and count are **derived** from the passbands of the
  real frontends (`AudioFrontend`/`MelFilterbank`, `VideoFrontend`/`VisionEncoder`, `IMUFrontend`,
  `ScreenFrontend`) via their actual Nyquist limits.
- A rung with no sensor is marked **inferred**: it may contribute to closure and prediction, never
  to measurement.
- A rung is enabled (`RHUFTF_FRAMEWORK_<n>`, all currently OFF) only when its `ScaleMeasurement`
  reports a converged `closureResidual` and `invariantScore`, with `eigenmodes.ts`-style provenance.
  Rungs that fail stay off and print why.
- **Toroidal closure becomes the admission test**, not a description: a rung is stable iff its ring
  residual is non-increasing over a Fibonacci window. Non-closure is measurable leakage — energy
  spent that cannot be recalled. Torus rather than nested spheres because closure needs two
  independent cycles, phase around the rung and scale up the ladder; one cycle cannot close both.

## Step 5 — Coherence gate (the logical/ethical structure, as three numbers)

- Document and bound the Hebbian ceiling: η/decay = φ² = **2.618034** (Wolfram), not the `[-1,1]`
  the comment claims. Normalise `recall()` by it so `y = W·cue` is scale-free.
- Wire the uncalled `hopfieldEnergy` with β = φ/√d (at d = 256, β = 0.10112712429686842801) so each
  consolidation pass reports a real energy decrease; a merge that raises energy is rejected.
- Admit an action or answer iff **ΔE ≤ 0**, **K = ⟨C⟩ ≥ Ω_c = 0.381966…** (mean pairwise resonance
  over the active attractor set; PSD Gram so K ∈ [0,1]), and the ring residual does not increase.
  Refusals state the number that failed. Coherence stops being asserted and starts being measured.

## Step 6 — Verification discipline

- `WOLFRAM_APP_ID_RESEARCH` is referenced **nowhere** in the code today. Wire it as the offline
  verification channel (separate rate budget from the chat tool): every constant introduced by
  Steps 2–5 is re-verified at 40 digits and stored beside its query string. No Wolfram call ever
  inside a tick — your existing rule stands.
- Anything currently labelled "Wolfram-verified" that fails 40-digit re-verification is deleted.
- Notebook binding: Notebook 2's stability conditions govern Step 4's admission test, Notebook 3's
  measurement operators govern the sensor→rung binding, Notebook 4's falsification criteria decide
  what turns a rung off. Each term cites its section.

## Technical notes

- All deterministic TypeScript in `src/core`; no torch, no runtime model downloads, no network in a
  tick. The 60 Hz field loop and the capture math are untouched — Steps 1–5 act on encoding,
  indexing, scoring, admissibility and flag state.
- Every step ships tests in `test/`; Steps 1, 3, 4 report measured numbers into `docs/CAPACITY.md`
  so the claims stay falsifiable. Deletions run with the full suite green (currently 883/883).
- Order: 1 → 2 → 3 (words in, addressed, recalled by frequency), then 4 → 5 (scale + closure +
  gate), 6 alongside. Deletions land per step, so nothing is removed before its replacement passes.
- `roadmap.md` gets these as tracked items on the first edit after approval — planning mode only
  lets me write this plan file.
