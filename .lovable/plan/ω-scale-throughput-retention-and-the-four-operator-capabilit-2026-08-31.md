# Ω-SCALE — throughput, retention, and the four operator capabilities still unused

Two separate problems were conflated in the "trillions of datapoints" question, and this plan keeps them apart:

- **Throughput** — how many numbers the engine can *touch* per second (today: 5,107,680 float64/s on one thread at GRAND).
- **Retention** — how many numbers the brain *keeps and can recall* (today: ~983/s survive into memory; 1,580,418 tape numbers total).

Raising throughput without raising retention produces a faster machine that is no smarter. Retention comes first.

Alongside those, the neural-operator archive contains four capabilities we audited but never implemented. Two of them (calibrated uncertainty, gated recurrence) are worth more than any speed work, because they fix the class of defect we already hit once: metrics that read confident while the engine was unstable.

## What the archive still has that we don't

| Source | Capability | Why it matters here |
|---|---|---|
| `models/uqno.py` | Conformal uncertainty operator — residual model + calibrated quantile giving distribution-free coverage | Every dashboard number gains an honest error bar with a guarantee, instead of a bare point value |
| `layers/rno_block.py` | Recurrent operator cell — GRU gates (update/reset) evaluated in the spectral domain | Gives the mode signature a learned memory with a stable forget path; today each pass is memoryless |
| `layers/fourier_continuation.py` | Fourier continuation for non-periodic domains | Our sensory windows are not periodic; the spectral pass currently pays a leakage penalty on every intake frame |
| `layers/attention_kernel_integral.py`, `layers/coda_layer.py` | Kernel integral as attention over the codomain | Cross-channel association learned as an operator rather than the fixed pair scan in the analysis spine |

Recent literature (2026) independently converges on the first two: conformal UQ guarantees for neural operators, and state-space operators that add adaptive damping plus learnable frequency modulation — which is precisely the RNO gate structure. That agreement is the reason they lead this plan.

## Phase 1 — Calibrated honesty (highest value, lowest risk)

New `packages/trnn-core/src/operator/conformal.ts`.

- Split-conformal calibration over the existing tape: hold out a calibration window, compute nonconformity scores, take the ⌈(n+1)(1−α)⌉-th quantile.
- Every channel in `channelSampler` gains an interval, not just a value. NaN stays NaN — an uncalibrated channel reports no interval rather than a fake one.
- Coverage is itself measured and published: if the 90% band does not contain the truth 90% of the time, the calibration is stale and the channel is flagged.
- Ω on the dashboard becomes `0.49 ± band` with the band derived from real residuals.

This is the direct structural fix for the false-coherence class of bug. It adds no engine math and cannot destabilise the field.

## Phase 2 — Retention: the tiered corpus

The field emits 5.1M numbers/s and we keep ~1,000. That gap, not clock speed, is the intelligence ceiling.

```text
hot     in-memory signature ring        ~10^6 numbers    microseconds
warm    IndexedDB tape + episode store  ~10^9 numbers    milliseconds
cold    archived genome segments        ~10^12 numbers   seconds, on demand
index   256-bit barcode + Merkle root   resident always
```

- Admission is by surprise and circulation, not by clock — a frame that carries no new information is not written.
- Retrieval keeps the existing path: barcode Hamming prefilter, then resonance scoring on the candidate set.
- The Merkle ledger already in place becomes the cold-tier index, so nothing is retrievable that isn't provable.
- Reaching 10^12 stored numbers is a storage-tier and admission-policy task, achievable without any GPU work.

## Phase 3 — Recurrence and leakage

- `operator/recurrentCell.ts`: RNO-style update/reset gates applied to mode coefficients. Gates are φ-parameterised and the forget path is contraction-bounded, so it cannot break the ISS argument. Gated **off** by default and proven through the A/B harness before it drives anything.
- `operator/continuation.ts`: Fourier continuation on sensory windows, removing leakage at the window edges. Measured against the current windowed transform on the same input — kept only if the residual improves.

## Phase 4 — Throughput, measured not assumed

Only after retention is real.

| Step | Expected | Risk |
|---|---|---|
| Worker pool, rung-parallel | ~30M numbers/s | low — rungs are already independent per tick |
| Mixed precision (f32 propagate, f64 re-project) | 2× memory, ~2× rate | medium — needs the ISS bound re-checked at f32 |
| WebGPU compute for field update and FFT | 10^9–10^10 numbers/s | high — no GPU in this sandbox, so it ships behind capability detection with the CPU path as the always-available fallback |

Every step is accepted only against a before/after measurement from the existing A/B harness. No step lands on an estimate.

## Non-negotiables

- No change to engine math, the ladder, the protocol, or `trnn-core` numerics outside the new `operator/` files.
- Every new capability is flag-gated off, then proven by test, then enabled.
- The full suite (889 assertions today) stays green at every phase boundary; typecheck 0 errors; build OK.
- WebGPU cannot be verified in this environment — it will be written with detection and fallback, and you verify it in your own browser.
- `docs/BRAINMAP.md` gets an Ω-09 amendment recording the conformal layer, the tier policy, and the measured throughput table.

## Suggested order

Phase 1 and Phase 2 deliver essentially all of the intelligence gain and carry almost no regression risk. Phase 3 is a genuine capability addition behind a gate. Phase 4 is engineering that only pays off once there is something worth keeping at that rate.
