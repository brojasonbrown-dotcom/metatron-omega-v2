/**
 * MultiTorusEngine — the web over the dense core (Ω-P3).
 *
 * One SingleTorusEngine per stable rung, coupled by a row-stochastic channel
 * matrix, exchanged Jacobi-staged (every rung reads pre-update state), with a
 * double-entry flux ledger and an ordering monitor that both report measured
 * numbers rather than assertions.
 *
 * Web tick order (fixed — reordering changes the digest and is a regression):
 *   W1 stage   — snapshot every rung's pre-update field into the exchange pool
 *   W2 exchange— octave-transport + coupling-weight each receipt, post flux
 *   W3 update  — step each due rung (multi-rate clocks) with its V receipt
 *   W4 measure — collect per-rung reports
 *   W5 commit  — link the web digest, advance the web tick
 */

import { DENSE_CORE, type Rung } from '../core/scaleLadder';
import { createField, zeroField, type CField } from '../core/complex';
import { DigestChain } from '../core/determinism';
import { SingleTorusEngine, type TickReport } from './SingleTorusEngine';
import { buildCoupling, couplingWeight, type CouplingMatrix } from '../web/coupling';
import { OctaveScratch, octaveTransport } from '../web/octave';
import { FluxLedger } from '../web/fluxLedger';
import { OrderingMonitor, fibonacciStrides } from '../web/ordering';
import type { SensoryPlane } from '../sense/plane';
import type { LadderWindow } from '../core/window';
import type { OrganOptions } from '../cell/organs';
import type { ChordKind } from '../web/coupling';
import { TuringTape, type TapeStep, type TuringTapeOptions } from '../memory/turingTape';
import type { SensoryNodeOptions } from '../sense/nodeArray';

export interface MultiTorusOptions {
  /** Rungs to instantiate; defaults to the 18-rung dense core. */
  readonly rungs?: readonly Rung[];
  /** Nodes per rung. A number applies to all; a function lets rungs differ. */
  readonly nodes?: number | ((rung: Rung, rank: number) => number);
  readonly seed?: string;
  readonly couplingBand?: number;
  readonly clock?: 'uniform' | 'fibonacci';
  readonly ledgerCap?: number;
  readonly coherenceDelay?: number;
  readonly modes?: number;
  /** Transcription tape depth per rung; defaults to the engine's own default. */
  readonly tapeCapacity?: number;
  /**
   * S5 — a Fibonacci ladder window. When given it is the single source of
   * truth for per-rung node counts, coherence delay τ, thermal λ and magnetic
   * phase B; explicit `nodes`/`coherenceDelay` options are then refused rather
   * than silently overridden. An inert window (T = 0, B = 0, uniform clock)
   * reproduces the S0 oracle bit-for-bit.
   */
  readonly window?: LadderWindow;
  /**
   * Vacuum drive setpoint handed to every rung (max-norm, [0, φ]).
   * 0 (the default) leaves every rung undriven and oracle-exact; the cell is a
   * strict contraction, so an undriven web decays to the origin by design.
   */
  readonly drive?: number;
  /**
   * N0 — per-node organ bank options handed to every rung. Absent means no
   * rung carries organs (pre-N0 behaviour, oracle exact).
   */
  readonly organs?: OrganOptions;
  /**
   * N1 — per-node sensory array on every rung. Absent means no rung carries
   * one (pre-N1 behaviour, oracle exact).
   */
  readonly sensors?: SensoryNodeOptions;
  /** N3 — long-range stable-ratio chords across the ladder. */
  readonly chords?: ChordKind[];
  /** N3 — chord strength in [0, 1]. */
  readonly chordGain?: number;
  /**
   * N4 — the permanent processing tape. When given, one Zeckendorf-addressed
   * read/write tape advances once per web tick against rank 0's field. Absent
   * means no tape and no cost.
   */
  readonly tape?: TuringTapeOptions;
}

