/**
 * Transcription tape (BRAINMAP 2.6): a 13-dimensional spectral signature per
 * tick, kept in an explicitly retained ring and digest-chained by the engine.
 */

import { SIGNATURE_MODES } from '../core/constants';

export interface TapeFrame {
  readonly tick: number;
  readonly signature: Float64Array;
  readonly digest: string;
}

export class TranscriptionTape {
  private readonly buf: Float64Array;
  private readonly ticks: Int32Array;
  private readonly digests: string[];
  private readonly cap: number;
  private cursor = 0;
  private count = 0;

  constructor(
    capacity = 2584,
    readonly width = SIGNATURE_MODES,
  ) {
    this.cap = capacity;
    this.buf = new Float64Array(capacity * width);
    this.ticks = new Int32Array(capacity);
    this.digests = new Array<string>(capacity).fill('');
  }

  write(tick: number, signature: ArrayLike<number>, digest: string): void {
    const o = this.cursor * this.width;
    for (let i = 0; i < this.width; i++) this.buf[o + i] = signature[i] ?? 0;
    this.ticks[this.cursor] = tick;
    this.digests[this.cursor] = digest;
    this.cursor = (this.cursor + 1) % this.cap;
    if (this.count < this.cap) this.count++;
  }

  size(): number {
    return this.count;
  }

  capacity(): number {
    return this.cap;
  }

  /** Most recent `k` frames, oldest first. */
  tail(k: number): TapeFrame[] {
    const m = Math.min(k, this.count);
    const out: TapeFrame[] = [];
    for (let i = m; i > 0; i--) {
      const idx = (this.cursor - i + this.cap) % this.cap;
      out.push({
        tick: this.ticks[idx],
        signature: this.buf.slice(idx * this.width, idx * this.width + this.width),
        digest: this.digests[idx],
      });
    }
    return out;
  }
}
