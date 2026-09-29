/**
 * Ω-WAKE S2 + S3 — the missing drive edges.
 *
 * Before this module nothing called `MemoryRuntime.drive()`, so the whole
 * L0–L6 substrate sat at 0 tape frames / 0 episodes while the engine ran, and
 * the mind's thoughts were pulled only while the MIND deck happened to be
 * mounted, leaving no trace anywhere.
 *
 * This driver owns both edges, and nothing else:
 *
 *   S2  Ω snapshot ──▶ MetatronOutput ──▶ memory.drive() ──▶ L0…L6
 *   S3  Ω mind pull (slow φ cadence) ──▶ new Thoughts ──▶ L5 journal
 *
 * Cadence: the snapshot bus already runs adaptively at 8–64 Hz, which is the
 * rate the memory layers were budgeted for, so one drive per emitted snapshot
 * is the correct cost. A floor period guards against a bus burst.
 */

import { getOmegaRuntime, type OmegaState } from './omegaRuntime';
import { getMemoryRuntime, type MemoryRuntime } from './memoryRuntime';
import { computeMetatronMemo, type MetatronOutput } from '@/core/MetatronCore';
import type { HostSnapshot, MindReport } from '@/core/omega/omegaProtocol';
import type { MemoryStore } from '@/core/memory/MemoryStore';
import { PHI_INV, OMEGA_C } from '@/core/constants/WolframVerified';

/** Hard floor between drives (ms) — 64 Hz, the host's own bus ceiling. */
export const MIN_DRIVE_PERIOD_MS = 1000 / 64;
/** Mind is pulled on a slow φ cadence: 1.618 s. */
export const MIND_PERIOD_MS = 1618;

/** Ω snapshot → the `MetatronOutput` the memory tick consumes. */
export function outputFromSnapshot(snap: HostSnapshot): MetatronOutput {
  const coherence = Number.isFinite(snap.coherence) ? snap.coherence : PHI_INV;
  const energy = Number.isFinite(snap.energy) ? snap.energy : OMEGA_C;
  return computeMetatronMemo({ coherence, energy, time: snap.tick });
}

/**
 * S3 — write the thoughts newer than `sinceTick` into the L5 journal.
 * Returns the number of records appended and the new watermark, so repeated
 * pulls of an overlapping report can never duplicate a thought.
 */
export function journalThoughts(
  report: MindReport | null,
  store: MemoryStore,
  sinceTick: number,
): { appended: number; watermark: number } {
  if (!report || !report.recent || report.recent.length === 0) {
    return { appended: 0, watermark: sinceTick };
  }
  let watermark = sinceTick;
  let appended = 0;
  for (const t of report.recent) {
    if (t.tick <= sinceTick) continue;
    store.journal.append({
      tick: t.tick,
      // Novelty is the salience the journal ranks by; surprise rides in the text.
      qualiaScalar: Number.isFinite(t.novelty) ? t.novelty : 0,
      signatureHash: t.conceptKey ?? `c${t.conceptId}`,
      text: `${t.action} ${t.conceptKey ?? t.conceptId} · novelty ${t.novelty.toFixed(4)} · surprise ${t.surprise.toFixed(4)} · via ${t.source}`,
    });
    appended++;
    if (t.tick > watermark) watermark = t.tick;
  }
  return { appended, watermark };
}

class MemoryDriver {
  private unsub: (() => void) | null = null;
  private memory: MemoryRuntime | null = null;
  private lastSnapshotVersion = -1;
  private lastDriveAt = 0;
  private lastMindPullAt = 0;
  private thoughtWatermark = -1;
  private driven = 0;
  private journaled = 0;

  start(): void {
    if (this.unsub) return;
    const omega = getOmegaRuntime();
    this.memory = getMemoryRuntime();
    this.unsub = omega.subscribe((s) => this.onState(s));
    // Catch a state that already exists before we subscribed.
    this.onState(omega.get());
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
  }

  stats() {
    return {
      driven: this.driven,
      journaled: this.journaled,
      watermark: this.thoughtWatermark,
    };
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  private onState(s: OmegaState): void {
    const mem = this.memory;
    if (!mem) return;
    const snap = s.snapshot;
    if (!snap || !s.running) return;

    // S3 — mind, on its own slow cadence, whenever the engine is running.
    const now = this.now();
    if (now - this.lastMindPullAt >= MIND_PERIOD_MS) {
      this.lastMindPullAt = now;
      getOmegaRuntime().requestMind();
    }
    if (s.mind) {
      const r = journalThoughts(s.mind, mem.store, this.thoughtWatermark);
      this.thoughtWatermark = r.watermark;
      this.journaled += r.appended;
    }

    // S2 — one memory drive per fresh snapshot, floored at the bus ceiling.
    if (s.version === this.lastSnapshotVersion) return;
    this.lastSnapshotVersion = s.version;
    if (now - this.lastDriveAt < MIN_DRIVE_PERIOD_MS) return;
    this.lastDriveAt = now;

    try {
      const out = outputFromSnapshot(snap);
      if (mem.drive(out)) this.driven++;
    } catch {
      // A memory failure must never stall the engine; the runtime records it.
    }
  }
}

let singleton: MemoryDriver | null = null;

export function getMemoryDriver(): MemoryDriver {
  if (!singleton) singleton = new MemoryDriver();
  return singleton;
}

export type { MemoryDriver };
