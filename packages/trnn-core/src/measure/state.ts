/**
 * Field state readouts + corridor gate (BRAINMAP 2.6).
 * Read-only: the gate returns a scale, the engine decides what to do with it.
 */

import { CORRIDOR } from '../core/constants';
import { energy, maxNorm, type CField } from '../core/complex';

export type Regime = 'STABLE' | 'STRESS' | 'CRITICAL';

export interface FieldState {
  readonly energy: number;
  readonly peak: number;
  readonly meanMagnitude: number;
}

export function readState(psi: CField): FieldState {
  let s = 0;
  for (let i = 0; i < psi.n; i++) s += Math.sqrt(psi.re[i] * psi.re[i] + psi.im[i] * psi.im[i]);
  return { energy: energy(psi), peak: maxNorm(psi), meanMagnitude: psi.n > 0 ? s / psi.n : 0 };
}

export interface GateReading {
  readonly skill: number;
  readonly regime: Regime;
  readonly scale: number;
}

/**
 * Corridor gate with phi^-8 hysteresis.
 *
 * `error` MUST be a dimensionless, scale-free defect — the phase-aligned
 * closure defect from `closureTarget` (range [0, 2]). Feeding it an extensive
 * quantity such as the raw obstruction makes skill fall as the field grows or
 * as nodes are added, which reads every healthy rung as CRITICAL.
 *
 * skill = 1/(1+err); regimes at phi^-1 (STABLE) and 0.7*phi^-1 (STRESS).
 * defect 0 -> skill 1 (exact closure); defect sqrt(2) -> 0.414 (decorrelated,
 * STRESS/CRITICAL boundary); defect 2 -> 0.333 (phase reversal, CRITICAL).
 */
export class CorridorGate {
  private regime: Regime = 'STABLE';

  reset(): void {
    this.regime = 'STABLE';
  }

  read(error: number): GateReading {
    const skill = 1 / (1 + Math.abs(error));

    const h = CORRIDOR.hysteresis;
    const up = this.regime === 'STABLE' ? 0 : h;
    let next: Regime;
    if (skill >= CORRIDOR.stable + up) next = 'STABLE';
    else if (skill >= CORRIDOR.stress + up) next = 'STRESS';
    else next = 'CRITICAL';
    this.regime = next;
    const scale = next === 'STABLE' ? CORRIDOR.gateScales[0] : next === 'STRESS' ? CORRIDOR.gateScales[1] : CORRIDOR.gateScales[2];
    return { skill, regime: next, scale };
  }
}
