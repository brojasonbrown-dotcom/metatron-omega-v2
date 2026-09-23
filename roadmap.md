# Roadmap

## Ω-OPERATOR v2 (complete, 2026-08-31)

- [x] N1 `operator/fourierDiff.ts` — exact spectral calculus + golden-direction mode derivative
- [x] N2′ `operator/modeCurrent.ts` — discrete Hodge witness on the φ mode graph
- [x] N3 `operator/resample.ts` — discretisation invariance across Fibonacci rungs
- [x] N4 `operator/sobolev.ts` — H1/H2/Hdiv graded error
- [x] N5′ `operator/modeCoupling.ts` — banded Hermitian coupling, gate default 0
- [x] Tests o1–o5 (37 assertions)
- [x] N6 A/B harness (`operator/abHarness.ts`, o6: 5 tests) — spectral derivative >1e6x, exact rung transfer, H1 separation >10x where L2 reports 1.0
- [x] Read-only channel `field.modeCirculation` in the analysis spine (sampler + cognitiveDriver + analysisRuntime; w3: 6 tests incl. driver-invariance)
- [x] BRAINMAP amendment Ω-08
- [x] Full-suite regression + build (883/883 green, tsgo 0 errors, build OK)

## Provenance / method ruling (from the pasted external plan)

- [x] Ruling recorded: **reference-oracle only**. The external plan assumes a Python
      TRNN with `trnn/neural/*.py` and a torch sidecar. No such tier exists in this
      repository, and the runtime is an edge Worker where torch cannot run at all.
      neuraloperator is therefore never a dependency — its mathematics is re-derived
      in deterministic TypeScript and differentially validated against closed forms.
- [x] N4.1 equivalent: archive confirmed sandbox-only, never committed

## Ω-CAPACITY (complete 2026-08-31)

Answered by measurement, not estimate. Harness: `src/core/capacity/` (envelope,
superposition, layering, residency, retrieval, report). Report: `docs/CAPACITY.md`.
Live surface: MEMORY deck → CAPACITY (on-demand, read-only, own store).

- [x] C1 Real ceilings per rung, timed with a correctness check in the same loop:
      peak 858,924 numbers/s at rung 233, engine rung 987 at 186 ticks/s (3× the
      60 Hz schedule), round-trip error 6e-16 at every rung; RAM working 179 MiB
      holding 8,560,080 resident numbers.
- [x] C2 Superposition resolution measured: FHRR fan-in **34** at the 5σ floor
      (not the nominal 100), 256-bit barcode collision-free over 1024 vectors and
      smooth in noise, 15.2 usable digits/slot → ~657 bits per 13-mode signature.
- [x] C3 Ingest layering measured lossless for all five scheduled rate classes
      (≤2e-15); binding constraint is the width-89 fast sensory class → surviving
      band limit k = 44.
- [x] C4 Residency measured on sealed bytes: 4.07 bytes/retained number, seal and
      read timed, Merkle leaves committed per sealed unit.
- [x] C5 Retrieval measured against planted clusters: 98.8% recall at 8
      candidates (104 numbers read); larger candidate sets buy nothing.
      (First formulation measured against a uniform-random population and was
      discarded as badly posed — the truth set there is arbitrary.)
- [x] C6 Report: `docs/CAPACITY.md` + `formatCapacityReport()`; durable ceiling
      2.64 × 10⁹ retained numbers at a 10 GiB grant — the honest figure, 10⁹ not 10¹².
- [x] Tests `test/capacity/c2-capacity.test.ts` (18 assertions), tsgo clean.

## Ω-SCALE (complete 2026-08-31)

- [x] P1 Conformal calibration (`operator/conformal.ts`) wired live into the
      analysis runtime and ANALYSIS deck (± bands, coverage, staleness).
- [x] P2 Tiered corpus (`operator/retention.ts`) wired live: every calibrated
      observation is offered by surprise; TIERED RETENTION shown on the deck.
- [x] P3 Gated recurrence (`operator/recurrentCell.ts`) + Fourier continuation
      (`operator/continuation.ts`), flag-gated off, proven by test.
- [x] P4 Throughput planner (`operator/throughput.ts`) wired live: host
      capability + Amdahl-aware plan shown on the deck.

## Ω-CONSISTENCY (open, requested 2026-08-31)

Audit every eigenmode / Fourier / node path and confirm the Ω-OPERATOR upgrades
are applied everywhere applicable, at the highest resolution the substrate allows.

- [x] K1 Enumerate every FFT / spectral / eigenmode call site (engine, analysis,
      knowledge, sensory) and record which operator upgrade applies to each.
