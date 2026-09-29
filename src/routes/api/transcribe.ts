/**
 * Ω-LEXICON L0 — the hearing teacher.
 *
 * Short microphone chunks → Lovable AI speech-to-text → words. The words are
 * the teacher labels that let the field bind sound features to word identity;
 * they are placed into memory via MemoryStore.hear() on the client. Gateway
 * status codes are relayed verbatim so credit/rate states reach the UI.
 */
import { createFileRoute } from '@tanstack/react-router';

const GATEWAY = 'https://ai.gateway.lovable.dev/v1/audio/transcriptions';
const MODEL = 'google/gemini-3.5-transcribe';
const MAX_BYTES = 8 * 1024 * 1024;

export const Route = createFileRoute('/api/transcribe')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key)
          return Response.json({ error: 'Speech service is not configured.' }, { status: 500 });
        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return Response.json({ error: 'Expected audio upload.' }, { status: 400 });
        }
        const file = form.get('file');
        if (
          !(file instanceof File) ||
          !file.size ||
          file.size > MAX_BYTES ||
          !file.type.startsWith('audio/')
        ) {
          return Response.json({ error: 'Invalid audio chunk.' }, { status: 400 });
        }
        const out = new FormData();
        out.append('model', MODEL);
        out.append('file', file, file.name || 'chunk.webm');
        out.append('response_format', 'json');
        const res = await fetch(GATEWAY, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'X-Lovable-AIG-SDK': 'fetch' },
          body: out,
          signal: request.signal,
        });
        if (!res.ok) {
          const body = await res.text();
          console.error(`transcribe failed [${res.status}]: ${body}`);
          let message = 'Transcription failed.';
          try {
            message = JSON.parse(body)?.error?.message ?? JSON.parse(body)?.message ?? message;
          } catch {
            /* keep */
          }
          return Response.json({ error: message }, { status: res.status });
        }
        const data = (await res.json()) as { text?: string };
        return Response.json({ text: (data.text ?? '').trim(), at: Date.now() });
      },
    },
  },
});
