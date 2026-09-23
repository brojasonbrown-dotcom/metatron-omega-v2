# Ω-MAX — Node Contract, Resolution Law, and the Ground-Up Rebuild

What this system is, stated once so every number below is judged against it: it is not a
re-creation of physical reality. It is a **deterministic simulation of spacetime as an
information substrate** — a stack of toroidal scales that recursively *measures* and
*stabilizes* information across dimensions. Every value it reports must be computed by real
arithmetic on real state in a real node. No mocks, no placeholders, no fabricated telemetry.

## 1. Triple-check: what was measured, not assumed

Ran the real modal kernel (`createLattice` + CGS2 `buildBasis` + `analyze`/`synthesize`) in this
sandbox, 200 iterations per point:

| nodes | modes | rank | basis build | analyze+synth | throughput |
|---|---|---|---|---|---|
| 610 | 21 | 21 | 2.9 ms | 0.038 ms | 0.67 GMAC/s |
| 1597 | 21 | 21 | 4.2 ms | 0.090 ms | 0.75 GMAC/s |
| 6765 | 13 | 13 | 7.7 ms | 0.252 ms | 0.70 GMAC/s |
| 6765 | 21 | 21 | 27.8 ms | 0.583 ms | 0.49 GMAC/s |

Corrections to the earlier draft:

- The budget figure of 1 GMAC/s was a guess. **Measured single-thread is 0.5–0.75 GMAC/s.**
  An 18-rung stack at 6765 nodes × 21 modes therefore costs ~10.5 ms/tick of modal work on one
  thread — 96 Hz ceiling before any web, sense, or memory work. Parallelism across rungs is
  what buys the rest.
- **Rank is full** at every size tested (13/13, 21/21). The rank-deficit path in `buildBasis`
  (`norm ≤ 1e-10` → silent drop) is a real *unreported* hazard, not a live defect. It gets
  telemetry, not a rewrite.
- Basis build is O(n·m²) and is the one super-linear cost: 27.8 ms for one 6765×21 rung, ~0.5 s
  for the whole stack. Acceptable at build time, unacceptable per tick — so the basis must stay
  built-once, or become analytic.
