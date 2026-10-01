# Ω-UNDERSTAND W1 — Ψ → word readout (2026-10-01)

## Information-flow review
- Source: per-rung slots of Ψ; the per-tick change ΔΨ = Ψ_t − Ψ_{t−1} (injection + propagation + sensory).
- Destination: `store.lastReadout` (UI "field reads"), `describeField` object slot (replaces fake `recalledWord`).
- Indicates: which known words the field's change resonates with, weight, and explained energy.
- Storage: transient (per tick); no persistence; the vocabulary is the lexicon's known words.
- Pattern use: every tick is a scored recognition event; precision/recall is testable.

## Options filtered
| Option | Verdict |
|---|---|
| raw cosine ranking | rejected: measured false positive (moon > drinks) |
| learned decoder (NLMS) | deferred: needs training data; only if it beats MP |
| softmax over templates + matching pursuit explain-away | kept: deterministic, no training, crosstalk removed by subtraction |

## Design
- `lexemePattern(token, rungs)` in `lexeme.ts`: the single-token, unit-amplitude Ψ delta. `injectTextPsi` uses it (one definition).
- `LexiconMemory.readPsi(field, rungs, maxWords)`: non-negative matching pursuit over unit templates of known words; calibrated softmax mass on the first pick; stop when a step explains < φ⁻⁶ of initial energy.
- `crisp` = topMass ≥ φ⁻¹ and explained ≥ φ⁻¹.
- `tickMemory`: readout on ΔΨ; fake `recalledWord` deleted; `describeField` gets the readout's top word only when crisp.
- Tests: recovery of words in sentences over the full catalog vocabulary; moon not outranking drinks; empty/zero field; determinism.
