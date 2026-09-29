/**
 * Acquisition — the autonomous field-of-study learning loop.
 *
 * PLAN → SEARCH → FETCH → PARSE → DISTIL → CONSOLIDATE, continuous until
 * stopped. Every source is a real tool call through the existing dispatch
 * server function; nothing is synthesised. Sources that fail are reported as
 * failures — the run never invents content to fill a gap.
 *
 * The loop is frontier-driven: a seed query plan expands into a URL frontier,
 * each fetched document contributes outbound links back to the frontier, and
 * novelty (fraction of chunks that were new) throttles the crawl so a field
 * that has stopped yielding new material stops burning requests.
 */

import type { KnowledgeBase } from './KnowledgeBase';
import { isGeometryUrl, describeAsset } from '@/core/geometry';
import { runOcr } from '@/core/ocr/ocrLadder';

/** Raster formats the OCR ladder can read. */
const IMAGE_URL = /\.(png|jpe?g|webp|bmp|tiff?|gif)($|\?)/i;

export type ToolCall = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ ok: true; data: unknown } | { ok: false; reason: string }>;

export type RunPhase =
  | 'idle'
  | 'plan'
  | 'search'
  | 'fetch'
  | 'distil'
  | 'consolidate'
  | 'stopped'
  | 'error';

export interface RunEvent {
  t: number;
  phase: RunPhase;
  tool: string;
  target: string;
  ok: boolean;
  detail: string;
}

export interface RunState {
  field: string;
  active: boolean;
  phase: RunPhase;
  cycle: number;
  fetched: number;
  failed: number;
  newChunks: number;
  novelty: number; // rolling fraction of chunks that were new
  frontier: number;
  events: RunEvent[];
}

const MAX_EVENTS = 120;

/** Search channels, in priority order. All keyless. */
const SEARCH_PLAN: Array<{
  tool: string;
  args: (q: string) => Record<string, unknown>;
  urls: (d: any) => Array<{ url: string; title: string }>;
}> = [
  {
    tool: 'wikidata',
    args: (q) => ({ query: q }),
    urls: (d) => extractUrls(d),
  },

  {
    tool: 'gdelt',
    args: (q) => ({ query: q, mode: 'artlist', maxrecords: 25, timespan: '3m' }),
    urls: (d) => (d?.articles ?? []).map((a: any) => ({ url: a.url, title: a.title || a.url })),
  },
  {
    tool: 'google_news',
    args: (q) => ({ query: q }),
    urls: (d) => extractUrls(d),
  },
  {
    tool: 'semantic_scholar',
    args: (q) => ({ query: q, limit: 10 }),
    urls: (d) => extractUrls(d),
  },
  {
    tool: 'crossref',
    args: (q) => ({ query: q, rows: 10 }),
    urls: (d) => extractUrls(d),
  },
  {
    tool: 'arxiv_search',
    args: (q) => ({ query: q, max_results: 10 }),
    urls: (d) => extractUrls(d),
  },
  {
    tool: 'hackernews',
    args: (q) => ({ query: q }),
    urls: (d) => extractUrls(d),
  },
  {
    tool: 'sec_edgar',
    args: (q) => ({ query: q }),
    urls: (d) => extractUrls(d),
  },
  {
    tool: 'open_library',
    args: (q) => ({ q, limit: 10 }),
    urls: (d) => extractUrls(d),
  },
];

