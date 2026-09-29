/**
 * SingleTorusEngine — the certified O-P1 trunk.
 *
 * Deterministic (Law L2): no RNG, no wall-clock, no hardware probe on the tick
 * path. Initial conditions come from a named seed through SplitMix64; every
 * tick appends to a digest chain; checkpoints every 144 ticks make rollback
 * exact.
 *
 * E10 tick order (fixed — reordering changes the digest and is a regression):
 *   1  stage inputs (Jacobi: everything reads pre-update state)
 *   2  modal analysis -> geometric drive G and phase term P
 *   3  resonance term R from memory
 *   4  closure target Pi + residual flux
 *   5  prediction zhat from the memory trace
 *   6  cell update (nine terms, phi^4 clamp)
 *   7  memory kernel
 *   8  measurement plane (coherence, state, corridor gate)
 *   9  transcription signature + digest link
 *  10  checkpoint at the 144-tick cadence
 */

import {
  CELL,
  CLAMP_MAX,
  CHECKPOINT_PERIOD,
  JURY_GAIN,
  LAMBDA_MEMORY,
  PHI,
  PHI_INV,
  SIGNATURE_MODES,
} from '../core/constants';
import { DigestChain, SeedStream } from '../core/determinism';
import {
  clampField,
  cloneField,
  copyField,
  createField,
  distance,
  isFiniteField,
  zeroField,
  type CField,
} from '../core/complex';
import { createLattice, type Lattice, type LatticeKind } from '../torus/lattice';
import {
  analyze,
  buildBasis,
  coeffBuffer,
  signature,
  synthesize,
  type ModeBasis,
} from '../torus/superposition';
import { cellStep, type CellTerms } from '../cell/update';
import { memoryStep } from '../cell/memory';
import { closureTarget } from '../cell/closure';
import { CoherenceMeter } from '../measure/coherence';
import { CorridorGate, readState, type GateReading, type FieldState } from '../measure/state';
import { TranscriptionTape } from '../measure/transcription';
import { dcos, dsin } from '../core/dmath';
import { NodeOrgans, type OrganOptions, type OrganReport } from '../cell/organs';
import {
  SensoryNodeArray,
  type SensoryNodeOptions,
  type SensoryNodeReport,
} from '../sense/nodeArray';

/** Local mirror of the sensory injection bound (Law L-S1) — φ. Declared here
 *  rather than imported from ../sense so the engine keeps zero dependency on
 *  the sensory plane; the G6 battery asserts the two values are identical. */
const SENSE_BOUND = PHI;

export interface EngineOptions {
  /** Nodes on the torus — must be Fibonacci (profile value). */
  readonly nodes: number;
  /** Ladder index of this rung (telemetry + closure walk). */
  readonly rung?: number;
  readonly seed?: string;
  readonly lattice?: LatticeKind;
  readonly modes?: number;
  readonly tapeCapacity?: number;
  /** Coherence delay override (tests use a short delay). */
  readonly coherenceDelay?: number;
  /**
   * S5 — effective memory kernel λ for this rung. The thermal operator may
   * only *shrink* λ (Law: temperature can decohere, never amplify), so any
   * value above LAMBDA_MEMORY is refused rather than silently clamped.
   * Defaults to LAMBDA_MEMORY, which is bit-identical to the S0 oracle.
   */
  readonly lambda?: number;
  /**
   * S5 — magnetic phase offset added to the modal phase rotation, radians.
   * 0 (the default) leaves the rotation exactly at 2πφ⁻¹.
   */
  readonly modePhase?: number;
  /**
   * Vacuum drive setpoint (max-norm the rung is held at), in [0, φ].
   *
   * The nine-term cell is a strict contraction (g = 0.7508 < 1) and every
   * internal term is proportional to z, so an *undriven* rung decays to the
   * origin geometrically — the field goes dark within a few hundred ticks.
   * That is correct dynamics, not a bug, but a live substrate must be driven.
   *
   * When > 0 the engine synthesises a deterministic golden-angle excitation
   * into the η·U slot with amplitude proportional to the shortfall
   * (setpoint − ‖z‖∞), so the rung settles at the setpoint and never above it.
   * 0 (the default) leaves the map exactly at the S0 oracle, bit-for-bit.
   */
  readonly drive?: number;
  /**
   * N0 — per-node organ bank (eigenmode residual, radial φ-ladder transform,
   * local superposition, per-node receptor). Absent means the rung carries no
   * organs at all and behaves exactly as before; present with radialGain 0
   * means the organs observe but never touch the dynamics, so the digest is
   * still bit-identical to the S0 oracle.
   */
  readonly organs?: OrganOptions;
  /**
   * N1 — the per-node sensory array. Every line convergence on the lattice
   * gets a receptor: φ-spaced spectral bands over a Fibonacci window,
   * instantaneous frequency, energy share and current divergence across the
   * four incident grid lines. It is a pure observer — it never touches the
   * dynamics, so a rung built with sensors digests bit-identically to one
   * built without. Absent means no array and no cost.
   */
  readonly sensors?: SensoryNodeOptions;
}

