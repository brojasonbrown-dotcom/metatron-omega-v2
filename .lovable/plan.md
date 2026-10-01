# Ω-UNDERSTAND — synthesis review: full associative word recall, what LLMs/perceptrons exploit, and the field's best use

Status: REVIEW + TASK SEQUENCE. Planning only. Each W-task below is one prompt, one gate. Supersedes the order of R1–R5 in `ω-respond-…-2026-10-01.md` (R-items are folded in, not duplicated).

## 1. What we have learned (measured, not assumed)

| Finding | Source | Consequence |
|---|---|---|
| Lone word → Ψ is uniquely decodable (17/17) | Ω-RESPOND sandbox | field can carry identity for small active sets |
| Sentence → Ψ: false positive (moon .40) beats true word (drinks .33) | Ω-RESPOND | superposition crosstalk; readout needs cleanup, not raw cosine |
| Role swap cosine 0.852 | Ω-RESPOND | order/roles are lost in injection |
| 1,191 tokens on 51/55 positions, max 151 per position, length-driven | field test | placement is the main capacity bottleneck |
| Words >11 letters collide (base-27 truncation) | Ω-HEAR | identity loss for long words |
| Repeating a word doubles energy (0.227→0.454); no habituation in field | field test | repetition is not yet a learning signal in Ψ |
| Propagation retains low 1.00 / mid 0.45 / high 0.29 per step | field test | field is a low-pass context integrator; fine detail must live in memory |
| Lexicon recall and Ψ never meet; `recalledWord` is last typed token | Ω-RESPOND | fake readout must be replaced |
| cat~dog 0.075 vs cat~moon 0.025; neighbours of cat = a, sleeps, chases | Ω-RESPOND | first-order co-occurrence only; no "what it is like" |
| Sound map: chunk-averaged, chunk-labelled | Ω-HEAR | no word-level acoustic learning yet |

Answer to "can it recall all related patterns of a word?": today, no. It recalls the single nearest lexicon vector and its window neighbours. It does not retrieve the set of patterns, pathways, spellings, sounds, and sentences that involve the word.

## 2. What LLMs and perceptrons actually exploit (and the field equivalent)

| Mechanism | What it does | Honest field/memory equivalent | Keep? |
|---|---|---|---|
| Learned embeddings | words with similar contexts get close vectors | second-order (shared-neighbour) context in `LexiconMemory` | yes (W3) |
| Attention = softmax(q·k) | content-addressed retrieval over many items | modern Hopfield recall is mathematically the same operation; already our calibrated kernel | yes (W1, W2) |
| Positional encoding | order via phase/rotation | positional phase in `injectTextPsi` | yes (W4) |
| Residual stream / layers | iterate retrieve → refine | k-step Hopfield cleanup over Ψ readout | yes (W1) |
| Next-token prediction + loss | learning signal = surprise | L4 successor prediction scored before update | yes (W5) |
| Backprop over billions of params | gradient training | not reproduced; NLMS/Hebbian local rules only | no, out of scope; stated as a limitation |
| Perceptron / sparse coding | linear separability via high-dimensional sparse codes | full-token hashed sparse placement (k-of-N) | yes (W0) |

The field contributes what LLMs lack: a continuous, measurable dynamical state with closure/coherence diagnostics. Coherence is used as a **gate** (when recall is trusted, when consolidation may happen, when the field may propose), never as a score of meaning.

## 3. Information-flow review

- **Source:** typed/heard tokens (teacher), Ψ after propagation, stored lexicon/pathway/pattern stores.
- **Destination:** Ψ (short-lived context), lexicon (identity + meaning), L4 pathways (sequence), phenomenon log (new, see W7), journal/UI.
- **What it indicates:** Ψ = which words are active and how strongly in context; lexicon = what a word is like; pathways = what follows what; closure/coherence = whether the state is stable enough to trust.
- **Storage layering:** fast Ψ + L1 Hebbian; slow lexicon, L3 patterns, L4 pathways; all persisted via existing `MemoryPersistence`. Missing: an index from a word to every stored item that involves it.
- **Pattern use:** every tick becomes a scored recognition event (precision/recall), every prediction a scored surprise event.

