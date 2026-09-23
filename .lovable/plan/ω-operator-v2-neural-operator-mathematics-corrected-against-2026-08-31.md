# Ω-OPERATOR v2 — Neural-Operator Mathematics, Corrected Against the Real Substrate

This is a revision of v1. Three claims in v1 were wrong about this codebase and one
phase was mathematically void. Those are corrected below and marked **[v1 CORRECTION]**.
Everything asserted here was checked against the source in this turn.

## Verified ground truth (read this turn, not assumed)

| Claim | Verdict |
|---|---|
| `learn/spectralFilter.ts` is "diagonal-real gain" | **FALSE.** It is already `α_k = ρ_k e^{iψ_k}`, complex, surjectively parameterised, clamped at `ρ_max = φ⁻¹`. v1's N5 premise was wrong. |
| `spectral/fft.ts` only handles powers of two | **FALSE.** Bluestein chirp path gives exact O(n log n) at arbitrary n — Fibonacci node counts (13, 233, 1597) are already first-class. Resampling is therefore cheap and exact. |
| Hodge split on the `(u,v)` torus coordinates gives a new coherence witness | **VOID as written.** `torus/lattice.ts` is a *1-D golden ring*: `u_j = 2πj/n`, `v_j = jφ mod 2π`. Numerically confirmed this turn: on a 1-D circle every zero-mean field is exactly a gradient (residual 1.3e-15). A Hodge ratio computed there is identically 0 — a dead channel, not a metric. |
| No spectral differentiation exists | **TRUE.** `spectral/laplacian.ts` is graph-Laplacian only. Real gap. |
| Sobolev-graded error is absent | **TRUE.** Plain L2 everywhere. Real gap. |

## What actually is the highest-value extraction

The library's real gift is not FNO-the-architecture. It is three facts:

1. **The eigenbasis is the operator.** In an orthonormal eigenbasis a linear
   propagator is diagonal — which this engine already exploits correctly. So the
   headroom is *not* in making the filter richer per mode; it is in the **coupling
   between modes**, which is exactly what a diagonal filter structurally cannot
   represent, and which is where all nonlinear field intelligence lives.
2. **Discretisation invariance.** A field is a function, not a sample vector.
   Learn at rung 4, evaluate at rung 14, with zero interpolation error. This is
   the missing primitive for genuine fractal nesting, and Bluestein makes it free.
3. **Graded norms.** L2 rewards smooth-but-wrong. H1 does not.

## Why the coherence ceiling is a *metric* problem, not a field problem

Measured previously: field coherence (golden-delay `|⟨Ψ(t)|Ψ(t−233)⟩|²`) sits near 1.0,
while dashboard Ω sits at 0.4946 — its φ-weighted geometric-mean ceiling under
saturating F4 and driver-dependent F8. v1 proposed fixing this with a Hodge witness.
That instrument does not exist on a 1-D ring. The correct replacement witness is below
(**N2′**), and it is genuinely driver-invariant.

## Phases (all additive, all default-off, all gated on measurement)

### N1 — `operator/fourierDiff.ts` — exact spectral calculus *(unchanged, keep)*
`dx`, `d2x`, and higher orders via `∂ = ik·û` on the periodic ring, on top of
`fftUnitary`. Nyquist bin zeroed for odd orders (otherwise a real field acquires an
imaginary derivative — the classic bug).
Also `dPhi`: the derivative along the **golden direction** `v_j = jφ`, which on this
lattice is *not* a second FFT axis but a rotation by an irrational angle. It is computed
in mode space from the `(p,q)` pairs in `torus/eigenmodes.ts`, where it is exact.
**Gate:** analytic match < 1e-12 on `sin(kx)`, `e^{ikx}`, φ-mode superpositions; agrees
with the graph Laplacian on the ring in the band-limited regime.

### N2′ — `operator/modeCurrent.ts` — the driver-invariant witness *(replaces v1's N2)* **[v1 CORRECTION]**
Instead of a void spatial Hodge split, lift the field into the **2-D mode lattice**
`(p_k, q_k) = (k, round(kφ⁻¹))` that `eigenmodes.ts` already defines. On that genuine
2-torus of wavenumbers the Helmholtz–Hodge decomposition is non-degenerate, and the
object we split is the **spectral energy-flux field** `J(p,q)` — the per-tick transport
of energy between modes.

- Solenoidal `J` = energy circulating on closed loops in mode space = *sustained
  internal structure*.
- Irrotational `J` = energy flowing from source to sink = *driven throughput*.

`modeCirculation ∈ [0,1]` is the solenoidal fraction. It is amplitude-free (a ratio),
scale-free (normalised per rung), and **driver-free** — pumping the input harder raises
the irrotational part and leaves circulation untouched. That is precisely what Ω lacks.
**Gate:** P² = P idempotent to 1e-12; a pure feed-forward cascade reports ≈0; a closed
3-mode resonant loop reports ≈1; ratio invariant to ×10 input amplitude within 1e-9.
Shipped as a **read-only** channel `field.modeCirculation` in `channelSampler.ts`.
It does not touch Ω. We watch both for a full session before anything is rewired.

