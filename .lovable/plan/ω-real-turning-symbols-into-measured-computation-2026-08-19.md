# Ω-REAL — Turning Symbols Into Measured Computation

Audit of the uploaded `metatron_raffy` package (15 modules, 2,954 lines), the 657-line
deep-research report, and the live engine is complete. This plan converts every symbolic
claim into an executing, certified operator — with no regression to the frozen dynamics.

## 1. What the audit actually found

**Live engine already has (do not rebuild):** φ/Lucas/Binet exact identity bank (BigInt,
90-digit), the φ-ladder and Lucas-mod-13 closure theory, FFT/Lanczos/spherical harmonics,
13×13 eigenmode attention, λ-SSM spine with Jury + ISS stability certificates, L0–L6 memory
with governor and Fibonacci banding, SimHash-φ, adaptive conformal envelope, 18-rung
certified sensory node array, digest-chain replay oracle.

**Entirely absent (the real gap):** statistical correlation family (Pearson/Spearman/
Kendall-τb/distance correlation/HSIC/Gaussian MI), causal layer (Granger F, Gaussian-CMI
transfer entropy, DML), VSA algebra (bind/bundle/permute + cleanup memory), Merkle
append-only ledger with inclusion/consistency proofs, sealed genome records with
provenance + supersession + crypto-shredding, and a *formal* abstention-aware fusion bus.

**Defects in the uploaded prototype — fixed, never ported verbatim:**
`PhiMemoryKernel` default `d=14` contradicts the calibrated `d=8`; `L0Tape` byte-budget
assertion multiplies the budget by 8 (enforces 2304 B, not 288 B); `GenomeRecord.correct()`
computes the pre-correction body and discards it (audit trail claimed but absent);
`lineage_forward` has no cycle guard; `adjust_trust` substitutes the literal `"x"` for an
empty reason; `ACI.coverage()` mutates state; `te_scan` returns lag 1 when every lag
abstains; ledger consistency proof is O(n) not O(log n) and is memory-only.

**Class discipline is binding.** Class A (φ identities, kernel roots, stable rungs
{1,13,15,27} mod 28, flux window [φ⁻²⁶,φ⁻²⁵), consolidation cosine 1−φ⁻³, κ=1/(φπ)) is
never tuned. Class C (resonance floor 0.05625982094858675, STRESS 0.432) is tunable only
through the harness and must be *labelled* as empirical everywhere it is displayed.

## 2. The principle: every symbol earns its number

The dashboard's Ω = 0.372 / Λ = 0.666 / κ-closure = 0.289 are analytic residuals of a
symbolic model, not telemetry. The rule going forward: a symbol becomes computation only
when it is (a) an operator that consumes live field state, (b) bounded by a proved
stability condition, and (c) certified by a test that fails if the number is fabricated.
Any quantity that cannot meet all three is rendered as `not measured`, never as a number.

## 3. Lost-component operators to implement

Each is a *real* algorithm mapped onto the existing complex spectral substrate — no new
state variables, only new dynamics on state we already own.

| Operator | Math | Where it attaches | Stability bound |
|---|---|---|---|
| Memristive synapse | HP/Chua `x←clip(x+Δt·k·i·f(x),0,1)`, Biolek window, `W=M(x)e^{iθ}` | HebbianMatrix entries | passivity `M(x)≥0`, `Δt·k·max|i|≪1` |
| Complex Oja bound | `ΔW=η(z_jz̄_k−|z_k|²W)` | replaces raw Hebb growth | `ηλ_max(C)≪1`, self-normalising |
| S4D / HiPPO reading | `g_k=e^{λ_kΔt}`, `λ_k=−γ_k+iω₀φ^k` | per-mode kernel gains | `Re λ≤0` (already enforced) |
| FHRR VSA | bind = phase add, unbind = conjugate, bundle = sum | 13-mode tile = native FHRR vector | unit modulus by construction |
| Complex Hopfield cleanup | `W=Σz^μ z^{μ*}`, `z←h/|h|`, `E=−Σ Re(z̄Wz)` | memory recall / cleanup | Hermitian W ⇒ E monotone |
| Exact DMD / Koopman | `Ã=U*X'VΣ⁻¹`, modes `Φ=X'VΣ⁻¹W` | predictor over mode trajectories | clip `|λ|≤1` after each refit |
| NG-RC readout | delay+monomial features, ridge closed form | φ-rungs are the delay taps | `λ>0` Tikhonov |

