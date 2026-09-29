# Ω-LEXICON: words the brain computes, not labels it stores

## What the review found (103 Wolfram queries, 99 answered)

**Working today:** a word goes into the field (base-27 code, Zeckendorf address, torus placement), gets stored as a pattern, and can be recalled. That makes it an *address*. It does not yet carry *meaning*.

**Six problems stop it working as live language:**

1. **The timing is wrong.** Memory captures at about 2 Hz. Speech arrives at 5–10 words/s and reading at about 20. So most words are merged or dropped before they're stored. The field runs at 60 Hz, only 3–12× faster than word arrival. Your document asks for 100–1000×.
2. **The word code has no sense of similarity.** Base-27 uses 52.30 of the 53 available bits, so it's an exact and reversible ID. But "run" and "ran" end up far apart in it. Similarity has to come from the existing trigram field signature plus how often words appear together. The ID stays as the key.
3. **Recall is too blurry.** β = φ/√1597 = 0.0405. A crisp pick from N words needs β ≥ 2·ln N / Δ, where Δ is the gap between the right word and the runner-up. For 20,000 words, ln N = 9.90, so with Δ = 0.5 that means β ≈ 40, about 1000× higher. At today's β, recall averages many words together instead of picking one.
4. **Capacity.** An old-style associative memory at d = 1597 holds about 0.138·d = 220 words. The modern energy form scales exponentially (e^{d/8} ≈ 5·10⁸⁶), so the lexicon has to use the modern form. A sparse code with 32 of 1597 bits active gives 222 bits of address space. At ε = 0.25, 1597 dimensions separate up to about 100k items (a random-projection bound, 1474 dims needed). At ε = 0.2 you need 2164, which means the 2584 tier.
5. **Storage.** 20k words × 1597 dimensions × 8 bytes = 244 MB. That's too much for a browser. Signatures must be recomputed deterministically from the word itself, with no storage cost, and only learned corrections kept (sparse, 32-bit).
6. **The φ^150–φ^210 layer bands in the document can't be built.** φ^60 is 3.46·10¹², or 41.7 octaves between the fastest and slowest layer. The real bands on this machine run from 16 kHz audio to about 0.1 Hz for a whole conversation, which is 13.9 φ-rungs (16 kHz→20 Hz) plus about 11 more below that. The layers will be defined by their measured rates, not by φ exponents.

**The lexicon's most valuable part:** entries like `rise: ż > 0` and `fall: z̈ = −g` are *testable conditions on a path through the field*. These can run for real: a verb becomes a detector that fires when the field's own path meets its condition. That's how the brain can "feel" a word — the word turns on because the field is doing what the word describes. Some entries can't be checked from the field (for example ρ_fluid for "float"). Those stay listed but are marked **ungrounded**, and they never affect recall scores.

**Other checked facts:** Zipf's law on 20k words gives H = 10.48, so the most common word is about 9.5% of all text, and frequency weighting is required. Memory fade times: φ⁻² → 2.08 ticks, φ⁻³ → 3.71, φ⁻⁵ → 10.58. The golden angle is 137.508°. Its closeness to α⁻¹ = 137.036 has no mechanism behind it and is not used.

## How information flows today (traced in the code)

```text
senses (mic mel/MFCC/chroma 233 Hz, camera, IMU, screen) ─┐
typed/chat text ──(lexeme → torus slots)─────────────────┤
                                                          v
field Ψ (60 Hz) → capture tick (~2 Hz) → layers L0–L6
   L1 Hebbian co-activation  (the only learned weights, saved to IndexedDB)
   pattern index (3-stage recall, rehearsal-weighted)
   consolidation (cosine + energy gate) → prototypes
   mind: concept store + self-model prediction (novelty, surprise)
```

- **Stored:** a pattern snapshot is kept at every capture. Hebbian weights change on each tick. Prototypes merge together during consolidation.
- **Recalled:** by field similarity. Recall boosts a pattern's rehearsal count, and patterns fade with age.
- **Saved:** Hebbian weights and the memory snapshot go to the browser's storage, written with a short delay.
- **Missing for hearing words:** the microphone produces sound features but never *word identities*. So a sound pattern and the word it carries are never active together, and nothing can link them. Text links only to whatever else happens to be in the field when it's typed. Functions and meanings are linked to nothing.

## What learning a word requires (three bindings)

