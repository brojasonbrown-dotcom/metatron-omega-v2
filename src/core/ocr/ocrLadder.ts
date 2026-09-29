/**
 * OCR ladder — three measured tiers, no silent fallbacks.
 *
 *   browser  Tesseract WASM, on-device, zero setup, nothing leaves the machine
 *   gateway  vision model through the app's own /api/ocr route (costs credits)
 *   sidecar  a GPU service you run yourself (e.g. Unlimited-OCR / sglang);
 *            the app probes the URL you paste and uses it when it answers
 *
 * Every tier reports availability with evidence or with the reason it is off.
 * A read that produces nothing is a failure, never an empty chunk.
 */

export type OcrTierId = 'browser' | 'gateway' | 'sidecar';

export interface OcrTierState {
  id: OcrTierId;
  label: string;
  available: boolean;
  probed: boolean;
  detail: string;
  /** measured round-trip of the probe, ms */
  ms: number;
}

export interface OcrResult {
  ok: boolean;
  tier: OcrTierId | null;
  text: string;
  chars: number;
  ms: number;
  reason?: string;
}

const SIDECAR_KEY = 'metatron.omega.ocr.sidecar';
const ORDER_KEY = 'metatron.omega.ocr.order';

function ls(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function getSidecarUrl(): string {
  return ls()?.getItem(SIDECAR_KEY) ?? '';
}
export function setSidecarUrl(url: string): void {
  ls()?.setItem(SIDECAR_KEY, url.trim());
}

export function getPreferredOrder(): OcrTierId[] {
  const raw = ls()?.getItem(ORDER_KEY);
  if (!raw) return ['sidecar', 'browser', 'gateway'];
  try {
    const parsed = JSON.parse(raw) as OcrTierId[];
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    /* fall through */
  }
  return ['sidecar', 'browser', 'gateway'];
}
export function setPreferredOrder(order: OcrTierId[]): void {
  ls()?.setItem(ORDER_KEY, JSON.stringify(order));
}

// ── browser tier (Tesseract WASM, dynamically imported) ───────────────────
interface TesseractModule {
  recognize?: (
    image: string,
    lang: string,
  ) => Promise<{ data: { text: string; confidence: number } }>;
}
let tesseractMod: TesseractModule | null = null;
let tesseractTried = false;

async function loadTesseract(): Promise<TesseractModule | null> {
  if (tesseractTried) return tesseractMod;
  tesseractTried = true;
  try {
    tesseractMod = (await import(/* @vite-ignore */ 'tesseract.js')) as TesseractModule;
  } catch {
    tesseractMod = null;
  }
  return tesseractMod;
}

async function browserOcr(image: string): Promise<OcrResult> {
  const t0 = Date.now();
  const mod = await loadTesseract();
  if (!mod?.recognize)
    return {
      ok: false,
      tier: 'browser',
      text: '',
      chars: 0,
      ms: Date.now() - t0,
      reason: 'tesseract.js unavailable in this build',
    };
  try {
    const out = await mod.recognize(image, 'eng');
    const text = String(out?.data?.text ?? '').trim();
    if (!text)
      return {
        ok: false,
        tier: 'browser',
        text: '',
        chars: 0,
        ms: Date.now() - t0,
        reason: 'no legible text',
      };
    return { ok: true, tier: 'browser', text, chars: text.length, ms: Date.now() - t0 };
  } catch (e) {
    return {
      ok: false,
      tier: 'browser',
      text: '',
      chars: 0,
      ms: Date.now() - t0,
      reason: String((e as Error)?.message ?? e).slice(0, 200),
    };
  }
}

// ── gateway tier ──────────────────────────────────────────────────────────
export async function gatewayVision(
  image: string,
  mode: 'ocr' | 'caption',
  hint = '',
): Promise<OcrResult> {
  const t0 = Date.now();
  try {
    const r = await fetch('/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, mode, hint }),
    });
    const body = await r.json().catch(() => ({}));
    const ms = Date.now() - t0;
    if (!r.ok) {
      const reason =
        r.status === 402
          ? 'AI credits exhausted — top up to use the gateway tier'
          : r.status === 429
            ? 'gateway rate limited — retry shortly'
            : String(body?.error ?? `HTTP ${r.status}`).slice(0, 240);
      return { ok: false, tier: 'gateway', text: '', chars: 0, ms, reason };
    }
    const text = String(body?.text ?? '').trim();
    if (!text)
      return { ok: false, tier: 'gateway', text: '', chars: 0, ms, reason: 'nothing legible' };
    return { ok: true, tier: 'gateway', text, chars: text.length, ms };
  } catch (e) {
    return {
      ok: false,
      tier: 'gateway',
      text: '',
      chars: 0,
      ms: Date.now() - t0,
      reason: String((e as Error)?.message ?? e).slice(0, 200),
    };
  }
}