The φ ladder is not decoration here: incommensurate φ-spaced phases are the provably best
FHRR basis (no binding-chain aliasing) and a near-optimal HiPPO multi-timescale covering.

## 4. Resolution / rate contract

Processing is assigned to the scale where it is valid, and nothing is computed at a rate
its statistics cannot support.

| Rate | Work |
|---|---|
| 377/233/89 Hz | sensory intake, Level-1 signal (MSC, PLV, GCC-PHAT) on streaming windows |
| per-τ tick | tile step, memristive + Oja plasticity, FHRR bind of the live percept |
| 21 ticks (F8) | mind report, Hopfield cleanup, coherence corridor gate C(t)>φ⁻² |
| 144 ticks (F12) | L3 consolidation, streaming DMD refit, genome signature emission |
| stable rungs {1,13,15,27} mod 28 | Ten-Sweep protocol: long gap (12) = sweeps 1–7, short gap (2) = 8–10 |
| ≥34 paired samples (F9) | Level-2 statistics may speak at all; below that they abstain |
| ≥34+lag samples | Level-3 causal (Granger, TE) may speak; DML batched off the tick path |

## 5. Implementation phases (each ends green or is reverted)

**P0 — Substrate parity. [DONE]** `src/substrate/phiSubstrate.ts` + `test/r0-substrate-parity.test.ts`
(14 tests). Ported as *derivations*, not duplicates: the four stable rungs {1,13,15,27} and
the {12,2} heartbeat are computed from L_n mod 13 rather than hardcoded as in the reference;
flux window entry at n=13 and the Metatron spectrum are proved at runtime via
`substrateParity()`. The two calibrations with no φ-closed form (resonance floor, stress
threshold) are explicitly tagged Class C so no surface can present them as proved constants.
Correction made: Binet/Pisot tolerances must scale with φⁿ — an absolute 1e-12 sits below the
ulp of φ²⁸ and fails for numerical, not mathematical, reasons.

**P1 — Innovation-form coherence C(t). [DONE]** `src/substrate/coherenceKernel.ts` +
`test/r1-innovation-coherence.test.ts` (12 tests). Roots computed and verified exactly
{1, −φ⁻²}; C(t) runs on the mean-centred *innovation* stream, allocation-free, with `null`
abstention (never 0) while warming or on a silent drive. Gate C(t)>φ⁻².
Two defects found in the reference derivation and fixed at the source rather than papered over:
1. `E[C]` omitted the delay — the kernel correlates at lag τ, so ρ=e^(−θ·τ/φ); at τ=2 the
   corridor centre is 0.1993, not 0.3794. Without this a correct kernel looks broken.
2. `E[C]=ρ²+(1−ρ²)/d` is the **large-d asymptote**, not the exact finite-d mean. Measured
   bias (20k steps × 40 seeds): d=4 −0.033, d=8 −0.021, d=32 −0.0072, d=256 −0.0014.
   Documented via `expectedCBias`, and the battery certifies the bias is negative and
   shrinks with d rather than hiding it inside a tolerance.
Guard hit and respected: the engine forbids raw `Math.*` transcendentals in `src/`; the kernel
routes through `dexp`/`dlog`/`dsin`/`dcos`.

Regression at end of P0+P1: **479/479 tests green, typecheck clean, S0 oracle hashes
bit-identical** (no dynamics touched — both modules are purely additive).


