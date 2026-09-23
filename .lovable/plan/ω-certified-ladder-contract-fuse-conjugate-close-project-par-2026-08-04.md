# Ω-Certified Ladder: Contract, Fuse, Conjugate, Close, Project, Parallelise

Six principles, six concrete build steps on top of what already runs (9-rung RHUFT-F ladder, real eigenmodes at n=1/n=8, Lyapunov E_t, law layer, memory substrate). Nothing existing is removed; every rung keeps its current measurement and gains a certificate.

## Where we are today

- `src/ui/v13/scaleRuntime.ts` resamples one 44-float sample onto 9 shadow rungs, runs O_0..O_8, and reports per-rung `closureScore`, `invariantScore`, `drift`, `energy`, plus a single global `lyapunovEnergy`.
- There is **no composite score**: the panel shows 9 independent numbers, so a single dead rung is invisible in the aggregate.
- There is **no contraction certificate**: nothing measures whether a rung's operator actually shrinks error, so chaining them is unproven.
- The pass is **forward only** — no φ-conjugate mirror, no loop closure back into the base, no mode-domain residual decomposition.
- Work is scheduled per-observation, single-threaded; `pressureUtilisation` is reported but not used to schedule.

## Step 1 — Contract certificates (principle ①)

New `src/core/runtime/rhuftf/contraction.ts`.

For each rung n, estimate the empirical contraction factor over a sliding window:

```text
lambda_n = || e_t ||  /  || e_{t-1} ||        e_t = psi_t - psiHat_t
```

Use a windowed geometric mean of the ratio (log-domain, Neumaier-accumulated) so spikes don't dominate, and hold a per-rung certified floor from the spec table (φ⁻², φ⁻³, φ⁻¹·⁵ …). Emit per rung:

- `lambdaEmpirical`, `lambdaFloor`, `certified = lambdaEmpirical < 1`
- `slack = lambdaFloor - lambdaEmpirical` (negative = rung is off-spec)
- composed rate along any admitted chain = Π λ_i, exposed as `chainRate`

Composition gate: `scaleRuntime` only marks a rung-to-rung link **admitted** when both endpoints are certified. Non-certified rungs still measure and display — they are just excluded from the composed chain, never silently dropped.

## Step 2 — Ω fusion by geometric mean (principle ②)

New `src/core/runtime/rhuftf/omega.ts`.

```text
Omega = exp( Σ_i w_i · ln( clamp(m_i, eps, 1) )  /  Σ_i w_i )
w_i   = PHI ** (-rank_i)
```

- Metrics `m_i` are the normalised per-rung closure scores, plus invariant witnesses, plus law-layer metrics (perfection deficit, smoothness, multiscale closure) and memory-recall precision — each registered through one `registerOmegaMetric({ id, rank, read })` call so future modules fold in without touching the fusion code.
- Log-domain domination is the point: any rung near 0 vetoes Ω. NaN metrics are reported as `abstain` and excluded from both numerator and denominator (an unmeasurable rung must not be scored as a failure, and must not be scored as a pass either — the count of abstentions is shown).
- Panel gets an Ω gauge with the veto attribution: which metric contributed the most negative log term.

## Step 3 — φ-conjugate dual pass (principle ③)

Extend the shadow tape to carry a mirrored inward spiral: for each rung the conjugate state is the same sample resampled with reciprocal-φ stride ordering (outward n → inward 8−n index map, φ⁻¹ amplitude weighting).

Run the identical operator on the conjugate and record:

- `varForward`, `varConjugate`, and `biasWitness = (varF - varC) / (varF + varC)`
- Cancellation check: forward+conjugate mean should annihilate the odd harmonic content; residual after cancellation is `conjugateResidual`.

Any new module registered into Ω must supply a `dual()` — enforced by the metric registry type, so it cannot be forgotten.

## Step 4 — Torus loop closure and ring residual (principle ④)

Feed rung 8's output y_8 back into rung 0's input channel through the existing `LadderProjection`, one tick delayed, and measure:

```text
ringResidual = || y_0(t) - P(y_8(t-1)) ||  /  || y_0(t) ||
```

This becomes the single headline health metric next to Ω. Feedback is **observer-only by default** (writes to the shadow tape, never to the live ψ) behind `FLAG_RHUFTF_TORUS_CLOSURE`, so no engine regression is possible; the flag console can promote it to a live coupling for experiments.

## Step 5 — φ-mode projection when residual stalls (principle ⑤)

New `projectResidual(residual) -> { k, coeff[] }`: decompose the ring/closure residual onto the φ-mode basis (φ⁻ᵏ-scaled DCT-like basis over the rung's node count, reusing the eigenmode machinery in `eigenmodes.ts`).

- Detect the leaking harmonic as `argmax_k |coeff_k|`, report `k` and the implied decay `residual ≈ φ⁻ᵏ`.
- Apply the F8 κ-closure damping to exactly that mode (existing operator, targeted rather than broad), with damping strength derived from the coefficient, not a constant.
- Stall detector: if `ringResidual` fails to shrink over N ticks, the panel surfaces "leaking harmonic k=… → damping applied" instead of a flat number.

## Step 6 — Parallelise by mode index (principle ⑥)

Current `pressureUtilisation ≈ 0.277` means ~3.6× headroom. Change `WorkerPool` dispatch from data-chunk partitioning to **mode-index partitioning**: each worker owns a contiguous band of mode indices across all rungs, so no worker needs a neighbour's amplitudes and the reduction is a per-band Neumaier partial that combines associatively (bit-stable ordering by band index preserves determinism).

- Band count = `min(hardwareConcurrency, ceil(totalModes / minBandWidth))`, taken from the existing `hardwareProbe` and Brain tier budget so it stays configurable in the UI.
- Utilisation target becomes a control input: the governor raises band count until measured utilisation approaches its ceiling, then holds.

## UI

`ScaleDeckPanel` gains three sections, no layout rewrite:

1. **Ω** — gauge, weight ladder φ^(−rank), veto attribution, abstain count.
2. **CERTIFICATES** — per rung λ_empirical vs λ_floor, certified badge, composed chain rate.
3. **LOOP** — ring residual sparkline, leaking harmonic k, conjugate bias witness.

## Technical notes

- All new math uses the existing Neumaier accumulators; no `Math.random`, no module-scope compute (Worker global-scope restriction).
- New files: `contraction.ts`, `omega.ts`, `conjugate.ts`, `torusClosure.ts`, `phiModes.ts` under `src/core/runtime/rhuftf/`, all pure and unit-testable.
- Every new behaviour sits behind a port flag defaulting to observer-only; engines and current metrics are untouched, so no regression path exists.
- Wolfram-verified constants (φ, φ⁻¹, κ, φ-power table) are pulled from `WolframVerified.ts` rather than re-literalised.
