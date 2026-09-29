# Ω-HEAR: visible hearing, correctable transcripts, and a unique field pattern for every word

## What the review found

- **Hearing exists but is hidden.** The Listen button, the typed-sentence reader and word recall sit in COGNITION → substrate → WORDS, three clicks deep. No top-level tab shows words at all, which is why hearing looks absent.
- **Two separate "ears" that never meet.** The SENSE tab's audio channel (mel · MFCC · chroma, 233 Hz) and the Listen button (4-second chunks sent for speech-to-text) open the microphone independently. The field hears sound without words, or words without their live sound — never both on one timeline.
- **Words commit immediately.** A heard chunk goes straight into memory with no chance to fix a misheard word, so errors are learned as truth.
- **Only the last chunk is shown**, as one line of text. There is no rolling transcript, no per-word view, and no display of the word's field pattern.
- **Gematria is active but invisible.** Every token already gets an exact base-27 code, a Zeckendorf address, a torus position and a phasor signature. None of it is shown, and the address is not used as a recall key for the lexicon.
- **Dormant areas are not reported.** There is no single view saying which layers received data this session, which were saved, and which never fired.

## What gets built (edits to existing files only)

### 1. HEAR tab (top level)
A new top-level tab, placed after SENSE, with one **Start hearing** button that switches on both ears together: the spectral channel (sound features at 233 Hz) and the speech-to-text teacher (word labels). One button, one microphone stream, shared by both. The WORDS sub-section in COGNITION moves here instead of being duplicated.

### 2. Rolling transcript with correction before memory
- The last ~30 heard words appear as chips, newest on the right, each showing its confidence and its guess from sound alone (hit/miss).
- Each word waits in a **pending** state for a short hold window (default 8 s, adjustable, with a pause button). During that window you can click a word to correct it, delete it, or confirm it.
- Only confirmed or expired-unchanged words are committed to the field and lexicon. A correction is itself a learning signal: the sound is bound to the corrected word, and the wrong guess gets a negative score in the sound→word map.
- Typed sentences use the same pending path, so reading and hearing behave identically.

### 3. A unique, visible pattern for every word
For each word chip, an inspector shows:
- exact code (base-27 integer, flagged if longer than 11 letters),
- Zeckendorf address (the unique key),
- torus position (major-circle rung, minor-circle phase),
- a small fingerprint of its phasor signature,
- nearest known words and whether recall was crisp or a blend,
- which grounded detectors (rising, falling, periodic…) it matches.

Uniqueness is enforced and checked: the Zeckendorf address becomes the lexicon's primary key, so two distinct words can never share an entry, and a test asserts no collisions across the 1181-entry catalog plus a 20k-word sample.

### 4. Shared sound/word timeline
Each committed word is placed at its arrival time together with the audio features captured in that same window from the spectral channel, so Hebbian learning links sound pattern ↔ word on one clock. The top-1/top-5 "hears alone" score stays and becomes visible on the HEAR tab.

### 5. Activity map (dormant vs live)
A compact panel on HEAR (and on COGNITION) listing each layer — field tape, Hebbian, episodes, patterns, pathways, journal, lexicon, sound→word map, sensory atoms — with: writes this session, last write time, saved (yes/no, time of last save). Anything that received nothing is marked **dormant** in plain view, so gaps are measured, not guessed.

### 6. Checks
Tests for: the pending queue (edit, delete, expiry commits exactly once), correction producing a negative sound→word trial, one shared microphone stream, Zeckendorf-key uniqueness, and the activity map counting real writes.

## Technical details
- `sensoryDriver.ts`: expose the live audio `MediaStream` so `memoryRuntime.setListening` reuses it instead of calling `getUserMedia` again; pull the audio descriptor for each chunk from the same window.
- `memoryRuntime.ts`: add `pendingWords` ring with `hold`, `correct(id, text)`, `drop(id)`, `confirm(id)`; commit via existing `MemoryStore.hearWithSound`. Correction path calls `soundWords.observe` with the corrected label and records the miss.
- `lexicon.ts`: key entries by `lexeme(token).address`; add `inspect(word)` returning code/address/torus/signature fingerprint/neighbours/detectors.
- `MemoryDeckPanel.tsx`: extract `WordsStrip` into the new HEAR tab component; `OmegaWorkstation.tsx` gains the `hear` tab; COGNITION links to it.
- Activity map reads existing `MemoryStore.stats()` plus per-layer write counters and the persistence flush timestamps.
- Word-level timestamps from speech-to-text stay out of scope; chunks remain the unit until a model returning word timings is confirmed.
