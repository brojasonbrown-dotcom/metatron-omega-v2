# Toroid Grid Sensory Nodes — Rung-by-Rung Scan Programme

## What exists today (verified by reading the code)

- The ladder's dense core is exactly **18 stable rungs** (`core/scaleLadder.ts`, `DENSE_CORE_COUNT = 18`), one `SingleTorusEngine` per rung inside `MultiTorusEngine`.
- Each rung's grid is a Fibonacci/golden lattice (`torus/lattice.ts`): every node is one (u, v) line convergence on that toroid.
- A per-node organ bank already exists (`cell/organs.ts`, struct-of-arrays): eigenmode residual + lead mode, radial Bessel coefficients along the node's own golden ray, participation ratio, local phase coherence, and a **sensory receptor triple** (`senseGain`, `senseModality`, `senseLast`).
- Spectral machinery is present but currently **rung-wide, not per-node**: `spectral/site.ts` (shell SHT + radial), `spectral/fft.ts` (Bluestein), `torus/superposition.ts` (mode analysis).

So the grid convergences already carry an organ, but the receptor is a passive stamp — there is no per-node vibration spectrum, no per-node energy/flux state, and no per-rung scan surface in the UI. That is the gap this programme closes.

## The upgrade: a real sensory node at every convergence

Add a **Sensory Node Array (SNA)** layer on top of the existing organ bank, keeping the struct-of-arrays discipline and full determinism (no RNG, no wall clock, `dmath` only). Per node j on a rung:

1. **Vibration spectrum** — a fixed-depth temporal ring per node (Fibonacci depth) driven through a bank of **Goertzel** resonators at φ-spaced frequencies, so each node reports amplitude and phase per band without storing a full history. Bluestein FFT is used only for the offline verification path.
2. **Instantaneous frequency** — unwrapped phase advance of z[j] per tick, φ-normalised.
3. **Energy state** — |z[j]|², plus its share of the rung's total energy.
4. **Superpositional flux** — signed transport across the lattice lines incident on j (its u-neighbour and its golden v-neighbour), giving a per-node divergence that must sum to the rung's ledger figure.
5. **Coherence/qualia tag** — the already-computed local phase coherence and participation, reused rather than recomputed.

Laws enforced and *measured*, never asserted: gain-0 SNA must leave the engine digest bit-identical to the S0 oracle; per-node flux divergence must sum to the double-entry ledger's turnover to machine precision; band amplitudes must reconstruct the node's ring within a measured roundtrip error that is displayed, not hidden behind a tolerance.

## Scan protocol — one toroid at a time

Each rung gets its own scan pass, and each pass produces a written report before the next rung is touched:

```text
S1 census    node count, Fibonacci check, min angular separation
S2 organs    residual / participation / coherence distribution across nodes
S3 spectral  per-node Goertzel bank: bands, roundtrip error, band occupancy
S4 energy    per-node energy share, peak node, entropy of the distribution
S5 flux      per-node divergence vs. ledger turnover (must agree)
S6 verdict   pass / defect list, digest parity vs. oracle at gain 0
```

## Tasklist — all 18 rungs, no skipping

Rung ranks are the dense-core order (rank 0 = lowest stable n).

