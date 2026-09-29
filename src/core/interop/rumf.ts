/**
 * Ω-READY R6 — the RUMF memory transport.
 *
 * RUMF (Retrieval, Uniformity & Maturation Fabric) is the host's memory fabric:
 * Wing → Room → Drawer → DrawerEntry, with four hard invariants we must honour
 * exactly or the host rejects our writes:
 *
 *   • Absolute Zero — identical inputs produce identical SHA3-256 ids, on every
 *     node, forever. So no counters, no timestamps, no randomness in an id.
 *   • BigNum128 only — scores are 10^18 fixed point; no runtime floats.
 *   • CBOR only — drawer entries carry `payload_cbor`, canonical bytes.
 *   • HLC v2.1 — every mutation is stamped with (wall, logical, node_id).
 *
 * The id laws are ported verbatim from `deploy/rust-api/src/rumf`:
 *   wing id   = "wing_" ‖ hex(SHA3-256("wing"   ‖ label))
 *   room id   = "room_" ‖ hex(SHA3-256("room"   ‖ label))
 *   drawer id = hex(SHA3-256(bytes(content_hash) ‖ bytes(context_hash)
 *                            ‖ utf8(wing_id) ‖ utf8(room_id)))
 * Note the asymmetry: wing/room hash the LABEL STRING, the drawer hashes the
 * DECODED HASH BYTES. Getting that wrong yields ids the host cannot match, so it
 * is pinned by test rather than left to a reader's memory.
 */

import { sha3_256 } from '@noble/hashes/sha3.js';
import {
  encodeCbor,
  decodeCbor,
  toHex,
  fromHex,
  hashHex,
  type CborValue,
  type Hlc,
  hlcEncode,
} from './contract';
import { BN_ONE, bnClampUnit, type BigNum128, type TrustLevel } from './bn128';

/** Fibonacci maturation stage, F1..F12. */
export type FibonacciStage =
  | 'F1'
  | 'F2'
  | 'F3'
  | 'F4'
  | 'F5'
  | 'F6'
  | 'F7'
  | 'F8'
  | 'F9'
  | 'F10'
  | 'F11'
  | 'F12';

export const FIBONACCI_STAGES: readonly FibonacciStage[] = [
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
] as const;

export function stageIndex(s: FibonacciStage): number {
  return Number(s.slice(1));
}

/** Host `fibonacci`: F(0)=0, F(1)=F(2)=1, then the usual recurrence. */
function fib(n: number): number {
  if (n === 0) return 0;
  if (n <= 2) return 1;
  let a = 1,
    b = 1;
  for (let i = 3; i <= n; i++) {
    const c = a + b;
    a = b;
    b = c;
  }
  return b;
}

/** Host law: expected dwell = Fibonacci(index) minutes, in seconds. */
export function stageExpectedDurationSeconds(s: FibonacciStage): number {
  return fib(stageIndex(s)) * 60;
}

export function stageNext(s: FibonacciStage): FibonacciStage | null {
  const i = stageIndex(s);
  return i >= 12 ? null : (`F${i + 1}` as FibonacciStage);
}

// ── ids (Absolute Zero) ────────────────────────────────────────────────────

const TE = new TextEncoder();

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** `prefix_` ‖ hex(SHA3-256(prefix ‖ label)) — the host's `next_id`. */
export function prefixedId(prefix: string, label: string): string {
  return `${prefix}_${toHex(sha3_256(concatBytes(TE.encode(prefix), TE.encode(label))))}`;
}

export function wingId(label: string): string {
  return prefixedId('wing', label);
}
export function roomId(label: string): string {
  return prefixedId('room', label);
}

/** SHA3-256 over decoded content/context hash bytes plus the id strings. */
export function drawerId(
  contentHash: string,
  contextHash: string,
  wing: string,
  room: string,
): string {
  return toHex(
    sha3_256(
      concatBytes(fromHex(contentHash), fromHex(contextHash), TE.encode(wing), TE.encode(room)),
    ),
  );
}

const HEX64 = /^[0-9a-f]{64}$/;

export function isValidDrawerId(id: string): boolean {
  return HEX64.test(id);
}

// ── records ────────────────────────────────────────────────────────────────

export interface Wing {
  readonly id: string;
  readonly label: string;
  readonly created_at: Hlc;
}
export interface Room {
  readonly id: string;
  readonly wing_id: string;
  readonly label: string;
  readonly created_at: Hlc;
}
export interface DrawerEntry {
  readonly hlc: Hlc;
  readonly trust: TrustLevel;
  readonly payload_cbor: Uint8Array;
}
export interface Drawer {
  readonly id: string;
  readonly content_hash: string;
  readonly context_hash: string;
  readonly wing_id: string;
  readonly room_id: string;
  readonly trust: TrustLevel;
  readonly stage: FibonacciStage;
  readonly created_at: Hlc;
  readonly entries: readonly DrawerEntry[];
}

