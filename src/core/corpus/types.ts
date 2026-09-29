/**
 * Ω-CORPUS — shared frame type and the binary shard codec.
 *
 * The corpus stores numbers, not objects. A shard is one header followed by a
 * packed Float32 payload, so a frame costs 4 bytes per number instead of the
 * ~20 a JSON array would. The header is fixed-width and 8-byte aligned, which
 * makes decoding a single `subarray` with no parsing at all.
 *
 * Determinism is load-bearing: an identical frame stream must produce
 * byte-identical shard bytes, because the content hash of those bytes is what
 * the Merkle ledger commits to. Nothing here reads a clock.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { toHex } from '@metatron/trnn-core/ledger/merkle';

export const SHARD_MAGIC = 0x4d544331; // "MTC1"
export const SHARD_SCHEMA = 1;
export const HEADER_BYTES = 40;

/** Payload flags. A cold segment is band-limited, and says so. */
export const FLAG_RAW = 0;
export const FLAG_RESAMPLED = 1;

/** One retained observation: a signature slice plus the witnesses of its pass. */
export interface CorpusFrame {
  readonly tick: number;
  readonly rank: number;
  /** The retained numbers. Length must equal the tier width when sealed. */
  readonly values: Float64Array;
  /** Surprise in calibrated band half-widths at the moment of admission. */
  readonly surprise: number;
}

export interface ShardHeader {
  readonly schema: number;
  readonly count: number;
  readonly width: number;
  readonly tickFrom: number;
  readonly tickTo: number;
  readonly flags: number;
}

export interface DecodedShard extends ShardHeader {
  /** One tick per frame, stored exactly. */
  readonly ticks: Float64Array;
  /** count × width Float32 values, row-major by frame. */
  readonly values: Float32Array;
}

function widthOf(frames: readonly CorpusFrame[], width: number): number {
  if (!Number.isInteger(width) || width <= 0) {
    throw new RangeError(`encodeShard: bad width ${width}`);
  }
  for (const f of frames) {
    if (f.values.length !== width) {
      throw new RangeError(
        `encodeShard: frame at tick ${f.tick} has ${f.values.length} values, expected ${width}`,
      );
    }
  }
  return width;
}

/**
 * Encode frames into one immutable shard buffer.
 *
 * Frames are written in the order given — the caller is responsible for tick
 * order, because re-sorting here would silently change the content hash of an
 * otherwise identical stream.
 */
export function encodeShard(
  frames: readonly CorpusFrame[],
  width: number,
  flags: number = FLAG_RAW,
): Uint8Array {
  widthOf(frames, width);
  const count = frames.length;
  const bytes = new Uint8Array(HEADER_BYTES + count * 8 + count * width * 4);
  const view = new DataView(bytes.buffer);
  const tickFrom = count > 0 ? frames[0].tick : 0;
  const tickTo = count > 0 ? frames[count - 1].tick : 0;

  view.setUint32(0, SHARD_MAGIC, true);
  view.setUint32(4, SHARD_SCHEMA, true);
  view.setUint32(8, count, true);
  view.setUint32(12, width, true);
  view.setFloat64(16, tickFrom, true);
  view.setFloat64(24, tickTo, true);
  view.setUint32(32, flags, true);
  view.setUint32(36, 0, true);

  // Ticks are float64 and stored explicitly: a tick is an identity, never
  // something to be re-derived by interpolation on read.
  const ticks = new Float64Array(bytes.buffer, HEADER_BYTES, count);
  const payload = new Float32Array(bytes.buffer, HEADER_BYTES + count * 8, count * width);
  for (let i = 0; i < count; i++) {
    ticks[i] = frames[i].tick;
    payload.set(frames[i].values as unknown as ArrayLike<number>, i * width);
  }
  return bytes;
}

/** Decode a shard. Throws on a foreign or truncated buffer — never guesses. */
export function decodeShard(bytes: Uint8Array): DecodedShard {
  if (bytes.byteLength < HEADER_BYTES) throw new RangeError('decodeShard: truncated header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== SHARD_MAGIC) throw new RangeError('decodeShard: bad magic');
  const schema = view.getUint32(4, true);
  if (schema !== SHARD_SCHEMA) throw new RangeError(`decodeShard: schema ${schema} unsupported`);
  const count = view.getUint32(8, true);
  const width = view.getUint32(12, true);
  const need = HEADER_BYTES + count * 8 + count * width * 4;
  if (bytes.byteLength < need) throw new RangeError('decodeShard: truncated payload');

  // A view onto a non-aligned host buffer cannot be a typed array directly, so
  // an unaligned shard is copied once rather than mis-read.
  const aligned = (bytes.byteOffset + HEADER_BYTES) % 8 === 0 ? bytes : Uint8Array.from(bytes);
  const base = aligned.byteOffset + HEADER_BYTES;
  const ticks = new Float64Array(aligned.buffer, base, count);
  const values = new Float32Array(aligned.buffer, base + count * 8, count * width);

  return {
    schema,
    count,
    width,
    tickFrom: view.getFloat64(16, true),
    tickTo: view.getFloat64(24, true),
    flags: view.getUint32(32, true),
    ticks,
    values,
  };
}

/** Content hash of a sealed buffer — the ledger's address for it. */
export function contentHashHex(bytes: Uint8Array): string {
  return toHex(sha256(bytes));
}

/** Frames back out of a decoded shard, at float32 fidelity. */
export function framesOf(shard: DecodedShard): CorpusFrame[] {
  const out: CorpusFrame[] = [];
  for (let i = 0; i < shard.count; i++) {
    out.push({
      tick: shard.ticks[i],
      rank: -1,
      values: Float64Array.from(shard.values.subarray(i * shard.width, (i + 1) * shard.width)),
      surprise: NaN,
    });
  }
  return out;
}
