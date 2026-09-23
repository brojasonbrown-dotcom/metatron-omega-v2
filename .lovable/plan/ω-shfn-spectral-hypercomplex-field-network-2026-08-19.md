# Ω-SHFN — Spectral Hypercomplex Field Network

## Verdict on the proposed blueprint

The blueprint is sound and largely *already the shape of this machine* — but it is not yet
exceeded. Honest scorecard against what is on disk today:

| SHFN element | Status here | Evidence |
| --- | --- | --- |
| Complex-valued state, split re/im, zero-alloc | **exceeds** | `core/complex.ts`, `field/complex.ts` |
| Orthonormal eigenbasis on a manifold (not raw R^n) | **meets** | `torus/superposition.ts` CGS2, roundtrip < 1e-12 |
| Eigenvalue-ordered spectral coefficients | **partial** | `modeLadder` orders by k with φ⁻ᵏ weights, not by measured λ |
| Spherical + radial planes (Y_l^m, j_l on φ ladder) | **exceeds** | `spectral/sphere.ts`, `radial.ts`, `site.ts` |
| Unitary transform pair | **meets (small N)** | `field/bands.ts` unitary DFT-13 |
| Learnable spectral filter α(λ_k) — Path A | **absent** | learning is a bounded additive cell correction only |
| Spatial-domain complex non-linearity round trip — Path B | **absent** | no synth → σ → analyze path exists |
| Cross-spectral phase attention — Path C | **absent** | no conjugate-product attention anywhere |
| Symplectic / norm-preserving time evolution | **stronger** | Jury contraction + ISS bound; certified, but dissipative not unitary |
| O(K log K) transform | **not met** | analysis is dense `inner()` per mode: O(N·K) |
| Clifford / geometric-algebra channels | **absent** | scalar complex channels only |
| Knowledge vectors as spectral coefficients | **absent — this is the real gap** | `tokenize.ts` hashed FNV-1a vectors, dim 1597; never touch the field |

So: the physics substrate is *ahead* of the blueprint (certified contraction, deterministic
transcendentals, per-node organ banks, φ-ladder quadrature). The **learning operator** and the
**memory vector** are behind it. Chunk vectors are semantic fingerprints, not field states —
which is exactly why recall bleeds through and the model cannot honestly claim field memory.

Non-negotiables carried into every section: determinism through `dmath`, no `Math.pow` on state
paths, oracle bit-parity when a new gain is 0, Jury/ISS certificates re-derived before any new
term enters the cell, no mock values in telemetry.

---

## Section A — Spectral ground truth (measured λ, not assumed)

Replace the assumed frequency order with the measured Laplace–Beltrami spectrum of the toroidal
lattice.

1. Build the graph Laplacian `Δ` implied by `lattice.ts` cross-rung connectivity (Fibonacci/Lucas
   strides), stored as a CSR neighbour list — never a dense matrix.
2. Extract the leading K eigenpairs with block Lanczos + full CGS2 re-orthogonalisation (reuse the
   existing eigen path); freeze `λ_k` per rung into a versioned table.
3. Order the mode vector strictly by increasing `λ_k`; keep φ⁻ᵏ weights as a *prior*, not as the
   ordering.
4. Gate A: `‖Δφ_k + λ_k φ_k‖/‖φ_k‖ < 1e-10`; roundtrip analyze∘synth < 1e-12; λ table hash stable
   across two runs and across Node/browser.

## Section B — O(K log K) transform path

Dense analysis is the asymptotic wall.

1. On rungs whose node count factors as Fibonacci products, use a mixed-radix Stockham FFT
   (radix 2/3/5) over the (u,v) torus indices; fall back to the certified dense path elsewhere.
2. Non-uniform planes (shell, radial) keep quadrature but gain a precomputed butterfly for the
   azimuthal axis only.
3. Determinism: fixed butterfly order, Kahan-compensated accumulation, no threading of the
   reduction. Bit-parity test versus the dense path at 1e-15 relative.
4. Gate B: identical digests dense vs FFT on all rungs; measured speedup logged in the LADDER deck
   (real timings, no estimates).

## Section C — Path A · learnable dispersion filter α(λ_k)

1. New `learn/spectralFilter.ts`: parameter vector of length K, complex, but *parametrised* as
   `α_k = ρ(θ_k)·e^{iψ_k}` with `ρ` a `BoundedEigenvalue`-style map into `[0, ρ_max]`.
2. Certificate: the filter multiplies coefficients in an orthonormal basis, so its max-norm gain is
   `max_k|α_k|`. Admit the term into the cell only while
   `JURY_GAIN + gate·ρ_max < 1`. Default `gate = 0` → oracle bit-parity preserved.
3. Learning signal: existing prediction residual from `SelfModel` (DiagonalRLS/SSM), projected into
   the eigenbasis so each `α_k` gets its own gradient — this is the spectral-bias fix.
