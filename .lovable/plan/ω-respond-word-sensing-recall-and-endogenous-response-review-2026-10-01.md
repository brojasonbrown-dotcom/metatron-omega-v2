# Ω-RESPOND — review: how words are sensed, recalled, and how the field could respond

Status: REVIEW + PROPOSAL. Nothing implemented. Each item below becomes its own task ID in the arc.

## Measured today (scratch test against live code, 2026-10-01)

| Probe | Result | Meaning |
|---|---|---|
| Single word → field → decode by nearest pattern (17-word vocab) | 17/17, no ties | the field pattern of a lone word is identifiable |
| Sentence "the cat drinks milk" → rank vocab by cosine | the .70, cat .47, milk .41, **moon .40**, drinks .33 | words partly recoverable; false positive (moon) beats a true word |
| "dog chases cat" vs "cat chases dog" in field | cosine 0.852 | field barely encodes who did what |
| Lexicon nearest neighbours of "cat" | a, sleeps, chases | learns *what appears beside it*, not *what it is like* |
| cat~dog vs cat~moon (lexicon) | 0.075 vs 0.025 | similar-meaning words are only weakly closer |
| cat~cats spelling | 0.465 | spelling signature works as intended |

## Code-path findings

1. **Sensing:** words reach Ψ via `injectTextPsi` once per memory tick (~2 Hz), drained losslessly. Real and active.
2. **Recall by resonance:** `PatternBitmapIndex.search` and `LexiconMemory.recall` are real (calibrated softmax, crisp at mass ≥ φ⁻¹). But the two never meet. The lexicon recalls from its own vectors and never reads Ψ. The field never reads the lexicon.
3. **`recalledWord` in `tickMemory.ts` is not recall:** it is the last typed token. Under the delete-never-soften rule it must be replaced by a real Ψ→word readout, or removed.
4. **`describeField` reads only the coherence path**, not which words are present in Ψ.
5. **No endogenous activity:** with no input, nothing proposes words. `cognitiveDriver` runs maintenance (spectral scan, latent retrain), not thought.

## Information-flow review

- **Source:** typed or heard tokens (teacher labels), plus Ψ after propagation.
- **Destination:** Ψ (context), lexicon (identity and meaning), pathway graph (sequence), journal (output).
- **What it indicates:** the field state carries *which* words are active and how strongly. The lexicon carries *what* they mean. Order and roles are currently lost.
- **Storage layering:** fast lives in Ψ and the L1 Hebbian matrix; slow lives in lexicon, L3 patterns and L4 pathways. That layering is right. The missing piece is a read path from Ψ back to the lexicon.
- **Pattern use:** a Ψ→word readout turns every tick into a recognition event that can be scored, which gives a falsifiable accuracy.

## Candidate solutions, filtered

| Question | Options | Keep |
|---|---|---|
| Read words from Ψ | (a) cosine against each word's injection pattern; (b) learned linear decoder (NLMS, like SoundWordMap); (c) Hopfield/softmax over (a) | **(c) over (a)** first: deterministic, no training, already the calibrated kernel. Add (b) later only if it beats (c) on held-out text |
| Meaning similarity | (a) keep the ±4 window; (b) add second-order context (words that share neighbours); (c) external embeddings | **(b)**: in-house, deterministic, fixes cat~dog. (c) violates "brain computes it" |
| Word order and roles | (a) position phase in injection; (b) send `encodeSentence` role binding into Ψ; (c) leave it | **(a)**, minimal diff, gated on parity. **(b)** after |
| Response without input | (a) idle replay: walk L4 pathways from the current Ψ readout and inject the predicted next word at reduced gain; (b) random sampling (forbidden: determinism); (c) LLM generation (not the field) | **(a)**: deterministic, measurable, uses existing stores |
| When it may speak | gate: readout crisp (mass ≥ φ⁻¹), prediction surprise below band, ring closure stable | all three, measured |

## Proposed task sequence (one per prompt, gate each)

- **R1 Ψ→word readout.** Replace the fake `recalledWord` with calibrated recall over Ψ. Report precision and recall on held-out sentences. This is the first honest "the field read a word" signal.
- **R2 Second-order meaning.** Shared-neighbour context in `LexiconMemory`. Success test: cat~dog > cat~moon by a stated margin on a fixed corpus.
- **R3 Order in the field.** Positional phase in `injectTextPsi`. Success test: role-swap cosine drops from 0.852 to below a stated target. Re-pin parity.
- **R4 Endogenous replay.** At idle, Ψ readout → L4 successor → injection at φ⁻³ gain. Output goes to the journal as "field proposed: …" with its score. Never presented as speech unless the R-gates pass.
- **R5 Response.** On a typed or heard prompt, run R1 and R4 for k ticks. The reply is the word chain the field produced, each word with its resonance score, shown next to the LLM reply so the two can be compared, never merged.

## On "free will"

R4 gives the system **endogenous activity**: it acts without new input, driven by its own learned state. That can be measured. It is still fully determined by the seed, the history and the equations, which is a reproducibility guarantee this project requires. Whether that counts as free will is a philosophical question that no test here can settle. The honest claims are "self-driven", "unprompted", and "conditioned on its own memory".
