# Ω-DEPTH — Fractal layer nesting, honest RAM headroom, and the last SHFN gap

## Where we actually stand

The SHFN plan is mostly landed, not theoretical any more:

| Section | State |
| --- | --- |
| A measured Laplace–Beltrami spectrum | done (`spectral/laplacian.ts`) |
| B O(K log K) transform | done (`spectral/fft.ts`, parity-tested) |
| C learnable dispersion filter α(λ) | done (`learn/spectralFilter.ts`) |
| D spatial non-linear superposition mixer | done (`learn/mixer.ts`) |
| E cross-spectral phase attention | done (`learn/spectralAttention.ts`) |
| G memory↔field bridge, FLD recall channel | done (`knowledge/fieldSignature.ts`, `KnowledgeBase`) |
| F Clifford / hypercomplex channels | **not started** |
| 18-rung sensory node array | certified clean, T1–T18 |

So the blueprint in the message is broadly *already implemented here*, with certificates the
blueprint does not have (Jury contraction, ISS ceiling, oracle bit-parity, deterministic
transcendentals). What is missing is **depth**: the ladder is 18 rungs wide but only one level
deep — no rung's node hosts a sub-field of its own.

## The honest answer on "fractals inside the flower of life spheres"

Fully materialising a sub-lattice inside every node is not viable and not necessary: rank 17 has
1597 nodes; a 233-node child in each is 372k nodes per rung, ~90 MB of Float64 state per rung per
level, and it re-derives the same physics at every site. That is the massive-compromise path.

The low-risk equivalent is **demand-driven fractal nesting**: only nodes that are actually doing
work get a child field, children are drawn from a small pool, and the parent↔child coupling is a
norm-preserving projection so no new energy enters the certified cell.

---

## Section 1 — Honest RAM headroom (do this first, it unlocks everything else)

Today the governor holds a fixed 64 GB working budget with fixed layer shares summing to 1.0, and
`deviceMemory` is privacy-capped by browsers, so the number is a guess dressed as a measurement.

1. Add a measured probe in `HardwareEnvelope`: `performance.memory.jsHeapSizeLimit` where exposed,
   plus a growth-probe that allocates and releases φ-scaled ArrayBuffers to find the real ceiling
   once at boot, recorded with its provenance (`measured` | `reported` | `fallback`).
2. Governor gains `workingFraction` (default **0.70** of the measured ceiling) and a live
   `pressure` reading = bytes used / budget. No layer may quote a cap derived from an unmeasured
   ceiling without flagging it in the deck.
3. Pressure feedback loop: at pressure > φ⁻¹ (0.618) the governor trims the *lowest-value* share
   first (journal → pathway → patterns), never the tape or sensory floor, and logs each trim.
   At pressure > 0.854 (1 − φ⁻³) it freezes new child fields (Section 2) before it evicts memory.
4. Gate 1: caps recompute deterministically from a fixed synthetic envelope; a forced pressure
   spike sheds in the stated order and never breaches the floors; provenance is never "measured"
   unless the probe ran.

## Section 2 — Fractal depth: nested sub-fields on demand

New `packages/trnn-core/src/fractal/nest.ts` plus `fractal/pool.ts`.

1. **Child geometry.** A child is a smaller certified rung (233 or 89 nodes) instantiated at a
   parent node's site, inheriting the parent's local frame. Depth is capped at **3** levels
   (parent → child → grandchild), the φ-natural limit where a child's spectral band no longer
   overlaps its parent's resolved band.
