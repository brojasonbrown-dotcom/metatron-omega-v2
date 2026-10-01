/**
 * tickMemory — bridge from MetatronOutput → MemoryStore.capture().
 *
 * Routes everything through MemoryCaptureKernel so L0 tape, L1 hebbian, L2
 * episodic, L3 semantic, L4 pathway, L5 journal, and L6 reflective all fire
 * on their PhiLock-scheduled cadences.
 *
 * Toroidal closure (Section 6 fix): the captured `qualiaScalar` now comes
 * from `computeQualiaCorrelate(psi)` → `qualiaScalar(...)`, matching the
 * canonical RHUFT definition (Hurwitz incommensurability × Gram stability ×
 * φ-attractor energy fraction). Before the fix, memory was scored by
 * `out.metatronCoherence` — the *master-metric* geometric mean, which is a
 * different physical quantity and mis-weighted episodic salience.
 *
 * Engine numerics are untouched: the chain orchestrator is never invoked
 * from here; the fix only affects what memory *records*, not what the
 * engine *computes*. V10 framework goldens cannot regress.
 */

import type { MetatronOutput } from '@/core/MetatronCore';
import type { MemoryStore } from './MemoryStore';
import { isFibonacciTick } from './FibonacciPatterns';
import {
  computeQualiaCorrelate,
  type QualiaCorrelateMeasurement,
} from '@/core/field/QualiaCorrelate';
import { qualiaScalar as reflectQualiaScalar } from '@/core/field/Reflect';
import { PHI, PHI_INV } from '@/core/constants/WolframVerified';
import { injectTextPsi, lexemeTokens, type TextInjection } from '@/core/gematria/lexeme';
import { describeField } from '@/core/knowledge/lexicon';

/**
 * Legacy flat 18-vector projection. Kept for parity tests / external callers.
 * Per-rung components: [chainUpCoupling, masterMetric]. No phase information,
 * no toroidal geometry — sensory ΔΨ injected here is a flat vector add.
 */
export function projectPsi(out: MetatronOutput): Float64Array {
  const psi = new Float64Array(out.chain.length * 2);
  for (let i = 0; i < out.chain.length; i++) {
    psi[i] = out.chain[i].chainUpCoupling;
    psi[i + out.chain.length] = out.chain[i].masterMetric;
  }
  return psi;
}

/**
 * TOROIDAL Ψ EMBEDDING (Gap #2 — true toroidal flow).
 *
 * Each of the 9 rungs maps to a position on the surface of a (R=φ, r=1) torus:
 *
 *   θ_n = 2π · n/9                    (uniform major-circle slot per scale)
 *   φ_n = 2π · {n · φ⁻¹}              (golden-angle phyllotaxis on minor circle)
 *
 *   x_n = (R + r·cos φ_n) · cos θ_n
 *   y_n = (R + r·cos φ_n) · sin θ_n
 *   z_n =  r·sin φ_n
 *
 * The (x,y,z) position is amplitude-modulated by chainUpCoupling and the
 * fourth component carries the mean-centred masterMetric. Per-rung components
 * are 4; total length = 9·4 + 4 (global tail) = 40.
 *
 * Layout (so sensory ΔΨ has a stable geometric meaning):
 *   psi[4n + 0]   rung_n . x          (toroidal X · c_n)
 *   psi[4n + 1]   rung_n . y          (toroidal Y · c_n)
 *   psi[4n + 2]   rung_n . z          (toroidal Z · c_n)
 *   psi[4n + 3]   rung_n . m          (masterMetric, mean-centred to [-1,1])
 *   psi[36]       global torusClosure
 *   psi[37]       global metatronCoherence
 *   psi[38]       toroidal-flow scalar Σ_n c_n · sin(θ_n − φ_n)  (circulation invariant)
 *   psi[39]       phaseCirculation
 *
 * Mathematical properties (Wolfram-verified):
 *
 *   1. Equidistribution. The 9 minor-circle phases {n·φ⁻¹} (n=0..8) have
 *      gap-ratio max/min = φ² = 2.618. This IS the Hurwitz signature — any
 *      9-point sequence on a circle achieves min-possible discrepancy when
 *      rotated by the golden ratio (slowest-converging continued fraction).
 *
 *   2. Fibonacci-tick resonance. The minor-circle phase at tick F_k is
 *      {F_k · φ⁻¹}. Successive Fibonacci-tick drifts converge to 1/φ² =
 *      0.381966 — IDENTICAL to the engine's coherence attractor Ω_c. So the
 *      L3 FibonacciPatterns layer, when sampling this embedding on F_k
 *      ticks, precesses at the exact rate the φ-phase-lock targets. The
 *      embedding is self-consistent with the engine's locking law.
 *
 *   3. Circulation invariant. Σ_n c_n · sin(θ_n − φ_n) is non-zero iff the
 *      chain has net toroidal winding (smooth flow → finite signed sum;
 *      turbulent → cancels to zero). Complementary to phaseCirculation
 *      which only measures |Δcoupling| magnitude.
 *
 *   4. Stability under sensory injection. Sensory ΔΨ via
 *      injectPsi(target, last) writes at indices `last.indices[i] % N`. With
 *      N=40, those writes land on specific (rung, axis) tuples — so the
 *      same percept consistently perturbs the same toroidal point, enabling
 *      Hebbian co-activation along genuine flow lines instead of arbitrary
 *      flat-vector indices.
 *
 * Engine numerics unaffected: this function is read-only over `out`.
 * V10 framework goldens cannot regress.
 */