- [x] K2 Apply spectral derivative / Sobolev / resample / mode-coupling where a
      site still uses a lower-order or leaky equivalent — each change A/B proven.
- [x] K3 Confirm mode counts, node counts and window lengths are at profile
      maximum (no hardcoded truncation below the ladder's capacity).
- [x] K4 Report: one table of site -> upgrade -> measured before/after.

## Ω-UI (complete 2026-08-31)

- [x] U1 `useCognitive` read-only hook over the cognitive driver snapshot.
- [x] U2 SPECTRAL deck GRADED WITNESSES block — drift/band, roughness (h1/l2),
      leakage + continuity gain, persistence + contraction proof, circulation,
      entropy, residual, knowledge builds. Observation-only, no engine writes.
- [x] U3 Verified ANALYSIS deck already renders calibrated bands, tiered
      retention and the throughput plan for the new channels.

## Ω-CORPUS (complete 2026-08-31)

Tiered trillion-scale corpus: hot signature cache → IndexedDB/OPFS shard tape →
cold spectral archive, every sealed unit a leaf in the Merkle ledger.

- [x] A1 Binary shard codec (`core/corpus/types.ts`): MTC1 header, float64 ticks,
      float32 values (~4 bytes/number), content-hash addressed.
- [x] A2 Blob store adapters (`storage.ts`): OPFS (atomic temp→rename), IndexedDB
      fallback, in-memory for tests; host quota estimation.
- [x] A3 HOT (`HotCache.ts`): surprise-admitted RAM ring sized from the memory
      governor's envelope; eviction demotes, never deletes.
- [x] A4 WARM (`WarmShards.ts`): seals at 1597 frames, hash-verified reads,
      tick-range index.
- [x] A5 COLD (`ColdArchive.ts`): spectral resample to 13-mode signatures,
      quota guard refuses admission at 95% rather than evicting.
- [x] A6 LEDGER (`CorpusLedger.ts`): RFC-6962 leaves, signed tree heads,
      inclusion + consistency proofs across reload.
- [x] A7 RECALL (`CorpusRecall.ts`): budget-aware retrieval in numbers read,
      abstains rather than overspending.
- [x] A8 Coordinator (`Corpus.ts`) + `corpusRuntime.ts` feed from the analysis
      sampler; storage work is queued off the tick path.
- [x] A9 MEMORY deck CORPUS block: tiers, admission counters, ledger root, quota.
- [x] A10 18 new assertions (`test/corpus/c1-corpus.test.ts`); suite 958 green.

## Ω-UNBOUND (complete 2026-09-01)

Ceilings audited one at a time and sorted honestly into *removable artefact*,
*relocatable limit* and *hard host limit*. Only the first two were touched.

- [x] P1 Generated φ/Fibonacci spine (`core/window.ts`): `rungAt`/`spineUpTo`
      memoise the recurrence up to the last exact safe integer instead of
      reading an 18-entry table. Default `buildWindow` bounds are unchanged;
      the wider spine is opt-in via `{ unbounded: true }`, so no caller moved.
- [x] P2 Recursive residual torus (`operator/nestedField.ts`): `descend` splits
      a field into a coarse view plus the residual no narrower rung can carry;
      `ascend` puts them back. Resolution becomes depth rather than grid width,
      and `closureDefect` reports whether the chain actually closed instead of
      asserting that it did.
- [x] P3 Hierarchical FHRR (`substrate/hierBundle.ts`): flat fan-in crosses the
      5σ floor in the thirties, so association is staged — branch × branch — and
      `hierRoute` abstains per stage rather than guessing at the root.
- [x] P4 Opt-in double-double arithmetic (`spectral/exact.ts`): `twoSum` /
      `twoProduct` compensated sums, dots and energies for the accumulations
      where float64 cancellation, not the algorithm, was the error floor.
- [x] P5 COLD retention ladder (`ColdArchive.ts`): under quota pressure the
      oldest segment narrows 13→8→5→3 and is re-sealed with `cold-recompact`
      carrying its prior hash, so the archive gives up resolution before it
      gives up evidence — and still refuses, plainly, once the ladder is spent.
- [x] P6 C7 nesting capacity (`capacity/nesting.ts`), SPECTRAL deck NESTING
      block, 21 + 5 new assertions (`o11-nested.test.ts`,
      `test/corpus/c2-retention-ladder.test.ts`).

**Not claimed.** Wall-clock, host bytes, browser quota, float64 dynamic range
and the arithmetic floor are still real and still measured. What changed is that
none of them is now an *arbitrary constant in our code*.