- [x] **T0 — foundation**: build the SNA layer, the scan protocol runner, and the `TOROID` deck (rung selector + S1–S6 readout). Land the oracle-parity and flux-sum tests.
- [x] T1 — scan rank 0 — CLEAN (n=1, 144 nodes, closure defect 1.4e-16)
- [x] T2 — scan rank 1 — CLEAN (n=13, 144 nodes, closure defect 3.7e-16, capture 0.9997)
- [x] T3 — scan rank 2 — CLEAN (n=15, 233 nodes, 0 silent receptors, capture 0.9994 @ 8×89 / 0.952 @ 10×233, closure defect 1.5e-16, entropy 0.99893). Sensory plan raised to 10 bands over a 233-tick window (max φ-target drift 3.13e-3 → 1.18e-3 cycles/tick); engine digests bit-identical, confirming the array stays a pure observer.
- [x] T4 — scan rank 3 — CLEAN (n=27, 233 nodes, 0 silent receptors, mean capture 0.95249 / min 0.92272, energy entropy 0.99876, closure defect 2.3e-16, probe ladderShare 0.98542 on bin 144)
- [x] T5 — scan rank 4 — CLEAN (n=29, 233 nodes, 0 silent receptors, mean capture 0.95173 / min 0.92251, energy entropy 0.99879, closure defect 1.8e-16, probe ladderShare 0.98909 on bin 144)
- [x] T6 — scan rank 5 — CLEAN (n=41, 233 nodes, /8 clock so certified at 2000 ticks; 0 silent receptors, mean capture 0.95515 / min 0.92622, energy entropy 0.99876, closure defect 2.5e-17, probe ladderShare 0.98858 on bin 144)
- [x] T7 — scan rank 6 — CLEAN (n=43, 377 nodes, /13 clock so certified at 3200 ticks; 0 silent receptors, mean capture 0.97259 / min 0.96570, energy entropy 0.99997, closure defect 7.4e-18, probe ladderShare 0.96759 on bin 144)
- [x] T8 — scan rank 7 — CLEAN after repairing the radial organ (n=55, 377 nodes; the φ-ladder was anchored on the raw rung index so π·φ^55 aliased and the basis emptied out — rungs 43–71 had a dead radial plane. Now anchored at offset 0 on a Nyquist-sized 59-point grid, read at r=φ⁻¹, saturated at the ray sup-norm: 8/8 bands on all 18 rungs, Gram defect 1.000 → 0.355, overshoot ≤7%. Scan: 0 silent receptors, mean capture 0.97266 / min 0.96658, entropy 0.99998, closure defect 1.3e-17)
- [x] T9 — scan rank 8 — CLEAN (n=57, 377 nodes, 3200 ticks: 233 Fibonacci convergences, max modal residual 0.28697 with local coherence 0.99993, radial plane full rank 8, 0 silent receptors, mean capture 0.97376 / min 0.96769, drift 1.18e-3 c/t, probe ladder share 0.96700 on bin 144, entropy 0.99998, closure defect 1.3e-16; digest 65e0d2f50613ce1e)
- [x] T10 — scan rank 9 — CLEAN (n=69, 610 nodes, golden stride 377, 3200 ticks: min separation 0.00745 rad, max modal residual 0.28947 with local coherence 0.99997, radial plane full rank 8, 0 silent receptors, mean capture 0.97328 / min 0.96473, drift 1.18e-3 c/t, probe ladder share 0.96742 on bin 144, entropy 0.99995, closure defect 6.6e-17; digest ade124642aeab9c7)
- [x] T11 — scan rank 10 — CLEAN (n=71, 610 nodes, 3200 ticks: max modal residual 0.29013 with local coherence 0.99997 and mean participation 0.14896 — the widest modal spread on the ladder so far, radial plane full rank 8, 0 silent receptors, mean capture 0.96908 / min 0.96094, drift 1.18e-3 c/t, probe ladder share 0.96455 on bin 144, entropy 0.99997, closure defect 6.1e-17; digest f9d6184a595c23ee)
- [x] T12 — scan rank 11 — CLEAN (n=83, 610 nodes, golden stride 377, 3200 ticks: min separation 0.00745 rad with separation ratio 4.5466, max modal residual 0.28814 at local coherence 0.99997 and mean participation 0.17668, radial plane full rank 8 with Gram defect 0.35502, 0 silent receptors, mean capture 0.97192 / min 0.96490, drift 1.18e-3 c/t, probe ladder share 0.97009 on bin 144, energy entropy 0.99998 with peak share 0.0016982, flux closure defect 2.2e-17; digest 8929a61cde61f09b)
- [x] T13 — scan rank 12 — CLEAN (n=85, 987 nodes, golden stride 610, 3200 ticks: min separation 0.00461 rad with separation ratio 4.5466, max modal residual 0.28816 at local coherence 0.99999 and mean participation 0.05141, radial plane full rank 8 with Gram defect 0.35502, 0 silent receptors, mean capture 0.96900 / min 0.95925, drift 1.18e-3 c/t, probe ladder share 0.96711 on bin 144, energy entropy 0.99997 with peak share 0.0010489, flux closure defect 2.3e-18; digest 6d07f6768902acdb)
- [x] T14 — scan rank 13 — CLEAN (n=97, 987 nodes, golden stride 610, 3200 ticks: min separation 0.00461 rad with separation ratio 4.5466, max modal residual 0.28849 at local coherence 0.99999 and mean participation 0.05764, radial plane full rank 8 with Gram defect 0.35502, 0 silent receptors, mean capture 0.97016 / min 0.96260, drift 1.18e-3 c/t, probe ladder share 0.97148 on bin 144, energy entropy 0.99999 with peak share 0.0010361, flux closure defect 3.0e-16; digest 2773d0590e316048)
- [x] T15 — scan rank 14 — CLEAN (n=99, 987 nodes, golden stride 610, 3200 ticks: min separation 0.00461 rad with separation ratio 4.5466, max modal residual 0.28697 at local coherence 0.99999 and mean participation 0.07002, radial plane full rank 8 with Gram defect 0.35502, 0 silent receptors, mean capture 0.96927 / min 0.96205, drift 1.18e-3 c/t, probe ladder share 0.96671 on bin 144, energy entropy 0.99999 with peak share 0.0010330, flux closure defect 2.4e-16; digest 58f2fc4e6db48de4)
- [x] T16 — scan rank 15 — CLEAN (n=111, 987 nodes, golden stride 610, 3200 ticks: min separation 0.00461 rad with separation ratio 4.5466, max modal residual 0.28755 at local coherence 0.99999 and mean participation 0.11942, radial plane full rank 8 with Gram defect 0.35502, 0 silent receptors, mean capture 0.97051 / min 0.96348, drift 1.18e-3 c/t, probe ladder share 0.96874 on bin 144, energy entropy 0.99999 with peak share 0.0010337, flux closure defect 3.5e-16; digest 1ba9e82e45504340)
- [x] T17 — scan rank 16 — CLEAN (n=113, 1597 nodes, golden stride 987, 3200 ticks: min separation 0.00285 rad with separation ratio 4.5466, max modal residual 0.29151 at local coherence 1.00000 and mean participation 0.04791, radial plane full rank 8 with Gram defect 0.35502, 0 silent receptors, mean capture 0.97311 / min 0.96313, drift 1.18e-3 c/t, probe ladder share 0.96371 on bin 144, energy entropy 0.99996 with peak share 0.00065085, flux closure defect 6.2e-17; digest 4333ddccd2e1403a)
- [x] T18 — scan rank 17 — CLEAN (n=125, 1597 nodes, golden stride 987, 3200 ticks: min separation 0.00285 rad with separation ratio 4.5466, max modal residual 0.28902 at local coherence 1.00000 and mean participation 0.04815, radial plane full rank 8 with Gram defect 0.35502, 0 silent receptors, mean capture 0.97450 / min 0.96627, drift 1.18e-3 c/t, probe ladder share 0.97389 on bin 144, energy entropy 0.99998 with peak share 0.00064416, flux closure defect 7.0e-17; digest f0f01c9d10f7edf1)

