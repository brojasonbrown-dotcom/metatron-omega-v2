# Baseline — P0.1 (2026-09-29 UTC)

Recorded on the single active branch. This record supersedes the ~883 figure in the context sheet and the 1050 reported earlier.

| Gate | Result |
|---|---|
| Typecheck (`tsgo --noEmit`) | 0 errors |
| Vitest | 76 files · **1055 / 1055** passed |
| Production build (`vite build`) | success |
| build-errors.log | build OK |
| Lint (`eslint .`) | **0 errors, 0 warnings** (was 11 715 errors, 10 warnings) |

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

## P0.1 resolution (all four gates green: lint 0 · tsgo 0 · 1055/1055 · build OK)

- **Formatting (11 543):** `.prettierrc` set to `singleQuote: true`, which matches the code's actual style (360 files differed vs 406), then a single format pass. Whitespace and quotes only.
- **Precision (65):** each literal was rewritten to the shortest decimal that parses to the *same* IEEE-754 double. This was checked by machine (`Number(new) === Number(old)`), so no value changed. Literals carrying more than 17 significant digits keep the full Wolfram digits in an `// exact:` comment for provenance.
- **no-explicit-any (97):** ocrLadder.ts now has a typed `TesseractModule`. Acquisition.ts narrows `unknown`. The r7 test uses the ledger's real header type. `intel.server.ts` (89) parses untyped third-party HTTP payloads, so it has a file-scoped rule exemption until per-tool zod schemas land (roadmap).
- **no-constant-condition (2):** dmd.ts has a QR sweep that exits via deflation breaks, so the loop condition is documented inline. F4 `12 − 30 + 20 === 2` was a compile-time identity posing as a check; it is now a literal `1` with a note, same value, and is flagged for P1.1.
- **exhaustive-deps (7):** the `version` dependencies deliberately invalidate mutable-store reads, and removing them would show stale data, so they are documented inline. Two useless memos over arrays rebuilt every render were removed. The missing `setInput` dependency was added.
- **only-export-components (2):** the hooks stay next to their provider, documented inline.

## Gate marker (P0.2)

`bun run gate` fails if fewer tests pass than this number. Lower it only with a written reason on the line below it.

gate-expected-tests: 1079

P0.3: +24 tests (11 digest + 1 count + 12 parity); marker 1055 → 1079.
