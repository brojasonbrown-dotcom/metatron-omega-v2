# Deep Functionality Review — Metatron / RHUFT Engine

## What I actually verified

Read-only trace of the cognition stack plus 38 live Wolfram|Alpha queries against both App IDs
(both keys work). Every claim has a file/line or a Wolfram result behind it.

**Working well (do not touch)**

- Memory pipeline is real and wired end to end: `tickMemory()` → `MemoryStore.capture()` →
  `MemoryCaptureKernel` (L0–L6) → `LearningEngine.observe()`, driven at ~2 Hz, decoupled from the
  60 Hz field loop.
- Recall is genuinely indexed, not a scan: integer bitmap prefilter (top 34) then exact resonance
  rescore — `PatternBitmapIndex.search` 129–160, `O(N) int + O(k·d) float`.
- Hebbian weights are the one real learned structure, updated every tick, persisted to IndexedDB.
- Hot/Warm/Cold corpus abstains under budget instead of scanning — correct.
- `eigenmodes.ts` is the strongest file in the repo: real Perron/Lanczos solvers with residual
  provenance, replacing two former surrogates. This is the standard the rest should meet.
- Constants confirmed to 40 digits: κ = 0.1967263286166931934694975748293871704833,
  Ω_c = 0.3819660112501051517954131656343618822797, merge floor 0.76393202250021030359,
  η = φ⁻³ = 0.23606797749978969641, decay = φ⁻⁵ = 0.090169943749474241023. No drift.

**You were right about the layers**

`F1–F9` mix two incompatible things in one file. Real: the Lyapunov `closureResidual` over the
node field via a φ-coherent toroidal phase sweep, and the `wave2()` precision uplift. Not real:
inline numerology used as if it were derivation — "1495 = 5×13×23, contains TWO Fibonacci
numbers!", "METATRON_VALUE 314 ≈ 100π", "φ^15 = 1364 — within 10% of 1495". A 10% miss is not a
verification, and coincidences carry no information, so any channel scored off them injects noise
into recall. **I withdraw the 9-channel gematria residue signature from the plan.**

Worse, the part that *is* physically structured is switched off: the whole RHUFT-F per-scale
ladder (`ScaleMeasurement`, `registry.ts`, `localUpdateRegistry.ts`, the 18 `F*LocalUpdate` /
`F*Measurement` modules, `torusClosure`, `eigenmodes`) is opt-in behind
`RHUFTF_FRAMEWORK_<n>` / `RHUFTF_LOCAL_UPDATE_<n>`, all default OFF. And the rung widths
(7, 55, 7, 13, 9, 22, 55, 55, 55) are **not bound to any frequency band** — `carrierHz` exists in
`ScaleMeasurementContext` but no rung declares a passband. So scale is named, never measured.

**Your sensory-scale point, made numeric (Wolfram)**

- Hearing spans log₂(20000/20) = **9.965784285 octaves**.
- Vision spans log₂(7.5e14/4.3e14) = **0.802554 octave** — less than one octave.
- The gap between them is log₂(4.3e14/20) = **44.2894 octaves** = **63.7953 φ-rungs**.

That is the real finding: the two sensory bands are narrow, wildly unequal in width, and separated
by ~64 φ-rungs of completely unsampled spacetime. A 9-rung ladder with arbitrary widths cannot
represent that. Rung spacing must be derived from the passband of the sensor that reads it, and
rungs with no sensor must be explicitly marked inferred, not silently scored.

**Other real gaps**

1. η/decay = φ² ≈ **2.618034** is the Hebbian saturation ceiling, yet the file claims `[-1,1]`
   clamping. `y = W·cue` carries an undocumented φ² gain.
2. Recall is frequency-blind: no rehearsal count, no recency term. A pattern recalled 500 times
   ranks identically to one seen once.
3. `zeckAddress()` is computed into `IndexedPattern.address` and never read — an exact hierarchical
   key discarded, which is why Stage 1 stays O(N).
4. `Z[φ]` exact ring (`zAdd/zSub/zMul/zNorm/zEq/zIsExact`) has zero callers.
5. `hopfieldStep/hopfieldEnergy/hopfieldBeta` never called — coherence is asserted, never measured.
6. `WOLFRAM_APP_ID_RESEARCH` is referenced nowhere in the code.
7. Dead: `Weave.ts`, `TapeDmd.ts`, `MemoryStore.replay()`, `trajectoryAt()`, `bitmapResonance`,
   `fibCode/fibDecode`, `zeckDensity`, `digitSumTrajectory`; `L4.pathway` fires every 13 ticks into
   an empty body.

## Proposed work

### A. Frequency-aware recall (fixes gap 2 — the core of "recalled on high frequencies")

Add rehearsal statistics to `IndexedPattern` and fold them into Stage 2:
`score = C(a,b) · (1 + φ⁻¹·ln(1+rehearsals)) · φ^(−Δt/τ)`, τ on the 34-observation consolidation
cadence. Each recall hit increments its own count, so high-frequency structure wins. Measured
hit-rate before/after on the existing capacity harness.

### B. Zeckendorf-bucketed prefilter (fixes gap 3 and the O(N) stage)