// ── sidecar tier ──────────────────────────────────────────────────────────
async function sidecarOcr(image: string): Promise<OcrResult> {
  const t0 = Date.now();
  const url = getSidecarUrl();
  if (!url)
    return {
      ok: false,
      tier: 'sidecar',
      text: '',
      chars: 0,
      ms: 0,
      reason: 'no sidecar URL configured',
    };
  try {
    const r = await fetch(url.replace(/\/+$/, '') + '/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image }),
    });
    const ms = Date.now() - t0;
    if (!r.ok)
      return { ok: false, tier: 'sidecar', text: '', chars: 0, ms, reason: `HTTP ${r.status}` };
    const body = await r.json().catch(() => ({}));
    const text = String(body?.text ?? body?.result ?? '').trim();
    if (!text)
      return {
        ok: false,
        tier: 'sidecar',
        text: '',
        chars: 0,
        ms,
        reason: 'sidecar returned no text',
      };
    return { ok: true, tier: 'sidecar', text, chars: text.length, ms };
  } catch (e) {
    return {
      ok: false,
      tier: 'sidecar',
      text: '',
      chars: 0,
      ms: Date.now() - t0,
      reason: String((e as Error)?.message ?? e).slice(0, 200),
    };
  }
}

// ── probing ───────────────────────────────────────────────────────────────
/** Tiny legible PNG — a real image that proves the pipe works end to end. */
const PROBE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAAAgCAIAAABiouoDAAABY0lEQVR4nO3YMYqDQBTG8XE9gNZzhFiIsUmYUu9hmfOkEAIhiE3OkBDbxCJg6QVs7EwTRmy+LcQ0cfd1Gnbfr3IGhMefYRANAIL97GvuAT4dByJwIAIHInAgAgcicCACByJwIAIHInAgwnigJEl831+v177vp2nab9q23T9UVeV5Xl3X04w4M7w5nU5KqaZpADRNo5S6XC4ALMsCoLVWSuV5/v7inzQSKAiC2+32Wl6v1zAMMQSKomi/30813vxGAkkptdavpdZaSgnAsqztdrvZbKab7gPQlzQAwzCEEF3XxXH8X66ewUigxWJRFMVrWRSF4zhCCNM07/f78/nc7XbTDTi790N1Pp+VUo/HA8MlnWUZhjuoqiopZVmWkx70+YwEAnA4HDzPW61Wy+UySZJ+sw8E4Hg8uq7btu0kE87MAP+T/hV/SRM4EIEDETgQgQMROBCBAxE4EIEDETgQgQMRvgE5M4O7NR8F3wAAAABJRU5ErkJggg==';

export async function probeTiers(): Promise<OcrTierState[]> {
  const out: OcrTierState[] = [];

  const t0 = Date.now();
  const mod = await loadTesseract();
  out.push({
    id: 'browser',
    label: 'Browser · Tesseract WASM',
    available: Boolean(mod?.recognize),
    probed: true,
    detail: mod?.recognize
      ? 'on-device, nothing uploaded'
      : 'tesseract.js not resolvable in this build',
    ms: Date.now() - t0,
  });

  const g0 = Date.now();
  let gatewayOk = false;
  let gatewayDetail = '';
  try {
    const r = await fetch('/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: PROBE_PNG, mode: 'ocr' }),
    });
    const body = await r.json().catch(() => ({}));
    gatewayOk = r.ok;
    gatewayDetail = r.ok
      ? `reachable (${body?.model ?? 'vision model'})`
      : r.status === 402
        ? 'AI credits exhausted'
        : r.status === 429
          ? 'rate limited'
          : `HTTP ${r.status}`;
  } catch (e) {
    gatewayDetail = String((e as Error)?.message ?? e).slice(0, 160);
  }
  out.push({
    id: 'gateway',
    label: 'Gateway · vision model',
    available: gatewayOk,
    probed: true,
    detail: gatewayDetail,
    ms: Date.now() - g0,
  });

  const s0 = Date.now();
  const url = getSidecarUrl();
  let sideOk = false;
  let sideDetail = 'no sidecar URL configured';
  if (url) {
    try {
      const r = await fetch(url.replace(/\/+$/, '') + '/health', { method: 'GET' });
      sideOk = r.ok;
      sideDetail = r.ok ? `reachable at ${new URL(url).host}` : `HTTP ${r.status}`;
    } catch (e) {
      sideDetail = String((e as Error)?.message ?? e).slice(0, 160);
    }
  }
  out.push({
    id: 'sidecar',
    label: 'Sidecar · self-hosted OCR (GPU)',
    available: sideOk,
    probed: true,
    detail: sideDetail,
    ms: Date.now() - s0,
  });

  return out;
}

/**
 * Run the ladder in preference order, returning the first tier that produced
 * text. Every tier attempt that failed is reported in `reason` so the panel
 * can show exactly why a page was not read.
 */
export async function runOcr(image: string, order = getPreferredOrder()): Promise<OcrResult> {
  const failures: string[] = [];
  for (const tier of order) {
    const r =
      tier === 'browser'
        ? await browserOcr(image)
        : tier === 'gateway'
          ? await gatewayVision(image, 'ocr')
          : await sidecarOcr(image);
    if (r.ok) return r;
    failures.push(`${tier}: ${r.reason ?? 'failed'}`);
  }
  return { ok: false, tier: null, text: '', chars: 0, ms: 0, reason: failures.join(' · ') };
}
