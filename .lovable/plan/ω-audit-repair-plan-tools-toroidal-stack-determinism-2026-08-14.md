# Ω Audit + Repair Plan — Tools, Toroidal Stack, Determinism

Review only so far. Nothing has been edited. Below is what I actually found in the running
code, then the exact work I propose, ordered so nothing regresses.

## 1. What is verifiably healthy

- Full gate battery runs green: **185/185 tests** across G0 (foundation), G1 (single torus),
  G2 (spectral), G3 (web), G4 (runtime/governor), G5 (views), G6 (sense/memory),
  G7 (cognition), G8 (learning), plus the brain-core field suite.
- The stability law is *computed*, not asserted: rung n stable ⟺ L(n) mod 13 ∈ {1,12} ⟺
  n ≡ {1,13,15,27} (mod 28). Dense core = the 18 lowest stable rungs. The 18-layer
  structure you describe is already the law in `core/scaleLadder.ts`.
- The nine-term cell carries a real Jury certificate (g = 0.7507764050037854 < 1) and the
  φ⁴ clamp is a belt-and-braces invariant rather than the thing holding it together.
- Web coupling is row-stochastic with φ-decay; flux ledger closes to zero imbalance and the
  ordering monitor reports zero violations on the dense core.
- No `Math.random` anywhere in `trnn-core` or the field substrate. Wall-clock is used only
  for telemetry/IDs, never inside a step.

## 2. Real defects and gaps found

**A. `locate_anything` is single-provider and mis-shaped.**
- It only calls the legacy `api-inference.huggingface.co` endpoint, which no longer serves
  most detection checkpoints — that is the failure you are seeing.
- The request body sends `inputs: <url or data uri>`. Zero-shot detection on the HF router
  expects the image *bytes* (base64) plus `candidate_labels`; a bare https URL is rejected.
- `NVIDIA_API_KEY` is present in the vault but no NVIDIA route exists, so the strongest
  available detector is unused.
- The circuit breaker keys on model only, so one dead provider poisons a healthy one.

**B. The 18×610 geometry is not expressible.**
Profiles interpolate node counts geometrically between `baseNodes` and `topNodes` and snap
to Fibonacci. There is no uniform-width build, so "18 toroids of exactly 610 nodes each"
(10,980 nodes) cannot be selected. Cost check: ≈0.9 MB per rung → ≈16 MB total, well
inside a browser tab. This is a missing configuration, not a limit.

**C. Structural soundness gaps (the instabilities to close).**
1. The Jury certificate covers only the homogeneous part. The drive terms (G,P,R,U,V,S)
   have no input bound, so the clamp is currently the only thing bounding a driven run.
   An input-to-state (ISS) bound `‖z‖∞ ≤ (Σ|k_i|·‖term_i‖∞)/(1−g)` should be computed and
   asserted per tick, with the clamp counted as a *fault*, not as normal operation.
2. `cellStep`'s `addTerm` silently truncates to `min(n, term.n)`. A width mismatch produces
   a quietly wrong field instead of an error. Must throw.
3. Mode basis drops degenerate vectors (`norm ≤ 1e-10`) and shortens `specs`. Correct, but
   the drop is invisible — signature width then differs from the profile's declared `modes`
   with no telemetry. Needs a reported `rank deficit`.
4. Coherence delay is a fixed 233 ticks for every rung, while rung clocks are φ-scaled.
   On rung 17 that measures a different physical lag than on rung 0. Delay should be
   per-rung and Fibonacci-matched to the rung clock.

## 3. Work plan (ordered, no-regression)

**Phase T — tools (do first, it is what is blocking you)**
1. Rewrite `locateAnything` as a **provider ladder** with per-provider breakers:
   NVIDIA NIM (`NVIDIA_API_KEY`) → HF router `router.huggingface.co` zero-shot detection →
   legacy HF inference. First success wins; each provider reports why it was skipped.
2. Normalise the image once per call: https URL → fetch → base64 (size-capped), `data:` URI
   → strip prefix. Send the shape each provider actually expects.
3. Normalise output to one schema: `{label, score, bbox:{xmin,ymin,xmax,ymax}, normalized}`
   with pixel/normalized coordinates disambiguated, sorted by score, threshold applied
   server-side so provider differences never leak.
4. Sweep the rest of the arsenal: run every tool spec against its live endpoint, mark each
   `ok / needs-key / dead`, fix the dead ones, and surface real status in the TOOLS panel
   instead of a static list. Learning/reasoning tools stay untouched per your instruction.

**Phase S — structure**
5. Add a uniform node policy and an `OMEGA` profile: 18 rungs × 610 nodes, modes 21,
   Fibonacci clock, coupling band 4. Existing profiles are left byte-identical.
6. Extend the governor so hardware probing can select `OMEGA` where it fits, and report
   the exact footprint against `measureFootprint()`.

**Phase C — certification**
7. Add the ISS bound to `cellStep`, expose `clamped > 0` as a fault counter in the FIELD
   deck, and add a gate test that a driven run never touches the clamp.
8. Make `addTerm` width mismatch throw; add the test.
9. Report basis rank deficit through the spectral view and the SPECTRAL deck.
10. Per-rung Fibonacci coherence delay, with a gate test that coherence is clock-invariant
    across rungs for a stationary field.
11. New gate **G9**: 18×610 build runs 1000 ticks bit-identically from the same seed on
    two independent instances, with zero flux imbalance, zero ordering violations, zero
    clamp events, and a rank-complete basis on every rung.

## 4. Explicitly out of scope for now

Learning and reasoning (tiers T0–T3, SPSA battery, JEPA-style gating) are frozen exactly as
they are, per your instruction to do those last. No file under `learn/` will be touched.