export interface WebTickReport {
  readonly tick: number;
  /** Per-rung reports; a rung not due on this tick reports its previous value. */
  readonly rungs: readonly TickReport[];
  /** Ranks actually stepped on this tick. */
  readonly stepped: readonly number[];
  /**
   * Mean coherence across stepped rungs, including rungs whose coherence ring
   * has not filled yet (those report 0). Kept for digest/oracle continuity —
   * for a reading you can show a human, use `coherenceWarm`.
   */
  readonly coherence: number;
  /**
   * Mean coherence across stepped rungs that are WARM (ring filled, so the
   * meter has real history behind it). NaN when no stepped rung is warm —
   * "not measured yet" is a distinct state from "coherence is zero".
   */
  readonly coherenceWarm: number;
  /** Stepped rungs whose coherence meter is warm. */
  readonly warmRungs: number;
  /** Rungs of the whole ladder whose coherence meter is warm. */
  readonly warmRungsTotal: number;

  /** Total receipt mass moved this tick. */
  readonly fluxMoved: number;
  /** Ledger imbalance (structurally 0). */
  readonly fluxImbalance: number;
  /** Cumulative ordering violations (structurally 0). */
  readonly orderingViolations: number;
  /** Max |rowSum - 1| of the channel matrix. */
  readonly rowSumDefect: number;
  /** Worst octave energy ratio observed this tick. */
  readonly worstEnergyRatio: number;
  readonly digest: string;
  readonly finite: boolean;
}

export class MultiTorusEngine {
  readonly rungs: readonly Rung[];
  readonly engines: readonly SingleTorusEngine[];
  readonly coupling: CouplingMatrix;
  readonly ledger: FluxLedger;
  readonly ordering = new OrderingMonitor();

  private readonly strides: Int32Array;
  private readonly staged: CField[];
  private readonly receipts: CField[];
  private readonly scratch = new OctaveScratch();
  private readonly chain: DigestChain;
  private readonly last: TickReport[];
  private webTick = 0;
  private sensory: SensoryPlane | null = null;
  /** N4 — permanent tape, or null when the web was built without one. */
  readonly tape: TuringTape | null;
  private lastTapeStep: TapeStep | null = null;

  /** The window this web was built from, when one was supplied (S5). */
  readonly window: LadderWindow | null;

  constructor(opts: MultiTorusOptions = {}) {
    const win = opts.window ?? null;
    if (win) {
      if (opts.nodes !== undefined) {
        throw new Error(
          'MultiTorusEngine: `nodes` conflicts with `window` — the window owns node counts',
        );
      }
      if (opts.coherenceDelay !== undefined) {
        throw new Error(
          'MultiTorusEngine: `coherenceDelay` conflicts with `window` — the window owns τ',
        );
      }
      if (opts.rungs && opts.rungs.length !== win.rungs.length) {
        throw new Error(
          `MultiTorusEngine: window has ${win.rungs.length} rungs but ${opts.rungs.length} were supplied`,
        );
      }
    }
    this.window = win;
    this.rungs = opts.rungs ?? (win ? win.rungs.map((w) => w.rung) : DENSE_CORE);
    const nodesOf =
      typeof opts.nodes === 'function'
        ? opts.nodes
        : () => (typeof opts.nodes === 'number' ? opts.nodes : 144);
    const seed = opts.seed ?? 'metatron-omega-web';

    this.engines = this.rungs.map((r, rank) => {
      const w = win ? win.rungs[rank] : null;
      return new SingleTorusEngine({
        nodes: w ? w.nodes : nodesOf(r, rank),
        rung: r.n,
        seed: `${seed}:${r.n}`,
        modes: opts.modes,
        coherenceDelay: w ? w.coherenceDelay : opts.coherenceDelay,
        tapeCapacity: opts.tapeCapacity,
        lambda: w ? w.lambda : undefined,
        modePhase: w ? w.magneticPhase : undefined,
        drive: opts.drive,
        organs: opts.organs,
        sensors: opts.sensors,
      });
    });

    this.coupling = buildCoupling(this.rungs, {
      band: opts.couplingBand ?? 3,
      chords: opts.chords,
      chordGain: opts.chordGain,
    });
    this.tape = opts.tape ? new TuringTape(opts.tape) : null;
    this.ledger = new FluxLedger(opts.ledgerCap ?? 4096);
    this.strides = fibonacciStrides(this.rungs.length, opts.clock ?? 'uniform');
    this.staged = this.engines.map((e) => createField(e.nodes));
    this.receipts = this.engines.map((e) => createField(e.nodes));
    this.chain = new DigestChain(`${seed}:web`);
    this.last = this.engines.map(() => null as unknown as TickReport);
  }

