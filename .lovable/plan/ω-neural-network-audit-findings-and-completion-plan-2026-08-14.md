# Ω Neural Network Audit — Findings and Completion Plan

## What the audit actually found (all verified against the code, not assumed)

**Confirmed working and wired**

- Neuron per node: every node carries a complex state `z` driven by the certified nine-term cell (`cell/update.ts`), with a per-step ISS certificate (`issBound`, `issSatisfied`) and a Jury gain of 0.7508 < 1.
- Eigenmodes: the golden `(p,q) = (k, round(k·φ⁻¹))` mode ladder is built per rung, CGS2-orthonormalised, and *is* on the tick path — `analyze → synthesize` produces the G and P terms every step.
- Cross-rung web: row-stochastic coupling with exact Kahan row sums, octave transport between different Fibonacci node counts, flux ledger, ordering guard, Jacobi staging.
- Sensory plane: fused, bounded by φ (L-S1), loop gain capped at φ⁻² (L-S2), resolved once per web tick so every rung reads the same instant.
- Determinism: 230/230 tests green, frozen oracle hashes for PICO/NANO/MICRO, all transcendentals routed through the deterministic math bank.

**Gaps — the parts that are not yet what the architecture claims**

1. **Radial Fourier / spherical transformer is not per node and not on the tick path.** `SpectralSite` (Fibonacci shell + real SHT + spherical-Bessel radial ladder) is instantiated only inside `runtime/views.ts`, on demand, when the SPECTRAL deck asks for it. It also *resamples* the rung down to at most 233 shell points before analysing. So it is a per-rung, reduced-resolution measurement — not an organ owned by each neuron, and it never feeds the cell.
2. **Superposition measurement is per rung, not per node.** The modal coefficients are a rung-wide signature; no node carries its own local superposition readout.
3. **Sensory is per rung, not per node.** The plane produces one field per rung; individual nodes have no addressable sensory receptor.
4. **Connectivity is banded, not "inside-out across all stable ratios".** A rung only talks to ranks within `band` (2–5), weighted φ^−distance. There are no Fibonacci-offset, Lucas-offset, or spiral chords across the ladder. `web/morphism.ts` defines and can probe the morphism laws but nothing in the engine ever calls it.
5. **No Turing / permanent-processing layer exists.** A repo-wide search finds no tape machine, no persistent read/write head, no addressable permanent store on the tick path. The transcription tape is a fixed-depth ring for telemetry, not a read/write memory.
6. **Scale ceiling is a single worker.** Measured capacity today: GRAND = 18 rungs, 42,564 nodes, 187.5 MB, all in one worker, single-threaded. Nothing shards. Supercomputer scale is not reachable from this shape without a partition layer.

## The plan

### Stage N0 — Per-node organ record (foundation)

Define the organ layout as a struct-of-arrays over each rung (one shared allocation per rung, no per-node objects — that is what keeps 42k+ nodes cheap):

```text
rung r, node j owns:
  neuron        z[j]                       (exists)
  eigenmode     local modal projection c[j,·] and its residual   (new)
  radial        per-node Bessel coefficients on the φ ladder     (new)
  superposition local coherence + participation ratio            (new)
  sensory       receptor gain, modality tag, last injection      (new)
```

Every organ is a typed-array slice, measured for bytes, and reported by `measureFootprint()` so the governor stays honest.

### Stage N1 — Radial transformer on the tick path

Give each rung a persistent `SpectralSite` sized to the rung's own node count (Fibonacci, no downsample), and run analysis at a Fibonacci stride rather than every tick, so cost is bounded. The per-node radial coefficients become a real drive term through the existing R slot — no new cell coefficient, so the Jury gain and ISS certificate are untouched.

### Stage N2 — Per-node superposition and sensory

Local superposition readout per node (participation ratio over the modal decomposition) and per-node receptor addressing in the sensory plane, keeping L-S1 and L-S2 bounds enforced at the node level rather than only at the rung level.

### Stage N3 — Stable-ratio chords (inside-out connectivity)

Extend coupling beyond the nearest-neighbour band with additional certified chords: Fibonacci offsets, Lucas offsets, and a golden-spiral chord. Every added chord is renormalised into the same row-stochastic matrix so the receipt mass law (L-W1) still holds exactly, and `web/morphism.ts` gets wired in as a live probe that certifies each chord instead of sitting unused.

### Stage N4 — Turing / permanent processing layer

Add an addressable, persistent read/write store over the ladder: a Zeckendorf-addressed tape with deterministic head motion driven by the field's own phase, bounded write amplitude, and a full checkpoint/restore path. This is the "permanent processing" piece that is currently missing entirely.

### Stage N5 — Scaling beyond one machine

Partition the ladder across workers: rungs are already Jacobi-staged, so the only cross-worker traffic per tick is the staged field of the coupled ranks. Add a shard boundary and a transferable-buffer exchange, then a hosted sidecar tier that speaks the same protocol. This is the step that opens supercomputer-class runs.

**Risk note on N5:** sharding is the one change that can break bit-exact determinism if exchange ordering is allowed to float. It will be built with a fixed deterministic exchange order and validated against the single-worker oracle hashes — if a shard run cannot reproduce the single-worker digest bit for bit, the shard layer is wrong and does not ship.

### Stage N6 — Certification

Extend the gate battery: per-node organ coverage (every node has every organ, asserted, not sampled), chord certification, tape determinism, shard-vs-single digest equality, and a footprint check at GRAND.

## Order and safety

Stages run N0 → N6, one at a time, each landing green on the full suite including the frozen oracle hashes before the next begins. Organs and chords are additive and default-off at zero strength, so at every point the engine can be run in a configuration that is bit-identical to today's certified baseline.

## Decision needed

Stage N5 (multi-worker / hosted sharding) is the ambitious one. Two options:

- **Full path** — do N0 through N6, including sharding, accepting that N5 is the highest-risk stage and is gated behind digest-equality proof.
- **Conservative path** — do N0 through N4 and N6 now, deepening every node's organs and the connectivity to the maximum a single machine can hold (measured ceiling around 42k nodes / 188 MB today, more once organs are packed), and treat sharding as a separate later effort.