**P2 — Correlation stack L1/L2. [DONE]** `src/substrate/signalStats.ts` (Level-1) +
`src/substrate/correlation.ts` (Level-2) + `test/r2-correlation-stack.test.ts` (25 tests).
Level-1: Welch MSC with a hard 3-segment floor, zero-phase Butterworth band-pass (SOS,
order-4 band-pass), FFT Hilbert, PLV with edge trimming, GCC-PHAT with parabolic
sub-sample refinement. Level-2: Pearson, Spearman, tie-corrected Kendall-τb, Székely
distance correlation, normalised HSIC (median-heuristic RBF), Gaussian-copula MI, plus a
seeded (B+1)-corrected permutation null. Every estimator abstains with `null` below the
F9=34 paired-sample floor — never 0 — and the quadratic members subsample deterministically
(uniform stride, no RNG) to QUADRATIC_CAP=512, reporting the sample count actually used.

Three defects found and fixed by the battery rather than by inspection:
1. Band-pass pole pairing. Iterating all N low-pass prototype poles and taking one BP root
   each duplicates the low-side pole pair and drops the high-side one — the filter still
   looks plausible on a magnitude plot but has the wrong bandwidth (passband gain measured
   0.24 instead of 0.5). Corrected to iterate upper-half LP poles only, two BP biquads each.
2. GCC-PHAT sign. ifft(X·conj(Y)) peaks at k=−D for a y that lags x by D, so the raw argmax
   reverses every downstream causal ordering. The reported lag is now the delay of y
   relative to x, pinned by an explicit known-delay test (and −0 normalised to +0).
3. MSC band averaging is only meaningful where the shared signal lives; averaging a wide
   band around a narrow tone dilutes a true coherence of ~1 down to 0.62. Band selection is
   the caller's responsibility and the estimator reports per-bin values so it can be checked.

Regression: **504/504 green, typecheck clean, S0 oracle hashes bit-identical.** The modules
are additive and are exported from the package index; nothing is wired into a panel yet.

**P3 — Causal layer L3. DONE.** `src/substrate/causal.ts` + `test/r3-causal-layer.test.ts`
(24 tests). Granger F with a from-scratch Lanczos lgamma / Lentz incomplete beta (F-CDF
matches published critical values to 4 dp); Gaussian-copula transfer entropy pinned to the
Barnett identity G = 2·TE to 10 dp; a Bonferroni-corrected lag scan that returns
`bestLag: null` — never 0-as-sentinel — when every lag abstains; DML for the partially
linear model with K-fold cross-fitting, Neyman-orthogonal score, θ/SE/CI/p; a deterministic
seeded variance-reduction regression forest (no Math.random, bit-reproducible refits);
`directedReport` for signed directionality. Ridge-stabilised Cholesky OLS underneath, which
flags a singular design instead of emitting NaN. Abstention is `null` with a reason, at the
same F9 = 34 floor applied to the *effective* n − lag.

Three defects found by the battery, not by inspection:
1. The Numerical-Recipes `erfccheb` p-value path is only ~1.2e-7 accurate — fine for a plot,
   not for a p-value. Replaced with series-below-1 / Lentz-continued-fraction erfc (~1e-16).
2. DML with a pure-forest nuisance carried +9% bias on the fixture (θ̂ = 1.367 vs 1.25): the
   Neyman score protects against nuisance *noise*, not nuisance *bias*, and a piecewise
   constant learner leaves the same smooth remainder in both residuals. Nuisance is now
   ridge-linear on [1, X, X²] plus a forest on the leftover; bias fell inside one SE.
3. `Math.sin` in the lgamma reflection branch broke the determinism guard (S5.1) — routed
   through `dsin`.

Also fixed: the suite's 5 s default Vitest timeout was measuring machine load, not code
health, and turned six unrelated CPU-bound engine batteries red under parallelism. Budget
raised to 30 s in `vite.config.ts`; a red test now means a real hang.

**P4 — Resonance bus. DONE.** `src/substrate/resonanceBus.ts` + `test/r4-resonance-bus.test.ts`
(27 tests). Law stated once: `R=(∏ active · γ)^{1/(k+1)}`, γ=exp(−(phase_dev/κ)²) as a channel
(∞ scatter = measured veto, NaN = abstain), measured zero vetoes absolutely, abstention leaves
both product and exponent, opt-in C(t) gate at φ⁻² abstains instead of reporting a small
confident number, RESONANCE_FLOOR reported as a Class C flag and never folded into the value.
`Resonance.measureResonance` and `KnowledgeBase.recall` now delegate to the bus
(`fuseResonance` / `blendWithResonance`); A/B parity with the legacy fusion certified to 1e-12
with identical ranking, γ and the gate default-off so no ranking moved. Log-space through
`dlog`/`dexp`. Suite 555/555, typecheck clean, S0 oracle hashes unchanged.


