# Ω-CLEAN — Remove Dead Weight Without Touching the Brain

Goal: strip every unused file from the program while guaranteeing zero regression to the
engine, the computations, and the memory/learning substrate.

Verified by a full static import-graph trace from every entry point
(`src/routes/**`, `src/router.tsx`, `src/start.ts`, `src/server.ts`, `vite.config.ts`,
and all test files), following static imports, dynamic `import()`, and
`new Worker(new URL(...))` instantiations.

**Total removal: ~2.3 MB across ~190 files. Zero reachable file loses a dependency.**

## What is protected and will NOT be touched

These were checked explicitly because their names look like the ones being deleted:

- `src/core/rhuft/` — live engine math (`LucasClosure`, φ closure). **Stays.**
- `src/core/runtime/rhuftf/` — live ladder/omega runtime. **Stays.**
- `src/core/frameworks/`, `src/core/memory/`, `src/core/sensory/`, `src/core/knowledge/`,
  `src/core/analysis/`, `src/core/interop/`, `src/core/self/`, `src/core/geometry/`,
  `src/core/gematria/` — **all stay.**
- `packages/trnn-core/` and `packages/field-kernel-core/` — fully live. **Untouched.**
- `public/wolfram/*.jsonl` — **stays** (see Phase 3 note).
- All learned/persisted machine state and memory snapshots — **untouched**.

## Phase 1 — The uploaded RHUFT context corpus (~505 KB, 60 files)

`src/core/context/RhuftLibrary.ts` has **zero importers**. It is the only module that
reads `src/context/rhuft/*.md`, so the entire 59-chapter corpus is bundled weight the
machine never reads and never learned from.

- Delete `src/context/rhuft/` (all 59 `.md` chapters)
- Delete `src/core/context/RhuftLibrary.ts` and the now-empty `src/core/context/`

This is the "context I uploaded" you asked to remove. It is inert documentation, not
learned state.

## Phase 2 — The brain-core neural-network package (~1.66 MB, 86 files)

`packages/brain-core` is a closed island: nothing in `src/` imports it, and the only
live reference is its own test reaching into one subfolder. The dead bulk includes the
largest files in the whole repo:

- `src/quarantine/RHUFTFrameworks.ts` (346 KB)
- `src/WOlfram nt.txt` (174 KB)
- `src/frameworks.ts` (79 KB)
- `src/fractal_node.ts` (43 KB)
- `src/cognition/`, `src/adapters/`, `src/schemas/`, `src/config/`, `src/scripts/`,
  `src/formal/*.wl`, `worker_pool.ts`, `hardware_governor.ts`, all root `*.ts` law
  modules, and the stray `*.md` plan files

**Deletion order matters for the "no regression" guarantee:**

1. Delete everything in `packages/brain-core/` **except** `src/field/**` and
   `test/field.test.ts`, plus `package.json`/`tsconfig.json`.
2. Run the full suite + build. Confirm `field.test.ts` still passes.
3. Then delete the remainder — `src/field/**`, `test/field.test.ts`, the package
   manifests, and the `@metatron/brain-core` aliases in `vite.config.ts` and
   `tsconfig.json`.
4. Re-run the full suite + build.

Step 3 removes the `field.test.ts` contract suite along with the substrate it tests.
That suite covers only code nothing else imports, so the app and engine are unaffected —
but the reported test count will drop by that file's assertions. Flagging it plainly
because you asked for a clean removal of the neural-network build files, and this is the
one place where "clean" and "keep every test" cannot both hold.

## Phase 3 — Dead engine-adjacent cluster (~314 KB, ~56 files) — proof-gated

A cluster under `src/core/` traced as unreachable: `bus/FallbackEngine.ts`,
`bus/useEngine.ts`, `field/{QRF,SelfMeasure,Torus}.ts`, `harmonic/RecursiveOctave.ts`,
`numerics/Real.ts`, `recursion/MemoryFeedback.ts`, `stability/CrystallinePLL.ts`,
`runtime/{BrowserDriverBank,CanonicalUpdateBank,FrameworkOrchestrator,ShadowStateTape,
frameworkExtensions,frameworkOrchestrator.worker}.ts`, and parts of `v12/`.

**This phase is treated as high-risk and is not a blanket delete.** The trace reported
`src/core/v12/**` as dead, but `src/lib/chat/engineSnapshot.ts:15` imports
`@/core/v12/audit/LyapunovBank` and *is* reachable — so at least one file in that subtree
is load-bearing. Where one claim in a cluster is wrong, the rest are not trustworthy in
bulk.

Method for this phase:

1. Re-derive reachability with the TypeScript compiler rather than regex, so JSX-only and
   barrel-re-export usages cannot hide a live edge.
2. Delete **one module at a time**, running typecheck after each.
3. Any module whose removal breaks typecheck is restored and marked live.
4. Full suite + build at the end of the phase.

`BrowserDriverBank.ts` is the only fetcher of `public/wolfram/*.jsonl`. If it is confirmed
dead and removed, those assets become orphaned — but they are 48 KB of verified constant
banks and are **kept regardless**, so no numeric bank can ever be lost.

If any module in this phase resists clean proof, it stays. Leaving 300 KB in place is
strictly better than a silent engine regression.

## Phase 4 — Unused UI primitives (~143 KB, 44 files)

43 shadcn components in `src/components/ui/` plus `src/hooks/use-mobile.tsx` are never
rendered. Deleted one batch at a time with a build check between batches, since JSX usage
is the case static tracing is weakest at. Anything that breaks a build is restored.

`src/components/v11/` **stays** — it is live (imported by `__root.tsx`,
`OmegaWorkstation.tsx`, `OmegaEngineShim.tsx`, `KokoroPanel.tsx`, `engineSnapshot.ts`).

## Verification gate — applies after every phase

No phase is considered done until all four pass:

1. `tsgo` typecheck — 0 errors
2. Full Vitest suite — green (expected count drops only by `field.test.ts` in Phase 2)
3. Production build — success
4. `/tmp/observability/build-errors.log` — clean

If any gate fails, that phase is reverted before the next begins. Phases are independent,
so a failure in Phase 3 or 4 does not jeopardise the ~2.16 MB removed in Phases 1–2.

## Technical notes

- `import.meta.glob` appears exactly once in the codebase (`RhuftLibrary.ts`), so
  Phase 1 also removes the last glob-based bundling path.
- `frameworkOrchestrator.worker.ts` is dead only because its sole referrer
  (`FrameworkOrchestrator.ts`) is dead; both go together in Phase 3 or neither does.
- Vitest has no explicit glob config (the `test` block in `vite.config.ts` only sets
  timeouts), so default `**/*.test.ts` discovery applies — this is why the brain-core
  test must be removed in the same step as the substrate it imports, or the runner
  reports a hard resolution failure.
- Alias cleanup in `vite.config.ts` and `tsconfig.json` happens only in Phase 2 step 3,
  after the package is fully gone, so no intermediate state has a dangling alias.
- Nothing under `docs/`, `.lovable/`, or any persisted memory/snapshot path is touched.
