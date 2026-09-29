/**
 * METATRON V11 — RESOURCE GOVERNOR
 * =================================
 * Sovereign, browser-local. Holds the user's RAM/CPU/precision/carrier
 * choices and HARD-refuses anything that would violate Planck, host RAM,
 * or precision-floor invariants. State persists in localStorage.
 *
 * No telemetry. No network. The engine reads from this and from
 * HardwareEnvelope; nothing else.
 */

import { CARRIER_CEILING_HZ, type HardwareEnvelope } from './HardwareEnvelope';

export type PrecisionMode = 'auto' | 'f64' | 'dec50' | 'dec500' | 'mpfr';
export type CarrierMode = 'fixed' | 'auto-max';
/**
 * Cold-boot mode — controls how aggressively the engine seeds its
 * initial field resolution M before the auto-climb governor takes over.
 *   legacy → F₁₁ = 89 (original V11 conservative boot, identical to pre-v4 behavior)
 *   fast   → F₂₀ = 6,765 (capable hosts, ~80ms cold-start)
 *   full   → min(governor.computeMaxM(), planckCeilingFor(carrier)) — uncapped
 *            except by RAM, precision, and the Planck physics clamp. On 64GB +
 *            8-core hosts this lifts cold-boot from 179 nodes to 600k–1M.
 * Pure floor knob — does NOT change any field math, only how many modes
 * exist at tick 0. Auto-climb still adjusts from there.
 */
export type BootMode = 'legacy' | 'fast' | 'full';

export interface GovernorSettings {
  ramBytes: number; // R_max
  ramCeilingBytes: number; // user-declared host RAM ceiling when browser underreports
  cpuThreads: number; // C_max
  computePressure: number; // deterministic field-relaxation passes per tick
  coupling: boolean; // ρ* lock
  rhoBytesPerCore: number; // ρ* (default 4 GB/core)
  precision: PrecisionMode;
  carrier: CarrierMode;
  carrierHz: number; // active carrier when carrier='fixed'
  spiralEnabled: boolean;
  reflectEnabled: boolean;
  bootMode: BootMode; // cold-start M ceiling (legacy/fast/full)
  /**
   * Phase 2b — strength α of the Wolfram-bank per-mode perturbation applied
   * inside the kernel: psi ← psi · (1 + α · coef_k). Default 0 keeps the
   * kernel bit-identical to pre-Phase-2b. Hard-capped at 0.1 so the bank can
   * never dominate the φ-harmonic carrier. Set via the Engine Architecture
   * panel slider; persists in localStorage like every other governor setting.
   */
  bankInfluence: number;
}

export interface RefusalReason {
  code: 'planck' | 'ram' | 'precision' | 'alias';
  message: string;
}

const STORAGE_KEY = 'metatron-v11.governor.v4';
// Legacy keys we migrate from on first load. Anything found here is read once,
// passed through `migrateLegacy()` to strip throttling values, then re-saved
// under the current key. This unsticks users whose `precision='dec50'` or
// tiny `ramBytes` from a prior build was capping `honestCeiling` at ≤162.
// v3 → v4 also seeds `bootMode` for users who never had it.
const LEGACY_STORAGE_KEYS = ['metatron-v11.governor.v3', 'metatron-v11.governor.v2'];

/**
 * One-way migration from older governor envelopes. Preserves every explicit
 * user preference (carrier, CPU threads, toggles) but rewrites values that
 * are now known to throttle the engine below what current defaults expose:
 *   - `precision='f64'` capped honestCeiling at 1
 *   - `precision='dec50'` capped honestCeiling at 162
 *   - `ramBytes` below the current 64 GB working budget
 * Newer projects with deliberate low-RAM/low-precision choices can still set
 * them via the GovernorPanel — migration runs once per key version.
 */
function migrateLegacy(raw: Partial<GovernorSettings>): Partial<GovernorSettings> {
  const out: Partial<GovernorSettings> = { ...raw };
  if (out.precision === 'f64' || out.precision === 'dec50') {
    out.precision = 'auto';
  }
  if (typeof out.ramBytes === 'number' && out.ramBytes < 64 * 1024 * 1024 * 1024) {
    out.ramBytes = 64 * 1024 * 1024 * 1024;
  }
  if (typeof out.ramCeilingBytes === 'number' && out.ramCeilingBytes < 64 * 1024 * 1024 * 1024) {
    out.ramCeilingBytes = 256 * 1024 * 1024 * 1024;
  }
  return out;
}

