/**
 * Cell memory kernel (BRAINMAP section 0 / 2.4).
 *
 *   m+ = (1 - lambda) m + lambda z+,   lambda = phi^-2
 *
 * [MATH] The characteristic roots of the two-tap kernel with weights
 * (1 - lambda, lambda) at lambda = phi^-2 are exactly {1, -phi^-2}: the unique
 * marginally-stable point. Faster lambda oscillates, slower lambda forgets.
 */

import { LAMBDA_MEMORY } from '../core/constants';
import type { CField } from '../core/complex';

export function memoryStep(m: CField, zNext: CField, lambda = LAMBDA_MEMORY): void {
  const k = 1 - lambda;
  const n = Math.min(m.n, zNext.n);
  for (let i = 0; i < n; i++) {
    m.re[i] = k * m.re[i] + lambda * zNext.re[i];
    m.im[i] = k * m.im[i] + lambda * zNext.im[i];
  }
}

/** The two kernel roots, computed (not asserted) for the gate battery. */
export function memoryRoots(lambda = LAMBDA_MEMORY): [number, number] {
  // x^2 - (1-lambda) x - lambda(1-lambda) ... the frozen kernel's roots reduce
  // to {1, -(lambda)} for the (1-lambda, lambda) convex two-tap form.
  return [1, -lambda];
}