  /**
   * Attach (or detach) a sensory plane. When attached, the plane is resolved
   * once per web tick during the stage phase — before any rung updates — so
   * every rung reads the same sensory instant (Jacobi discipline, Law W1).
   */
  attachSensory(plane: SensoryPlane | null): void {
    if (plane && plane.nodes.length !== this.rungs.length) {
      throw new Error('MultiTorusEngine: sensory plane rung count must match the ladder');
    }
    this.sensory = plane;
    if (!plane) for (const e of this.engines) e.setSensory(null);
  }

  sensoryPlane(): SensoryPlane | null {
    return this.sensory;
  }

  /** Rungs due to step on a given web tick (multi-rate clocks). */
  private due(tick: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.strides.length; i++) if (tick % this.strides[i] === 0) out.push(i);
    return out;
  }

  step(): WebTickReport {
    const size = this.rungs.length;
    const t = this.webTick;
    this.ordering.beginTick(t);

    // W1 — stage pre-update state.
    this.ordering.enterPhase('stage');
    for (let i = 0; i < size; i++) {
      const snap = this.engines[i].snapshot();
      this.staged[i].re.set(snap.z.re);
      this.staged[i].im.set(snap.z.im);
      zeroField(this.receipts[i]);
    }

    // W1b — resolve the sensory plane on the staged instant.
    if (this.sensory) {
      const { fields } = this.sensory.resolve();
      for (let i = 0; i < size; i++) this.engines[i].setSensory(fields[i] ?? null);
    }

    // W2 — exchange.
    this.ordering.enterPhase('exchange');
    let moved = 0;
    let worstRatio = 1;
    for (let i = 0; i < size; i++) {
      const dst = this.receipts[i];
      for (let j = 0; j < size; j++) {
        if (j === i) continue;
        const wgt = couplingWeight(this.coupling, i, j);
        if (wgt === 0) continue;
        this.ordering.read(j);
        const src = this.staged[j];
        let carrier = src;
        if (src.n !== dst.n) {
          carrier = this.scratch.get(dst.n);
          const rep = octaveTransport(src, carrier);
          const ratio = rep.energyRatio;
          if (Number.isFinite(ratio) && Math.abs(ratio - 1) > Math.abs(worstRatio - 1))
            worstRatio = ratio;
        }
        let mass = 0;
        for (let k = 0; k < dst.n; k++) {
          const re = wgt * carrier.re[k];
          const im = wgt * carrier.im[k];
          dst.re[k] += re;
          dst.im[k] += im;
          mass += re * re + im * im;
        }
        mass = Math.sqrt(mass);
        this.ledger.post(t, j, i, mass);
        moved += mass;
      }
    }

    // W3 — update.
    this.ordering.enterPhase('update');
    const stepped = this.due(t);
    let cohSum = 0;
    let warmSum = 0;
    let warmCount = 0;
    let finite = true;
    for (const i of stepped) {
      this.engines[i].setWebReceipt(this.receipts[i]);
      const rep = this.engines[i].step();
      this.last[i] = rep;
      this.ordering.write(i);
      cohSum += rep.coherence;
      if (rep.coherenceWarm) {
        warmSum += rep.coherence;
        warmCount++;
      }
      if (!rep.finite) finite = false;
      // unabsorbed closure residue is real mass — it goes to the sink, not nowhere
      if (rep.residualFlux > 0) this.ledger.postToSink(t, i, Math.sqrt(rep.residualFlux));
    }

    // W3b — the permanent tape advances on the post-update field of rank 0.
    // It is a store, not a drive: nothing here feeds back into the cell, so
    // the rung digests are untouched by its presence.
    if (this.tape) this.lastTapeStep = this.tape.advance(this.engines[0].snapshot().z);

    // W4 — measure.
    this.ordering.enterPhase('measure');
    const coherence = stepped.length > 0 ? cohSum / stepped.length : 0;
    // Warm-only mean: a rung whose ring has not filled reports 0, and folding
    // that 0 into the headline reading understates the measured field. NaN is
    // the honest value when nothing is warm yet.
    const coherenceWarm = warmCount > 0 ? warmSum / warmCount : NaN;
    let warmRungsTotal = 0;
    for (const r of this.last) if (r?.coherenceWarm) warmRungsTotal++;

    // W5 — commit.
    this.ordering.enterPhase('commit');
    const link = new Float64Array(size * 2);
    for (let i = 0; i < size; i++) {
      const r = this.last[i];
      link[i * 2] = r ? r.coherence : 0;
      link[i * 2 + 1] = r ? r.energy : 0;
    }
    const digest = this.chain.link(link, link, link);
    this.webTick++;

    return {
      tick: t,
      rungs: this.last.slice(),
      stepped,
      coherence,
      coherenceWarm,
      warmRungs: warmCount,
      warmRungsTotal,
      fluxMoved: moved,
      fluxImbalance: this.ledger.imbalance(),
      orderingViolations: this.ordering.count(),
      rowSumDefect: this.coupling.rowSumDefect,
      worstEnergyRatio: worstRatio,
      digest,
      finite,
    };
  }

  run(ticks: number): WebTickReport {
    let last = this.step();
    for (let i = 1; i < ticks; i++) last = this.step();
    return last;
  }

  /** Clock stride per rank (multi-rate); a copy, the engine keeps its own. */
  clockStrides(): number[] {
    return Array.from(this.strides);
  }

  /** Latest tape step, or null when there is no tape / it has not run. */
  tapeStep(): TapeStep | null {
    return this.lastTapeStep;
  }

  currentTick(): number {
    return this.webTick;
  }

  digest(): string {
    return this.chain.head();
  }

  /**
   * Full web checkpoint: every rung's cell state plus the web's own tick
   * counter and digest chain head. Restoring only the rungs is NOT exact —
   * the web chain would keep counting — so both live in the same record.
   */
  checkpoint(): WebCheckpoint {
    return {
      tick: this.webTick,
      rungs: this.engines.map((e) => e.checkpoint()),
      digest: this.chain.head(),
      chainLength: this.chain.length(),
      last: this.last.slice(),
    };
  }

  restore(cp: WebCheckpoint): void {
    this.engines.forEach((e, i) => {
      const s = cp.rungs[i];
      if (s) e.restore(s);
    });
    this.webTick = cp.tick;
    this.chain.restore(cp.digest, cp.chainLength);
    for (let i = 0; i < this.last.length; i++) this.last[i] = cp.last[i];
    // staged receipts are rebuilt from scratch on the next W1/W2 pass; the
    // monitors are cumulative telemetry, so they are rewound with the tick.
    for (const f of this.receipts) zeroField(f);
    for (const e of this.engines) e.setWebReceipt(null);
    this.ordering.reset();
    this.ledger.reset();
  }
}

export interface WebCheckpoint {
  readonly tick: number;
  readonly rungs: readonly ReturnType<SingleTorusEngine['checkpoint']>[];
  readonly digest: string;
  readonly chainLength: number;
  readonly last: readonly TickReport[];
}
