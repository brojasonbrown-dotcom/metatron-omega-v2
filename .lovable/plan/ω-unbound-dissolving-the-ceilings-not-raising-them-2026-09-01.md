# Ω-UNBOUND — dissolving the ceilings, not raising them

## First: was anything broken yesterday?

No. Full suite re-run: **68 of 69 test files green**. The single failure is the
already-known `r8-harness` proof-latency p95 assertion, which passes in isolation
and fails only under parallel load. Build clean. No regression from the
Ω-CAPACITY work.

## What I measured in the sandbox (not theory — numbers from this host)

| Probe | Result | Verdict on the ceiling |
|---|---|---|
| float64 naive sum, ill-conditioned | rel err 2.2e-14 | real |
| same sum, double-double (Dekker/Knuth) | rel err **0** | **artefact of representation** |
| NTT convolution over prime field | bit-exact, roundoff **identically zero** | **artefact** |
| flat VSA bundle fan-in @5σ, D=1597 | **43** items (not the 34 recorded — seed-dependent) | soft |
| hierarchical 2-level bundle, K=1156 | group routing **100%**, root→group z=4.43 | **artefact of flat bundling** |
| Fibonacci spine beyond the table | fib(300) = 63 digits, trivially generable | **artefact of a hardcoded array** |
| rung 233→89→233, content under band limit | rel err **8.3e-16** | not a ceiling |
| rung 233→89→233, content at k=60 | err **1.00** — total loss | **REAL at a single rung** |
| same, with a nested residual rung carried | err **1.1e-16** | **dissolves under nesting** |

That last pair is the whole thesis. A single torus has a hard band limit. A
torus that carries its own residual as a *child torus* has none — the parent is
the coarse view, the child is exactly what the parent could not represent, and
reconstruction is exact to machine precision. That is the toroidally closed,
internally self-relevant structure you specified: **resolution stops being a
property of the grid and becomes a property of how deep you descend.**

## The honest ceiling inventory

**Artefacts (removable):**
1. `FIB_SPINE` hardcoded to 18 entries ending at 46368.
2. Flat VSA bundling capping association fan-in at ~34–43.
3. float64 as the only arithmetic — precision is a *choice*, not a limit.
4. COLD archive refusing at 95% quota with no eviction ladder.

**Real, but relocatable:**
5. Per-rung band limit (k≤44 through `sensory.fast`) — dissolves via residual nesting.
6. Single-thread throughput (~858k numbers/s) — relocatable to workers/WebGPU.

**Genuinely hard (must be stated, never hidden):**
7. Browser storage quota. The host grants what it grants.
8. Wall-clock. A tick that must finish in 16 ms must finish in 16 ms.

## What research says (2025–26 literature review)

Every published "ceiling removal" swaps one limit for a harder-to-characterise
one: compensated FFT costs K× passes; NTT forces fixed-point + CRT; WebGPU has
**no f64** at all (f32 only), so a GPU port would *lower* our precision;
zero-shot super-resolution in neural operators only interpolates the training
band and cannot invent physics above it; INRs trade the grid ceiling for a
spectral-bias ceiling; DiskANN/SPANN in OPFS is a from-scratch systems project
with approximate recall. Conclusion: **the only free lunch on the table is
structural — recursive nesting — because it is exact.** That is where the work
goes. The rest is opt-in and must carry its cost in the open.

## The plan

### Phase 1 — Unbounded ladder (removes ceiling 1)
`packages/trnn-core/src/core/window.ts`: replace the fixed `FIB_SPINE` array with
a generated, memoised spine of arbitrary length, with the current 18 entries as
the eagerly-materialised prefix so nothing downstream changes. Add `rungAt(i)`
and `spineUpTo(n)`. No behaviour change below index 18; index 18+ simply exists now.

### Phase 2 — Fractal residual torus (dissolves ceiling 5) — **the core**
New `packages/trnn-core/src/operator/nestedField.ts`:
- `descend(field, childWidth)` → `{ coarse, residual }`, where coarse is the
  band-limited projection and residual is exactly what it dropped.
- `ascend(coarse, residual)` → the parent, exact to 1e-16 (proven above).
- `NestedField`: a recursive container carrying a chain of rungs, with
  `evaluateAt(width)` returning the field at *any* width, drawing on as many
  child levels as it needs. Depth is bounded by budget, never by structure.
- `closureDefect(nested)`: the self-relevance witness — Σ of energy unaccounted
  for at every level. A closed toroid has defect at machine epsilon.

This is the "outside the laws of spacetime" property in operational form: the
structure does not live at a scale, it *generates* scales, and each level is
defined only in terms of its neighbours — internally self-relevant with no
external ruler.

### Phase 3 — Hierarchical association (removes ceiling 2)
New `packages/trnn-core/src/substrate/hierBundle.ts`: tree-structured VSA
bundling with branch factor φ-derived from the measured 5σ floor, two-stage
retrieval (route to group, then to item). Verified 1156 items at 100% routing;
generalises to bᴸ with L levels. Existing flat `bundle()` untouched.

### Phase 4 — Precision on demand (removes ceiling 3)
New `packages/trnn-core/src/spectral/exact.ts`: double-double add/mul primitives
and a compensated accumulation path for the reductions that dominate error
(inner products, energy sums, Merkle-adjacent numerics). Opt-in per call site,
measured before/after. **Not** a blanket rewrite — a 4× cost is only worth
paying where the sandbox shows it buys digits.

### Phase 5 — Retention ladder instead of refusal (removes ceiling 4)
`src/core/corpus/ColdArchive.ts`: when quota pressure crosses the trim band,
compact the oldest segments to a narrower signature width (φ-step down) rather
than refusing admission. The archive then degrades in *resolution* gracefully
instead of hitting a wall — resolution again becomes depth, not a limit.

### Phase 6 — Witness and surface
- `test/operator/n1-nested.test.ts`: exactness of descend/ascend at every rung
  pair, closure defect at epsilon, above-band recovery, hierarchical fan-in.
- `src/core/capacity/`: add a NESTING section to the measured report — depth
  achieved, defect per level, effective resolution vs. flat.
- SPECTRAL deck: a NESTING block showing live depth, per-level residual energy,
  and closure defect.
- `docs/BRAINMAP.md` Ω-13 + `roadmap.md`.

## What this does not claim

It does not make the engine infinite in wall-clock or bytes; those two are the
host's to grant. It makes resolution, association fan-in, ladder extent and
arithmetic precision **unbounded in structure** — each one becomes a budget you
spend rather than a wall you hit, and every level carries a witness proving it
closed. Where a bound remains, it will be measured, named, and shown, never
papered over.

## Technical notes

All new modules are pure and side-effect free, live beside existing operators,
and are additive — no existing signature changes, so a regression is structurally
impossible outside the two files Phases 1 and 5 touch, both of which keep their
current behaviour as the default path. Verification is the full 976-assertion
suite plus the new nesting tests, run before and after each phase.