1. **Sound ↔ word.** A word label has to arrive together with the sound pattern that carries it, so Hebbian learning can link the two. The teacher is speech-to-text on the microphone stream (Lovable AI, off the tick path), with a timestamp for each word. Once enough pairs are learned, the field can predict the word straight from the sound features, and its guesses are scored against the teacher. The teacher can then be turned off.
2. **Word ↔ pattern (vision, motion, context).** Links form between the word vector and whatever senses are active in the same φ-scaled time window, ±φ³ ≈ 4.2 captures. A link is weighted by surprise, so unexpected pairings learn faster (predictive-coding gain = surprise).
3. **Word ↔ function / meaning.** Each grounded detector from the lexicon (for example `rise: ż>0`) fires a label when the field's own path meets its condition. That word is then linked to the field state that caused it. Its meaning is the set of states that turn it on. It can be checked: activating a word should call up states that satisfy its condition.

## Methods used (each maps to an existing part)

- **Fast + slow memory (complementary learning):** the pattern index is the fast store. Consolidation, plus replay during idle ticks, is the slow cortex. Replay uses the existing `MemoryStore.replay()`.
- **Modern Hopfield recall** with the calibrated β, so a crisp pick is always possible.
- **Sparse distributed addressing** (32 of 1597 active) for the lexicon, exact key = base-27.
- **Reversible binding (circular convolution / phase binding)** on the complex field for role and filler slots, which gives sentences as structure.
- **Assembly formation:** keep the top-k active units after each word. Repeated sets become assemblies, which are the compositional units.
- **Next-word prediction:** a small linear state update driven by the existing self-model. Its surprise drives both learning rate and storage.
- **New here — closure-gated learning:** a link is written only if adding it does not raise the torus closure residual over a Fibonacci window. Learning can then never make the field less stable.

## What gets built (all edits to existing files)

**L0 — Hearing words.** The microphone stream is sent to Lovable speech-to-text in short chunks, and words come back with timestamps. Each word is placed into the field at its timestamp, lined up with the audio features captured at that moment. A running score shows how often the field's own word guess from sound matches the teacher.

**L1 — Word-rate capture.** Separate word capture from the 2 Hz memory tick. Each token gets its own write when it arrives, placed on the field tick, so no words are lost at 20 words/s. Rate counters show up on the MEMORY deck.

**L2 — Meaning vector per word.** Signature = (trigram field signature ⊕ learned co-occurrence offset). The offset is learned by the existing Hebbian matrix from words that share a sentence. Base-27/Zeckendorf remains the exact key. No stored table, just a sparse learned delta.

**L3 — Calibrated recall.** Replace the fixed β with β = 2·ln N / Δ̂, where Δ̂ is the measured gap between the best and second-best match. Each result reports whether it was a crisp pick or a blend. The energy-based admission gate stays.

**L4 — Grounded lexicon.** Parse the uploaded lexicon into a typed catalog: word, part of speech, type signature, condition. Conditions that can be computed get turned into predicates over the field path (velocity, acceleration, closure, coherence, drift, phase). All others are marked ungrounded. Verbs, adjectives and prepositions become live detectors. When one fires, its word is activated in memory, and that closes the loop from algorithm to word.

**L5 — Sentence as structure.** Bind roles and fillers (agent/action/object/place/time) by circular convolution. A sentence becomes one vector that you can reverse to get the parts back. A one-cycle field update tracks the topic across sentences. Each decode checks how accurately it recovers the parts and reports that measurement.

**L6 — Field → words (transcription back).** At each word tick: take the grounded detectors that fired, add the strongest recalled concepts, fill the role slots, and turn that into a short sentence of words from the catalog. This is the brain describing its own state, and it links to the existing chat snapshot.

**L7 — Checks.** Tests for: no dropped tokens at 20 Hz; similar spellings sitting closer than random words; crisp recall at N = 20k once the gap is measured; exact recovery of the base-27 key; each grounded predicate against a synthetic path; recovery of role parts from a bound sentence at or above a measured floor. New constants get checked at 40 digits through the research Wolfram key.

## Technical details
- Files touched: `gematria/lexeme.ts`, `knowledge/fieldSignature.ts`, `memory/tickMemory.ts`, `memory/PatternBitmapIndex.ts`, `memory/Consolidator.ts` (β), `memory/HebbianMatrix.ts`, `cognition/mind.ts`, `lib/chat/engineSnapshot.ts`, the MEMORY/MIND deck panels. The lexicon catalog goes in the existing `core/knowledge/` as data plus one predicate compiler.
- Everything stays deterministic, with no downloaded models and no Wolfram calls during a tick.
- Scope honesty: this gives words grounded in the engine's own dynamics. It does not give real-world meaning beyond what the catalog's conditions and co-occurrence can measure.