export interface TickReport {
  readonly tick: number;
  readonly coherence: number;
  readonly ignition: boolean;
  readonly coherenceWarm: boolean;
  readonly energy: number;
  readonly peak: number;
  readonly delta: number;
  readonly realizedGain: number;
  readonly clamped: number;
  readonly obstruction: number;
  readonly residualFlux: number;
  readonly regime: GateReading['regime'];
  readonly gateScale: number;
  /** Dimensionless phase-aligned closure defect in [0, 2] (gate input). */
  readonly closureDefect: number;
  /** Shift autocorrelation gamma in [0, 1]; 1 = exact toroidal closure. */
  readonly closureQuality: number;
  readonly skill: number;
  readonly digest: string;
  readonly checkpointed: boolean;
  readonly finite: boolean;
}

export interface Checkpoint {
  readonly tick: number;
  readonly z: CField;
  readonly m: CField;
  readonly digest: string;
  readonly chainLength: number;
}

export class SingleTorusEngine {
  readonly nodes: number;
  readonly rung: number;
  readonly lattice: Lattice;
  readonly basis: ModeBasis;
  /** Contraction certificate for the homogeneous cell. */
  readonly juryGain = JURY_GAIN;
  /** Effective memory kernel actually used by this rung (S5). */
  readonly lambda: number;
  /** Magnetic phase offset actually used by this rung, radians (S5). */
  readonly modePhase: number;
  /** Vacuum drive setpoint actually in force (0 = undriven / oracle exact). */
  readonly drive: number;
  /** N0 per-node organ bank, or null when this rung was built without organs. */
  readonly organs: NodeOrgans | null;
  /** N1 per-node sensory array, or null when this rung was built without one. */
  readonly sensors: SensoryNodeArray | null;

  /** Frozen cos/sin of the modal rotation — precomputed, never re-derived. */
  private readonly cth: number;
  private readonly sth: number;

  private readonly z: CField;
  private readonly zNext: CField;
  private readonly m: CField;
  private readonly G: CField;
  private readonly P: CField;
  private readonly R: CField;
  private readonly Pi: CField;
  private readonly zhat: CField;
  private readonly coeffs: Float64Array;
  private readonly sig: Float64Array;
  private readonly chain: DigestChain;
  private readonly meter: CoherenceMeter;
  private readonly gate = new CorridorGate();
  readonly tape: TranscriptionTape;

  private tick = 0;
  private lastCheckpoint: Checkpoint | null = null;
  private inputBuffer: CField | null = null;
  private webBuffer: CField | null = null;
  private senseBuffer: CField | null = null;
  /** Vacuum-drive staging buffer (allocated only when the drive is armed). */
  private driveBuffer: CField | null = null;