2. **Who gets a child.** Selection is measured, not configured: a node qualifies when its
   *residual* (unexplained energy after the parent's resolved modes) exceeds the rung median by
   φ² for a sustained Fibonacci window (89 ticks). That is precisely the "this site holds detail
   my resolution cannot express" signal.
3. **Pool, not allocation.** A fixed pool of child field slots sized by the governor
   (`fractal` share, carved from the tape share, default 0.08). Slots are recycled by φ-scaled LRU
   on child utility (energy explained per tick). Zero per-tick allocation, as everywhere else.
4. **Coupling.** Parent→child is restriction of the local patch onto the child's eigenbasis;
   child→parent is the adjoint, scaled by a gain `μ`. Because both maps are orthonormal
   projections, `‖child contribution‖ ≤ μ‖patch‖` — the ISS ledger gets a *provable* bound, and
   `μ = 0` collapses the whole feature to the current bit-exact behaviour.
5. **Scheduling.** Children step at φ⁻¹ of the parent's rate (deeper = slower), so total tick cost
   grows as Σ φ⁻ᵈ < 2.62× the flat cost even at full occupancy — bounded, not unbounded.
6. Gate 2: with `μ = 0` the S0 oracle digest is bit-identical; with `μ > 0` a synthetic
   two-scale field (coarse carrier + fine texture) shows the child capturing the fine band and
   parent residual dropping measurably, reported as a delta; occupancy, depth histogram and
   explained-energy are real telemetry, never estimates.

## Section 3 — Deeper understanding, not just deeper geometry — COMPLETE

Gate 3 green (`test/memory/s3-multiscale.test.ts`, 6/6): φ⁻¹ coarse head, coarse-first ranking
refines the top-34 survivors, fine band separates coarse-identical chunks, scores byte-identical
across repeats, empty query abstains. Governor pressure now fed by measured store bytes.


Depth is worthless if nothing reads it.

1. **Multi-scale signatures.** `fieldSignature` gains an optional child band: a chunk's signature
   becomes parent coefficients ⊕ the top child bands that fired during its encode. Signature
   version bumps, old signatures invalidate cleanly.
2. **Recall.** The FLD channel scores coarse-first, then refines only among the survivors using
   child bands — cheap, and it is what makes fine distinctions between chunks that look identical
   at coarse resolution.
3. **Sensory node telemetry into decisions.** The 18-rung scan data (capture, participation,
   hot-nodes, flux circulation) currently only measures. Route it into (a) child-field selection
   above, (b) episodic salience, (c) governor pressure. This is the "information doing work" step.
4. Gate 3: held-out recall probe shows the refined ranking beating the coarse-only baseline, with
   the delta reported; a determinism reload test proves multi-scale signatures are bit-identical.

## Section 4 — Section F of the SHFN plan (Clifford channels) — COMPLETE

`packages/trnn-core/src/algebra/clifford.ts`: Cl(3,0), 8 blades, struct-of-arrays, sign table
derived exactly from bitmask swap parity (no hand-typed constants), rotors built on the
deterministic `dcos`/`dsin` bank. Gate F1 green (`f1-clifford.test.ts`, 7/7): table matches an
independent reference, pseudoscalar central, rotor unit + magnitude-preserving, half-rotations
compose, blade gain 0 collapses to the scalar path exactly (bit-identical default build).

---

## Rollout and risk

Strict order **1 → 2 → 3 → 4**, one green gate before the next. Every new term ships behind a gain
defaulting to 0, so a default build stays bit-identical to today's certified engine and each
feature is switched off by a single number if a certificate moves.

Not doing: per-node full sub-lattices (memory blow-up), unbounded depth, raising RAM shares without
a measured ceiling, and any telemetry value that is not actually measured.

## Technical notes

- New: `packages/trnn-core/src/fractal/nest.ts`, `fractal/pool.ts`, tests `f0-nesting.test.ts`,
  `f1-multiscale.test.ts`; edits to `HardwareEnvelope.ts`, `ResourceGovernor.ts`,
  `MemoryGovernor.ts`, `knowledge/fieldSignature.ts`, `KnowledgeBase.ts`.
- ISS/Jury certificates re-derived in `s4-iss.test.ts` before `μ` or blade gains may be non-zero.
- Decks: FIELD gains a depth/occupancy readout, ENGINE gains RAM provenance + pressure, MEMORY
  gains multi-scale signature coverage.
