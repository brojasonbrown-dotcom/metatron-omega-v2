/**
 * @metatron/field-kernel-core/portFlags
 *
 * Phase 1 · Step 2 — canonical location of the port kill-switch registry.
 *
 * Every wave that lands V10 surface in V12/V13 must check its flag here.
 * Default OFF: V13 keeps its pre-port behaviour until the flag flips. Flags
 * read from import.meta.env (Vite context) or process.env (Node/tsx/esbuild
 * context) so they can be toggled per-build without code changes, with
 * sensible runtime defaults.
 *
 * Consumers previously imported from "@/core/runtime/portFlags"; that path
 * is now a pure re-export shim so browser bundles pick up the same table
 * the daemon does.
 *
 * Order mirrors docs/v12_migration/MANIFEST.md (waves 1–10) followed by
 * F4 sub-flags. Adding a flag = extend the union AND the DEFAULTS map.
 */

type FlagKey =
  | 'FLAG_WOLFRAM_CONSTANTS_V10'
  | 'FLAG_LADDER_CLOSURE_5AXIS'
  | 'FLAG_DRIVERBANK_LIVE'
  | 'FLAG_BIO_REBUILD_LIVE'
  | 'FLAG_PINEAL_MACRO_LIVE'
  | 'FLAG_SELF_VALIDATION_LIVE'
  | 'FLAG_LANCZOS_TOPK_LIVE'
  | 'FLAG_IDENTITY_LAYER_LIVE'
  | 'FLAG_AI_SURFACE_LIVE'
  | 'FLAG_PORT_PANELS_LIVE'
  | 'FLAG_F2_WAVE2_PRECISION'
  | 'FLAG_WAVE2_PRECISION'
  // Hardware-saturation waves (H1..H4). All default OFF; bit-exact parity
  // when OFF. See .lovable/plan.md "Hardware-Saturation & Real-Compute Plan".
  | 'FLAG_HARDWARE_FULL_BOOT'
  | 'FLAG_FRAMEWORKS_LIVE'
  | 'FLAG_SIMD_KERNEL'
  | 'FLAG_CARRIER_STACK'
  // Wolfram-pass (App ID WX4LH6W5AU, 2026-06-17): when ON, the orchestrator
  // normalises carrier-stack aggregates by the exact rational 1741/1728 and
  // anchors phase-drift diagnostics to the reciprocal-Fibonacci-55 target.
  // OFF preserves bit-exact pre-Wolfram-pass behaviour.
  | 'FLAG_GOLDEN_SHARD'
  // Phase 3a — tiled streaming shards. When ON, FieldWorkerPool subdivides
  // any shard whose node count exceeds MAX_NODES_PER_SHARD into tiles
  // round-robined across workers. Bit-identical when OFF (default).
  | 'FLAG_TILED_KERNEL'
  // Phase 3b — Lanczos top-K projection for N ≥ 4096. Reserved; no
  // behaviour change until the BandedGram port lands. OFF preserves the
  // dense full-mode kernel exactly.
  | 'FLAG_LANCZOS_TOPK'
  // F4 Geometric uplift (Phase F4-α..ε). All default OFF; bit-identical
  // to F4.golden.json when OFF. See .lovable/plan.md "F4 Geometric —
  // Completion & Stabilization Plan".
  | 'FLAG_F4_CONST_BANK'      // α — constant-bank consolidation (no-op runtime)
  | 'FLAG_F4_SILVER'          // β — silver-ratio / octagonal family
  | 'FLAG_F4_EXTENDED_SOLIDS' // γ — Archimedean/Catalan/Kepler-Poinsot catalog
  | 'FLAG_F4_SPECTRUM'        // δ — 291-octave geometric scale spectrum
  | 'FLAG_F4_PHI2K'           // ε — φ⁻²ᵏ ring decay + honeycomb layer
  // Phase 2 (RHUFT-F Layers 1 + 4). Both default OFF; runtime bit-identical
  // to end-of-Phase-1 when OFF. When ON, the ShadowStateTape allocates
  // FieldStateN per scale and the metric bank publishes unclamped
  // drift/coherence/closure/ρ_I/burden/inertia/Lyapunov readouts.
  | 'FLAG_RHUFTF_STATE_TUPLE'
  | 'FLAG_RHUFTF_METRICS'
  // Phase 4 (RHUFT-F per-scale framework rebuild). Each scale n∈[0..8]
  // gets a pair: FLAG_LEGACY_FRAMEWORK_n (default ON — preserves current
  // compute path bit-identically) and FLAG_RHUFTF_FRAMEWORK_n (default OFF
  // — enables the new read-only measurement module for that scale). The
  // two are non-exclusive by design: the measurement module reads the
  // legacy output, it never replaces it.
  | 'FLAG_LEGACY_FRAMEWORK_0'  | 'FLAG_RHUFTF_FRAMEWORK_0'
  | 'FLAG_LEGACY_FRAMEWORK_1'  | 'FLAG_RHUFTF_FRAMEWORK_1'
  | 'FLAG_LEGACY_FRAMEWORK_2'  | 'FLAG_RHUFTF_FRAMEWORK_2'
  | 'FLAG_LEGACY_FRAMEWORK_3'  | 'FLAG_RHUFTF_FRAMEWORK_3'
  | 'FLAG_LEGACY_FRAMEWORK_4'  | 'FLAG_RHUFTF_FRAMEWORK_4'
  | 'FLAG_LEGACY_FRAMEWORK_5'  | 'FLAG_RHUFTF_FRAMEWORK_5'
  | 'FLAG_LEGACY_FRAMEWORK_6'  | 'FLAG_RHUFTF_FRAMEWORK_6'
  | 'FLAG_LEGACY_FRAMEWORK_7'  | 'FLAG_RHUFTF_FRAMEWORK_7'
  | 'FLAG_LEGACY_FRAMEWORK_8'  | 'FLAG_RHUFTF_FRAMEWORK_8'
  // Phase 5 · Step 2 — canonical local-update per-scale writers. Each
  // FLAG_RHUFTF_LOCAL_UPDATE_<n> gates registration of the corresponding
  // U_n module into the localUpdateRegistry (default OFF). When all off
  // the registry stays empty and CanonicalUpdateBank (Step 4) is a no-op.
  | 'FLAG_RHUFTF_LOCAL_UPDATE_0'
  | 'FLAG_RHUFTF_LOCAL_UPDATE_1'
  | 'FLAG_RHUFTF_LOCAL_UPDATE_2'
  | 'FLAG_RHUFTF_LOCAL_UPDATE_3'
  | 'FLAG_RHUFTF_LOCAL_UPDATE_4'
  | 'FLAG_RHUFTF_LOCAL_UPDATE_5'
  | 'FLAG_RHUFTF_LOCAL_UPDATE_6'
  | 'FLAG_RHUFTF_LOCAL_UPDATE_7'
  | 'FLAG_RHUFTF_LOCAL_UPDATE_8'
  // Phase 5 · Step 4 — CanonicalUpdateBank orchestrator. When OFF (default)
  // CanonicalUpdateBank.step() is a no-op returning null and the runtime is
  // byte-identical to end-of-Phase-4. When ON, the bank iterates registered
  // U_n modules into a shadow "next tape" and emits per-tick
  // CanonicalUpdateSnapshot diagnostics. NEVER writes into the physics tape.
  | 'FLAG_RHUFTF_CANONICAL_UPDATE'
  // Phase 6 · Step 2 — MasterUpdateController delegate cut-over. When OFF
  // (default) the controller ignores the canonical bank's per-scale next
  // tape for Ψ commit — the master law owns Ψ, matching Phase-5 Step-8
  // observation-only semantics. When ON *and* FLAG_RHUFTF_CANONICAL_UPDATE
  // is also ON, the controller projects Ψ into the full ladder via
  // LadderProjection, steps the CanonicalUpdateBank, and pulls the bank's
  // per-scale next tape back into Ψ before the triadic gate. The gate,
  // ring push, and V trace are reused verbatim — only the Ψ commit
  // *source* changes. Never enables the delegate branch when the parent
  // FLAG_RHUFTF_CANONICAL_UPDATE flag is OFF (see MasterUpdateController).
  | 'FLAG_RHUFTF_CONTROLLER_DELEGATE'
  // Phase 7 · Step 2 — daemon-side CanonicalBankTicker. When OFF (default)
  // the Node daemon's optional CanonicalBankTicker never allocates the
  // wrapped MasterUpdateController and `tick()` returns null — byte-inert
  // relative to the pre-Phase-7 daemon. When ON, the daemon steps the same
  // RHUFT-F canonical pipeline as the browser controller (proven
  // byte-identical by Phase 7 · Step 4 parity script). Independent of
  // FLAG_RHUFTF_CANONICAL_UPDATE / FLAG_RHUFTF_CONTROLLER_DELEGATE —
  // the daemon must set BOTH the daemon-bank flag AND the canonical /
  // delegate flags to actually observe non-null snapshots.
  | 'FLAG_RHUFTF_DAEMON_BANK'
  // Ω-REAL P5 — memristive (Joglekar-window) plasticity on the L1 associative
  // matrix in place of the saturating-linear Hebb rule. Default OFF; OFF is
  // bit-identical to the pre-P5 update.
  | 'FLAG_MEMRISTIVE_L1';