  constructor(opts: EngineOptions) {
    this.nodes = opts.nodes;
    this.rung = opts.rung ?? 1;
    const lambda = opts.lambda ?? LAMBDA_MEMORY;
    if (!(lambda > 0) || lambda > LAMBDA_MEMORY) {
      throw new RangeError(
        `SingleTorusEngine: lambda must be in (0, ${LAMBDA_MEMORY}] — the thermal operator may only shrink it; got ${lambda}`,
      );
    }
    const modePhase = opts.modePhase ?? 0;
    if (!Number.isFinite(modePhase)) {
      throw new RangeError(`SingleTorusEngine: modePhase must be finite, got ${modePhase}`);
    }
    const drive = opts.drive ?? 0;
    if (!Number.isFinite(drive) || drive < 0 || drive > PHI) {
      throw new RangeError(`SingleTorusEngine: drive must be in [0, ${PHI}], got ${drive}`);
    }
    this.lambda = lambda;
    this.modePhase = modePhase;
    this.drive = drive;

    const th = 2 * Math.PI * PHI_INV + modePhase;
    this.cth = dcos(th);
    this.sth = dsin(th);
    this.lattice = createLattice(opts.nodes, opts.lattice ?? 'fibonacci');
    this.basis = buildBasis(this.lattice, opts.modes ?? SIGNATURE_MODES);

    this.z = createField(this.nodes);
    this.zNext = createField(this.nodes);
    this.m = createField(this.nodes);
    this.G = createField(this.nodes);
    this.P = createField(this.nodes);
    this.R = createField(this.nodes);
    this.Pi = createField(this.nodes);
    this.zhat = createField(this.nodes);
    this.coeffs = coeffBuffer(this.basis);
    this.sig = new Float64Array(this.basis.vectors.length);

    this.organs = opts.organs
      ? new NodeOrgans(this.nodes, this.basis.vectors.length, { rung: this.rung, ...opts.organs })
      : null;
    this.sensors = opts.sensors ? new SensoryNodeArray(this.nodes, opts.sensors) : null;

    this.chain = new DigestChain(opts.seed ?? 'metatron-omega');
    this.meter = new CoherenceMeter(this.nodes, opts.coherenceDelay);
    this.tape = new TranscriptionTape(opts.tapeCapacity ?? 2584, this.basis.vectors.length);

    this.seedField(opts.seed ?? 'metatron-omega');
  }

  /** Deterministic initial condition — off the tick path (Law L2 compliant). */
  private seedField(seed: string): void {
    const rng = new SeedStream(seed);
    for (let i = 0; i < this.nodes; i++) {
      // unit-scale, phase-spread by the golden angle; amplitude from the stream
      const a = 0.5 * (0.5 + 0.5 * rng.next());
      const th = 2 * Math.PI * ((i * PHI_INV) % 1);
      this.z.re[i] = a * dcos(th);
      this.z.im[i] = a * dsin(th);
      this.m.re[i] = this.z.re[i];
      this.m.im[i] = this.z.im[i];
    }
  }

  /** Stage an external input U for the next tick (copied, not retained). */
  setInput(u: CField | null): void {
    if (!u) {
      this.inputBuffer = null;
      return;
    }
    if (!this.inputBuffer) this.inputBuffer = createField(this.nodes);
    zeroField(this.inputBuffer);
    const k = Math.min(this.nodes, u.n);
    for (let i = 0; i < k; i++) {
      this.inputBuffer.re[i] = u.re[i];
      this.inputBuffer.im[i] = u.im[i];
    }
  }

  /**
   * Stage a cross-rung web receipt V for the next tick (copied, not retained).
   * Zero-gated by default: with no receipt the term contributes exactly nothing,
   * so the single-torus digest chain is unchanged (Law: no silent regression).
   */
  setWebReceipt(v: CField | null): void {
    if (!v) {
      this.webBuffer = null;
      return;
    }
    if (!this.webBuffer) this.webBuffer = createField(this.nodes);
    zeroField(this.webBuffer);
    const k = Math.min(this.nodes, v.n);
    for (let i = 0; i < k; i++) {
      this.webBuffer.re[i] = v.re[i];
      this.webBuffer.im[i] = v.im[i];
    }
  }

