/**
 * Deterministic tick ordering and the Jacobi read/write discipline.
 *
 * Law L-W3: within one web tick every rung reads only *pre-update* state. A
 * read of a value already written in the same tick is an ordering violation —
 * it makes the run order-dependent and therefore non-reproducible.
 *
 * The OrderingMonitor is not a debug aid; it is the enforcement mechanism the
 * MultiTorusEngine runs with, and its violation count is a gate metric.
 */

export type Phase = 'stage' | 'exchange' | 'update' | 'measure' | 'commit';

export const PHASE_ORDER: readonly Phase[] = ['stage', 'exchange', 'update', 'measure', 'commit'];

export interface OrderingViolation {
  readonly tick: number;
  readonly rank: number;
  readonly phase: Phase;
  readonly reason: string;
}

export class OrderingMonitor {
  private tick = -1;
  private phaseIdx = -1;
  private readonly written = new Set<number>();
  private readonly violations: OrderingViolation[] = [];

  beginTick(tick: number): void {
    if (tick <= this.tick) {
      this.violations.push({
        tick,
        rank: -1,
        phase: 'stage',
        reason: `tick did not advance (${tick} <= ${this.tick})`,
      });
    }
    this.tick = tick;
    this.phaseIdx = -1;
    this.written.clear();
  }

  enterPhase(p: Phase): void {
    const idx = PHASE_ORDER.indexOf(p);
    if (idx < this.phaseIdx) {
      this.violations.push({
        tick: this.tick,
        rank: -1,
        phase: p,
        reason: `phase went backwards from ${PHASE_ORDER[this.phaseIdx]}`,
      });
    }
    this.phaseIdx = idx;
  }

  /** Register a read of rung `rank`'s state; must be pre-update. */
  read(rank: number): void {
    if (this.written.has(rank)) {
      this.violations.push({
        tick: this.tick,
        rank,
        phase: PHASE_ORDER[Math.max(0, this.phaseIdx)],
        reason: 'read-after-write inside one tick',
      });
    }
  }

  /** Register a commit of rung `rank`'s new state. */
  write(rank: number): void {
    if (this.phaseIdx < PHASE_ORDER.indexOf('update')) {
      this.violations.push({
        tick: this.tick,
        rank,
        phase: PHASE_ORDER[Math.max(0, this.phaseIdx)],
        reason: 'write before the update phase',
      });
    }
    this.written.add(rank);
  }

  count(): number {
    return this.violations.length;
  }

  list(): readonly OrderingViolation[] {
    return this.violations;
  }

  reset(): void {
    this.tick = -1;
    this.phaseIdx = -1;
    this.written.clear();
    this.violations.length = 0;
  }
}

/**
 * Multi-rate clocks (amendment A-08): rung `rank` advances every stride(rank)
 * web ticks. Strides are Fibonacci so nested periods re-align on Fibonacci
 * boundaries instead of drifting.
 */
export function fibonacciStrides(
  size: number,
  mode: 'uniform' | 'fibonacci' = 'uniform',
): Int32Array {
  const s = new Int32Array(size);
  if (mode === 'uniform') {
    s.fill(1);
    return s;
  }
  // 1,1,2,3,5,8,13,... capped at 13 so the slowest rung stays observable
  let a = 1;
  let b = 1;
  for (let i = 0; i < size; i++) {
    s[i] = Math.min(a, 13);
    const c = a + b;
    a = b;
    b = c;
  }
  return s;
}
