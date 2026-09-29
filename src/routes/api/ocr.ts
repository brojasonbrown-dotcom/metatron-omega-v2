/**
 * Gateway OCR / visual-descriptor tier.
 *
 * One POST endpoint, two modes:
 *   mode: 'ocr'     — transcribe every legible glyph in the image
 *   mode: 'caption' — describe what the drawing/model shows, in CAD/BIM terms
 *
 * The caption is explicitly model-derived: the caller stores it at reduced
 * trust next to the measured geometry descriptor, never in place of it.
 * Gateway status codes are relayed verbatim so credit/rate states surface in
 * the UI instead of turning into a silent blank read.
 */

import { createFileRoute } from '@tanstack/react-router';

const GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-3-flash-preview';

const OCR_PROMPT =
  'Transcribe every legible piece of text in this image exactly as written: title blocks, dimensions, ' +
  'annotations, room names, schedules, revision notes, part numbers. Preserve reading order and keep ' +
  'tabular data as rows. Output only the transcription, no commentary. If nothing is legible, output NOTHING_LEGIBLE.';

const CAPTION_PROMPT =
  'You are labelling a technical drawing or 3D model for an engineering knowledge base. Describe what is ' +
  'shown using precise CAD/BIM vocabulary: drawing type (plan, section, elevation, detail, isometric, ' +
  'schematic), the elements present (walls, doors, ducts, fasteners, weldments, PCB traces…), the apparent ' +
  'discipline, line conventions in use (hidden, centre, hatch, dimension), and any repeating module or grid. ' +
  'State only what is visible. Be concrete and under 200 words.';

export const Route = createFileRoute('/api/ocr')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
          });

        const key = process.env['LOVABLE_API_KEY'];
        if (!key) return json({ error: 'gateway key not configured', tier: 'gateway' }, 500);

        let body: { image?: string; mode?: string; hint?: string };
        try {
          body = await request.json();
        } catch {
          return json({ error: 'invalid JSON body' }, 400);
        }

        const image = String(body.image ?? '').trim();
        if (!image || !/^(https?:\/\/|data:image\/)/i.test(image)) {
          return json({ error: "'image' must be an https URL or a data:image/... URL" }, 400);
        }
        const mode = body.mode === 'caption' ? 'caption' : 'ocr';
        const prompt = mode === 'caption' ? CAPTION_PROMPT : OCR_PROMPT;
        const hint = String(body.hint ?? '').slice(0, 400);

        const res = await fetch(GATEWAY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Lovable-API-Key': key },
          body: JSON.stringify({
            model: MODEL,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: hint ? `${prompt}\n\nContext: ${hint}` : prompt },
                  { type: 'image_url', image_url: { url: image } },
                ],
              },
            ],
          }),
        });

        const raw = await res.text();
        if (!res.ok) {
          return json(
            { error: raw.slice(0, 1200), status: res.status, tier: 'gateway', mode },
            res.status,
          );
        }
        let text = '';
        try {
          const parsed = JSON.parse(raw);
          text = String(parsed?.choices?.[0]?.message?.content ?? '').trim();
        } catch {
          return json({ error: 'unparseable gateway response', tier: 'gateway' }, 502);
        }
        if (!text || text === 'NOTHING_LEGIBLE') {
          return json({ text: '', empty: true, tier: 'gateway', mode, model: MODEL });
        }
        return json({ text, tier: 'gateway', mode, model: MODEL, chars: text.length });
      },
    },
  },
});