/** Walk any JSON payload and harvest http(s) URLs with the nearest title. */
function extractUrls(
  node: unknown,
  out: Array<{ url: string; title: string }> = [],
  title = '',
): Array<{ url: string; title: string }> {
  if (!node) return out;
  if (typeof node === 'string') {
    if (/^https?:\/\//i.test(node) && out.length < 60)
      out.push({ url: node, title: title || node });
    return out;
  }
  if (Array.isArray(node)) {
    for (const n of node) extractUrls(n, out, title);
    return out;
  }
  if (typeof node === 'object') {
    const rec = node as Record<string, unknown>;
    const localTitle = String(rec.title ?? rec.name ?? rec.headline ?? title ?? '');
    for (const v of Object.values(rec)) extractUrls(v, out, localTitle);
  }
  return out;
}

/** Query plan for a field of study — breadth first, then management depth. */
export function planQueries(field: string): string[] {
  const f = field.trim();
  return [
    f,
    `${f} overview fundamentals`,
    `${f} best practices`,
    `${f} frameworks and models`,
    `${f} case studies`,
    `${f} standards and regulation`,
    `${f} metrics and benchmarks`,
    `${f} risks and failure modes`,
    `${f} tooling and software`,
    `${f} research 2026`,
  ];
}

const BAD_EXT = /\.(png|jpe?g|gif|svg|webp|mp4|mp3|zip|gz|exe|dmg|woff2?)($|\?)/i;
const BAD_HOST =
  /(doubleclick|googletagmanager|facebook\.com|twitter\.com|x\.com|instagram\.com|linkedin\.com\/login)/i;

export function usableUrl(u: string): boolean {
  if (!/^https?:\/\//i.test(u)) return false;
  if (BAD_EXT.test(u) || BAD_HOST.test(u)) return false;
  return u.length < 400;
}

export interface RunnerOptions {
  field: string;
  kb: KnowledgeBase;
  call: ToolCall;
  onUpdate: (s: RunState) => void;
  /** documents per cycle */
  batch?: number;
  /** ms between requests — polite crawling */
  delayMs?: number;
  /**
   * Ladder rung dominant at capture time, read live at each ingest.
   * Returns -1 when the engine is not streaming — an untagged memory is
   * honest, a guessed rung is not.
   */
  rungAt?: () => number;
}

export class AcquisitionRunner {
  private opts: Required<RunnerOptions>;
  private frontier: Array<{ url: string; title: string }> = [];
  private seen = new Set<string>();
  private queryIdx = 0;
  private stopFlag = false;
  private noveltyWindow: number[] = [];
  private state: RunState;

  constructor(opts: RunnerOptions) {
    this.opts = { batch: 6, delayMs: 400, rungAt: () => -1, ...opts } as Required<RunnerOptions>;
    this.state = {
      field: opts.field,
      active: false,
      phase: 'idle',
      cycle: 0,
      fetched: 0,
      failed: 0,
      newChunks: 0,
      novelty: 1,
      frontier: 0,
      events: [],
    };
  }

  snapshot(): RunState {
    return { ...this.state, events: [...this.state.events] };
  }

  stop(): void {
    this.stopFlag = true;
  }

  private emit(phase: RunPhase, tool: string, target: string, ok: boolean, detail: string): void {
    this.state.phase = phase;
    this.state.events.unshift({ t: Date.now(), phase, tool, target, ok, detail });
    if (this.state.events.length > MAX_EVENTS) this.state.events.length = MAX_EVENTS;
    this.state.frontier = this.frontier.length;
    this.opts.onUpdate(this.snapshot());
  }

  private async sleep(ms: number) {
    await new Promise((r) => setTimeout(r, ms));
  }

  async run(): Promise<void> {
    this.stopFlag = false;
    this.state.active = true;
    this.emit(
      'plan',
      'planner',
      this.opts.field,
      true,
      `${planQueries(this.opts.field).length} seed queries`,
    );

    // Deterministic encyclopedic seed — a real URL, fetched like any other.
    const wiki = `https://en.wikipedia.org/wiki/${encodeURIComponent(this.opts.field.trim().replace(/\s+/g, '_'))}`;
    if (!this.seen.has(wiki) && !this.opts.kb.hasUrl(wiki)) {
      this.seen.add(wiki);
      this.frontier.unshift({ url: wiki, title: this.opts.field });
    }

    while (!this.stopFlag) {
      this.state.cycle++;
      if (this.frontier.length < this.opts.batch) await this.searchCycle();
      if (this.stopFlag) break;
      await this.fetchCycle();
      if (this.stopFlag) break;
      this.emit(
        'consolidate',
        'kb',
        this.opts.field,
        true,
        `${this.opts.kb.stats().chunks} chunks · ${this.opts.kb.stats().concepts} concepts`,
      );
      await this.sleep(this.opts.delayMs);
      // Exhausted every channel with an empty frontier: idle rather than spin.
      if (
        this.frontier.length === 0 &&
        this.queryIdx >= SEARCH_PLAN.length * planQueries(this.opts.field).length
      ) {
        this.emit('idle', 'planner', this.opts.field, true, 'frontier exhausted — restarting plan');
        this.queryIdx = 0;
        await this.sleep(2000);
      }
    }

    this.state.active = false;
    this.emit('stopped', 'runner', this.opts.field, true, `cycle ${this.state.cycle}`);
  }

  private async searchCycle(): Promise<void> {
    const queries = planQueries(this.opts.field);
    const plan = SEARCH_PLAN[this.queryIdx % SEARCH_PLAN.length];
    const query = queries[Math.floor(this.queryIdx / SEARCH_PLAN.length) % queries.length];
    this.queryIdx++;

    const res = await this.opts.call(plan.tool, plan.args(query));
    if (!res.ok) {
      this.state.failed++;
      this.emit('search', plan.tool, query, false, res.reason);
      return;
    }
    let added = 0;
    for (const item of plan.urls(res.data)) {
      if (!item?.url || !usableUrl(item.url)) continue;
      if (this.seen.has(item.url) || this.opts.kb.hasUrl(item.url)) continue;
      this.seen.add(item.url);
      this.frontier.push({ url: item.url, title: item.title });
      added++;
      if (this.frontier.length > 400) break;
    }
    this.emit('search', plan.tool, query, true, `+${added} urls`);
  }

  /**
   * Modality router. A CAD/BIM asset is fetched raw and measured by the
   * geometry core; an image goes down the OCR ladder; everything else takes
   * the HTML path. Each branch returns real text or an honest failure — the
   * loop never substitutes one modality's content for another's.
   */
  private async acquire(item: { url: string; title: string }): Promise<
    | { ok: false; tool: string; reason: string }
    | {
        ok: true;
        tool: string;
        title: string;
        text: string;
        links: string[];
        descriptor?: Float64Array;
        modality: 'text' | 'geometry' | 'image';
        detail: string;
      }
  > {
    // ── geometry (DXF/SVG/OBJ/STL/IFC/STEP) ─────────────────────────────
    if (isGeometryUrl(item.url)) {
      const res = await this.opts.call('cad_fetch', { url: item.url, max_chars: 400_000 });
      if (!res.ok) return { ok: false, tool: 'cad_fetch', reason: res.reason };
      const d = res.data as {
        text?: string;
        contentType?: string;
        error?: string;
        binary?: boolean;
      };
      if (d?.error) return { ok: false, tool: 'cad_fetch', reason: d.error };
      const asset = describeAsset(d.text ?? '', item.url, d.contentType ?? '', item.title);
      if (!asset.ok || !asset.text || !asset.descriptor) {
        return { ok: false, tool: 'cad_fetch', reason: asset.reason ?? 'no geometry measured' };
      }
      return {
        ok: true,
        tool: 'cad_fetch',
        title: item.title || item.url.split('/').pop() || item.url,
        text: asset.text,
        links: [],
        descriptor: asset.descriptor.vector,
        modality: 'geometry',
        detail: `${asset.kind} · ${asset.descriptor.segments} segments · ${asset.descriptor.topology.loops} loops`,
      };
    }

    // ── raster image → OCR ladder (browser → gateway → sidecar) ─────────
    if (IMAGE_URL.test(item.url)) {
      const r = await runOcr(item.url);
      if (!r.ok) return { ok: false, tool: 'ocr', reason: r.reason ?? 'no tier produced text' };
      return {
        ok: true,
        tool: `ocr:${r.tier}`,
        title: item.title || item.url,
        text: r.text,
        links: [],
        modality: 'image',
        detail: `${r.chars} chars via ${r.tier} in ${r.ms}ms`,
      };
    }

    // ── default: HTML/text ───────────────────────────────────────────────
    const res = await this.opts.call('web_fetch', {
      url: item.url,
      max_chars: 40000,
      include_links: true,
    });
    if (!res.ok) return { ok: false, tool: 'web_fetch', reason: res.reason };
    const d = res.data as {
      title?: string;
      text?: string;
      links?: Array<string | { url?: string; href?: string; text?: string }>;
      error?: string;
    };
    const text = (d?.text ?? '').trim();
    if (d?.error || text.length < 400) {
      return {
        ok: false,
        tool: 'web_fetch',
        reason: d?.error ?? `thin content (${text.length} chars)`,
      };
    }
    const links: string[] = [];
    for (const l of d.links ?? []) {
      const u = typeof l === 'string' ? l : (l.url ?? l.href ?? '');
      if (u) links.push(u);
    }
    return {
      ok: true,
      tool: 'web_fetch',
      title: d.title || item.title,
      text,
      links,
      modality: 'text',
      detail: `${text.length} chars`,
    };
  }

  private async fetchCycle(): Promise<void> {
    for (let i = 0; i < this.opts.batch && this.frontier.length > 0; i++) {
      if (this.stopFlag) return;
      const item = this.frontier.shift()!;
      const got = await this.acquire(item);
      if (!got.ok) {
        this.state.failed++;
        this.emit('fetch', got.tool, item.url, false, got.reason);
        await this.sleep(this.opts.delayMs);
        continue;
      }
      const text = got.text;
      const d = { links: got.links } as { links: string[] };

      const out = this.opts.kb.ingest({
        field: this.opts.field,
        url: item.url,
        title: got.title || item.title,
        source: got.tool,
        text,
        descriptor: got.descriptor,
        modality: got.modality,
        // Scale binding: stamp the rung that was dominant when this material
        // entered, so cross-scale φ-affinity has something real to read.
        rung: this.opts.rungAt(),
      });
      this.state.fetched++;
      this.state.newChunks += out.newChunks;
      const nov = out.chunks > 0 ? out.newChunks / out.chunks : 0;
      this.noveltyWindow.push(nov);
      if (this.noveltyWindow.length > 20) this.noveltyWindow.shift();
      this.state.novelty =
        this.noveltyWindow.reduce((a, b) => a + b, 0) / this.noveltyWindow.length;

      // Expand the frontier from real outbound links only.
      for (const u of d.links) {
        if (!u || !usableUrl(u) || this.seen.has(u)) continue;
        this.seen.add(u);
        if (this.frontier.length < 400) this.frontier.push({ url: u, title: u });
      }

      this.emit(
        'distil',
        got.tool,
        item.url,
        true,
        `${out.newChunks}/${out.chunks} new chunks · ${got.detail}`,
      );

      // Novelty throttle: a dry field crawls slower instead of hammering.
      const throttle = this.opts.delayMs * (this.state.novelty < 0.15 ? 4 : 1);
      await this.sleep(throttle);
    }
  }
}