  /**
   * Stage a sensory injection S for the next tick (copied, not retained).
   * Zero-gated exactly like the web receipt: with no sensory plane attached the
   * ξ-term contributes nothing and the digest chain is bit-identical to P5.
   * The φ bound is re-applied here, so no caller can inject past Law L-S1.
   */
  setSensory(s: CField | null): void {
    if (!s) {
      this.senseBuffer = null;
      return;
    }
    if (!this.senseBuffer) this.senseBuffer = createField(this.nodes);
    zeroField(this.senseBuffer);
    const k = Math.min(this.nodes, s.n);
    for (let i = 0; i < k; i++) {
      this.senseBuffer.re[i] = s.re[i];
      this.senseBuffer.im[i] = s.im[i];
    }
    if (this.organs) this.organs.applyReceptors(this.senseBuffer);
    clampField(this.senseBuffer, SENSE_BOUND);
    this.organs?.recordInjection(this.senseBuffer);
  }

  /**
   * Resolve the U slot for this tick: the staged external input, plus the
   * vacuum drive when it is armed and the rung sits below its setpoint.
   *
   * Deterministic (tick + node index only), allocation-free after the first
   * armed tick, and bounded by φ so Law L-S1 and the ISS certificate hold.
   */
  private resolveInput(): CField | null {
    if (this.drive <= 0) return this.inputBuffer;
    let peak = 0;
    for (let i = 0; i < this.nodes; i++) {
      const a = Math.sqrt(this.z.re[i] * this.z.re[i] + this.z.im[i] * this.z.im[i]);
      if (a > peak) peak = a;
    }
    const deficit = this.drive - peak;
    if (deficit <= 0) return this.inputBuffer;
    // Proportional lift: the shortfall is undone in one step through η,
    // capped at the φ⁴ clamp so a cold start cannot overshoot it.
    const amp = Math.min(CLAMP_MAX, deficit / CELL.eta);
    if (!this.driveBuffer) this.driveBuffer = createField(this.nodes);
    const d = this.driveBuffer;
    const turn = (this.tick * PHI_INV) % 1;
    for (let i = 0; i < this.nodes; i++) {
      const th = 2 * Math.PI * ((i * PHI_INV + turn) % 1);
      d.re[i] = amp * dcos(th);
      d.im[i] = amp * dsin(th);
    }
    const u = this.inputBuffer;
    if (u) {
      for (let i = 0; i < this.nodes; i++) {
        d.re[i] += u.re[i];
        d.im[i] += u.im[i];
      }
    }
    return d;
  }

