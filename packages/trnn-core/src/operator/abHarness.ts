/**
 * Ω-OPERATOR N6 — A/B measurement, not belief.
 *
 * Every phase of this layer claims to beat something that already exists. This
 * harness makes each claim falsifiable by running both paths over the same
 * recorded field tape and reporting numbers:
 *
 *   A1  derivative:  finite-difference / graph stencil  vs  spectral ∂ = ik·û
 *   A2  transfer:    index (nearest-node) resampling    vs  spectral resampling
 *   A3  error metric: L² alone                          vs  H¹ discrimination
 *
 * A phase that does not win here stays flagged off, and that is a valid
 * outcome — the point of the harness is that the answer is measured.
 */

import type { CField } from '../core/complex';
import { derivative } from './fourierDiff';
import { resample } from './resample';
import { gradedError, l2 } from './sobolev';

export interface ABVerdict {
  readonly name: string;
  readonly legacy: number;
  readonly operator: number;
  /** legacy / operator — greater than 1 means the operator path is better. */
  readonly improvement: number;
  readonly wins: boolean;
}

/** Central second-order finite difference on the ring — the legacy stencil. */
export function finiteDifference(f: CField): CField {
  const n = f.n;
  const h = (2 * Math.PI) / n;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = (i + 1) % n;
    const m = (i - 1 + n) % n;
    re[i] = (f.re[p] - f.re[m]) / (2 * h);
    im[i] = (f.im[p] - f.im[m]) / (2 * h);
  }
  return { re, im, n };
}

/** Nearest-index resampling — what fractal nesting does today. */
export function indexResample(f: CField, m: number): CField {
  const re = new Float64Array(m);
  const im = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    const src = Math.min(f.n - 1, Math.round((j * f.n) / m));
    re[j] = f.re[src];
    im[j] = f.im[src];
  }
  return { re, im, n: m };
}

/** A1 — derivative accuracy against the analytic truth. */
export function abDerivative(f: CField, truth: CField): ABVerdict {
  const legacy = l2(finiteDifference(f), truth);
  const op = l2(derivative(f, 1), truth);
  return verdict('derivative', legacy, op);
}

/**
 * A2 — round-trip transfer fidelity through a **narrower** rung.
 *
 * The narrow direction is the only honest one: going up first and coming back
 * down is a trivial identity for nearest-index sampling too, which would make
 * the comparison meaningless. Descending to a coarse rung and returning is what
 * fractal nesting actually does, and it is where aliasing bites.
 *
 * `f` must be band-limited inside `narrow`'s band, otherwise both paths lose
 * real content and the test measures the field rather than the method.
 */
export function abTransfer(f: CField, narrow: number): ABVerdict {
  const legacy = l2(indexResample(indexResample(f, narrow), f.n), f);
  const op = l2(resample(resample(f, narrow), f.n), f);
  return verdict('transfer', legacy, op);
}

/**
 * A3 — metric discrimination. Two candidates share an L² error; only a graded
 * norm can tell the rough one from the smooth one. The reported figure is the
 * separation ratio, so higher is better for both paths and the comparison is
 * apples-to-apples.
 */
export function abMetric(truth: CField, smooth: CField, rough: CField): ABVerdict {
  const lSep = ratio(l2(rough, truth), l2(smooth, truth));
  const hSep = ratio(gradedError(rough, truth).h1, gradedError(smooth, truth).h1);
  return verdict('metric', lSep, hSep, true);
}

function ratio(a: number, b: number): number {
  return b > 0 ? a / b : a > 0 ? Infinity : 1;
}

function verdict(name: string, legacy: number, op: number, higherIsBetter = false): ABVerdict {
  const improvement = higherIsBetter
    ? (legacy > 0 ? op / legacy : Infinity)
    : (op > 0 ? legacy / op : Infinity);
  return { name, legacy, operator: op, improvement, wins: improvement > 1 };
}

export interface ABReport {
  readonly verdicts: readonly ABVerdict[];
  readonly allWin: boolean;
}

export function runABSuite(f: CField, truth: CField, narrow: number, smooth: CField, rough: CField): ABReport {
  const verdicts = [abDerivative(f, truth), abTransfer(f, narrow), abMetric(f, smooth, rough)];
  return { verdicts, allWin: verdicts.every((v) => v.wins) };
}
