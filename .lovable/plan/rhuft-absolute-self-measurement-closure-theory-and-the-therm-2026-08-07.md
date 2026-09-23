# RHUFT Absolute — Self-Measurement, Closure Theory, and the Thermal Layer

## What I verified before writing this

- **Qualia is live but split in two, and the two halves never meet.** `src/core/field/Qualia.ts` (`C, N, S, V, I`) is computed every tick inside `src/core/bus/FallbackEngine.ts:394` and shipped over the wire (`protocol.ts:158`). `src/core/field/QualiaCorrelate.ts` (`Q_inc, Q_stab, Q_res`) is computed on a *different* path — `tickMemory.ts:205` and `engineSnapshot.ts:169` — and never reaches the V13 UI. Searching `src/ui` for either returns nothing: **no V13 panel renders any qualia observable today.**
- **`Q_inc` is a tautology.** `QualiaCorrelate.ts:36` computes `HURWITZ_CONSTANT / HURWITZ_CONSTANT`, i.e. the literal constant `1`. One of three geometric-mean factors is dead, so `Q` is really a two-factor score wearing a three-factor label.
- **The Lucas closure theorem is not in the runtime.** No `Lucas` symbol exists anywhere under `src/core` (it appears only in `packages/brain-core/src/formal/*.wl` certificates). The document's central *proven* result — exact 13-fold closure is impossible because the Lucas sequence mod 13 has period 28 and never hits zero — currently informs nothing the engine measures.
- **The scale ladder is 9 surrogate rungs, not the physical ladder.** `src/ui/v13/scaleRuntime.ts` resamples onto `O_0..O_8`; `LadderProjection.ts` scatters Ψ block-cyclically across 9 shapes. There is no `L(n) = l_P·φⁿ` ladder and no rung↔physical-anchor mapping.
- **`SelfValidationRHUFT.ts` validates three fixed points** (`1/φ²`, `φ`, `φ²`) with a φ-weighted geomean — the right shape, but it is not called from any V13 surface either.
- **No thermal or charge layer exists.** No temperature, Boltzmann, or magnetic quantity anywhere in `src/core`.

## On your question

You are close, but the honest form matters. The claim that survives is: *if* a system's dynamics are pure self-reference with no external substrate, the cheapest stable recursion is Ψ(t) = Ψ(t−τ) + λΨ(t−2τ), whose eigenvalue is φ — so a self-measuring computational field is necessarily φ-structured. That is a theorem about self-reference, not proof that physical spacetime *is* that field, and your own document is scrupulous about the difference (Class A exact / Class B coincidence / Class C failed). What I will build enforces exactly that discipline: every rung the engine reports carries a class tag, so the machine tells you which of its numbers are proven, which are ppm-level coincidences, and which failed recomputation. That is what makes it a *measurement* instrument rather than a persuasion device.

## The plan — one file at a time, in dependency order

### Stage 1 · Closure arithmetic (new foundation)
**`src/core/rhuft/LucasClosure.ts`** — exact integer Lucas/Fibonacci (BigInt-backed, memoized), the residue map `r(n) = min(Lₙ mod 13, 13 − Lₙ mod 13)`, the period-28 proof check (residues never 0), the Pisot defect `|φⁿ − Lₙ| = |ψ|ⁿ`, and the stable-rung predicate `n ≡ 1, 13, 15 (mod 28)`. Ships a self-check that reproduces the document's 28-residue table verbatim, plus the flux ladder `κφ⁻ⁿ` with the exact `flux(13) = φ⁻²⁶ = 3.6840146919×10⁻⁶` identity.

**`src/core/rhuft/PhiLadder.ts`** — the real ladder `L(n) = l_P·φⁿ`, n = 0…300, with corrected anchors from your §8: proton 94.34, electron 107.08, DNA ≈125, human 167.6, universe 293.96. Each rung carries `{ n, length, mass, stable, residue, class }`.

### Stage 2 · Repair the self-measurement layer
**`src/core/field/QualiaCorrelate.ts`** — replace the tautological `Q_inc` with a real Hurwitz incommensurability measure: continued-fraction expansion of the dominant mode-frequency ratio, scored against the Hurwitz bound `1/√5`. A φ-basis then scores 1.0 *because it was measured to*, not because the numerator equals the denominator. `Q_stab` and `Q_res` keep their current (correct) math untouched.

