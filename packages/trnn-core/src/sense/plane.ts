/**
 * Ω-P6 — the sensory plane.
 *
 * One object owns every live channel, fuses them, transports the fused field
 * onto each rung's lattice and hands the result to the engine as the ξ-term S.
 *
 * Two laws are enforced here and measured on every resolve:
 *
 *   L-S1  injection bound     ‖S‖_inf ≤ φ on every rung
 *   L-S2  actuator loop gain  ≤ φ⁻²
 *
 * L-S2 is the one that keeps the sensory path from turning the certified
 * contraction into a resonator. The cell's sensory coefficient is ξ = φ⁻⁵, so
 * the closed-loop contribution of an actuator that re-reads the field it just
 * drove is bounded by ξ·loopGain·‖z‖; with loopGain ≤ φ⁻² that is φ⁻⁷ per tick,
 * two orders below the Jury slack (1 − 0.7508 = 0.2492). The plane refuses any
 * gain above the bound rather than silently clipping the field later.
 *
 * Rung falloff: rung r receives the fused field scaled by φ^(−r/2). Sensory
 * energy is a local event, so it should not arrive at every scale with equal
 * authority; the √φ ladder matches the ladder's own τ spacing.
 */

import { PHI, phiPow } from '../core/constants';
import { createField, maxNorm, zeroField, type CField } from '../core/complex';
import { octaveTransport } from '../web/octave';
import { boundField, SENSE_BOUND, type Modality } from './encode';
import { fuseChannels, type FusionInput, type FusionReport } from './fusion';
import { dpow } from '../core/dmath';

/** [DEFINED] hard ceiling on the sensory actuator loop gain (Law L-S2). */
export const MAX_LOOP_GAIN = phiPow(-2);

export interface ChannelSpec {
  readonly id: string;
  readonly modality: Modality;
  readonly nodes: number;
  readonly gain?: number;
}

export interface RungInjection {
  readonly rank: number;
  readonly nodes: number;
  readonly peak: number;
  readonly energy: number;
  /** Energy ratio reported by the octave transport onto this rung. */
  readonly transportRatio: number;
  readonly falloff: number;
}

export interface SensePlaneReport {
  readonly revision: number;
  readonly channels: number;
  readonly loopGain: number;
  readonly fusion: FusionReport;
  readonly rungs: readonly RungInjection[];
  readonly maxPeak: number;
  readonly withinBound: boolean;
}

interface Channel {
  readonly spec: ChannelSpec;
  readonly field: CField;
  live: boolean;
  updatedAt: number;
}

export class SensoryPlane {
  /** Node count of each rung, in rank order. */
  readonly nodes: readonly number[];
  /** Fusion lattice — the widest rung, so no channel is decimated before fusion. */
  readonly fuseNodes: number;

  private readonly channels = new Map<string, Channel>();
  private readonly fused: CField;
  private readonly staged: CField[];
  private readonly transportRatio: Float64Array;
  private loopGain = MAX_LOOP_GAIN;
  private revision = 0;
  private lastReport: SensePlaneReport;

  constructor(nodes: readonly number[], opts: { loopGain?: number } = {}) {
    this.nodes = nodes.slice();
    this.fuseNodes = nodes.length > 0 ? Math.max(...nodes) : 0;
    this.fused = createField(Math.max(1, this.fuseNodes));
    this.staged = this.nodes.map((n) => createField(n));
    this.transportRatio = new Float64Array(this.nodes.length).fill(1);
    if (opts.loopGain !== undefined) this.setLoopGain(opts.loopGain);
    this.lastReport = this.emptyReport();
  }

  private emptyReport(): SensePlaneReport {
    return {
      revision: this.revision,
      channels: 0,
      loopGain: this.loopGain,
      fusion: {
        channels: [],
        count: 0,
        weight: 0,
        rawPeak: 0,
        peak: 0,
        scale: 1,
        energy: 0,
        withinBound: true,
      },
      rungs: this.nodes.map((n, rank) => ({
        rank,
        nodes: n,
        peak: 0,
        energy: 0,
        transportRatio: 1,
        falloff: this.falloff(rank),
      })),
      maxPeak: 0,
      withinBound: true,
    };
  }

  /** φ^(−rank/2) — the ladder-matched sensory falloff. */
  falloff(rank: number): number {
    return dpow(PHI, -rank / 2);
  }

  /** Set the actuator loop gain. Values above φ⁻² are rejected (Law L-S2). */
  setLoopGain(g: number): number {
    if (!Number.isFinite(g) || g < 0)
      throw new Error('SensoryPlane: loop gain must be finite and ≥ 0');
    if (g > MAX_LOOP_GAIN + 1e-15) {
      throw new Error(
        `SensoryPlane: loop gain ${g} exceeds the certified bound φ⁻² = ${MAX_LOOP_GAIN}`,
      );
    }
    this.loopGain = g;
    this.revision++;
    return this.loopGain;
  }

