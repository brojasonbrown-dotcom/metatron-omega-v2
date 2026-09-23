# Roadmap — rigorous word→field intelligence

Rule for every item: it must be measured, used, and falsifiable by a test.
Anything that cannot be is deleted, not documented.

## Done

- [x] **Exact word codes** — `src/core/gematria/lexeme.ts`: injective positional
      base-27 code (exact to 11 letters, `27^11 < 2^53`), Zeckendorf address,
      reversible via `unzeckendorf`. Anagrams no longer collide.
      Residue channel budget `log₂22 = 4.459431618637297` bits — bucketing only,
      never a meaning. (A test caught a wrong digit in this constant; corrected.)
- [x] **Words become field structure** — `injectTextPsi` writes tokens onto the
      same (R = φ, r = 1) torus the engine runs on: major circle from the
      Zeckendorf index, minor from `frac(v·φ⁻¹)` (equidistributed), gain φ⁻³,
      `1/√k` normalisation. The four global invariant slots are never written.
- [x] **Wired into the tick** — `tickMemory.ts` injects text after sensory and
      before the qualia correlate, so L1 Hebbian co-activation runs across
      (word, sound, image) together. Returns `textInjection`.
- [x] **Frequency-aware recall** — `PatternBitmapIndex.search` is three-stage
      (LSH bucket gather → φ-weighted Hamming → exact kernel), scoring
      `C · (1 + φ⁻¹·ln(1+rehearsals)) · φ^(−Δt/τ)`, `τ = 34`. The bucket map was
      built and never read; recall was paying O(N) on every call.
- [x] **Merge admission gate** — `mergeAdmissible` in `Consolidator.ts`, wired
      into the cosine-accepted branch. Energy on the unit sphere plus
      Ramsauer separation against live prototypes, `β = φ/√d`. The first version
      was norm-sensitive and rejected legitimate merges; the separation margin is
      the informative half and is now what decides.
- [x] **Hebbian bound stated correctly** — unclamped fixed point is
      `η/decay = φ² = 2.618033988749895`; the ±1 clamp in `update()` is what
      actually binds. `recall()` left raw so engine numerics stay bit-identical.
- [x] **Dead code removed** — `Weave.ts`, `TapeDmd.ts`, `fibCode`, `fibDecode`,
      `zeckDensity`, `bitmapResonance`, `digitSumTrajectory`.

## Open

- [ ] **F1-F9 quarantine.** Partly resolved, and the part that mattered is done:
      the coincidence terms were reaching a *scored* quantity. Each rung's
      headline metric is a blend, and F9's `cosmicWebCoherence` spends ~0.30 of
      its weight on terms like "Omega_dark/Omega_matter ~= sqrt(5)" and
      "dT/T ~= phi^-24"; that blend was `metatronCoherence`, which was the
      coherence axis of memory capture (psi[37], qualia C, episodic salience) and
      therefore of every recall score downstream.
      `MetatronCore` now also returns `metatronWitnessCoherence` - the same
      phi^(-rank) weighted geometric mean taken over clamp01(1 - closureResidual),
      i.e. derived end-to-end from measured Lyapunov residuals - and `tickMemory`
      scores on that. `metatronCoherence` survives as a display diagnostic only,
      so the v10 parity goldens and UI decks are untouched.
      Still open: move the coincidence commentary inside the nine F-layer files
      into an inert `lore` block, and delete anything that fails 40-digit
      re-verification. No scored path depends on it any more, so this is now
      hygiene rather than correctness.

- [ ] **`WOLFRAM_APP_ID_RESEARCH` verification channel.** Offline only, never
      inside a tick; separate 20/min budget from the chat tool. Re-verify every
      constant at 40 digits and record the exact query string beside it.
- [ ] **Scale-matched sensory ladder.** Declare `[fLo, fHi]` per rung; bind each
      frontend by its Nyquist limit; mark unsensed rungs `inferred` so they are
      never silently scored. Hearing spans 9.965784285 octaves, vision 0.802554
      of one, separated by 44.2894 octaves = 63.7953 φ-rungs — the present
      9-rung ladder with widths (7,55,7,13,9,22,55,55,55) is bound to no band.
- [ ] **Toroidal closure as the rung-enable criterion.** `torusClosure.ts`
      already computes `ringResidual`; a rung turns on only when that residual is
      non-increasing over a Fibonacci window, with eigenmodes-style provenance.
      Per-rung leakage surfaced on the SCALES deck.

## Notebook binding

Notebook 2 governs the admission test, Notebook 3 the sensor→rung binding,
Notebook 4 what turns a rung off.