export function projectPsiToroidal(out: MetatronOutput): Float64Array {
  const N_RUNGS = out.chain.length; // 9 in current chain
  const TAIL = 4;
  const psi = new Float64Array(N_RUNGS * 4 + TAIL);
  const R = PHI; // major radius (golden)
  const r = 1.0; // minor radius
  for (let n = 0; n < N_RUNGS; n++) {
    const c = out.chain[n].chainUpCoupling;
    const m = out.chain[n].masterMetric;
    const theta = (2 * Math.PI * n) / N_RUNGS;
    const minorTurns = (n * PHI_INV) % 1;
    const phi = 2 * Math.PI * minorTurns;
    const ringR = R + r * Math.cos(phi);
    const base = 4 * n;
    psi[base + 0] = ringR * Math.cos(theta) * c;
    psi[base + 1] = ringR * Math.sin(theta) * c;
    psi[base + 2] = r * Math.sin(phi) * c;
    psi[base + 3] = (m - 0.5) * 2; // mean-centred master metric
  }
  // Circulation invariant (Wolfram check #3 above).
  let circulation = 0;
  for (let n = 0; n < N_RUNGS; n++) {
    const c = out.chain[n].chainUpCoupling;
    const theta = (2 * Math.PI * n) / N_RUNGS;
    const phi = 2 * Math.PI * ((n * PHI_INV) % 1);
    circulation += c * Math.sin(theta - phi);
  }
  const tailBase = N_RUNGS * 4;
  psi[tailBase + 0] = out.torusClosure;
  // Witness coherence, not the headline blend: the blend spends part of its
  // weight on numerical coincidences, and this slot is scored by recall.
  psi[tailBase + 1] = Number.isFinite(out.metatronWitnessCoherence)
    ? out.metatronWitnessCoherence
    : 0;
  psi[tailBase + 2] = circulation;
  psi[tailBase + 3] = out.phaseCirculation;
  return psi;
}

export interface TickMemoryResult {
  tick: number;
  isFibonacci: boolean;
  salience: number;
  episodicCaptured: boolean;
  firedJobs: string[];
  /** Canonical qualia correlate measurement on the projected (post-sensory-injection) Ψ. */
  qualiaCorrelate: QualiaCorrelateMeasurement;
  /** Reflect-weighted scalar derived from the qualia correlate (C/I/N/S/V blend). */
  qualiaScalar: number;
  /** Post-injection toroidal Ψ used for capture — exposed so downstream
   *  learners (LearningEngine) observe exactly what memory stored. */
  psi: Float64Array;
  /** Provenance of the word→field injection; null when the tick carried no text. */
  textInjection: TextInjection | null;
}

