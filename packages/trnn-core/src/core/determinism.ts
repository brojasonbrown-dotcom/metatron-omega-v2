/**
 * Law L2 — determinism.
 *
 * The engine path has no RNG, no wall-clock and no hardware probe. Every tick
 * appends a digest to a hash chain; two runs from the same seed produce the
 * same chain, so a run is reproducible and divergence is localisable to a tick.
 *
 * Hash: FNV-1a over 64 bits, BigInt-exact, applied to the raw IEEE-754 bytes of
 * every value. [DEFINED] — blake2b is the Python side's choice; here the
 * requirement is only that the chain is collision-resistant enough to localise
 * divergence and is bit-identical across JS engines, which FNV-1a with exact
 * BigInt arithmetic guarantees.
 */

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

const scratch = new DataView(new ArrayBuffer(8));

export class Digest {
  private h: bigint;

  constructor(seed: bigint = FNV_OFFSET) {
    this.h = seed & MASK64;
  }

  byte(b: number): this {
    this.h = ((this.h ^ BigInt(b & 0xff)) * FNV_PRIME) & MASK64;
    return this;
  }

  /** Absorb a float64 by its exact bit pattern (NaN/-0 included). */
  float(x: number): this {
    scratch.setFloat64(0, x, true);
    for (let i = 0; i < 8; i++) this.byte(scratch.getUint8(i));
    return this;
  }

  int(x: number): this {
    scratch.setFloat64(0, x, true);
    for (let i = 0; i < 8; i++) this.byte(scratch.getUint8(i));
    return this;
  }

  text(s: string): this {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      this.byte(c & 0xff).byte(c >>> 8);
    }
    return this;
  }

  array(xs: ArrayLike<number>): this {
    this.int(xs.length);
    for (let i = 0; i < xs.length; i++) this.float(xs[i]);
    return this;
  }

  value(): bigint {
    return this.h;
  }

  hex(): string {
    return this.h.toString(16).padStart(16, '0');
  }
}

/** A running chain: link(prev, payload) -> next. */
export class DigestChain {
  private h: bigint;
  private n = 0;

  constructor(seed: string) {
    this.h = new Digest().text(seed).value();
  }

  /** Absorb one tick's payload and return the new head. */
  link(...payloads: ArrayLike<number>[]): string {
    const d = new Digest(this.h);
    d.int(this.n++);
    for (const p of payloads) d.array(p);
    this.h = d.value();
    return this.head();
  }

  head(): string {
    return this.h.toString(16).padStart(16, '0');
  }

  length(): number {
    return this.n;
  }

  /** Restore a chain to a checkpointed head (rollback support). */
  restore(headHex: string, count: number): void {
    this.h = BigInt('0x' + headHex) & MASK64;
    this.n = count;
  }
}

/**
 * Deterministic seed stream. Used ONLY for initial conditions (never on the
 * tick path): SplitMix64, exact, engine-independent.
 */
export class SeedStream {
  private s: bigint;

  constructor(seed: string) {
    this.s = new Digest().text(seed).value();
  }

  next(): number {
    this.s = (this.s + 0x9e3779b97f4a7c15n) & MASK64;
    let z = this.s;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    z = z ^ (z >> 31n);
    // 53-bit mantissa -> [0,1)
    return Number(z >> 11n) / 9007199254740992;
  }

  /** Symmetric sample in [-1, 1). */
  signed(): number {
    return this.next() * 2 - 1;
  }
}
