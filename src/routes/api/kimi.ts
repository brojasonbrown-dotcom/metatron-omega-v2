/**
 * METATRON V11 — Kimi K2 autonomous sub-agent.
 *
 * POST /api/kimi
 *   body: { goal: string; snapshot: EngineSnapshot; maxIterations?: number }
 * Returns JSON: { iterations, toolCalls, finalAnswer, trace }
 *
 * Uses Moonshot Kimi K2 (OpenAI-compatible) with the full V11 tool catalogue.
 * Loops up to maxIterations, executing tool calls in-process via HANDLERS.
 * Returns the complete trace so the UI can render every step.
 */
import { createFileRoute } from '@tanstack/react-router';
import { buildSystemPrompt } from '@/lib/chat/systemPrompt';
import { OPENAI_TOOLS } from '@/lib/chat/tools/registry';
import { HANDLERS, hasHandler } from '@/lib/chat/tools/handlers.server';
import {
  buildEvidenceBlock,
  runMemoryTool,
  MEMORY_TOOLS,
  MEMORY_TOOL_NAMES,
  type MemoryPack,
} from '@/lib/chat/memoryPack';
import {
  buildSelfBlock,
  runSelfTool,
  SELF_TOOLS,
  SELF_TOOL_NAMES,
  type SelfPack,
} from '@/lib/chat/selfPack';
import type { EngineSnapshot } from '@/lib/chat/types';

const KIMI_URL = 'https://api.moonshot.ai/v1/chat/completions';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const DEFAULT_KIMI_MODEL = 'kimi-k3';
/** Always-available fallback: Lovable AI Gateway (native tool-calling). */
const GATEWAY_FALLBACK_MODEL = 'google/gemini-3.6-flash';

type Provider = 'moonshot' | 'openai' | 'lovable';

interface ProviderRoute {
  provider: Provider;
  url: string;
  key: string | undefined;
  keyName: string;
  model: string;
}

/** Auth header shape differs per provider. */
function authHeaders(route: ProviderRoute): Record<string, string> {
  return route.provider === 'lovable'
    ? { 'Lovable-API-Key': route.key ?? '', 'Content-Type': 'application/json' }
    : { Authorization: `Bearer ${route.key}`, 'Content-Type': 'application/json' };
}

function gatewayRoute(model = GATEWAY_FALLBACK_MODEL): ProviderRoute {
  return {
    provider: 'lovable',
    url: GATEWAY_URL,
    key: process.env.LOVABLE_API_KEY,
    keyName: 'LOVABLE_API_KEY',
    model,
  };
}

function resolveProvider(raw: string | undefined): ProviderRoute {
  const id = (raw ?? GATEWAY_FALLBACK_MODEL).trim();
  if (id.startsWith('openai/')) {
    // Prefer a working direct OpenAI key; otherwise serve the same model
    // through the Lovable AI Gateway (which carries the workspace credits).
    if (process.env.OPENAI_API_KEY) {
      return {
        provider: 'openai',
        url: OPENAI_URL,
        key: process.env.OPENAI_API_KEY,
        keyName: 'OPENAI_API_KEY',
        model: id.slice('openai/'.length) || 'gpt-5-mini',
      };
    }
    return gatewayRoute(id);
  }
  if (!id.startsWith('moonshot/') && !/^(kimi|moonshot)[-.]/i.test(id)) {
    // google/*, or any other gateway-catalogue id.
    return gatewayRoute(id);
  }
  const stripped = id.replace(/^moonshot\//, '').trim();
  const model = /^(kimi|moonshot)[-.]/i.test(stripped) ? stripped : DEFAULT_KIMI_MODEL;
  return {
    provider: 'moonshot',
    url: KIMI_URL,
    key: process.env.MOONSHOT_API_KEY,
    keyName: 'MOONSHOT_API_KEY',
    model,
  };
}

function sanitizedUpstreamError(provider: Provider, status: number, raw: string): string {
  let message = `${provider} upstream request failed.`;
  let type = '';
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; type?: string } };
    message = parsed.error?.message ?? message;
    type = parsed.error?.type ?? '';
  } catch {
    if (raw.trim()) message = raw.trim();
  }

  if (
    status === 429 ||
    type.includes('quota') ||
    /insufficient balance|suspended|recharge|insufficient_quota/i.test(message)
  ) {
    return `${provider} quota is exhausted or suspended. Recharge/check the billing plan for the configured key, then retry.`;
  }
  if (status === 401 || status === 403) {
    return `${provider} authentication failed. Check the configured API key.`;
  }
  return `${provider} upstream error ${status}: ${message.replace(/org-[a-z0-9]+|ak-[a-z0-9]+|sk-[A-Za-z0-9_-]+/gi, '[redacted]').slice(0, 360)}`;
}