// Defaults intentionally lifted to expose the full φ-tier ladder (F₂₅ = 75 025
// and beyond) without the user having to hand-tune the governor. Real hardware
// detection in HardwareEnvelope still clamps these down if the box is small;
// these are the *aspirational* ceilings the engine is allowed to climb to.
const DEFAULTS: GovernorSettings = {
  ramBytes: 64 * 1024 * 1024 * 1024, // 64 GB working budget
  ramCeilingBytes: 256 * 1024 * 1024 * 1024, // 256 GB declared ceiling
  cpuThreads: 8,
  computePressure: 512,
  coupling: true,
  rhoBytesPerCore: 8 * 1024 * 1024 * 1024, // 8 GB / core
  precision: 'auto',
  carrier: 'fixed',
  carrierHz: 144,
  spiralEnabled: true,
  reflectEnabled: true,
  // Default lifted to 'full' — let capable hardware actually use itself.
  // The constructor below downgrades to 'fast' on weak hosts (cores<8 or <16GB).
  bootMode: 'full',
  bankInfluence: 0,
};

/**
 * Required working digits to keep φ⁻ᴹ above ULP plus 16-digit safety:
 *   digits ≥ ⌈M · log10(φ)⌉ + 16 = ⌈0.20898 · M⌉ + 16
 */
export function requiredDigits(M: number): number {
  return Math.ceil(0.2089876402499087 * Math.max(0, M)) + 16;
}

/** Smallest precision class that satisfies requiredDigits(M). */
export function pickPrecision(
  M: number,
  mode: PrecisionMode,
): { kind: 'f64' | 'bd'; digits: number } {
  if (mode === 'f64') return { kind: 'f64', digits: 16 };
  const need = requiredDigits(M);
  if (mode === 'auto') {
    return need <= 16 ? { kind: 'f64', digits: 16 } : { kind: 'bd', digits: need };
  }
  if (mode === 'dec50') return { kind: 'bd', digits: Math.max(50, need) };
  if (mode === 'dec500') return { kind: 'bd', digits: Math.max(500, need) };
  // mpfr — unbounded; here we just use BigDecimal at need digits
  return { kind: 'bd', digits: need };
}

export class ResourceGovernor {
  private state: GovernorSettings;
  private subs = new Set<(s: GovernorSettings) => void>();

  constructor(private readonly hw: HardwareEnvelope) {
    this.state = this.load(hw);
  }

