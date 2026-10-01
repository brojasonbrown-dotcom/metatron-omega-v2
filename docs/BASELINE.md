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

gate-expected-tests: 1099

P0.3: +24 tests (11 digest + 1 count + 12 parity); marker 1055 → 1079.

## Ω-UNDERSTAND W0 — 2026-10-01 (marker 1079 → 1083)
Full-token FNV-1a sparse placement (k=3 rungs) in `lexeme.ts` replaced `maxZeckIndex mod rungs`.
Measured on 1,092 catalog tokens, 55 rungs: before 51/55 rungs used, max 151 on one rung;
after 55/55 used, primary-rung max 30, k-placement load 42–82 (mean 59.6), 953 distinct rung-sets.
+4 tests in `test/memory/w0-placement.test.ts`.

## Ω-UNDERSTAND W1 — 2026-10-01 (marker 1083 → 1089)
Ψ → word readout: `LexiconMemory.readPsi` (non-negative matching pursuit with explain-away over
`lexemePattern` templates); fake `recalledWord` (last typed token) deleted from `tickMemory.ts`.
Measured phenomena (kept as tests):
- 55-rung Ψ, 1,092-word vocab, 200 sentences/length: P ≥ 0.990; R 1.000/.998/.988/.960/.896/.799 for L=1..6.
  Recall falls with length because rank r is injected at φ⁻ʳ.
- Live engine Ψ has 9 rungs (36 writable slots). At 9 rungs with the full vocab, P/R = .83/1.00 (L=1),
  .74/.78 (L=2), .44/.30 (L=4); at 21 rungs .95/.84 (L=4). Field width, not readout, bounds how many
  words the live field holds at once. Identity beyond ~2 simultaneous words must come from memory.
- A softmax "mass" under calibratedBeta is ≥ N/(N+1) by construction, so it was rejected as a
  confidence measure; readout reports the cosine margin instead (crisp: margin ≥ φ⁻⁵, explained ≥ φ⁻¹).
+5 tests `test/memory/w1-field-readout.test.ts`, +1 in `test/wake/w1-drive-edges.test.ts`.

## Ω-UNDERSTAND W2 — 2026-10-01 (marker 1089 → 1097)
Related-pattern recall: `LexiconMemory.associate` (spelling family, context neighbours, follows/
precedes with conditional p, co-occurrence c/√(f·f), 2-hop spread at φ⁻¹, sentences from a 1,597-
utterance ring with postings) and `MemoryStore.associate` (joins journal episodes + L4 successors).
Lexicon snapshot gains optional `assoc`; pre-W2 snapshots load with an empty index.
Measured phenomena:
- Journal records only NEW salient episodes; a repeated (reinforced) episode returns before
  journaling, so the journal is a lossy sentence store. The lexicon ring records every utterance.
- One lookup at 1,092 words costs ~106 ms, ~100 ms of it the full-vocabulary meaning recall
  (O(V·d), d = 1,597). The HEAR inspector now recomputes only when words are learned or a journal
  record arrives, not every tick.
- No per-word sound prototype exists (SoundWordMap is one linear map); sound association needs
  word-aligned audio first.
+10 tests `test/memory/w2-associate.test.ts` (incl. capture-label exclusion and spelling noise floor 3/√d).
