# Ω-WAKE — activating the dormant modules (mind, memory substrate, field knowledge, honest snapshot)

## The diagnosis (read off the code, not inferred)

Four separate dormancies, one root cause each. None of them is a bug in the math — every one is a
missing *drive edge* between a living producer and a living consumer.

1. **`engine.mind` = 0 thoughts.** `EngineHost.foldMind()` in `packages/trnn-core/src/runtime/host.ts`
   runs on every pump, but the UI only ever asks for a mind report when the MIND deck is open
   (`omegaRuntime.pullMind()`), and nothing persists it. If the host is not started, or the deck was
   never opened, the mind reports an empty log — correctly.
2. **0 tape frames / 0 episodes.** `MemoryRuntime.drive(out)` is the only entry into the whole
   L0–L6 substrate, and **no code calls it**. `grep` finds callers of `getMemoryRuntime()` for
   save/load/stats only. The memory store is alive and correct; nobody is feeding it.
3. **`knowledge.field` self-test fails.** `KnowledgeBase.prepareSignatures()` / `buildSignatures()`
   exist and are correct, but **no call site exists**, so the eigenbasis is never built and the FLD
   channel abstains honestly.
4. **Snapshot says `running=false, tick=0, field.state="fallback"`.** True and stale at once:
   `OmegaEngineShim` is a deliberately inert `EngineCtx` (a placeholder from the v13 teardown) and
   the chat snapshot reads *only* that context, while the real engine lives in the Ω worker
   (`omegaRuntime`). Two channels, one wired to nothing.

## The fix, in four sections

Each section is independently shippable, gated by a test, and adds no new engine math.

### S1 — One truth for engine state
Rewrite `OmegaEngineShim` to subscribe to `omegaRuntime` (`useOmegaState`) and project the live
snapshot into the legacy `EngineCtx`: `running`, `tick`, `fps`, coherence/energy from the Ω
snapshot, `fieldState` = `"live"` when the worker is built and running, `fieldSnapshot`/
`fieldCapabilities` from the Ω snapshot's runtime block. Where the Ω snapshot genuinely has no
counterpart, keep `null` — never synthesize. Result: chat's L1 and the module registry can no
longer disagree, and the model stops having to flag a discrepancy it cannot resolve.

### S2 — Wake the memory substrate (the drive edge)
Add a single owner of the memory tick: a `memoryDriver` module started once by `OmegaWorkstation`.
It subscribes to the Ω runtime and calls `memory.drive(out)` **once per emitted snapshot**, not per
engine tick — the bus already runs at the adaptive 8–64 Hz and that is exactly the cadence the
memory layers were budgeted for. `out` is built from the live snapshot via the existing
`computeMetatronMemo` path so `tickMemory()` receives a real `MetatronOutput`, no mock.
Backpressure: skip a drive if the previous one is still within the same snapshot version, and stop
driving when `MemoryGovernor` reports freeze pressure. Expected result: tape frames, Hebbian
entries and episodes all begin accumulating within a second of pressing start.

### S3 — Wake cognition and keep it
Two edges:
- `omegaRuntime` pulls the mind report on a slow φ cadence (every ~1.6 s) whenever the engine is
  running, not only when the MIND deck is mounted, so thoughts are visible to chat and self-test.
- Bridge thoughts into memory: each new `Thought` (novelty, surprise, concept key) is written to the
  L5 journal and, when `novelty >= NOVELTY_THRESHOLD`, tagged as a salience bump on the current
  capture so it can trigger an L2 episode. This is the "inner narrative" edge — cognition currently
  computes but never leaves a trace.

### S4 — Build the eigenbasis so FLD stops abstaining
Add an idle-time knowledge warm-up in `knowledgeRuntime`: after the corpus loads, call
`prepareSignatures()` once (tier chosen by `recommendTier()`), then `buildSignatures(256)` in
`requestIdleCallback` slices until coverage is complete, persisting progress. Surface real coverage
(`covered/total`, basis residual, digest) in the self-registry entry so the self-test reports a
measured state instead of "never built". The FLD channel then participates in recall for the
8,423-chunk corpus, which is where the top-1 = 0.750 self-retrieval should improve.

## Verification (every section gated)

- `test/wake/s1-engine-truth.test.ts` — shim projection is total: for a running Ω snapshot the
  derived `EngineCtx` reports `running=true`, non-zero tick, and `fieldState !== "fallback"`.
- `test/wake/s2-memory-drive.test.ts` — N driven snapshots ⇒ N tape frames, ≥1 episode at the first
  salience crossing, deterministic snapshot hash for a fixed input sequence.
- `test/wake/s3-mind-trace.test.ts` — a synthetic observation stream produces thoughts, and every
  high-novelty thought leaves exactly one journal record (no duplicates on repeated pulls).
- `test/wake/s4-field-basis.test.ts` — after warm-up, `knowledge.field` self-test passes and the FLD
  channel contributes a non-zero score on a chunk that is lexically dissimilar to its query.
- Full regression: vitest suite (currently 420/420), `tsgo --noEmit`, production build, and a
  Playwright pass on `/` confirming tape frames > 0 and thoughts > 0 after ~10 s of running.

## Risk notes

- No engine math is touched; all four sections add wiring and read paths only.
- The memory drive is the only new sustained CPU cost. It is bounded by the bus rate and already
  governed by `MemoryGovernor`'s 70% working budget and shedding ladder.
- Signature building is idle-sliced and abortable; a failed basis build leaves the FLD channel
  abstaining exactly as it does today.
