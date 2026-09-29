/**
 * PhiLockScheduler — single φ-phase scheduler for every memory layer.
 *
 * Replaces scattered `if (tick % F_k === 0)` checks. Each job declares a
 * Fibonacci period (F_k) and a depth (k). On every tick, eligible jobs
 * are sorted by priority and the scheduler runs them in priority order.
 *
 *   priority(j) = φ^depth · salience · exp(-Δt / τ)
 *
 * The scheduler is pure & deterministic; identical (tick, salience, jobs)
 * stream ⇒ identical fire order. Keeps a rolling audit log for the UI.
 */

import { PHI } from '@/core/frameworks/constants';

export interface PhiJob {
  name: string;
  /** Fibonacci period in ticks (F_k). 1 = every tick. */
  periodTicks: number;
  /** k in F_k — used as the φ-priority depth. */
  depth: number;
  /** τ in ticks for recency decay (default = periodTicks · 8). */
  tau?: number;
  /** Run handler. Receives the tick that fired it. */
  run: (tick: number) => void;
}

export interface PhiJobRecord extends PhiJob {
  lastRun: number;
  lastSalience: number;
  fires: number;
}

export interface PhiFiring {
  tick: number;
  name: string;
  priority: number;
  dt: number;
}

const LOG_CAP = 128;

export class PhiLockScheduler {
  private jobs = new Map<string, PhiJobRecord>();
  private log: PhiFiring[] = [];
  private lastTick = 0;

  register(job: PhiJob): void {
    this.jobs.set(job.name, {
      ...job,
      tau: job.tau ?? job.periodTicks * 8,
      lastRun: 0,
      lastSalience: 1,
      fires: 0,
    });
  }

  unregister(name: string): void {
    this.jobs.delete(name);
  }

  /** Per-tick global salience (set by capture kernel before run). */
  setSalience(name: string, salience: number): void {
    const j = this.jobs.get(name);
    if (j) j.lastSalience = salience;
  }

  /** Drive one tick. Runs all eligible jobs in priority order. */
  tick(now: number): PhiFiring[] {
    this.lastTick = now;
    const eligible: Array<{ job: PhiJobRecord; priority: number; dt: number }> = [];
    for (const job of this.jobs.values()) {
      const dt = now - job.lastRun;
      if (dt < job.periodTicks) continue;
      const tau = job.tau ?? job.periodTicks * 8;
      const rec = Math.exp(-dt / Math.max(1, tau));
      const priority = Math.pow(PHI, job.depth) * Math.max(1e-6, job.lastSalience) * rec;
      eligible.push({ job, priority, dt });
    }
    eligible.sort((a, b) => b.priority - a.priority);
    const fired: PhiFiring[] = [];
    for (const e of eligible) {
      try {
        e.job.run(now);
      } catch {
        /* swallow — scheduler stays alive */
      }
      e.job.lastRun = now;
      e.job.fires++;
      const f: PhiFiring = { tick: now, name: e.job.name, priority: e.priority, dt: e.dt };
      fired.push(f);
      this.log.push(f);
    }
    if (this.log.length > LOG_CAP) this.log.splice(0, this.log.length - LOG_CAP);
    return fired;
  }

  recentLog(n = 32): PhiFiring[] {
    return this.log.slice(-n).reverse();
  }

  stats() {
    const out: Array<{
      name: string;
      depth: number;
      period: number;
      fires: number;
      lastRun: number;
    }> = [];
    for (const j of this.jobs.values()) {
      out.push({
        name: j.name,
        depth: j.depth,
        period: j.periodTicks,
        fires: j.fires,
        lastRun: j.lastRun,
      });
    }
    return { tick: this.lastTick, jobs: out };
  }

  clear(): void {
    this.jobs.clear();
    this.log = [];
    this.lastTick = 0;
  }
}