const DEFAULTS: Record<FlagKey, boolean> = {
  FLAG_MEMRISTIVE_L1: false,
  // Wave 1 is non-behavioural (constants only) — safe to default ON.
  FLAG_WOLFRAM_CONSTANTS_V10: true,
  FLAG_LADDER_CLOSURE_5AXIS: false,
  FLAG_DRIVERBANK_LIVE: false,
  FLAG_BIO_REBUILD_LIVE: false,
  FLAG_PINEAL_MACRO_LIVE: false,
  FLAG_SELF_VALIDATION_LIVE: false,
  FLAG_LANCZOS_TOPK_LIVE: false,
  FLAG_IDENTITY_LAYER_LIVE: false,
  FLAG_AI_SURFACE_LIVE: false,
  FLAG_PORT_PANELS_LIVE: false,
  FLAG_F2_WAVE2_PRECISION: false,
  FLAG_WAVE2_PRECISION: false,
  FLAG_HARDWARE_FULL_BOOT: false,
  // Phase 16 · Step 5 — framework orchestrator default-ON. The F1..F9
  // chain runs in a dedicated worker, fire-and-forget off the engine's hot
  // path (250 ms watchdog). Set VITE_FLAG_FRAMEWORKS_LIVE=0 to restore the
  // pre-Phase-16 silent path.
  FLAG_FRAMEWORKS_LIVE: true,
  FLAG_SIMD_KERNEL: false,
  FLAG_CARRIER_STACK: false,
  FLAG_GOLDEN_SHARD: false,
  FLAG_TILED_KERNEL: false,
  FLAG_LANCZOS_TOPK: false,
  FLAG_F4_CONST_BANK: false,
  FLAG_F4_SILVER: false,
  FLAG_F4_EXTENDED_SOLIDS: false,
  FLAG_F4_SPECTRUM: false,
  FLAG_F4_PHI2K: false,
  // ── Phase 16 — Multi-Scale Ladder Activation (n = 0..8) ──────────────
  // Pre-flip baseline sealed in vendor/archive/phase16/step1/.
  //
  // Step 2 — observation substrate. The tape mirrors ψ per scale; the
  // metric bank derives drift / temporal coherence / closure / information
  // density / burden / inertia / Lyapunov energy. Neither writes into the
  // physics buffers, so this pair is read-only by construction.
  FLAG_RHUFTF_STATE_TUPLE: true,
  FLAG_RHUFTF_METRICS: true,
  // Step 3 — nine measurement operators O_n. LEGACY_FRAMEWORK_n stay ON so
  // the legacy scalar chain and the RHUFT-F ladder run side-by-side and any
  // divergence is visible rather than silent.
  FLAG_LEGACY_FRAMEWORK_0: true,  FLAG_RHUFTF_FRAMEWORK_0: true,
  FLAG_LEGACY_FRAMEWORK_1: true,  FLAG_RHUFTF_FRAMEWORK_1: true,
  FLAG_LEGACY_FRAMEWORK_2: true,  FLAG_RHUFTF_FRAMEWORK_2: true,
  FLAG_LEGACY_FRAMEWORK_3: true,  FLAG_RHUFTF_FRAMEWORK_3: true,
  FLAG_LEGACY_FRAMEWORK_4: true,  FLAG_RHUFTF_FRAMEWORK_4: true,
  FLAG_LEGACY_FRAMEWORK_5: true,  FLAG_RHUFTF_FRAMEWORK_5: true,
  FLAG_LEGACY_FRAMEWORK_6: true,  FLAG_RHUFTF_FRAMEWORK_6: true,
  FLAG_LEGACY_FRAMEWORK_7: true,  FLAG_RHUFTF_FRAMEWORK_7: true,
  FLAG_LEGACY_FRAMEWORK_8: true,  FLAG_RHUFTF_FRAMEWORK_8: true,
  // Step 4 — nine local-update kernels U_n. Gated by the canonical-vs-master
  // ULP suite, the delegate-invariant suite, and cross-runtime parity.
  // Note: MasterUpdateController force-registers U_0..U_8 for its own
  // delegate path, so these flags govern the *public* registry consumed by
  // CanonicalUpdateBank instances outside the controller (daemon ticker,
  // freeze harnesses, panel bootstraps).
  FLAG_RHUFTF_LOCAL_UPDATE_0: true,
  FLAG_RHUFTF_LOCAL_UPDATE_1: true,
  FLAG_RHUFTF_LOCAL_UPDATE_2: true,
  FLAG_RHUFTF_LOCAL_UPDATE_3: true,
  FLAG_RHUFTF_LOCAL_UPDATE_4: true,
  FLAG_RHUFTF_LOCAL_UPDATE_5: true,
  FLAG_RHUFTF_LOCAL_UPDATE_6: true,
  FLAG_RHUFTF_LOCAL_UPDATE_7: true,
  FLAG_RHUFTF_LOCAL_UPDATE_8: true,
  // Phase 8 — default-ON cutover for the RHUFT-F canonical bank stack.
  // Pre-flip baseline sealed in vendor/archive/phase8/step1/. The flip
  // changes WHICH code path runs, not the physics that path produces
  // (proven by phase8Step3DefaultOnFreeze.ts). Set to `0` via env to
  // restore the pre-Phase-8 behaviour byte-identically (proven by
  // phase8Step4ReversibilityFreeze.ts).
  FLAG_RHUFTF_CANONICAL_UPDATE: true,
  FLAG_RHUFTF_CONTROLLER_DELEGATE: true,
  FLAG_RHUFTF_DAEMON_BANK: true,
};


function parseBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  return raw === '1' || raw === 'true';
}

function readEnv(k: FlagKey): boolean | undefined {
  const key = `VITE_${k}`;
  // 1) Vite-injected import.meta.env (browser / Vite build).
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    const v = parseBool(env?.[key]);
    if (v !== undefined) return v;
  } catch { /* not in a Vite context */ }
  // 2) process.env fallback (bun / node scripts, generators, CI, daemon).
  try {
    if (typeof process !== 'undefined' && process?.env) {
      const v = parseBool(process.env[key]);
      if (v !== undefined) return v;
    }
  } catch { /* no process global */ }
  return undefined;
}

export type { FlagKey };

/**
 * Session-scoped runtime overrides (Phase S6). Precedence:
 *   runtime override  >  env (`VITE_<FLAG>` / `process.env`)  >  DEFAULTS
 *
 * Overrides live in the *current JS realm only* — they are deliberately not
 * persisted and not propagated into Web Workers or the Node daemon, so the
 * env value stays the reproducible boot default. Intended for operator
 * experiments from the SCALES console, never for shipping configuration.
 */
const OVERRIDES = new Map<FlagKey, boolean>();

export function portFlag(k: FlagKey): boolean {
  const ov = OVERRIDES.get(k);
  if (ov !== undefined) return ov;
  const env = readEnv(k);
  return env ?? DEFAULTS[k];
}

/** Boot value with no runtime override applied. */
export function portFlagBaseline(k: FlagKey): boolean {
  return readEnv(k) ?? DEFAULTS[k];
}

export function setPortFlagOverride(k: FlagKey, value: boolean | null): void {
  if (value === null) OVERRIDES.delete(k);
  else OVERRIDES.set(k, value);
}

export function portFlagOverride(k: FlagKey): boolean | undefined {
  return OVERRIDES.get(k);
}

export function clearPortFlagOverrides(): void {
  OVERRIDES.clear();
}

export function allFlagKeys(): readonly FlagKey[] {
  return Object.keys(DEFAULTS) as FlagKey[];
}

export const PORT_FLAGS: Record<FlagKey, boolean> = Object.fromEntries(
  (Object.keys(DEFAULTS) as FlagKey[]).map((k) => [k, portFlag(k)]),
) as Record<FlagKey, boolean>;