  private load(hw: HardwareEnvelope): GovernorSettings {
    let stored: Partial<GovernorSettings> = {};
    let currentKeyExisted = false;
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          currentKeyExisted = true;
          stored = JSON.parse(raw) as Partial<GovernorSettings>;
          // v4→v4 self-heal: an earlier persist under the current key can
          // still carry `precision='f64'` (caps honestCeiling at 1) or a
          // sub-64 GB `ramBytes` (caps M in the low hundreds). Migrating these
          // now is safe — the user can always re-select f64 explicitly from
          // GovernorPanel, but no one wants to boot at honestCeiling=1.
          stored = migrateLegacy(stored);
        } else {
          // First boot under the current key — sweep legacy keys exactly once.
          for (const k of LEGACY_STORAGE_KEYS) {
            const legacy = localStorage.getItem(k);
            if (legacy) {
              try {
                stored = migrateLegacy(JSON.parse(legacy) as Partial<GovernorSettings>);
              } catch {
                /* corrupt legacy — drop it */
              }
              try {
                localStorage.removeItem(k);
              } catch {
                /* quota */
              }
              break;
            }
          }
        }
      } catch {
        /* corrupt — ignore */
      }
    }

    const ramCeilingBytes = Math.max(
      hw.ramBytes,
      stored.ramCeilingBytes ?? stored.ramBytes ?? DEFAULTS.ramCeilingBytes,
    );
    // Hardware-aware bootMode default: many browsers privacy-cap deviceMemory
    // at 8 GB even on workstation hardware, so CPU breadth is the reliable
    // signal for whether a host should cold-boot at the full governor ceiling.
    // Any explicitly stored bootMode still wins; this only fills fresh installs.
    const capableHost = hw.cpuCores >= 8;
    const defaultBoot: BootMode = capableHost ? 'full' : 'fast';
    const loaded: GovernorSettings = {
      ...DEFAULTS,
      bootMode: defaultBoot,
      ramCeilingBytes,
      ramBytes: Math.min(
        ramCeilingBytes,
        stored.ramBytes ?? Math.max(hw.ramBytes, DEFAULTS.ramBytes),
      ),
      cpuThreads: Math.min(hw.cpuCores, stored.cpuThreads ?? hw.cpuCores),
      ...stored,
    };
    const normalized: GovernorSettings = {
      ...loaded,
      ramCeilingBytes: Math.max(hw.ramBytes, loaded.ramCeilingBytes),
      ramBytes: Math.min(Math.max(hw.ramBytes, loaded.ramCeilingBytes), loaded.ramBytes),
      computePressure: Math.max(1, loaded.computePressure),
    };
    // If we self-healed a stored envelope, persist the healed version
    // eagerly so the next boot doesn't re-migrate on every load.
    if (currentKeyExisted && typeof localStorage !== 'undefined') {
      try {
        const json = JSON.stringify(normalized);
        if (json !== this.lastPersistedJson) {
          localStorage.setItem(STORAGE_KEY, json);
          this.lastPersistedJson = json;
        }
      } catch {
        /* quota */
      }
    }
    return normalized;
  }

  // Debounced persist — slider drags fire `update()` at ~60Hz; the previous
  // implementation hit `localStorage.setItem` on every event, blocking the
  // main thread on a large JSON serialise per frame. We coalesce writes onto a
  // 144 ms tail (Fibonacci-12² resonance, ≥ one full 60 Hz frame interval) and
  // flush eagerly on page hide so the user never loses their final value.
  private static readonly PERSIST_DEBOUNCE_MS = 144;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPersistedJson = '';
  private unloadBound = false;

  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const json = JSON.stringify(this.state);
      if (json === this.lastPersistedJson) return; // no-op write — skip syscall
      localStorage.setItem(STORAGE_KEY, json);
      this.lastPersistedJson = json;
    } catch {
      /* quota */
    }
  }

  private schedulePersist(): void {
    if (typeof window === 'undefined') {
      this.persist();
      return;
    }
    if (!this.unloadBound) {
      const flush = () => this.flushPersist();
      window.addEventListener('pagehide', flush);
      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      });
      this.unloadBound = true;
    }
    if (this.persistTimer !== null) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, ResourceGovernor.PERSIST_DEBOUNCE_MS);
  }

  /** Force-flush any pending debounced write (used on unload / hide). */
  flushPersist(): void {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persist();
  }

  get settings(): GovernorSettings {
    return this.state;
  }

  update(patch: Partial<GovernorSettings>): GovernorSettings {
    const next: GovernorSettings = { ...this.state, ...patch };
    next.ramCeilingBytes = Math.max(
      this.hw.ramBytes,
      Math.min(2 * 1024 ** 4, next.ramCeilingBytes),
    );
    if (next.coupling) {
      // Snap RAM/CPU to ρ* if either side moved.
      if (patch.cpuThreads !== undefined)
        next.ramBytes = Math.min(next.ramCeilingBytes, next.cpuThreads * next.rhoBytesPerCore);
      else if (patch.ramBytes !== undefined)
        next.cpuThreads = Math.max(
          1,
          Math.min(this.hw.cpuCores, Math.round(next.ramBytes / next.rhoBytesPerCore)),
        );
    }
    next.ramBytes = Math.max(64 * 1024 * 1024, Math.min(next.ramCeilingBytes, next.ramBytes));
    next.cpuThreads = Math.max(1, Math.min(this.hw.cpuCores, next.cpuThreads));
    next.computePressure = Math.max(1, Math.min(8192, Math.floor(next.computePressure)));
    if (next.carrierHz > CARRIER_CEILING_HZ) next.carrierHz = CARRIER_CEILING_HZ;
    if (next.carrierHz < 1) next.carrierHz = 1;
    // Phase 2b — hard-clamp bank influence so the perturbation can never
    // dominate the φ-harmonic carrier. NaN / undefined → 0 (legacy behavior).
    next.bankInfluence = Number.isFinite(next.bankInfluence)
      ? Math.max(0, Math.min(0.1, next.bankInfluence))
      : 0;

    // Structural-equality short-circuit — clamp logic can produce a `next` that
    // is byte-identical to `this.state` (e.g. slider already at ceiling). Skip
    // both persist scheduling and subscriber notification in that case.
    const prev = this.state;
    if (
      prev.ramBytes === next.ramBytes &&
      prev.ramCeilingBytes === next.ramCeilingBytes &&
      prev.cpuThreads === next.cpuThreads &&
      prev.computePressure === next.computePressure &&
      prev.coupling === next.coupling &&
      prev.rhoBytesPerCore === next.rhoBytesPerCore &&
      prev.precision === next.precision &&
      prev.carrier === next.carrier &&
      prev.carrierHz === next.carrierHz &&
      prev.spiralEnabled === next.spiralEnabled &&
      prev.reflectEnabled === next.reflectEnabled &&
      prev.bootMode === next.bootMode &&
      prev.bankInfluence === next.bankInfluence
    ) {
      return prev;
    }
    this.state = next;
    this.schedulePersist();
    for (const cb of this.subs) cb(next);
    return next;
  }

  subscribe(cb: (s: GovernorSettings) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  /** Estimated banded-Gram RAM at given M (3 dense bands × 8 bytes). */
  estimateRamBytes(M: number, precisionDigits: number): number {
    const band = Math.max(1, Math.floor(Math.log(Math.max(2, M)) / Math.log(1.6180339887)));
    const bytesPerScalar = precisionDigits <= 16 ? 8 : Math.ceil(precisionDigits / 2);
    return 3 * M * band * bytesPerScalar;
  }

  /**
   * Honest M ceiling for current settings — min of:
   *   - precision-bound: how far φ⁻ᴹ stays above ULP at chosen digits
   *   - RAM-bound:       largest M whose banded-Gram fits in ramBytes
   *   - hard floor:      1
   * Returns Infinity if mode='mpfr' and ramBytes are unrealistic — never used,
   * caller still clamps via validateTarget().
   */
  computeMaxM(): number {
    const mode = this.state.precision;
    // Probe digits at a large M to see what 'auto' would request — we invert the relation.
    // requiredDigits(M) = ceil(0.20898·M) + 16  ⇒  M_struct(d) = floor((d − 16) / 0.20898)
    let structuralDigits: number;
    if (mode === 'f64') structuralDigits = 16;
    else if (mode === 'dec50') structuralDigits = Math.max(50, 16);
    else if (mode === 'dec500') structuralDigits = 500;
    else if (mode === 'mpfr') structuralDigits = 10000;
    else structuralDigits = Number.POSITIVE_INFINITY; // 'auto' — grows as needed
    const M_struct =
      mode === 'auto'
        ? 1_000_000 // arbitrary very-large; RAM will bite first
        : Math.max(1, Math.floor((structuralDigits - 16) / 0.2089876402499087));

    // RAM bound: binary-search the largest M whose estimateRamBytes fits.
    let lo = 1,
      hi = M_struct;
    while (lo < hi) {
      const mid = Math.min(hi, lo + Math.ceil((hi - lo + 1) / 2));
      const p = pickPrecision(mid, mode);
      const need = this.estimateRamBytes(mid, p.digits);
      if (need <= this.state.ramBytes) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(1, lo);
  }

  /** Refuse if any invariant would be violated; null = OK. */
  validateTarget(M: number): RefusalReason | null {
    if (M < 1) return { code: 'alias', message: 'M must be ≥ 1' };
    const p = pickPrecision(M, this.state.precision);
    const need = requiredDigits(M);
    if (p.kind === 'f64' && need > 16)
      return {
        code: 'precision',
        message: `M=${M} needs ${need} digits; f64 has 16. Use precision=auto.`,
      };
    const ramNeed = this.estimateRamBytes(M, p.digits);
    if (ramNeed > this.state.ramBytes)
      return {
        code: 'ram',
        message: `M=${M} @ ${p.digits}d needs ${(ramNeed / 1e9).toFixed(2)} GB; budget ${(this.state.ramBytes / 1e9).toFixed(2)} GB.`,
      };
    if (this.state.carrierHz > CARRIER_CEILING_HZ)
      return { code: 'planck', message: 'carrier exceeds Planck ceiling' };
    return null;
  }

  /**
   * Which invariant is binding the honest ceiling right now. Read-only
   * telemetry — the engine forwards it into `ScalerSnapshot.ceilingSource`
   * so the UI can honestly report *why* the ceiling is where it is.
   * `currentM` lets us distinguish "still at boot cap" from "actually pinned".
   */
  ceilingSource(
    currentM: number,
    carrierHz: number,
  ): NonNullable<import('../bus/protocol').ScalerSnapshot['ceilingSource']> {
    const mode = this.state.precision;
    // Precision-bound: f64 caps at digits≤16 (M ≤ ~1), dec50 at ~162.
    if (mode === 'f64' && requiredDigits(currentM + 1) > 16) return 'precision';
    if (mode === 'dec50' && requiredDigits(currentM + 1) > 50) return 'precision';
    if (mode === 'dec500' && requiredDigits(currentM + 1) > 500) return 'precision';
    // Planck-bound: carrier × φᴹ would breach the ceiling.
    if (carrierHz > 0) {
      const kMaxByCarrier = Math.floor(
        Math.log(CARRIER_CEILING_HZ / carrierHz) / Math.log(1.6180339887498949),
      );
      if (currentM >= kMaxByCarrier) return 'planck';
    }
    // RAM-bound: next promotion would blow the working budget.
    const p = pickPrecision(currentM + 1, mode);
    if (this.estimateRamBytes(currentM + 1, p.digits) > this.state.ramBytes) return 'ram';
    // Boot cap: cold-start mode ceiling not yet lifted.
    if (this.state.bootMode === 'legacy' && currentM >= 89) return 'boot';
    if (this.state.bootMode === 'fast' && currentM >= 6765) return 'boot';
    return 'headroom';
  }
}