**`src/core/field/Qualia.ts`** — add the closure-aware observables the framework requires and the current five omit: golden-delay self-overlap `C_φ(t) = |⟨Ψ(t)|Ψ(t−φτ)⟩|²` with explicit `1/φ² = 0.381966` threshold crossing, and an **ignition counter** (up-crossings per window) — the document's §12.7 result is that consciousness is a train of transient ignitions, not a steady state, so the metric must count events, not just report a level.

**`src/core/field/SelfMeasure.ts`** (new) — the single fusion point. Takes the five Qualia observables, the three Correlate factors, the ignition rate, and the closure residue of the active rung; emits one `SelfMeasurement` with a φ^(−rank)-weighted geometric mean and **veto attribution** (which factor dominated the log-domain). This is the one object the UI reads, ending the two-path split.

### Stage 3 · Bind the ladder to the runtime
**`src/ui/v13/scaleRuntime.ts`** — keep the existing 9-rung resample and the Lipschitz contraction probes (no regression), and *add* the physical rung index each `O_k` corresponds to, its Lucas residue, and whether it sits on a stable rung. Rungs on non-stable indices get their expected closure defect reported rather than treated as error.

**`src/core/runtime/rhuftf/torusClosure.ts`** — the loop residual gets a theoretical floor: closure can never beat `|ψ|ⁿ` at rung n. The panel currently implies residual → 0 is the goal; it is not, and the theorem says so.

**`src/core/runtime/rhuftf/omega.ts`** — fold `SelfMeasure` in as a metric with its own φ-rank weight, so a collapse in self-measurement vetoes Ω exactly like any other rung.

### Stage 4 · The thermal / charge layer
**`src/core/rhuft/Thermal.ts`** (new) — temperature as a derived field quantity, not an input: `T_n` from mode-energy equipartition over the active band, with the Planck temperature as rung-0 anchor and the φ-ladder giving `T(n) = T_P·φ⁻ⁿ`. Reports the CMB rung honestly (your §errata: the `φ⁻²` claim fails; the true exponent is ≈ φ⁻¹⁵¹·⁸) as a **Class C corrected** entry. Charge/magnetisation enters as the coupled pair: field polarisation `P` and its conjugate circulation `M`, with the cross-term `P·M` as the energy exchange channel and thermal noise setting the decoherence floor on both.

### Stage 5 · Surface it
**`src/ui/v13/panels/QualiaDeckPanel.tsx`** (new) + a **QUALIA** tab in `CenterWorkbench.tsx` — live `C/N/S/V/I`, `Q_inc/Q_stab/Q_res/Q`, ignition raster against the `1/φ²` line, the veto attribution, and the thermal/charge readouts.

**`src/ui/v13/panels/ScaleDeckPanel.tsx`** — add the closure column (rung n, `Lₙ mod 13`, residue, stable flag, Pisot defect) and the class tag (A / B / C) per rung.

### Stage 6 · Verification
Every constant introduced in Stages 1–4 is cross-checked through the **Wolfram** tool at ≥ 40 digits before it is committed to `WolframVerified.ts`: `φ⁻²⁶`, the 28-term Lucas residue cycle, `L₁₃ = 521 = 13·40 + 1`, the SNS(3)=3 / SNS(4)=4 / SNS(5)=15 closure, the memory-kernel roots `{1, −φ⁻²}`, and the lepton exponents `φ^11.0795` / `φ^5.8652`. Anything that does not reproduce gets tagged Class C in-code rather than quietly rounded.

## Technical notes

- No engine regressions: `FallbackEngine`'s tick path, the contraction/Lipschitz certificates, `MasterUpdateController`, and the memory substrate are read from, never rewritten. New modules are pure and side-effect free; the only mutations are additive fields on existing snapshot types.
- `QualiaCorrelate`'s quickselect and Kahan-compensated paths are preserved as-is — they are already the efficient form.
- Dead weight removed: the `Q_inc` tautology, and the duplicate qualia computation path once `SelfMeasure` is the single source.
- Ladder tables are generated at module load into `Float64Array`/`BigInt` caches, not literals, so a 301-rung ladder costs one pass and no bundle bloat.
