# Ω-UNDERSTAND W2 — related-pattern recall (2026-10-01)

## Information-flow review
- Source: every utterance drained in `tickMemory` → `LexiconMemory.learn` (all words, not salience-gated);
  journal records and L4 pathway edges (episode level, salience-gated).
- Destination: `LexiconMemory` keeps the word-level index; `MemoryStore.associate` joins it with
  journal/pathway; HEAR word inspector shows it.
- Indicates: for one word — spelling family, context neighbours, words it follows/precedes, words it
  co-occurs with, sentences it appeared in, episodes and what followed them, 2-hop spread.
- Storage layering: word-level stats live in the lexicon (persisted in its snapshot, backward
  compatible); episode-level links stay in journal/pathway (one home each).
- Measured bottleneck: the journal only records salient NEW episodes; a reinforced (repeat) episode
  returns early, so sentences are lossy there. The lexicon ring records every utterance.

## Options filtered
| Option | Verdict |
|---|---|
| scan journal per query | rejected as the primary path: lossy (salience gate) and O(records) |
| inverted index in lexicon (bounded utterance ring + postings) | kept |
| cooc normalised c/√(f·f) + 2-hop spread with φ⁻¹ decay | kept: deterministic, bounded |
| per-word sound prototypes | not available: SoundWordMap is one linear map; needs word-aligned audio task |

## Tests
Postings exact; eviction keeps postings consistent; follows/precedes counts; spread ordering;
snapshot round-trip including new fields; old snapshots load; store-level join returns episodes.