**P5 — VSA + memory deepening.** FHRR bind/bundle/permute + cleanup memory over the
13-mode complex state, fan-in capped at 100 per prototype (measured ceiling), feature-level
φ weighting (per-bit is a proved no-op), memristive/Oja plasticity on L1, DMD predictor on
L0 trajectories.

**P6 — Genome v2 + ledger.** RFC-6962 Merkle log (`@noble/hashes` sync SHA-256, domain
separation 0x00/0x01), inclusion + true O(log n) consistency proofs, Ed25519 signed tree
heads (`@noble/curves`), AES-256-GCM sealed records with nonce prepended, canonical JSON,
PROV-O provenance, bi-temporal validity, supersession-only correction with the
pre-correction body actually persisted, crypto-shredding, cycle-guarded lineage queries.

**P7 — Ten-Sweep protocol. [DONE]** `src/sweeps/tenSweep.ts` + `test/r7-ten-sweep.test.ts`
(35 tests). Ten operators, each with a measured exit metric and a sealed `SweepSeal`; the
{12,2} firing schedule is derived from the stable rungs, not hardcoded.
Reference defects fixed rather than ported: six of the ten sweeps sealed `ok: true`
unconditionally; sweeps 3 and 5 read the wall clock, so replays could not be compared (time
now enters only as an injected logical clock and the cycle is bit-deterministic); the
"red team" tested list membership the forger controls, and now recomputes the leaf and runs
the RFC-6962 inclusion proof, with genuine records verified in the same pass so a
reject-everything verifier cannot pass; sweep 5 never renormalised and was not idempotent
(now a phasor bundle with idempotence as its exit metric); sweep 9 reported over-budget with
no remedy and now emits an eviction plan that must reach budget. No sentinel numbers reach a
seal — undefined statistics are `null`.

**P8 — Harness. [DONE]** `src/harness/{golden,abstention,battery,conformal,latency,certify}.ts`
+ `test/r8-harness.test.ts` (35 tests). Four gates, each proven to pass on good evidence AND
to fail on deliberately broken evidence; nothing defaults to pass, and an unmeasured gate
fails.
- golden set: 7 frozen digests over the whole estimator stack; abstention digests as NaN so
  it can never collide with a measured 0. Freezing exposed a real defect — `Math.sin`/`Math.pow`
  are implementation-defined and made two digests differ between JavaScriptCore and V8; the
  inputs now use the `dmath` kernels and the digests are identical on both engines.
- abstention: a 46-case standing battery over the real estimators, each with a stated
  rationale. 46/46 correct, zero false-confident. False-confident carries a zero budget, and
  a thrown error is a failure rather than a lucky silence.
- conformal: ACI at α = 0.10 (aiming above the 0.85 gate, not at it). Coverage 0.897 over
  1600 events with a 5× mid-run scale shift; coverage back within 68 events (budget 100);
  warm-up abstains instead of quoting a made-up interval, and a frozen-α control proves the
  recursion is what recovers.
- latency: generate+verify against a 1024-leaf ledger, p95 well under the 100 ms budget,
  clock injected so the benchmark replays.

## 6. Non-regression contract

- The S0 oracle digest chain is frozen. Any phase that changes a digest is reverted, not
  re-baselined; new dynamics ship behind port flags and prove parity first.
- Every new operator lands with its own test battery before it is wired into any panel.
- No new number reaches the dashboard without a measurement provenance flag; anything
  unmeasured renders as `warming` / `not measured`.
- Typecheck, full vitest suite, and production build must be green at the end of each phase.

## 7. First increment on approval

P0 + P1 together: the Class-A parity battery and the innovation-form C(t) kernel with its
corridor gate — additive, zero risk to live dynamics, and they unblock every later phase.