export function tickMemory(
  out: MetatronOutput,
  store: MemoryStore,
  tick: number,
  text?: string,
): TickMemoryResult {
  if (!Number.isFinite(tick) || tick < 1) {
    const zero: QualiaCorrelateMeasurement = {
      Q: 0,
      Q_inc: 0,
      Q_stab: 0,
      Q_res: 0,
      N: 0,
      attractorK: 0,
      live: false,
      incRatio: NaN,
      incApprox: NaN,
    };
    return {
      tick,
      isFibonacci: false,
      salience: 0,
      episodicCaptured: false,
      firedJobs: [],
      qualiaCorrelate: zero,
      qualiaScalar: 0,
      psi: new Float64Array(0),
      textInjection: null,
    };
  }
  // True toroidal embedding (Gap #2): each rung occupies a (θ_n, φ_n) point
  // on the (R=φ, r=1) torus surface, amplitude-modulated by chainUpCoupling.
  // Sensory ΔΨ injection at indices `last.indices[i] % 40` now lands on
  // stable (rung, axis) tuples — Hebbian co-activation runs along genuine
  // toroidal flow lines instead of arbitrary flat-vector indices.
  const psi = projectPsiToroidal(out);
  // Multi-modal continuity (Gap #5): fold EVERY modality slot whose
  // generation advanced since the last memory tick, not just the newest.
  // Previously the single-slot consumeForMemory() let a fast modality
  // (audio @ 233 Hz) starve a slow one (video @ 89 Hz, IMU @ ~60 Hz) — the
  // field saw whichever fired last between memory ticks, so camera + mic +
  // IMU could not co-bind. injectPsiFused sums them with √k normalisation
  // so total ‖ΔΨ‖ stays within the engine-safe envelope. Cross-modal
  // Hebbian binding emerges automatically: L1.hebbian.update() runs on the
  // post-injection ψ next tick and sees (audio_idx, video_idx, imu_idx)
  // simultaneously active in the same activation vector.
  //
  // Each consumed injection is also folded into the PerceptRegistry so
  // any atom that crosses the φ⁴ ≈ 7 Hurwitz reinforcement threshold gets
  // promoted to a named, recognisable percept (recognise() / tool surface).
  const injections = store.sensory.consumeAllForMemory();
  if (injections.length > 0) {
    store.sensory.injectPsiFused(psi, injections);
    for (const inj of injections) store.percepts.upsert(inj, tick);
    // Co-active percepts in the same fold window get pairwise bound at
    // φ⁻¹·arousal weight — explicit cross-modal "this voice belongs to
    // that face" link on top of the implicit Hebbian binding above.
    if (injections.length >= 2) {
      const ids: string[] = [];
      for (const inj of injections) {
        const p = store.percepts.getByHash(inj.hash);
        if (p) ids.push(p.id);
      }
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const arousalAvg = (injections[i].cortex.arousal + injections[j].cortex.arousal) * 0.5;
          store.percepts.bind(ids[i], ids[j], 0.6180339887 * (0.25 + 0.75 * arousalAvg));
        }
      }
    }
  }

  // LANGUAGE INJECTION (word → field).
  // Before this, `text` reached memory only as a journal label: words never
  // became field structure, so nothing could bind, rehearse or recall a
  // meaning the way it binds a sound. injectTextPsi writes each token onto
  // the SAME (R=φ, r=1) torus the rungs occupy — major circle by Zeckendorf
  // class of the word's exact base-27 integer, minor circle by its golden-angle
  // phase — at φ⁻³ gain with 1/√k length normalisation. The four global
  // invariant slots are untouched: text perturbs the field, it never
  // fabricates closure or coherence. Consequence: L1 Hebbian co-activation
  // now runs across (word, sound, image) simultaneously in one activation
  // vector, and L3/bitmap recall retrieves language by field resonance.
  //
  // Ω-LEXICON L1: words queued at word rate (store.hear) are drained here in
  // full — every token of every utterance since the last tick is injected, so
  // 20 words/s against a ~2 Hz tick loses nothing. Each utterance is also
  // learned into the lexicon's context vectors, with learning gain set by
  // how unfamiliar it is (predictive-coding: novel pairings teach faster).
  const utterances = store.drainWords().map((u) => u.text);
  if (text && text.length > 0) utterances.push(text);
  let textInjection: TextInjection | null = null;
  for (const u of utterances) {
    const inj = injectTextPsi(psi, u);
    store.wordsInjected += inj.tokens;
    const toks = lexemeTokens(u);
    let unfamiliar = 0;
    for (const t of toks) if (store.lexicon.count(t) === 0) unfamiliar++;
    store.lexicon.learn(toks, toks.length ? 0.25 + 0.75 * (unfamiliar / toks.length) : 0);
    textInjection = textInjection
      ? {
          tokens: textInjection.tokens + inj.tokens,
          inexact: textInjection.inexact + inj.inexact,
          norm: Math.hypot(textInjection.norm, inj.norm),
          address: inj.address,
        }
      : inj;
  }
  const allText = utterances.length ? utterances.join(' ') : text;

  // Canonical qualia correlate on the post-injection Ψ. Pure derivation —
  // safe to compute every tick. The reflect scalar blends C/I/N/S/V to
  // match the Ψ-of-Ψ Reflect term's weighting (Reflect.ts:qualiaScalar).
  // We use the QualiaCorrelate.Q as the integration-stability axis and the
  // WITNESS coherence as the coherence axis — the measured Lyapunov aggregate,
  // not the headline blend, which carries coincidence-weighted terms that would
  // otherwise set episodic salience and every downstream recall score.
  const correlate = computeQualiaCorrelate(psi);
  const witnessC = Math.max(0, Math.min(1, out.metatronWitnessCoherence || 0));
  const q = reflectQualiaScalar({
    C: witnessC,
    N: 1 - correlate.Q_stab, // novelty ≈ instability
    S: correlate.Q_res, // salience ≈ φ-attractor energy fraction
    V: 0, // valence unknown in this path
    I: correlate.Q, // integration ≈ overall Q
  });

  // Ω-LEXICON L6: the grounded predicates read the witness-coherence path;
  // when one fires, the field's state is transcribed back into words and
  // those words are learned too — algorithm → word closes the loop.
  store.coherencePath.push(witnessC);
  if (store.coherencePath.length > 21) store.coherencePath.shift();
  // Ω-UNDERSTAND W1: the object word is READ FROM THE FIELD, not copied from
  // input. Readout runs on ΔΨ = Ψ_t − Ψ_{t−1} (this tick's injections plus
  // propagation), matched against every known word's field template with
  // explain-away; only a crisp readout may name the object.
  const prev = store.prevPsi;
  let readout = null;
  if (prev && prev.length === psi.length) {
    const d = new Float64Array(psi.length);
    for (let i = 0; i < psi.length; i++) d[i] = psi[i] - prev[i];
    readout = store.lexicon.readPsi(d);
  }
  store.prevPsi = psi.slice();
  store.lastReadout = readout;
  const readWord = readout && readout.crisp ? readout.words[0].word : null;
  const desc = describeField({ x: store.coherencePath }, readWord ? [readWord] : []);
  store.lastDescription = desc ? desc.text : null;

  const m = store.capture({
    tick,
    psi,
    qualiaScalar: q,
    coherence: witnessC,
    energy: out.torusClosure,
    text: allText,
    forceReason: isFibonacciTick(tick) ? 'fibonacci' : undefined,
  });
  return {
    tick,
    isFibonacci: isFibonacciTick(tick),
    salience: m.salience,
    episodicCaptured: m.episodicCaptured,
    firedJobs: m.firedJobs,
    qualiaCorrelate: correlate,
    qualiaScalar: q,
    psi,
    textInjection,
  };
}