### N3 — `operator/resample.ts` — discretisation invariance *(unchanged, upgraded rationale)*
Spectral zero-pad / truncate between Fibonacci rung widths, using the unitary
transform so energy is conserved by construction. Bluestein makes 13↔233↔1597 exact.
**Gate:** round-trip identity < 1e-12 for band-limited fields; Parseval energy equality;
`13→233→13` returns bit-comparable. Offered to `fractal/nest.ts` as an opt-in transfer
path, flag default off.

### N4 — `operator/sobolev.ts` — H1 / Hdiv graded error *(unchanged)*
`l2`, `h1`, `hdiv`, built on N1's derivatives, quadrature-weighted.
**Gate:** H1 ≥ L2 always; H1 separates two fields with identical L2 and different
roughness; closed-form agreement.
Reported into the learning ledger only. The optimiser keeps L2 until N6 proves H1 wins
on recorded tape.

### N5′ — `operator/modeCoupling.ts` — the actual representational gain *(replaces v1's N5)* **[v1 CORRECTION]**
`SpectralFilter` is already complex-diagonal, so "make it complex" buys nothing. The real
missing capacity is **off-diagonal coupling** on the 13-mode φ ladder: a banded
Hermitian-plus-skew coupling `C` restricted to the Fibonacci neighbour graph
(`k ↔ k±1`, `k ↔ k±2` — the φ-recurrence stencil), applied as `c' = (D + gC)c` with
`D` the existing filter.

Stability is not asserted, it is *constructed*: `C` is stored in a parameterisation whose
spectral radius is bounded by construction (skew part is exactly norm-preserving; the
symmetric part passes through the same algebraic sigmoid clamp as `ρ_max`), so
`‖D + gC‖₂ ≤ ρ_max + g·ρ_C` and the gate `g` enters the Jury ledger linearly with a
default of **0**. A default build is bit-identical to the S0 oracle — regression is
structurally impossible, not merely tested against.
**Gate:** g=0 reproduces `SpectralFilter` bit-for-bit; measured ℓ² gain < 1 for every
admissible parameter draw over 10⁶ deterministic samples; Jury sum recomputed and
re-certified; ISS bound in `cell/update.ts` still satisfied every tick.

### N6 — A/B on recorded tape, negative results allowed *(unchanged, now the gate for N5′)*
Same field tape through legacy vs new: golden-delay coherence, `modeCirculation`,
H1 vs L2 convergence, DMD residual, tick cost, bytes. No promotion without a measured
win *and* a full-suite green. A phase that does not help stays off and is documented as
not helping.

### N7 — only if N6 justifies it
FC-Gram continuation for **non-periodic sensory windows** (audio/IMU) where Gibbs
ringing currently contaminates spectral channels — the one place the library's
Fourier-continuation machinery is genuinely needed, since the engine's own domain is
already periodic. Then rotary embedding for the 1597-dim knowledge vectors; then SFNO
spherical harmonics for `spectral/sphere.ts`.

## On "infinite multidimensional stable self-measuring resonance"

Stated plainly, so the plan is honest about what it can and cannot deliver:

- **Infinite / multidimensional** is achievable only in the *discretisation-invariant*
  sense — N3. A field represented as a spectral object has no intrinsic resolution;
  rungs become views of one object rather than separate arrays. That is the real,
  achievable meaning of unbounded depth here, and it costs no extra memory.
- **Stable** is achievable in the strict sense already used in this engine: every new
  operator carries a contraction certificate (`‖·‖ ≤ ρ_max < 1`) and enters the cell
  through a gated additive term inside the existing Jury/ISS ledger. No phase ships
  without recomputing that ledger.
- **Self-measuring** is exactly N2′: a coherence witness that cannot be inflated by the
  driver. Ω = 0.49 is currently a saturating construct; `modeCirculation` is a measurement.
- **Resonance / intelligence** emerges, if it emerges, from N5′ — mode coupling is the
  only phase that adds representational capacity rather than instrumentation. It is
  deliberately last and deliberately gated at 0.

Anything beyond this is not engineering, and the plan will not claim it.

## Regression policy (non-negotiable)

- No Python, no torch, no new dependency. The archive stays in the sandbox and is never
  copied into the repository.
- All new code under `packages/trnn-core/src/operator/`. Nothing existing is rewritten
  in N1–N4. N5′ touches only the filter application site, behind a zero default.
- Determinism: `core/dmath` transcendentals only; no `Math.pow` on state paths; no RNG.
- Every phase adds tests before it adds a channel, and a channel before it adds state.
- The S0 oracle hashes must be unchanged after every phase.

## Deliverables

`operator/{fourierDiff,modeCurrent,resample,sobolev,modeCoupling}.ts`, tests `o1`–`o5`,
an A/B harness, one new read-only analysis channel `field.modeCirculation`, and BRAINMAP
amendment Ω-08 recording the operator layer plus the measured (not assumed) A/B results.
