/**
 * METATRON V13 — Chat streaming endpoint.
 *
 * POST /api/chat
 *   body: { messages: ChatMessage[]; model?: ChatModel; snapshot: EngineSnapshot }
 * Returns SSE stream proxied from Lovable AI Gateway (OpenAI-compatible).
 *
 * V13: removed `mode` parameter (the agentic system contract now serves
 * every model uniformly). Moonshot models should be dispatched to
 * /api/kimi instead — see src/lib/chat/client.ts:isAgenticModel.
 */
import { createFileRoute } from '@tanstack/react-router';
import { buildSystemPrompt } from '@/lib/chat/systemPrompt';
import { buildEvidenceBlock, type MemoryPack } from '@/lib/chat/memoryPack';
import { buildSelfBlock, type SelfPack } from '@/lib/chat/selfPack';
import type { ChatMessage, ChatModel, EngineSnapshot } from '@/lib/chat/types';

const GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const STREAM_FALLBACK_MODEL: ChatModel = 'google/gemini-3-flash-preview';

interface Body {
  messages: ChatMessage[];
  model?: ChatModel;
  snapshot: EngineSnapshot;
  /** on-device memory working set recalled by the client for this turn */
  memory?: MemoryPack | null;
  /** on-device self registry + genome audit measured by the client this turn */
  self?: SelfPack | null;
}

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: 'invalid JSON' }, { status: 400 });
        }

        const model = body.model ?? STREAM_FALLBACK_MODEL;
        if (model.startsWith('moonshot/')) {
          return Response.json(
            {
              error:
                'Kimi models must run through /api/kimi so tool loops remain native and auditable.',
            },
            { status: 400 },
          );
        }
        const system = [
          buildSystemPrompt(body.snapshot),
          buildSelfBlock(body.self),
          buildEvidenceBlock(body.memory),
        ].join('\n\n');

        // Route openai/* directly to OpenAI when OPENAI_API_KEY is present;
        // otherwise fall back to the Lovable AI Gateway.
        const openaiKey = process.env.OPENAI_API_KEY;
        const useDirectOpenAI = model.startsWith('openai/') && !!openaiKey;

        const upstreamUrl = useDirectOpenAI ? OPENAI_URL : GATEWAY;
        const upstreamModel = useDirectOpenAI ? model.slice('openai/'.length) : model;
        const gatewayKey = process.env.LOVABLE_API_KEY;

        if (!useDirectOpenAI && !gatewayKey) {
          return Response.json({ error: 'LOVABLE_API_KEY missing' }, { status: 500 });
        }

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (useDirectOpenAI) headers.Authorization = `Bearer ${openaiKey}`;
        else headers['Lovable-API-Key'] = gatewayKey!;

        const upstream = await fetch(upstreamUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: upstreamModel,
            stream: true,
            messages: [
              { role: 'system', content: system },
              ...body.messages.map((m) => ({ role: m.role, content: m.content })),
            ],
          }),
        });

        if (!upstream.ok) {
          if (upstream.status === 429)
            return Response.json({ error: 'Rate limit. Try again shortly.' }, { status: 429 });
          if (upstream.status === 402)
            return Response.json({ error: 'AI credits exhausted.' }, { status: 402 });
          const t = await upstream.text();
          return Response.json(
            { error: useDirectOpenAI ? 'openai error' : 'gateway error', detail: t.slice(0, 800) },
            { status: 502 },
          );
        }

        return new Response(upstream.body, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
          },
        });
      },
    },
  },
});