  currentLoopGain(): number {
    return this.loopGain;
  }

  /** Register (or re-register) a channel. Existing data for the id is dropped. */
  declare(spec: ChannelSpec): void {
    if (spec.nodes <= 0) throw new Error('SensoryPlane: channel nodes must be > 0');
    this.channels.set(spec.id, {
      spec,
      field: createField(spec.nodes),
      live: false,
      updatedAt: -1,
    });
    this.revision++;
  }

  has(id: string): boolean {
    return this.channels.has(id);
  }

  channelIds(): string[] {
    return [...this.channels.keys()].sort();
  }

  /**
   * Push encoded data into a channel. The field is copied (never retained) and
   * re-bounded defensively, so a caller that hand-builds a field cannot break
   * L-S1 by skipping the encoder.
   */
  push(id: string, field: CField, tick: number): void {
    const ch = this.channels.get(id);
    if (!ch) throw new Error(`SensoryPlane: unknown channel "${id}"`);
    zeroField(ch.field);
    const n = Math.min(ch.field.n, field.n);
    for (let i = 0; i < n; i++) {
      ch.field.re[i] = field.re[i];
      ch.field.im[i] = field.im[i];
    }
    boundField(ch.field, SENSE_BOUND);
    ch.live = true;
    ch.updatedAt = tick;
    this.revision++;
  }

  /** Silence a channel without unregistering it. */
  mute(id: string): void {
    const ch = this.channels.get(id);
    if (!ch) return;
    zeroField(ch.field);
    ch.live = false;
    this.revision++;
  }

  clear(): void {
    for (const ch of this.channels.values()) {
      zeroField(ch.field);
      ch.live = false;
    }
    zeroField(this.fused);
    for (const s of this.staged) zeroField(s);
    this.revision++;
    this.lastReport = this.emptyReport();
  }

  /**
   * Fuse + transport. Returns the per-rung injections in rank order; the
   * returned fields are plane-owned buffers, valid until the next resolve.
   */
  resolve(): { fields: readonly CField[]; report: SensePlaneReport } {
    const inputs: FusionInput[] = [];
    for (const ch of this.channels.values()) {
      if (!ch.live) continue;
      inputs.push({ id: ch.spec.id, field: ch.field, gain: ch.spec.gain ?? 1 });
    }
    const fusion = fuseChannels(inputs, this.fused, SENSE_BOUND);

    const rungs: RungInjection[] = [];
    let maxPeak = 0;
    for (let rank = 0; rank < this.staged.length; rank++) {
      const dst = this.staged[rank];
      if (fusion.count === 0) {
        zeroField(dst);
        this.transportRatio[rank] = 1;
        rungs.push({
          rank,
          nodes: dst.n,
          peak: 0,
          energy: 0,
          transportRatio: 1,
          falloff: this.falloff(rank),
        });
        continue;
      }
      const rep = octaveTransport(this.fused, dst);
      this.transportRatio[rank] = rep.energyRatio;
      const k = this.loopGain * this.falloff(rank);
      let energy = 0;
      let peak = 0;
      for (let i = 0; i < dst.n; i++) {
        dst.re[i] *= k;
        dst.im[i] *= k;
        const e = dst.re[i] * dst.re[i] + dst.im[i] * dst.im[i];
        energy += e;
        const a = Math.sqrt(e);
        if (a > peak) peak = a;
      }
      // defence in depth — scaling down can never break the bound, but the
      // assertion is what makes L-S1 measured rather than assumed.
      boundField(dst, SENSE_BOUND);
      if (peak > maxPeak) maxPeak = peak;
      rungs.push({
        rank,
        nodes: dst.n,
        peak,
        energy,
        transportRatio: rep.energyRatio,
        falloff: this.falloff(rank),
      });
    }

    this.lastReport = {
      revision: this.revision,
      channels: fusion.count,
      loopGain: this.loopGain,
      fusion,
      rungs,
      maxPeak,
      withinBound:
        maxPeak <= SENSE_BOUND + 1e-12 && rungs.every((r) => r.peak <= SENSE_BOUND + 1e-12),
    };
    return { fields: this.staged, report: this.lastReport };
  }

  report(): SensePlaneReport {
    return this.lastReport;
  }

  /** Peak of the fused (pre-transport) field — telemetry only. */
  fusedPeak(): number {
    return maxNorm(this.fused);
  }
}