Use the already-computed `address` as a radix bucket key; Stage 1 visits the candidate bucket plus
φ-adjacent neighbours. Target: sublinear candidates at ≥ the documented 98.8% recall at 8
candidates, proven by test.

### C. Scale-matched sensory ladder (replaces the withdrawn gematria-channel idea)

Turn the dormant RHUFT-F ladder into a real observability structure:

1. **Declare a passband per rung.** Each rung gets `[fLo, fHi]` in Hz and its width in octaves;
   rung count and spacing are then derived, not chosen. Anchors are the measured bands above
   (hearing 9.9658 oct, vision 0.8026 oct, IMU/DC and screen-refresh bands from the existing
   frontends).
2. **Bind each sensory frontend to the rung whose passband contains its sample rate.**
   `AudioFrontend`/`MelFilterbank`, `VideoFrontend`/`VisionEncoder`, `IMUFrontend`,
   `ScreenFrontend` each register their real Nyquist limit; the binding is computed from that, not
   hardcoded.
3. **Mark unsensed rungs as inferred.** A rung with no frontend contributes to closure and
   prediction, never to measurement. That is what kills the "useless computation" —
   every scored channel must trace to a sensor or a residual.
4. **Turn the flags on rung by rung, gated on evidence.** A rung is enabled only when its
   `ScaleMeasurement` reports a converged `closureResidual` and `invariantScore`, with the same
   provenance tag style `eigenmodes.ts` already uses. Rungs that fail stay off and say why.

### D. Toroidal closure as the stability criterion (answers "why a torus")

`torusClosure.ts` already computes exactly the right quantity — the ring residual
‖y₀(t) − P(y₈(t−1))‖ / ‖y₀(t)‖ — and is observer-only. Promote it to the ladder's admission test:

- A rung is *stable at its scale* iff its ring residual is non-increasing over a Fibonacci window.
  Non-closure is leakage: information leaving the ring is energy the engine spent and cannot recall.
- Report per-rung leakage rate as a number on the SCALES deck, so "minimises energy loss" is a
  measurement rather than a claim.
- Torus, not sphere, because closure needs two independent cycles — one around the rung (phase) and
  one up the ladder (scale). A single cycle cannot close both, which is the geometric reason the
  ladder has to be toroidal rather than nested-spherical. The engine's φ-coherent phase sweep
  already assumes this; C/D make it testable.

### E. Coherence gate as the ethical/logical structure (fixes gaps 1, 5)

Ethics expressed as admissibility, no roleplay, three measured numbers:

- Document and bound the φ² Hebbian ceiling; normalise `recall()` by it so the field is scale-free.
- Wire `hopfieldEnergy` with β = φ/√d (at d=256, β = 0.10112712429686842801) so every consolidation
  reports an actual energy decrease. A merge that raises energy is rejected.
- Admit an action/answer iff **ΔE ≤ 0** and **K = ⟨C⟩ ≥ Ω_c = 0.381966…** (mean pairwise resonance
  over the active attractor set, PSD Gram so K ∈ [0,1]) and the ring residual of D does not
  increase. A proposal that fragments the field, raises energy, or leaks scale is refused with the
  numeric reason shown.

### F. Revive the exact ring, or delete it (gap 4)

`Z[φ]` becomes the carrier for rung addressing and closure residuals in B/C/D — exact, no float
drift at 40+ digits. Whatever is still uncalled afterwards gets deleted; dead exports in a
cognition core are a correctness hazard.

### G. Wolfram research channel + numerology quarantine (gaps 6, and the F1–F9 problem)

- Route offline verification through `WOLFRAM_APP_ID_RESEARCH` (separate rate budget from the chat
  tool), re-verifying every constant introduced by C/D/E at 40 digits and recording the query string
  beside the value.
- Split each `F1–F9` file: derived quantities with a residual witness stay in the scoring path;
  coincidence-grade constants move to a clearly inert `lore` block that nothing imports. Anything
  claimed "Wolfram-verified" that fails re-verification at 40 digits is deleted, not loosened.

### H. Prune the dead paths (gap 7)

Delete or wire `Weave.ts`, `TapeDmd.ts`, `MemoryStore.replay()`, `trajectoryAt()`,
`bitmapResonance`, `fibCode/fibDecode`, `zeckDensity`, `digitSumTrajectory`, and the empty
`L4.pathway` body.

## Technical notes

- Everything stays deterministic TypeScript in `src/core`; no torch, no runtime model downloads,
  no Wolfram call inside a tick — your existing rule stands.
- Each item ships tests in `test/`; A, B, C, D report measured numbers into `docs/CAPACITY.md` so
  the claims stay falsifiable.
- Notebook binding: Notebook 2's variational/stability conditions govern D's admission test,
  Notebook 3's measurement operators govern C's sensor→rung binding, Notebook 4's falsification
  criteria govern what turns a rung off. Each term cites its section.
- Nothing changes the 60 Hz field loop or the capture math; A–E act on indexing, scoring,
  admissibility and flag state only.
- Order: A → B (measurable recall wins), then C → D (scale + closure), then E, then F/G/H cleanup.
- Note: I could not add these items to `roadmap.md` yet — planning mode only lets me write the plan
  file. That is the first edit once approved.
