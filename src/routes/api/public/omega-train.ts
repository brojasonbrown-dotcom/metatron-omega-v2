/**
 * Ω-P8 tier T3 — hosted training endpoint.
 *
 * GET  → capability ping used by the tier probe ({ version, engine }).
 * POST → runs the exact same held-out battery the browser runs, server-side,
 *        with a hard cap on the work a caller can request. Pure TypeScript, no
 *        native deps, so it is safe in the edge runtime.
 *
 * Public by prefix, therefore: no secrets are read, no persistence is touched,
 * every input is validated and clamped, and the response contains only the
 * measured report. There is nothing here an attacker can pivot on beyond CPU,
 * which the caps bound.
 */
import { createFileRoute } from '@tanstack/react-router';

const VERSION = 'omega-p8.1';

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(n)));
};

export const Route = createFileRoute('/api/public/omega-train')({
  server: {
    handlers: {
      GET: async () => Response.json({ version: VERSION, engine: 'trnn-core', tier: 'T3' }),

      POST: async ({ request }) => {
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }

        const { runBattery, sampleTrajectory } = await import('@metatron/trnn-core');

        const nodes = [34, 55, 89, 144].includes(clampInt(body['nodes'], 34, 144, 55))
          ? clampInt(body['nodes'], 34, 144, 55)
          : 55;
        const iterations = clampInt(body['iterations'], 20, 800, 240);
        const trainTicks = clampInt(body['trainTicks'], 55, 377, 233);
        const holdTicks = clampInt(body['holdTicks'], 34, 233, 89);
        const seed =
          typeof body['seed'] === 'string' ? body['seed'].slice(0, 64) : 'metatron-omega';

        const t0 = Date.now();
        const traj = sampleTrajectory({
          nodes,
          seed: `${seed}-learn`,
          warmup: 89,
          trainTicks,
          holdTicks,
        });
        const { cell, report } = runBattery(traj, { iterations, seed: `${seed}-spsa` });

        return Response.json({
          version: VERSION,
          elapsedMs: Date.now() - t0,
          nodes,
          report,
          certificates: cell.certificates().map((c) => ({ ...c })),
        });
      },
    },
  },
});
