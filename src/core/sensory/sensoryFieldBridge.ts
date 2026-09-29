/**
 * SensoryFieldBridge — module-scoped, SSR-safe mailbox between the sensory
 * frontends (AudioFrontend, VideoFrontend, IMUFrontend, future vision
 * encoders) and the field engine's per-tick framework input.
 *
 * Rationale
 * =========
 * The framework layer (F5 Color/Music, F6 Hebrew, F7 Galactic) expects
 * per-band `solfeggioCoherences` (length 9) and `flowerCoherences`
 * (length 55). Historically the engine passed `new Array(N).fill(coherence)`
 * — the same scalar broadcast, which meant F5 could never see a real
 * spectral pattern and was structurally starved regardless of the mic
 * being on. This bridge fixes that leak without introducing a hard
 * dependency: the engine still degrades gracefully when nothing is
 * publishing (mic off, tab hidden, engine-only mode).
 *
 * Guarantees
 * ----------
 *   • Zero allocations on the read path (returns the internal buffer;
 *     callers MUST NOT mutate it, and the engine only reads it into F5
 *     input via number[] copy inside the orchestrator).
 *   • SSR-safe: no browser globals touched at module scope.
 *   • Freshness gate: readers get `null` if the publisher hasn't ticked
 *     within `FRESHNESS_MS`. This prevents stale voice-carryover after
 *     the mic is disabled, and lets the engine fall back to the neutral
 *     `fill(coherence)` behavior on silence/no-input.
 *   • Bounded: the 9-band and 55-band buffers are single-writer,
 *     single-reader (one AudioFrontend, one FallbackEngine). Concurrent
 *     writers overwrite — by design; the newest sample wins.
 *
 * This module is deliberately dependency-free. It is safe to import from
 * anywhere in the client bundle.
 */

// Freshness window in milliseconds. If no publish arrives within this
// window, readers get `null`. Chosen so the engine's ~233 Hz tick sees
// a ~46-tick grace window (200 ms) — long enough to survive one dropped
// AudioContext buffer, short enough to release the field to neutral
// immediately after mic stop().
const FRESHNESS_MS = 200;

// Guard against non-DOM environments (SSR, workers). `performance.now()`
// is present in modern workers too, so we only need a nullable check.
function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

interface Slot {
  buf: Float32Array;
  ts: number; // performance.now() at publish
}

const solfeggioSlot: Slot = { buf: new Float32Array(9), ts: -Infinity };
const flowerSlot: Slot = { buf: new Float32Array(55), ts: -Infinity };

/**
 * Vision embedding slot. Variable dimensionality (depends on the model
 * loaded — typically 384/512/768/1024). We keep the raw normalized
 * embedding here plus a scalar "novelty burst" (‖Ψ_t − Ψ_{t-1}‖ / √D)
 * that framework consumers can use as a modulation signal without
 * needing to know the embedding shape. A wider vision-focused
 * FRESHNESS_MS is used because vision runs at 5–15 Hz, not 233 Hz.
 */
const VISION_FRESHNESS_MS = 500; // survive one dropped vision frame at 5 Hz
interface VisionSlot {
  embed: Float32Array | null; // L2-normalized model output
  dim: number;
  novelty: number; // 0..1
  ts: number;
}
const visionSlot: VisionSlot = { embed: null, dim: 0, novelty: 0, ts: -Infinity };

/**
 * Publish a 9-band solfeggio activity vector. Values SHOULD be in [0,1]
 * band-activity probability space (they sum to ≈1 across bands). The
 * consumer will scale by the current global coherence before handing
 * to F5. Silently no-ops if `bands.length !== 9`.
 */
export function publishSolfeggio(bands: Float32Array): void {
  if (bands.length !== 9) return;
  const dst = solfeggioSlot.buf;
  for (let i = 0; i < 9; i++) dst[i] = bands[i];
  solfeggioSlot.ts = now();
}

/**
 * Publish a 55-band φ-spaced flower activity vector. Same probability-
 * space convention as solfeggio. Silently no-ops on wrong length.
 */
export function publishFlowerBands(bands: Float32Array): void {
  if (bands.length !== 55) return;
  const dst = flowerSlot.buf;
  for (let i = 0; i < 55; i++) dst[i] = bands[i];
  flowerSlot.ts = now();
}

/**
 * Read the freshest solfeggio band vector, or `null` if none has been
 * published within FRESHNESS_MS. The returned buffer is internal —
 * callers MUST copy before mutating.
 */
export function readSolfeggio(): Float32Array | null {
  return now() - solfeggioSlot.ts <= FRESHNESS_MS ? solfeggioSlot.buf : null;
}

/**
 * Read the freshest flower band vector, or `null` if none has been
 * published within FRESHNESS_MS.
 */
export function readFlowerBands(): Float32Array | null {
  return now() - flowerSlot.ts <= FRESHNESS_MS ? flowerSlot.buf : null;
}

/**
 * Publish a vision embedding. Buffer is COPIED (vision frontends reuse
 * their internal Float32Array between frames — we can't hold a live
 * reference). `novelty` is a caller-computed 0..1 burst score.
 */
export function publishVisionEmbedding(embed: Float32Array, novelty: number): void {
  if (embed.length === 0) return;
  if (!visionSlot.embed || visionSlot.embed.length !== embed.length) {
    visionSlot.embed = new Float32Array(embed.length);
    visionSlot.dim = embed.length;
  }
  visionSlot.embed.set(embed);
  visionSlot.novelty = Math.max(0, Math.min(1, novelty));
  visionSlot.ts = now();
}

/**
 * Read the freshest vision embedding, or `null` if none has been
 * published within VISION_FRESHNESS_MS. Returns an internal buffer —
 * do not mutate.
 */
export function readVisionEmbedding(): {
  embed: Float32Array;
  dim: number;
  novelty: number;
} | null {
  if (!visionSlot.embed) return null;
  if (now() - visionSlot.ts > VISION_FRESHNESS_MS) return null;
  return { embed: visionSlot.embed, dim: visionSlot.dim, novelty: visionSlot.novelty };
}

/**
 * Testing / debug: force-clear all slots. Not called by production code.
 */
export function _resetSensoryBridge(): void {
  solfeggioSlot.ts = -Infinity;
  flowerSlot.ts = -Infinity;
  visionSlot.ts = -Infinity;
  visionSlot.novelty = 0;
  solfeggioSlot.buf.fill(0);
  flowerSlot.buf.fill(0);
  if (visionSlot.embed) visionSlot.embed.fill(0);
}
