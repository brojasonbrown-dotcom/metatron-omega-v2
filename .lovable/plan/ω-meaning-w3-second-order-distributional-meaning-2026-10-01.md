# Ω-UNDERSTAND W3 — second-order meaning (2026-10-01)

## Information-flow review
- Source: `LexiconMemory.cooc` (symmetric ±LEX_WINDOW counts, every utterance, W2), `freq`.
- Destination: `LexiconMemory.meaning(a,b)` / `similar(word,k)`; `Association.meaning`; HEAR inspector "used like".
- Indicates: paradigmatic similarity — words that occur in the same contexts (cat~dog), as opposed
  to syntagmatic association (cat→drinks, W2 `together`).
- Storage layering: derived only from persisted `cooc`; nothing new is stored. Cache is a pure
  function of `cooc`, invalidated on learn/load, so snapshots are unchanged.
- Pattern use: exact sparse vectors give a measured similarity for W5 prediction and W6 proposal.

## Measured problem
Sandbox: cat~dog 0.075 vs cat~moon 0.025 via `context` (spelling ⊕ running-mean neighbour delta):
the unit spelling base dominates and frequent words ("the") dominate the delta.

## Options filtered
| Option | Verdict |
|---|---|
| raise delta weight in `signature` | rejected: ad hoc, still spelling-dominated, changes persisted meaning |
| raw co-occurrence cosine | rejected: Zipf head ("the") dominates |
| PPMI rows, context smoothing α=¾ (Levy, Goldberg & Dagan 2015), cosine | kept: exact, deterministic, equivalent to the SGNS objective's optimum (Levy & Goldberg 2014) |
| truncated SVD of PPMI | rejected now: O(V²) memory, iterative, adds no correctness at this corpus size |
| random-indexing projection to phasors | deferred: approximation of the kept exact form; only needed for field injection (W6) |

## Definitions
S_w = Σ_c n(w,c), D = Σ_w S_w, P_α(c) = S_c^α / Σ_x S_x^α,
PPMI(w,c) = max(0, ln( n(w,c)·D / (S_w · D·P_α(c)) )), meaning(a,b) = cos(PPMI_a, PPMI_b).
dlog/dpow from dmath (determinism rule). Candidates for `similar` = words sharing ≥1 context.

## Tests
exact PPMI hand value; cat~dog > cat~moon with stated margin; cosine bounds/symmetry/self=1;
category precision on a deterministic two-category corpus vs the existing `context` channel;
cache invalidation after learn; restore gives identical results; determinism.