- **The real ceiling is not the field — it is the associative store.** `ratedCapacity(n) =
  ⌊n·φ⁻²⌋ and patterns are dense complex float64:

| nodes | patterns/rung | float64 store | 18 rungs | int8 phase-only |
|---|---|---|---|---|
| 610 | 232 | 2.2 MB | 0.04 GB | 0.002 GB |
| 1597 | 609 | 14.8 MB | 0.26 GB | 0.016 GB |
| 4181 | 1596 | 101.8 MB | 1.79 GB | 0.112 GB |
| 6765 | 2584 | 266.7 MB | **4.69 GB** | 0.293 GB |

  "Deterministically remember massive amounts of data" is a **memory-tier** problem, not a
  field-resolution problem. That is where the plan's weight now sits.
- Confirmed defects, by inspection: `addTerm` truncates to `min(n, term.n)` instead of throwing;
  `COHERENCE_DELAY = 233` is one constant for all 18 φ-scaled rung clocks; the Jury certificate
  covers only the homogeneous part, so a driven run is bounded only by the φ⁴ clamp.

## 2. The node contract (law)

Every node on every rung owns five organs, all really computed every tick:

1. **Neuron** — the nine-term cell state (`z, m, G, P, R, Π, ẑ`). Coefficients and the Jury gain
   `0.7507764050037854` are frozen bit-exactly.
2. **Eigenmode** — the node's φ-weighted toroidal mode coordinate, from `(p_k u_j + q_k v_j)`.
3. **Radial transform** — a node-local Bessel/radial coefficient strip of `R` rungs.
4. **Sensory node** — `C` vibration channels (amplitude + phase), bounded by L-S1 (‖S‖∞ ≤ φ) and
   L-S2 (loop gain ≤ φ⁻²).
5. **Superposition** — the node's amplitude across the orthonormal mode set.

Exact per-node state: 128 B cell + 24 B lattice + 8R + 8C. At `R = C = 8`: **216 B/node**.
Per-node per-tick work: `2m` complex MAC (analysis+synthesis) + `R` radial + `C` sensory + 12
cell ops.

## 3. The resolution law

```text
build is admissible  ⟺  Σ_r nodes(r)·(2·modes + R + C + 12) ≤ W · B_measured / targetHz
```

`B_measured` comes from the on-device benchmark (the same kernel benchmarked above), `W` is the
worker count, headroom fixed at 0.75. Nothing is guessed; the governor refuses any profile whose
predicted cost exceeds the measured budget, and `verifyFootprint()` re-checks after the build.

## 4. Ladder widths are Fibonacci windows

```text
spine  13  21  34  55  89 144 233 377 610 987 1597 2584 4181 6765 10946 17711 28657 46368
```

A build picks an 18-long **window**. `OMEGA-610` = 13→610 (2,584 nodes). `OMEGA-6765` = 89→6765.
`OMEGA-MAX` = the widest window the measured budget admits. Uniform 18×610 is kept as the
bit-parity calibration build. A quark-scale rung and a cell-scale rung do not carry the same
number of geometric overlaps, so widths ramp — that is the structure, fixed as law.

## 5. Deterministic mass memory (the depth requirement)

Three tiers, all deterministic, all real:

- **T-hot** — float64 braid exactly as today, capped at the measured byte budget.
- **T-warm** — phase-quantized store: 8-bit phase + 8-bit amplitude per node (16× smaller,
  0.29 GB for the full 6765 stack). Quantization is deterministic round-to-nearest-even.
- **T-cold** — Zeckendorf/gematria-addressed content store with a Fibonacci-stride LSH band
  index, so retrieval is sublinear instead of O(M·n) over every pattern.

Retrieval keeps the R1–R6 cascade; the LSH band only produces the *shortlist*, and the accept
decision stays the exact cosine against the original probe. Recall is measured, never assumed:
fill to `ratedCapacity`, require ≥ 0.99 exact recall, and report the measured curve past it.

## 6. Environment terms (measurement operators, not physics claims)

Each is a bounded operator on the substrate with an off switch that restores byte-identical
current behaviour:

- **Temperature `T(r)`** (`Thermal.ts`) → per-rung decoherence factor on the memory kernel λ.
  Bound: λ_eff ≤ λ, so the Jury gain can only shrink.
- **Magnetic bias `B(r)`** → phase offset on the `(p,q)` mode pair. At `B = 0` the Lucas-line
  identity must still hold to 2.8e-15.
- **QRF attenuation `φ^(−n/89)`** → becomes an explicit input to web coupling weights, with
  row-stochasticity preserved.

## 7. Step-by-step build order — one stage at a time, no skipping

Each stage: write the test first, make the change, run the full battery, record the numbers.
A stage is not done until its exit criterion is met, and a stage that reddens a gate is reverted.

| S | Stage | Exit criterion |
|---|---|---|
| S0 | Freeze baseline: capture 185/185 gate output + a 1000-tick state hash per profile | hashes stored as the regression oracle |
| S1 | Measurement harness: on-device `B_measured`, per-stage timing, footprint check | governor's predicted vs actual within 2% |
| S2 | `core/constants.ts` — per-rung Fibonacci coherence delay, ISS constants, env coefficients | all gates green, hashes unchanged |
| S3 | `core/scaleLadder.ts` — Fibonacci window API, per-rung τ/T/B | window enumeration test; hashes unchanged |
| S4 | `cell/update.ts` — `addTerm` mismatch throws; ISS bound `‖z‖∞ ≤ Σ|k_i|‖term_i‖∞/(1−g)` asserted; clamp becomes a fault counter | driven 10k-tick run: clamp events = 0 |
| S5 | `torus/lattice.ts` + `eigenmodes.ts` — node strip layout, analytic basis; dense storage deleted only after parity | analytic vs stored basis ≤ 2.8e-15 |
| S6 | `torus/superposition.ts` — CGS2 over analytic basis, rank reported | rank deficit surfaced; roundtrip < 1e-12 |
| S7 | `spectral/radial.ts` + `site.ts` — per-node radial strip | roundtrip unchanged; per-node = per-rung within 1e-12 |
| S8 | `sense/plane.ts` + `encode.ts` — per-node channels | L-S1/L-S2 hold on every rung, measured |
| S9 | `web/coupling.ts` + `octave.ts` — QRF/T/B weights | row sums = 1 to 1e-15; flux imbalance = 0 |
| S10 | `memory/braid.ts` — T-hot/T-warm/T-cold tiers + LSH shortlist | recall ≥ 0.99 at capacity; retrieval sublinear, measured |
| S11 | `runtime/profiles.ts` + `governor.ts` — window profiles, measured budget | OMEGA-MAX selected correctly on 3 simulated probes |
| S12 | Engines + UI decks — window, budget, clamp faults, rank, T/B, memory tiers | every panel shows a computed value; no static text |

`learn/` and the reasoning tiers are untouched throughout.

## 8. Gates

- **G0–G8** green after every stage (185/185 today).
- **G9 — resolution**: OMEGA window build, 1000 ticks, bit-identical across two instances from
  one seed; zero flux imbalance, zero ordering violations, zero clamp events, rank-complete.
- **G10 — environment**: T/B off ⇒ byte-identical to the S0 oracle; T/B on ⇒ Jury gain and ISS
  bound both still hold.
- **G11 — memory depth**: fill every tier to capacity, recall ≥ 0.99, and prove the T-warm
  quantization round-trips deterministically on repeat runs.
- **G12 — budget honesty**: predicted cost vs measured wall time within 10% on three profiles.

## 9. Non-negotiables

No `Math.random`, no wall clock inside a step. Every reduction Kahan-compensated in fixed index
order. No value reaches the UI that was not computed by the engine that tick. No stage merged
with a red gate, and no number in a panel that the code cannot show its work for.