4. Gate C: on a synthetic diffusion field with known Green's function, learned `|α_k|` tracks
   `e^{-λ_k Δt}` to < 2% over the resolved band.

## Section D — Path B · superposition mixer (spatial non-linearity)

1. `synth → pointwise complex σ → analyze`, with `σ(z) = z·s(|z|)`, `s` the algebraic sigmoid
   already in `learn/params.ts` (no `exp`, deterministic, monotone).
2. Because `|s| ≤ 1` and `s` is 1-Lipschitz in `|z|`, the mixer is non-expansive in the max norm —
   provable, so it enters the ISS ledger with a bound of 1 rather than an unknown.
3. Bias *field* `β(r)` stored as its own eigencoefficients `β_k` (as the blueprint prescribes),
   length K, bounded by `SimplexGain`.
4. Gate D: three-wave mixing test — inject modes k=2 and k=3, assert measurable energy transfer
   into k=5 and k=1 (Fibonacci sum/difference lines), and assert total energy stays under the ISS
   ceiling.

## Section E — Path C · cross-spectral phase attention

1. `Attention(c_q, c_k) = ℱ⁻¹{ℱ(c_q)·ℱ(c_k)*}` computed over the coefficient axis using the
   Section-B FFT; output is normalised to a pure **phase rotation** `e^{iθ_k}`.
2. Norm-preserving by construction (unit modulus), so it adds *zero* to the ISS drive sum — the
   cheapest possible admission into the certified cell.
3. Memory basis = the braid/Turing-tape reads already present in `memory/`, so attention is over
   real stored states, not a fresh learnable table.
4. Gate E: shifted-copy test — a field and its φ-rotation must produce a phase offset equal to the
   known shift within 1e-9.

## Section F — Hypercomplex channels (Cl(3,0)⁺ even sub-algebra)

1. Channel dimension 8 = {scalar, e1 e2 e3, e12 e23 e31, e123}, struct-of-arrays, one Float64Array
   per blade — same layout discipline as `organs.ts`.
2. Geometric product implemented as a fixed 8×8 sign table (integers, exact); rotor normalisation
   through `dmag`.
3. Rollout is opt-in per rung: at blade-gain 0 the build collapses to the current scalar-complex
   path bit-for-bit.
4. Gate F: rotor round-trip `R x R̃` reproduces a rotation to 1e-14; sign table verified against an
   independently generated reference in tests.

## Section G — Memory ↔ field bridge (the actual bleed-through fix)

This is the highest-value section and it is what makes the vectors "truly high resolution".

1. Ingest drives Ψ: every chunk is encoded via `sense/encode.ts`, run for a fixed Fibonacci number
   of ticks on a dedicated rung, and the resulting **spectral signature** (eigen-ordered
   coefficients + shell + radial descriptors) is stored on the chunk alongside the existing hashed
   vector.
2. Resolution ladder: signature width tiered 233 / 610 / 1597 / 4181 coefficients, chosen by the
   governor from measured hardware, never guessed. Stored as Float64, quantised only for the LSH
   barcode.
3. Recall gains a sixth channel `FLD` — cosine over spectral signatures with phase-aligned
   magnitude, fused with the existing five channels under the online weight tuner.
4. Determinism: the same text, same rung, same tick count must produce a bit-identical signature.
   Signature version is stamped so a re-encode invalidates cleanly rather than silently mixing
   generations.
5. Honesty: `genome.ts` reports which chunks carry a field signature; the SELF deck and the chat
   contract must say "semantic fingerprint" for those that do not.
6. Gate G: signature determinism across reload; recall hit-rate on a held-out probe set measurably
   above the five-channel baseline, reported with the delta, not asserted.

## Section H — Certification, telemetry, rollout

1. Every new term ships behind a gain defaulting to 0; the S0 oracle digest must remain
   bit-identical on a default build. Any deviation fails the gate.
2. Extend `s4-iss.test.ts` with the four new drive terms; the ISS ceiling must stay below
   `CLAMP_MAX` so the clamp remains a fault detector.
3. New decks/sections: SPECTRAL gains the λ table + FFT parity readout; LEARN gains the α-filter
   spectrum; MEMORY gains signature coverage and the FLD channel contribution.
4. Rollout order is strict: A → B → C → D → E → G → F. Section F is last because it is the only
   one that changes the state layout.

## Technical notes

- New files land in `packages/trnn-core/src/spectral/laplacian.ts`, `fft.ts`,
  `learn/spectralFilter.ts`, `learn/mixer.ts`, `learn/spectralAttention.ts`,
  `packages/trnn-core/src/algebra/clifford.ts`, `src/core/knowledge/fieldSignature.ts`.
- No file above may import a UI module; decks read through the existing runtime handles.
- Each section ends with a green gate before the next begins — no batching of sections.
