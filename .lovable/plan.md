# P0 — Foundation & governance

## New standing rule (added first, applies to every future plan)

Every plan must include an **Information-flow review** before any solution is chosen:

1. Where does this information come from? (source, sensor, rate, provenance: measured / derived / free)
2. Where should it go? (consumers, memory tier, persistence)
3. What does it indicate? (the measurable quantity it stands for, and its units)
4. Is the storage layering correct and accurate? (fast vs slow memory, snapshot schema, loss or duplication)
5. Can it serve pattern recognition or the field / RHUFT computation, and how exactly?
6. What methods could improve it for real use?

For each question: list all candidate solutions, then rigorously filter them (measurable, deterministic, testable, minimal diff, no lore). Keep only the best combination and say why the others were dropped.

Saved to project rules (AGENTS.md) and core memory.

## Verified current state

- Last build: OK (29 Sep 14:47 UTC).
- `package.json` has `build`, `lint`, `format` scripts but **no test or typecheck script**.
- Test count: the context sheet says about 883, but the last full run reported 1050. P0.1 records the real number, which then replaces both.
- Frozen-candidate files exist: `packages/trnn-core/src/core/constants.ts`, `dmath.ts`, `determinism.ts`. Neumaier summation appears in `spectral/laplacian.ts` and `web/fluxLedger.ts`, and possibly elsewhere (P0.3 lists all of them).

## Tasks (one per prompt, gate after each)

### P0.1 Baseline capture
- Info-flow: the source is the test runner, typecheck and build output. The destination is a baseline record. It shows the real health of the code.
- Run lint, typecheck, the full test suite and a production build, and record the results in `docs/BASELINE.md`: pass counts, failures, lint errors and the date.
- If anything fails, fix it inside P0.1 before closing it. Lint errors that predate this work get counted and triaged, not silently ignored.

### P0.2 Gate script
- Add the scripts `typecheck` (tsgo), `test` (vitest run) and `gate`.
- `gate` runs lint, then typecheck, then tests, then build, then checks the build-error log. It stops at the first failure and prints a one-line summary with the test count.
- It also compares the test count against `docs/BASELINE.md` and fails if the count drops without a note saying why.
- Chosen over CI or git hooks, which Lovable's sync cannot run reliably.

### P0.3 Determinism freeze
- Info-flow: these constants and kernels feed every value that reaches engine state, so a silent change breaks bit-for-bit reproducibility.
- List every frozen file in `docs/FROZEN.md`: `constants.ts`, `dmath.ts`, `determinism.ts` and every Neumaier kernel found by search.
- Add a test that hashes the frozen files (SHA-256 over normalised text) against recorded digests. Pair it with a bit-parity test that pins exact IEEE-754 outputs for dpow, dmath and the Neumaier sums at fixed inputs.
- Hashes catch edits to the files. Parity values catch changes in behaviour, including changes from dependencies. Both are needed.
- Scan for `Math.pow`, `Math.random` and `Date.now` on paths that reach engine state. Report them only; removing them is a later task.

### P0.4 Branch and versioning policy
- Write the policy in `docs/BRANCHING.md`:
  - One active branch, `main`, synced with Lovable.
  - Staging is Lovable's preview build and production is the published build. No second git branch while Lovable syncs, so nothing gets interleaved.
  - Commits are named by task ID.
  - Manual edits are committed before the next Lovable prompt so a regeneration never overwrites them.
- Record the rule in AGENTS.md.

## Technical notes
- Files touched across P0: `package.json` (scripts), `docs/BASELINE.md`, `docs/FROZEN.md`, `docs/BRANCHING.md`, one new frozen-integrity test file, and AGENTS.md.
- No engine math is modified in P0.
- Git commits are managed by the platform, so "commit per task" means one prompt per task.