interface Body {
  goal: string;
  snapshot: EngineSnapshot;
  /** on-device memory working set recalled by the client for this turn */
  memory?: MemoryPack | null;
  /** on-device self registry + genome audit measured by the client this turn */
  self?: SelfPack | null;
  /** Either "kimi-..." / "moonshot-..." or "moonshot/<id>"; prefix stripped. */
  model?: string;
  maxIterations?: number;
  disabledTools?: string[];
  temperature?: number;
  toolChoice?: 'auto' | 'required' | 'none';
}

interface TraceStep {
  iteration: number;
  thought?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  latencyMs?: number;
  error?: string;
}

export const Route = createFileRoute('/api/kimi')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: 'invalid JSON' }, { status: 400 });
        }

        const route = resolveProvider(body.model);
        if (!route.key) {
          return Response.json({ error: `${route.keyName} missing` }, { status: 500 });
        }

        const maxIter = Math.min(Math.max(body.maxIterations ?? 8, 1), 16);
        const model = route.model;
        // Single agentic contract — same prompt for every provider.
        const system = [
          buildSystemPrompt(body.snapshot, 'native'),
          buildSelfBlock(body.self),
          buildEvidenceBlock(body.memory),
        ].join('\n\n');
        const dedup = new Set<string>();
        const trace: TraceStep[] = [];
        const disabled = new Set(body.disabledTools ?? []);
        // Memory tools run in-process against the client-shipped pack — they
        // are the only way the model can read the on-device corpus.
        const activeTools = [
          ...SELF_TOOLS.filter((t) => !disabled.has(t.function.name)),
          ...MEMORY_TOOLS.filter((t) => !disabled.has(t.function.name)),
          ...OPENAI_TOOLS.filter((t) => !disabled.has(t.function.name)),
        ];

        // Temperature range differs; Moonshot caps at 1, OpenAI at 2.
        // kimi-k3 is stricter: only temperature=1 is accepted upstream (enforced at send-site).
        const tempCap = route.provider === 'moonshot' ? 1 : 2;
        const requestedTemp = Math.min(tempCap, Math.max(0, body.temperature ?? 0.6));
        const requestedChoice = body.toolChoice ?? 'auto';
        const toolChoice = activeTools.length
          ? requestedChoice === 'none'
            ? 'none'
            : requestedChoice
          : 'none';

        // OpenAI-style messages list — we mutate this between iterations.
        const messages: Array<Record<string, unknown>> = [
          { role: 'system', content: system },
          { role: 'user', content: body.goal },
        ];

        let finalAnswer: string | null = null;
        let toolCount = 0;
        let actualIter = 0;

        // Allow one automatic provider fallback: moonshot → openai when the
        // configured Moonshot key is rejected (401/403) and OPENAI_API_KEY is
        // available. Keeps the chat usable without manual model switching.
        let activeRoute = route;
        let activeModel = model;
        let fallbackTried = false;

        for (let iter = 1; iter <= maxIter; iter++) {
          actualIter = iter;
          const resp = await fetch(activeRoute.url, {
            method: 'POST',
            headers: authHeaders(activeRoute),
            body: JSON.stringify({
              model: activeModel,
              messages,
              tools: activeTools,
              tool_choice: toolChoice,
              temperature:
                activeRoute.provider === 'moonshot' && /^kimi-k3(\b|[-.])/i.test(activeModel)
                  ? 1
                  : requestedTemp,
            }),
          });
          if (!resp.ok) {
            const t = await resp.text();
            // Auto-fallback on auth errors: prefer whichever provider key is valid.
            //   openai → moonshot (user has no OpenAI credits)
            //   moonshot → openai (only if MOONSHOT is unreachable and OpenAI key is present)
            const authOrQuota =
              resp.status === 401 ||
              resp.status === 403 ||
              resp.status === 402 ||
              (resp.status === 429 && /insufficient balance|suspended|quota|recharge/i.test(t));
            if (
              !fallbackTried &&
              authOrQuota &&
              activeRoute.provider !== 'lovable' &&
              process.env.LOVABLE_API_KEY
            ) {
              fallbackTried = true;
              activeRoute = gatewayRoute();
              activeModel = GATEWAY_FALLBACK_MODEL;
              trace.push({
                iteration: iter,
                thought: `${route.provider} key unusable (HTTP ${resp.status}) — falling back to ${GATEWAY_FALLBACK_MODEL} via Lovable AI.`,
              });
              iter--;
              continue;
            }
            const error = sanitizedUpstreamError(activeRoute.provider, resp.status, t);
            trace.push({ iteration: iter, error });
            // Return 200 with error payload so the client renders the trace
            // instead of the platform 502 boundary. Preserve 429 for rate-limit UX.
            return Response.json(
              {
                iterations: iter,
                toolCalls: toolCount,
                finalAnswer,
                trace,
                error,
              },
              { status: resp.status === 429 ? 429 : 200 },
            );
          }

          const json = (await resp.json()) as {
            choices?: Array<{
              message?: {
                content?: string;
                tool_calls?: Array<{
                  id: string;
                  function: { name: string; arguments: string };
                }>;
              };
            }>;
          };
          const msg = json.choices?.[0]?.message;
          if (!msg) {
            trace.push({ iteration: iter, error: 'no choice' });
            break;
          }

          // Push assistant message
          messages.push(msg as Record<string, unknown>);

          if (msg.tool_calls && msg.tool_calls.length) {
            for (const tc of msg.tool_calls) {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(tc.function.arguments || '{}');
              } catch {
                /* ignore */
              }
              const dkey = `${tc.function.name}:${JSON.stringify(args)}`;
              if (dedup.has(dkey)) {
                trace.push({
                  iteration: iter,
                  toolName: tc.function.name,
                  toolArgs: args,
                  error: 'skipped: duplicate',
                  latencyMs: 0,
                });
                messages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: JSON.stringify({ skipped: 'duplicate' }),
                });
                continue;
              }
              dedup.add(dkey);
              const step: TraceStep = {
                iteration: iter,
                toolName: tc.function.name,
                toolArgs: args,
              };
              if (SELF_TOOL_NAMES.has(tc.function.name)) {
                const t0s = Date.now();
                const result = runSelfTool(tc.function.name, args, body.self);
                step.latencyMs = Date.now() - t0s;
                step.toolResult = result;
                trace.push(step);
                toolCount++;
                messages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: JSON.stringify(result).slice(0, 16000),
                });
                continue;
              }
              if (MEMORY_TOOL_NAMES.has(tc.function.name)) {
                const t0m = Date.now();
                const result = runMemoryTool(tc.function.name, args, body.memory);
                step.latencyMs = Date.now() - t0m;
                step.toolResult = result;
                trace.push(step);
                toolCount++;
                messages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: JSON.stringify(result).slice(0, 16000),
                });
                continue;
              }
              if (!hasHandler(tc.function.name)) {
                step.error = 'unknown tool';
                trace.push(step);
                messages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: JSON.stringify({ error: 'unknown tool' }),
                });
                continue;
              }
              const t0 = Date.now();
              try {
                // 30s per-tool budget via Promise.race
                const result = await Promise.race([
                  HANDLERS[tc.function.name](args as Record<string, never>),
                  new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000)),
                ]);
                step.latencyMs = Date.now() - t0;
                step.toolResult = result;
                trace.push(step);
                toolCount++;
                messages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: JSON.stringify(result).slice(0, 16000),
                });
              } catch (e) {
                step.error = (e as Error).message;
                step.latencyMs = Date.now() - t0;
                trace.push(step);
                messages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: JSON.stringify({ error: step.error }),
                });
              }
            }
            continue;
          }

          // No tool calls — model is producing its final answer
          if (msg.content) {
            finalAnswer = msg.content;
            trace.push({ iteration: iter, thought: msg.content });
          }
          break;
        }

        return Response.json({
          iterations: actualIter,
          toolCalls: toolCount,
          finalAnswer,
          trace,
        });
      },
    },
  },
});
