/// <reference lib="webworker" />
/**
 * Ω-P4 — the engine worker.
 *
 * The tick loop never touches the UI thread. This worker owns the probe, the
 * governor verdict and the EngineHost, pumps a budgeted slice per frame, and
 * emits an immutable snapshot at the host's adaptive bus rate (8–64 Hz).
 *
 * Protocol is intentionally tiny and fully typed in `omegaProtocol.ts`.
 */

import {
  EngineHost,
  probeHardware,
  selectProfile,
  verifyFootprint,
  profileById,
  profileNodes,
  profileCost,
  PROFILES_BY_TIER,
  probeTiers,
  type HardwareProbe,
  type GovernorVerdict,
  type ProfileId,
} from '@metatron/trnn-core';
import type { OmegaCommand, OmegaEvent } from './omegaProtocol';

let host: EngineHost | null = null;
let probe: HardwareProbe | null = null;
let verdict: GovernorVerdict | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let lastFrame = 0;
let lastEmit = 0;

const post = (e: OmegaEvent) => (self as unknown as Worker).postMessage(e);

function build(profileId: ProfileId, seed: string) {
  host?.stop();
  // The governor's sustainable rate is the contract; without it the host would
  // silently default to its ceiling and outrun the measured hardware budget.
  host = new EngineHost({
    profile: profileId,
    seed,
    sliceBudgetMs: 8,
    targetHz: verdict?.targetHz ?? 64,
  });

  const p = profileById(profileId);
  post({
    type: 'built',
    profile: profileId,
    seed,
    footprint: verifyFootprint(p, host.snapshot().predictedBytes),
    snapshot: host.snapshot(),
  });
  post({ type: 'described', description: host.describe() });
}

function loop() {
  if (!host) return;
  const now = performance.now();
  const elapsed = lastFrame === 0 ? 16 : Math.min(250, now - lastFrame);
  lastFrame = now;
  host.pump(now, elapsed);
  const snap = host.snapshot();
  const period = 1000 / Math.max(1, snap.busHz);
  if (now - lastEmit >= period) {
    lastEmit = now;
    post({ type: 'snapshot', snapshot: snap });
  }
}

function ensureTimer() {
  if (timer === null) timer = setInterval(loop, 8);
}

self.onmessage = async (ev: MessageEvent<OmegaCommand>) => {
  const cmd = ev.data;
  try {
    switch (cmd.type) {
      case 'probe': {
        probe = await probeHardware();
        verdict = selectProfile(probe, { targetHz: cmd.targetHz ?? 64 });
        post({
          type: 'probed',
          probe,
          verdict: {
            selected: verdict.selected.id,
            targetHz: verdict.targetHz,
            headroom: verdict.headroom,
            maxHz: verdict.maxHz,
            degraded: verdict.degraded,
            memoryConstrained: verdict.memoryConstrained,
            table: verdict.table.map((r) => ({ ...r })),
          },
          profiles: PROFILES_BY_TIER.map((p) => {
            const nodes = profileNodes(p);
            const cost = profileCost(p);
            return {
              id: p.id,
              tier: p.tier,
              rungs: p.rungs,
              modes: p.modes,
              note: p.note,
              nodes,
              totalNodes: cost.nodes,
              bytes: cost.bytes,
            };
          }),
        });
        break;
      }
      case 'build':
        build(cmd.profile, cmd.seed ?? 'metatron-omega');
        break;
      case 'start':
        if (!host) build(verdict?.selected.id ?? 'PICO', 'metatron-omega');
        host!.start();
        lastFrame = 0;
        ensureTimer();
        post({ type: 'running', running: true });
        break;
      case 'stop':
        host?.stop();
        post({ type: 'running', running: false });
        break;
      case 'setHz':
        host?.setTargetHz(cmd.hz);
        break;
      case 'describe':
        if (host) post({ type: 'described', description: host.describe() });
        break;
      case 'field':
        if (host) post({ type: 'field', frame: host.field(cmd.rank, cmd.maxSamples ?? 610) });
        break;
      case 'web':
        if (host) post({ type: 'web', view: host.web(cmd.tail ?? 24) });
        break;
      case 'spectral':
        if (host) post({ type: 'spectral', view: host.spectral(cmd.rank) });
        break;
      case 'scan':
        if (host) post({ type: 'scan', rank: cmd.rank, report: host.scan(cmd.rank) });
        break;
      case 'sense':
        if (host) post({ type: 'sense', view: host.sense() });
        break;
      case 'memory':
        if (host) post({ type: 'memory', view: host.memory() });
        break;
      case 'mind':
        if (host) post({ type: 'mind', report: host.cognition() });
        break;
      case 'reflect':
        if (host) post({ type: 'reflect', trace: host.reflect(cmd.k ?? 5) });
        break;
      case 'learn': {
        if (!host) break;
        // Explicit operator action. It is synchronous and takes seconds, so the
        // tick loop is paused for the duration and resumed exactly where it was
        // (the engine state is never touched by the battery).
        const wasRunning = host.snapshot().running;
        post({ type: 'learning', busy: true });
        if (wasRunning) host.stop();
        try {
          const run = host.learn({ iterations: cmd.iterations, nodes: cmd.nodes });
          post({ type: 'learn', run });
        } finally {
          if (wasRunning) {
            host.start();
            lastFrame = 0;
          }
          post({ type: 'learning', busy: false });
        }
        break;
      }
      case 'tiers': {
        const map = await probeTiers({
          sidecarUrl: cmd.sidecarUrl,
          hostedUrl: cmd.hostedUrl,
        });
        post({ type: 'tiers', map });
        break;
      }
      case 'senseDeclare':
        host?.declareChannel(cmd.id, cmd.modality, cmd.nodes, cmd.gain ?? 1);
        if (host) post({ type: 'sense', view: host.sense() });
        break;
      case 'sensePush':
        if (host) {
          host.pushChannel(cmd.id, cmd.text ?? cmd.data ?? [], {
            width: cmd.width,
            height: cmd.height,
          });
          post({ type: 'sense', view: host.sense() });
        }
        break;
      case 'senseMute':
        host?.muteChannel(cmd.id);
        if (host) post({ type: 'sense', view: host.sense() });
        break;
      case 'senseGain':
        host?.setSenseGain(cmd.gain);
        if (host) post({ type: 'sense', view: host.sense() });
        break;
      case 'checkpoint': {
        if (host) post({ type: 'checkpointed', tick: host.checkpoint().tick });
        break;
      }
      case 'dispose':
        host?.stop();
        if (timer !== null) clearInterval(timer);
        timer = null;
        host = null;
        break;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
