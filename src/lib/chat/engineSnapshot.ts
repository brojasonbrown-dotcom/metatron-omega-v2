/**
 * METATRON V11 — Engine snapshot builder.
 *
 * Pure transform: EngineCtx (from src/components/v11/EngineContext) → EngineSnapshot
 * payload safe to JSON-serialize and feed to the LLM. Reads ONLY real V11
 * fields. No mock telemetry. Missing data → null (the system prompt instructs
 * the model to say "I don't have that" rather than fabricate).
 */

import type { EngineCtx } from '@/components/v11/EngineContext';
import type { EngineSnapshot } from './types';
import { PHI, PHI_INV, PHI_SQ, PSI, PI, E } from '@/core/constants/WolframVerified';
import { LYAPUNOV_BANK } from '@/core/v12/audit/LyapunovBank';
import { computeQualiaCorrelate } from '@/core/field/QualiaCorrelate';
import { computeStability } from '@/core/residuals/Stability';
import { listToolNames } from './tools/registry';

const LYAPUNOV_BANK_FOR_SNAPSHOT = Object.fromEntries(
  Object.entries(LYAPUNOV_BANK).map(([k, v]) => [
    k,
    { lambda: v.lambda, symbolic: v.symbolic, source: v.source },
  ]),
);

export function buildEngineSnapshot(
  ctx: EngineCtx,
  toolProtocol: 'markers' | 'native' | 'none' = 'markers',
): EngineSnapshot {
  const res = ctx.residuals;
  let residualsSummary: EngineSnapshot['residuals'] = null;
  if (res) {
    const additive = {
      f4Packing: res.f4Packing,
      f8ZpeResidual: res.f8ZpeResidual,
      f2MassLadder: res.f2MassLadder,
      f2MassLadderBridgedQed: res.f2MassLadderBridge.bridgedQedResidual,
      f2MassLadderBridgedSlope: res.f2MassLadderBridge.bridgedSlopeResidual,
      f2MassLadderSlope: res.f2MassLadderBridge.bridgedSlope,
      f7TitiusBode: res.f7TitiusBode,
      f9CmbPeakRatio: res.f9CmbPeakRatio,
      torusPoloidal: res.torus.poloidal,
      torusToroidal: res.torus.toroidal,
    };
    // maxResidual ignores `f2MassLadderSlope` (signed fit parameter, not a residual)
    // and takes |x| of all other entries so signed bridge residuals don't go negative.
    const additiveValues = Object.entries(additive)
      .filter(([k, v]) => k !== 'f2MassLadderSlope' && Number.isFinite(v))
      .map(([, v]) => Math.abs(v as number));
    const saturation = res.saturation.map((s) => ({ ...s }));
    const maxResidual = Math.max(
      0,
      ...additiveValues,
      ...saturation.map((s) => s.measured).filter(Number.isFinite),
    );
    const okCount = saturation.filter((s) => s.label === 'saturated-OK').length;
    residualsSummary = {
      additive,
      saturation,
      maxResidual,
      okCount,
      totalCount: saturation.length,
    };
  }

  const snap = ctx.fieldSnapshot;
  const caps = ctx.fieldCapabilities;

  // Canonical "coherence" reported to the LLM = MetatronCore φ-weighted Ω,
  // matching what the Workstation header and Diagnostics tab display. The
  // raw driver-slider input is preserved separately as `driverInputCoherence`
  // so callers that need the input value can still read it.
  const omegaCanonical = Number.isFinite(ctx.out?.metatronCoherence)
    ? ctx.out.metatronCoherence
    : ctx.coherence;
  return {
    tick: ctx.tick,
    running: ctx.running,
    fps: ctx.fps,
    coherence: omegaCanonical,
    driverInputCoherence: ctx.coherence,
    energy: ctx.energy,
    uiControls: {
      requestedResolution: ctx.resolution,
    },
    field: {
      state: ctx.fieldState,
      implementation: caps?.kind ?? 'unavailable',
      version: caps?.version ?? null,
      protocol: caps?.protocol ?? null,
      actualNodesEvaluated: snap?.runtime?.nodesEvaluated ?? null,
      nodesInward: snap?.runtime?.nodesInward ?? null,
      nodesAxis: snap?.runtime?.nodesAxis ?? null,
      nodesTotal: snap?.runtime?.nodesTotal ?? null,
      currentM: snap?.scaler.currentM ?? null,
      honestCeiling: snap?.scaler.honestCeiling ?? null,
      honestCeilingTotal: snap?.scaler.honestCeilingTotal ?? null,
      activeWorkers: snap?.runtime?.activeWorkers ?? null,
      workerBacked: snap?.runtime?.workerBacked ?? null,
      computePressure: snap?.runtime?.computePressure ?? null,
      tickMs: snap?.runtime?.tickMs ?? null,
      effectiveOps: snap?.runtime?.effectiveOps ?? null,
      pressureUtilisation: snap?.runtime?.pressureUtilisation ?? null,
      carrierHz: snap?.carrierHz ?? null,
      workingDigits: snap?.workingDigits ?? null,
      precision: snap?.precision ?? null,
      spiral: snap?.spiral ? { ...snap.spiral } : null,
      runtimeCoherence: snap?.coherence ?? null,
      runtimeEnergy: snap?.energy ?? null,
      driversSample: (snap?.drivers ?? []).slice(0, 32).map((d) => ({ ...d })),
    },
    residuals: residualsSummary,
    memory: {
      enabled: ctx.memoryEnabled,
      status: ctx.memoryStatus,
    },
    constants: {
      phi: PHI,
      phi_inv: PHI_INV,
      phi_sq: PHI_SQ,
      psi: PSI,
      pi: PI,
      e: E,
    },
    frameworks: Object.fromEntries(
      ctx.out.chain.map((c) => [
        c.framework,
        {
          scale: c.scale,
          chainUpCoupling: c.chainUpCoupling,
          closureResidual: c.closureResidual,
          masterMetric: c.masterMetric,
        },
      ]),
    ),
    stability: (() => {
      const s = computeStability(ctx.out);
      return { value: s.value, floor: s.floor, target: s.target, band: s.band };
    })(),
    master: (() => {
      const s = computeStability(ctx.out);
      // CRITICAL: `coherenceOmega` is the φ-weighted geometric mean computed
      // by MetatronCore across all 9 rungs (out.metatronCoherence) — NOT the
      // driver-coherence input slider. Reporting ctx.coherence here caused the
      // chat to claim "full coherence" while the field measured ≈0.47.
      const omega = Number.isFinite(ctx.out.metatronCoherence) ? ctx.out.metatronCoherence : 0;
      const f8 = ctx.out.F8;
      return {
        coherenceOmega: omega,
        // Measured warm-field coherence from the live Ω worker (via the engine
        // projection). Distinct axis from the analytic geometric-mean Ω above.
        measuredFieldCoherence: ctx.coherence,
        driverCoherence: ctx.coherence,
        metatronClosure: ctx.out.metatronClosure,
        torusClosure: ctx.out.torusClosure,
        phaseCirculation: ctx.out.phaseCirculation,
        stabilityLambda: s.value,
        stabilityFloor: s.floor,
        // "Full coherence" is an honest claim only when the geometric-mean Ω
        // is at/above 0.95 — driver slider position is irrelevant.
        isFullCoherence: omega >= 0.95,
        f8KappaClosure: Number.isFinite(f8.closureResidual) ? f8.closureResidual : 0,
        f8BoundaryIndex: f8.chapter44.boundaryIndex,
        f8SinkCoupling: f8.chapter44.sinkCoupling,
      };
    })(),
    tools: (() => {
      const names = listToolNames();
      return { available: names.length, protocol: toolProtocol, names };
    })(),

    qualia: (() => {
      const m = ctx.out.F8.superpositionsM.map((n) => n.coherence);
      const q = computeQualiaCorrelate(m);
      return q;
    })(),
    chapter44: ctx.out.F8.chapter44,
    lyapunovBank: LYAPUNOV_BANK_FOR_SNAPSHOT,
    builtAt: new Date().toISOString(),
  };
}