## 4. Candidate solutions per bottleneck, filtered

| Bottleneck | Options | Kept |
|---|---|---|
| Placement collisions | (a) wider base-27 code; (b) full-token hash to sparse k-of-N positions; (c) learned placement | (b): deterministic, removes length bias, Wolfram-checked load bound |
| Readout crosstalk | (a) raw cosine; (b) Hopfield softmax over word patterns; (c) iterative cleanup with subtraction (explain-away) | (b)+(c): attention-equivalent, deterministic |
| Related-pattern recall | (a) nearest neighbours only; (b) inverted index word → {patterns, pathways, sentences, sounds}; (c) spreading activation over that graph with decay | (b)+(c), decay φ⁻¹ per hop, bounded hops |
| Meaning | (a) window co-occurrence; (b) second-order PPMI-style shared context; (c) external embeddings | (b); (c) violates "the brain computes it" |
| Order/roles | (a) positional phase; (b) role-bound injection from `encodeSentence` | (a) then (b) |
| Repetition | (a) energy doubling; (b) habituation via prediction error (repeat = low surprise, strengthen) | (b) |
| Endogenous response | (a) L4 replay from Ψ readout at φ⁻³ gain; (b) random sampling (forbidden) | (a), gated |

## 5. Task sequence (one per prompt, full gate each, replacement before deletion)

- **W0 Placement.** Full-token hashed sparse placement in `lexeme.ts`, replacing base-27 truncation. Test: max per-position load and positions used on the 1,191-token catalog vs stated bound; long words no longer collide. Re-pin parity.
- **W1 Ψ→word readout.** Hopfield softmax + explain-away cleanup over Ψ in `lexicon.ts`; replaces fake `recalledWord` in `tickMemory.ts`. Test: held-out sentence precision/recall; moon must not outrank drinks.
- **W2 Related-pattern recall.** Inverted index in `LexiconMemory` (word → patterns, pathways, sentences, sound prototypes) + bounded spreading activation. UI: word inspector in `HearDeckPanel` lists everything recalled with scores. Test: recall set completeness on a fixed corpus.
- **W3 Meaning.** Second-order context. Test: cat~dog > cat~moon by stated margin.
- **W4 Order.** Positional phase in `injectTextPsi`. Test: role-swap cosine below stated target.
- **W5 Prediction + habituation.** Score L4 successor before update; repetition weighted by surprise, not raw energy.
- **W6 Endogenous proposal.** Idle replay gated by readout crisp (mass ≥ φ⁻¹), surprise below band, closure stable. Logged "field proposed: …"; shown beside, never merged with, the LLM reply.
- **W7 Phenomenon log.** Every emergent measured effect from tests (e.g. low-pass retention, crosstalk ranking) recorded in `docs/BRAINMAP.md` under a measured-phenomena section with test reference; tests assert them so they stay true or fail loudly.

Out of scope, stated: word-aligned acoustic learning (needs its own task), backprop-scale training, any claim of physical cognition.

## Technical details

- Files extended only: `src/core/gematria/lexeme.ts`, `src/core/knowledge/lexicon.ts`, `src/core/knowledge/fieldSignature.ts`, `src/core/memory/tickMemory.ts`, `src/core/memory/MemoryStore.ts`, `src/ui/omega/HearDeckPanel.tsx`, `docs/BRAINMAP.md`, `docs/BASELINE.md` (marker raised per task).
- Determinism: hashing via existing deterministic hash; dmath/dpow only; no Date.now on state paths.
- Frozen files untouched; parity re-pins only where a task explicitly changes injection (W0, W4), each with reason in BASELINE.
- Per-task plans saved as `.lovable/plan/ω-<topic>-<date>.md`; first prompt after approval executes W0 only.
