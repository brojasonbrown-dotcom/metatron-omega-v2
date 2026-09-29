# Baseline — P0.1 (2026-09-29 UTC)

Recorded on the single active branch. This record supersedes the ~883 figure in the context sheet and the 1050 reported earlier.

| Gate | Result |
|---|---|
| Typecheck (`tsgo --noEmit`) | 0 errors |
| Vitest | 76 files · **1055 / 1055** passed |
| Production build (`vite build`) | success |
| build-errors.log | build OK |
| Lint (`eslint .`) | **RED**: 11 715 errors, 10 warnings |

## Lint breakdown (pre-existing, not introduced by P0)

| Rule | Count | Nature |
|---|---|---|
| prettier/prettier | 11 543 | formatting only |
| @typescript-eslint/no-explicit-any | 97 | type holes |
| no-loss-of-precision | 66 | numeric literals longer than an IEEE-754 double |
| react-hooks/exhaustive-deps | 7 | warnings |
| prefer-const | 7 | trivial |
| no-constant-condition | 2 | review |
| react-refresh/only-export-components | 2 | warnings |

`no-loss-of-precision` matters for determinism: each such literal parses to a different double than its written digits. It must be triaged per constant, never auto-fixed.

Test count may only drop when a task's plan states the expected drop.