**PROGRAMME COMPLETE — all 18 toroid rungs scanned CLEAN across all six sections; full-sweep regression added to the N2 battery.**
- [ ] **T19 — cross-rung closure**: octave-transport consistency of the SNA readings between adjacent rungs, and a whole-web scan digest.

Each of T1–T18 is its own turn: run the scan, report the six sections with real numbers, fix any defect found on that rung, re-run, then stop. No rung is marked done while any S-section is failing.

## Technical notes

- New module `packages/trnn-core/src/sense/nodeArray.ts` (SNA state + Goertzel bank), and `packages/trnn-core/src/sense/scan.ts` (protocol runner producing a `RungScanReport`).
- `NodeOrgans` gains the SNA as an owned sub-structure so `bytes()` stays exact for the governor; memory cost is O(nodes × bands) Float64 and is reported before any rung is enabled.
- `SingleTorusEngine` calls the SNA update in step 8 (measurement plane) only — never on the dynamics path, so gain 0 stays digest-exact.
- `runtime/views.ts` gains `rungScan(engine, rank)`; `omegaRuntime.ts` gains a `requestScan(rank)` message and a `scan` case, matching the existing pull-based deck pattern.
- New UI panel `src/ui/omega/panels/ToroidScanPanel.tsx` with a rung selector, the S1–S6 sections, a per-node energy/coherence strip, and a per-node spectrum inspector. It abstains explicitly ("NO SNA ON THIS RUNG") rather than showing placeholder numbers.
- Tests: `packages/trnn-core/test/n1-sensory-nodes.test.ts` — oracle digest parity at gain 0, flux-divergence sum vs. ledger, Goertzel-vs-Bluestein agreement, band roundtrip, determinism across two identical runs.