  /** One deterministic tick in the fixed E10 order. */
  step(): TickReport {
    // 2 — modal analysis: G is the modal projection, P its phase-rotated dual.
    analyze(this.basis, this.z, this.coeffs);
    synthesize(this.basis, this.coeffs, this.G);
    const cth = this.cth;
    const sth = this.sth;
    for (let i = 0; i < this.nodes; i++) {
      this.P.re[i] = this.G.re[i] * cth - this.G.im[i] * sth;
      this.P.im[i] = this.G.re[i] * sth + this.G.im[i] * cth;
    }

    // 3 — resonance from the memory trace.
    for (let i = 0; i < this.nodes; i++) {
      this.R.re[i] = this.m.re[i];
      this.R.im[i] = this.m.im[i];
    }
    // N1 — fold the per-node radial reconstruction into the resonance slot.
    // Convex blend at gain 0 is exactly the identity (oracle-safe).
    this.organs?.applyRadial(this.R);

    // 4 — closure target + residual flux.
    const closure = closureTarget(this.z, this.Pi, this.tick, this.rung);

    // 5 — prediction: memory extrapolated one step along the trace.
    for (let i = 0; i < this.nodes; i++) {
      this.zhat.re[i] = this.m.re[i] + (this.m.re[i] - this.z.re[i]) * PHI_INV;
      this.zhat.im[i] = this.m.im[i] + (this.m.im[i] - this.z.im[i]) * PHI_INV;
    }

    // 6 — the cell.
    const terms: CellTerms = {
      G: this.G,
      P: this.P,
      R: this.R,
      Pi: this.Pi,
      zhat: this.zhat,
      U: this.resolveInput(),
      V: this.webBuffer,
      S: this.senseBuffer,
    };
    const cell = cellStep(this.z, this.zNext, terms);
    const finite = isFiniteField(this.zNext);
    if (!finite) {
      // rollback rather than propagate NaN
      const cp = this.lastCheckpoint;
      if (cp) this.restore(cp);
      return {
        tick: this.tick,
        coherence: 0,
        ignition: false,
        coherenceWarm: false,
        energy: 0,
        peak: 0,
        delta: 0,
        realizedGain: 0,
        clamped: cell.clamped,
        obstruction: closure.obstruction,
        residualFlux: closure.residualFlux,
        regime: 'CRITICAL',
        gateScale: 0,
        closureDefect: closure.defect,
        closureQuality: closure.closure,
        skill: 0,
        digest: this.chain.head(),
        checkpointed: false,
        finite: false,
      };
    }
    const delta = distance(this.zNext, this.z);
    copyField(this.z, this.zNext);

    // 7 — memory kernel.
    memoryStep(this.m, this.z, this.lambda);

    // 8 — measurement (read-only).
    const coh = this.meter.push(this.z);
    const st: FieldState = readState(this.z);
    // The gate reads the phase-aligned closure defect, never the extensive
    // obstruction — see closure.ts for why the two are not interchangeable.
    const gate = this.gate.read(closure.defect);

    // 9 — signature + digest chain.
    analyze(this.basis, this.z, this.coeffs);
    signature(this.basis, this.coeffs, this.sig);
    // N0 — organs read the post-update field and the decomposition the engine
    // already computed; they never re-run the modal analysis.
    this.organs?.update(this.z, this.basis, this.coeffs);
    // N1 — the sensory array reads the same post-update field. Observation
    // only: it contributes nothing to the digest below.
    this.sensors?.update(this.z, this.lattice);
    const digest = this.chain.link(this.z.re, this.z.im, this.sig);
    this.tape.write(this.tick, this.sig, digest);

    // 10 — checkpoint cadence.
    this.tick++;
    const checkpointed = this.tick % CHECKPOINT_PERIOD === 0;
    if (checkpointed) {
      this.lastCheckpoint = {
        tick: this.tick,
        z: cloneField(this.z),
        m: cloneField(this.m),
        digest,
        chainLength: this.chain.length(),
      };
    }

    return {
      tick: this.tick,
      coherence: coh.c,
      ignition: coh.ignition,
      coherenceWarm: coh.warm,
      energy: st.energy,
      peak: st.peak,
      delta,
      realizedGain: cell.realizedGain,
      clamped: cell.clamped,
      obstruction: closure.obstruction,
      residualFlux: closure.residualFlux,
      regime: gate.regime,
      gateScale: gate.scale,
      closureDefect: closure.defect,
      closureQuality: closure.closure,
      skill: gate.skill,
      digest,
      checkpointed,
      finite: true,
    };
  }

  run(ticks: number): TickReport {
    let last = this.step();
    for (let i = 1; i < ticks; i++) last = this.step();
    return last;
  }

  /** Immutable read of the live field (copy — never hand out the buffers). */
  snapshot(): { tick: number; z: CField; m: CField; signature: Float64Array; digest: string } {
    return {
      tick: this.tick,
      z: cloneField(this.z),
      m: cloneField(this.m),
      signature: Float64Array.from(this.sig),
      digest: this.chain.head(),
    };
  }

  checkpoint(): Checkpoint {
    return {
      tick: this.tick,
      z: cloneField(this.z),
      m: cloneField(this.m),
      digest: this.chain.head(),
      chainLength: this.chain.length(),
    };
  }

  restore(cp: Checkpoint): void {
    copyField(this.z, cp.z);
    copyField(this.m, cp.m);
    this.tick = cp.tick;
    this.chain.restore(cp.digest, cp.chainLength);
    this.meter.reset();
    this.gate.reset();
    this.sensors?.reset();
  }

  /** Latest per-node organ readout, or null when the rung has no organs. */
  organReport(): OrganReport | null {
    return this.organs ? this.organs.report() : null;
  }

  /** Latest per-node sensory readout, or null when the rung has no array. */
  sensorReport(): SensoryNodeReport | null {
    return this.sensors ? this.sensors.report() : null;
  }

  currentTick(): number {
    return this.tick;
  }

  digest(): string {
    return this.chain.head();
  }
}