export function makeWing(label: string, hlc: Hlc): Wing {
  return { id: wingId(label), label, created_at: hlc };
}

export function makeRoom(wing: string, label: string, hlc: Hlc): Room {
  return { id: roomId(label), wing_id: wing, label, created_at: hlc };
}

export function makeEntry(payload: CborValue, trust: TrustLevel, hlc: Hlc): DrawerEntry {
  return { hlc, trust, payload_cbor: encodeCbor(payload) };
}

export function readEntry(e: DrawerEntry): CborValue {
  return decodeCbor(e.payload_cbor);
}

/**
 * Seal a drawer. `content` is what the memory IS, `context` is where it came
 * from; both are hashed under the law so the drawer id is content-addressed and
 * two identical memories in the same room collapse onto one drawer.
 */
export function sealDrawer(input: {
  content: CborValue;
  context: CborValue;
  wing: string;
  room: string;
  trust: TrustLevel;
  stage: FibonacciStage;
  hlc: Hlc;
  entries?: readonly DrawerEntry[];
}): Drawer {
  const content_hash = hashHex(encodeCbor(input.content));
  const context_hash = hashHex(encodeCbor(input.context));
  return {
    id: drawerId(content_hash, context_hash, input.wing, input.room),
    content_hash,
    context_hash,
    wing_id: input.wing,
    room_id: input.room,
    trust: input.trust,
    stage: input.stage,
    created_at: input.hlc,
    entries: input.entries ?? [makeEntry(input.content, input.trust, input.hlc)],
  };
}

// ── the Ω memory export ────────────────────────────────────────────────────

/**
 * The wings Ω writes into. Three, matching the host's three-substrate merge
 * order (brain / metatron / rumf) so the coherence fusion has a wing per term.
 */
export const OMEGA_WINGS = {
  brain: 'omega.brain',
  metatron: 'omega.metatron',
  rumf: 'omega.rumf',
} as const;

export type OmegaWing = keyof typeof OMEGA_WINGS;

/** Layer → room mapping for the Ω memory tiers. */
export const OMEGA_ROOMS = {
  L0: 'omega.L0.tape',
  L1: 'omega.L1.hebbian',
  L2: 'omega.L2.episodic',
  L3: 'omega.L3.patterns',
  L4: 'omega.L4.pathways',
  L5: 'omega.L5.journal',
  L6: 'omega.L6.knowledge',
} as const;

export type OmegaRoom = keyof typeof OMEGA_ROOMS;

/**
 * Ω → RUMF export of one memory item. Deterministic end to end: same item, same
 * layer, same clock ⇒ same drawer id and identical CBOR bytes.
 */
export function exportMemory(input: {
  layer: OmegaRoom;
  wing?: OmegaWing;
  item: CborValue;
  /** Provenance: engine tick, rung, source — anything that situates the item. */
  context: CborValue;
  trust: TrustLevel;
  stage?: FibonacciStage;
  hlc: Hlc;
}): Drawer {
  return sealDrawer({
    content: input.item,
    context: { room: OMEGA_ROOMS[input.layer], ...(input.context as object) } as CborValue,
    wing: wingId(OMEGA_WINGS[input.wing ?? 'metatron']),
    room: roomId(OMEGA_ROOMS[input.layer]),
    trust: input.trust,
    stage: input.stage ?? 'F1',
    hlc: input.hlc,
  });
}

/** Wire form of a drawer for the host's `application/cbor` endpoints. */
export function drawerToWire(d: Drawer): Uint8Array {
  return encodeCbor({
    id: d.id,
    content_hash: d.content_hash,
    context_hash: d.context_hash,
    wing_id: d.wing_id,
    room_id: d.room_id,
    trust: d.trust,
    stage: d.stage,
    created_at: hlcEncode(d.created_at),
    entries: d.entries.map((e) => ({
      hlc: hlcEncode(e.hlc),
      trust: e.trust,
      payload: e.payload_cbor,
    })),
  });
}

/**
 * Retrieval score, host-shaped: base × trust multiplier, all in BigNum128.
 * Floats never enter; the base score arrives already scaled.
 */
export function retrievalScore(base: BigNum128, multiplier: BigNum128): BigNum128 {
  return (bnClampUnit(base) * multiplier) / BN_ONE;
}
