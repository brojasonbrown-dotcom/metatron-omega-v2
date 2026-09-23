/**
 * METATRON V11 — INTEL ARSENAL (full V10 port).
 *
 * Server-only. Ported verbatim from V10 `metatron-intel/index.ts` with three
 * Worker-runtime adjustments:
 *   - `Deno.env.get(...)`   → `process.env.X` (lazy inside getters so module
 *                              eval never reads undefined on Cloudflare).
 *   - `Deno.serve(...)`     → removed (V11 dispatches via createServerFn).
 *   - `crypto.subtle/btoa/AbortSignal.timeout` are unchanged — all are
 *     Web-standard and supported by the Workers runtime with nodejs_compat.
 *
 * Every V10 action key is preserved. Add nothing here that is not a real
 * keyless or key-authed REST tool — engine logic stays in /core.
 */

const TIMEOUT_MS = 12000;

// ─── Lazy env getters (Workers inject env per request, not at module load).
const env = (k: string) => (process.env[k] ?? "").trim();
const nasaKey       = () => env("NASA_API_KEY") || "DEMO_KEY";
const openweather   = () => env("OPENWEATHER_API_KEY");
const newsapiKey    = () => env("NEWSAPI_KEY");
const virustotalKey = () => env("VIRUSTOTAL_API_KEY");
const abuseipdbKey  = () => env("ABUSEIPDB_API_KEY");
const githubToken   = () => env("GITHUB_TOKEN");
const shodanKey     = () => env("SHODAN_API_KEY");
const wolframKey    = () => env("WOLFRAM_APP_ID") || env("WOLFRAM_ALPHA_APP_ID");
/**
 * Separate App ID reserved for constant verification, so the 20 queries/min
 * budget of the offline verification channel can never be consumed by chat
 * traffic on `wolframKey()`. Falls back to no key rather than borrowing the
 * chat key — a verification that silently ran on the wrong budget is worse
 * than one that did not run.
 */
const wolframResearchKey = () => env("WOLFRAM_APP_ID_RESEARCH");
const openaqKey     = () => env("OPENAQ_API_KEY");
const nasaFirmsKey  = () => env("NASA_FIRMS_KEY");
const hfToken       = () => env("HF_TOKEN") || env("HUGGINGFACE_TOKEN");

/**
 * Strip anything that looks like a credential out of a string before it can
 * reach an error message, a log line, or the chat transcript. Several upstream
 * APIs take the key as a query parameter, so a bare `url → HTTP 403` leaks it.
 */
function redact(s: string): string {
  return s
    .replace(/([?&](?:key|apikey|api_key|token|access_token|appid|app_id|auth|password)=)[^&\s]+/gi, "$1***")
    .replace(/\b(sk|pk|hf|ghp|gho|shp)_[A-Za-z0-9]{8,}\b/g, "$1_***");
}

function assertUrl(u: unknown, field = "url"): string {
  if (typeof u !== "string" || !u.trim()) throw new Error(`SKIP: '${field}' required`);
  const s = u.trim();
  try { new URL(s); } catch { throw new Error(`SKIP: invalid '${field}': ${s.slice(0, 80)}`); }
  return s;
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<any> {
  assertUrl(url);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      ...init,
      signal: ctl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Metatron/1.0; +research)", ...(init.headers || {}) },
    });
    if (!r.ok) {
      const skippable = r.status === 429 || r.status === 403 || r.status === 404 || r.status === 410 || r.status >= 500;
      throw new Error(`${skippable ? "SKIP: " : ""}${redact(url)} → HTTP ${r.status}`);
    }
    const ct = r.headers.get("content-type") || "";
    return ct.includes("json") ? await r.json() : await r.text();
  } catch (e: any) {
    if (e?.name === "AbortError" || /aborted/i.test(String(e?.message))) {
      throw new Error(`SKIP: ${redact(url)} → timeout (${TIMEOUT_MS}ms)`);
    }
    throw new Error(redact(String(e?.message ?? e)));
  } finally { clearTimeout(t); }
}

/** Raw-text fetch for endpoints that mislabel NDJSON/CSV as JSON. */
async function fetchText(url: string, init: RequestInit = {}): Promise<string> {
  assertUrl(url);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      ...init, signal: ctl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Metatron/1.0; +research)", ...(init.headers || {}) },
    });
    if (!r.ok) throw new Error(`SKIP: ${redact(url)} → HTTP ${r.status}`);
    return await r.text();
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`SKIP: ${redact(url)} → timeout (${TIMEOUT_MS}ms)`);
    throw new Error(redact(String(e?.message ?? e)));
  } finally { clearTimeout(t); }
}

/** First URL in the list that answers; the last failure is what propagates. */
async function firstJson(urls: string[], init: RequestInit = {}): Promise<any> {
  let last: unknown;
  for (const u of urls) {
    try { return await fetchJson(u, init); } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error("SKIP: all mirrors unavailable");
}

const need = (v: any, name: string) => { if (!v || String(v).trim() === "") throw new Error(`SKIP: ${name} required`); return String(v).trim(); };

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 10)); } catch { return ""; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ""; } });
}

// ─── WAVE-1 Research ──────────────────────────────────────────────────────
async function crossref(p: { query: string; rows?: number }) {
  const rows = Math.min(Math.max(p.rows ?? 5, 1), 20);
  const q = encodeURIComponent(p.query || "consciousness");
  const d = await fetchJson(`https://api.crossref.org/works?query=${q}&rows=${rows}&select=DOI,title,author,issued,container-title,abstract`);
  const items = (d?.message?.items ?? []).map((it: any) => ({
    doi: it.DOI, title: Array.isArray(it.title) ? it.title[0] : it.title,
    journal: Array.isArray(it["container-title"]) ? it["container-title"][0] : null,
    year: it.issued?.["date-parts"]?.[0]?.[0] ?? null,
    authors: (it.author ?? []).slice(0, 5).map((a: any) => `${a.given ?? ""} ${a.family ?? ""}`.trim()),
    abstract: it.abstract ? String(it.abstract).replace(/<[^>]+>/g, "").slice(0, 600) : null,
  }));
  return { count: items.length, items };
}

async function semanticScholar(p: { query: string; limit?: number }) {
  const limit = Math.min(Math.max(p.limit ?? 5, 1), 20);
  const q = encodeURIComponent(p.query || "consciousness");
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${q}&limit=${limit}&fields=title,year,authors,abstract,citationCount,venue,url`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const d = await fetchJson(url);
      return { count: d?.data?.length ?? 0, items: d?.data ?? [], source: "semantic_scholar" };
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (/HTTP 429/.test(msg) && attempt === 0) { await new Promise(r => setTimeout(r, 1100)); continue; }
      if (/HTTP 429|HTTP 5\d\d|timeout/.test(msg)) {
        const cr = await crossref({ query: p.query, rows: limit });
        return { ...cr, source: "crossref-fallback", s2_error: msg };
      }
      throw e;
    }
  }
  return { count: 0, items: [] };
}

async function pubmed(p: { query: string; retmax?: number }) {
  const retmax = Math.min(Math.max(p.retmax ?? 5, 1), 20);
  const q = encodeURIComponent(p.query || "consciousness");
  const search = await fetchJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${retmax}&term=${q}`);
  const ids: string[] = search?.esearchresult?.idlist ?? [];
  if (!ids.length) return { count: 0, items: [] };
  const sum = await fetchJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}`);
  const items = ids.map(id => {
    const d = sum?.result?.[id]; if (!d) return null;
    return { pmid: id, title: d.title, journal: d.fulljournalname, pubdate: d.pubdate,
      authors: (d.authors ?? []).slice(0, 5).map((a: any) => a.name),
      doi: (d.articleids ?? []).find((x: any) => x.idtype === "doi")?.value ?? null,
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/` };
  }).filter(Boolean);
  return { count: items.length, items };
}

async function patentsview(p: { query: string; per_page?: number }) {
  const per_page = Math.min(Math.max(p.per_page ?? 5, 1), 25);
  const q = JSON.stringify({ _text_any: { patent_title: p.query || "quantum coherence" } });
  const f = JSON.stringify(["patent_number","patent_title","patent_date","assignee_organization"]);
  const o = JSON.stringify({ per_page });
  const d = await fetchJson(`https://api.patentsview.org/patents/query?q=${encodeURIComponent(q)}&f=${encodeURIComponent(f)}&o=${encodeURIComponent(o)}`);
  return { count: d?.count ?? 0, items: d?.patents ?? [] };
}

async function osmNominatim(p: { query: string }) {
  const q = p.query || "";
  try {
    const d = await fetchJson(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=5&addressdetails=1&accept-language=en`,
      { headers: { "User-Agent": "Metatron-Research/1.0", Referer: "https://metatron.local/", Accept: "application/json" } });
    if (Array.isArray(d) && d.length > 0) return { count: d.length, items: d, source: "nominatim" };
  } catch { /* fall through */ }
  const om = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`);
  const items = (om?.results ?? []).map((r: any) => ({
    place_id: r.id, lat: String(r.latitude), lon: String(r.longitude),
    display_name: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
    name: r.name, type: r.feature_code, country: r.country, population: r.population,
  }));
  return { count: items.length, items, source: "open-meteo-fallback" };
}

async function overpass(p: { query: string }) {
  const ql = p.query || '[out:json][timeout:10];node["amenity"="cafe"](around:500,-33.9249,18.4241);out;';
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Metatron/1.0 (+research)" },
      body: "data=" + encodeURIComponent(ql), signal: ctl.signal,
    });
    if (!r.ok) {
      const skip = r.status === 429 || r.status === 504 || r.status >= 500;
      throw new Error(`${skip ? "SKIP: " : ""}overpass → HTTP ${r.status}`);
    }
    const txt = await r.text();
    let parsed: any = null;
    try { parsed = JSON.parse(txt); } catch { return { count: 0, raw: txt.slice(0, 2000) }; }
    return { count: parsed?.elements?.length ?? 0, elements: (parsed?.elements ?? []).slice(0, 50) };
  } finally { clearTimeout(t); }
}

async function binance(p: { symbol?: string }) {
  const symbol = (p.symbol || "BTCUSDT").toUpperCase();
  const [ticker, depth] = await Promise.all([
    fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`),
    fetchJson(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=5`),
  ]);
  return {
    symbol, last: parseFloat(ticker.lastPrice),
    change_pct_24h: parseFloat(ticker.priceChangePercent),
    high_24h: parseFloat(ticker.highPrice), low_24h: parseFloat(ticker.lowPrice),
    volume_24h: parseFloat(ticker.volume), quote_volume_24h: parseFloat(ticker.quoteVolume),
    bids_top5: depth.bids, asks_top5: depth.asks,
  };
}

async function mastodon(p: { query: string; instance?: string }) {
  const instance = (p.instance || "mastodon.social").replace(/^https?:\/\//, "");
  const q = encodeURIComponent(p.query || "consciousness");
  const d = await fetchJson(`https://${instance}/api/v2/search?q=${q}&type=statuses&limit=10&resolve=false`);
  const items = (d?.statuses ?? []).map((s: any) => ({
    id: s.id, account: s.account?.acct, created_at: s.created_at,
    content: String(s.content || "").replace(/<[^>]+>/g, "").slice(0, 400),
    favourites: s.favourites_count, reblogs: s.reblogs_count, url: s.url,
  }));
  return { count: items.length, items };
}

async function celestrak(p: { group?: string }) {
  const group = p.group || "stations";
  const text = await fetchJson(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`);
  const lines = String(text).trim().split("\n");
  const sats: any[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    sats.push({ name: lines[i].trim(), line1: lines[i + 1].trim(), line2: lines[i + 2].trim() });
    if (sats.length >= 10) break;
  }
  return { group, count: sats.length, satellites: sats };
}

async function nasaFirms(p: { area?: string; days?: number; map_key?: string }) {
  const mapKey = (p.map_key || nasaFirmsKey()).trim();
  if (!mapKey) return { area: p.area || "world", days: p.days ?? 1, count: 0, items: [], note: "NASA FIRMS needs NASA_FIRMS_KEY secret." };
  const area = (p.area || "world").toLowerCase();
  const days = Math.min(Math.max(p.days ?? 1, 1), 7);
  try {
    const csv = await fetchJson(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/VIIRS_SNPP_NRT/${area}/${days}`);
    const rows = String(csv).trim().split("\n");
    const header = rows[0].split(",");
    const items = rows.slice(1, 21).map(r => { const c = r.split(","); return Object.fromEntries(header.map((h, i) => [h.trim(), c[i]])); });
    return { area, days, header, count: items.length, items };
  } catch (e) { return { area, days, count: 0, items: [], error: e instanceof Error ? e.message : String(e) }; }
}

async function jplHorizons(p: { body?: string; observer?: string; days?: number }) {
  let body = String(p.body || "499").trim();
  let observer = String(p.observer || "500@399").trim();
  const obsBody = observer.includes("@") ? observer.split("@")[1] : observer;
  if (obsBody === body || observer === body) observer = body === "399" ? "500@499" : "500@399";
  const stop = new Date(Date.now() + (p.days ?? 1) * 86400000).toISOString().slice(0, 10);
  const start = new Date().toISOString().slice(0, 10);
  const url = `https://ssd.jpl.nasa.gov/api/horizons.api?format=json&COMMAND='${body}'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&CENTER='${encodeURIComponent(observer)}'&START_TIME='${start}'&STOP_TIME='${stop}'&STEP_SIZE='1d'&QUANTITIES='1,9,20,23,24'`;
  const d = await fetchJson(url);
  const text: string = d?.result || "";
  const m = text.match(/\$\$SOE([\s\S]*?)\$\$EOE/);
  return { body, observer, ephemeris: m ? m[1].trim().slice(0, 4000) : text.slice(0, 2000) };
}

// ─── WAVE-2 OSINT / Finance / Web / Events ───────────────────────────────
async function greynoise(p: { ip: string }) {
  const ip = String(p.ip || "").trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) throw new Error("SKIP: valid IPv4 required");
  // The keyless Community endpoint was retired. With a key we use the real
  // context API; without one we degrade to Shodan InternetDB, which answers
  // the same question ("is this address noisy on the internet?") keylessly,
  // and label the answer with its actual source rather than pretending.
  const key = env("GREYNOISE_API_KEY");
  if (key) {
    const d = await fetchJson(`https://api.greynoise.io/v2/noise/context/${ip}`, { headers: { key, Accept: "application/json" } });
    return { source: "greynoise-v2", ...d };
  }
  const r = await fetch(`https://internetdb.shodan.io/${ip}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (r.status === 404) return { source: "shodan-internetdb", ip, seen: false, note: "no GREYNOISE_API_KEY; keyless fallback reports no exposure record" };
  if (!r.ok) throw new Error(`SKIP: greynoise unavailable and fallback HTTP ${r.status}`);
  const d: any = await r.json();
  return { source: "shodan-internetdb", ip, seen: true, ports: d?.ports ?? [], tags: d?.tags ?? [], vulns: d?.vulns ?? [],
           note: "keyless fallback — set GREYNOISE_API_KEY for classifier verdicts" };
}

async function hackernews(p: { query: string; tags?: string; hits?: number }) {
  const hits = Math.min(Math.max(p.hits ?? 10, 1), 30);
  const d = await fetchJson(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(p.query || "")}&tags=${encodeURIComponent(p.tags || "story")}&hitsPerPage=${hits}`);
  const items = (d?.hits ?? []).map((h: any) => ({
    title: h.title || h.story_title, author: h.author, points: h.points,
    comments: h.num_comments, created_at: h.created_at,
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
  }));
  return { count: items.length, items };
}

async function reddit(p: { query?: string; subreddit?: string; sort?: string; limit?: number }) {
  const limit = Math.min(Math.max(p.limit ?? 10, 1), 25);
  const sort = ["hot","new","top","rising","relevance"].includes(p.sort || "") ? (p.sort as string) : "hot";
  const sub = (p.subreddit || "all").replace(/^r\//, "");
  const path = p.query
    ? `${p.subreddit ? `r/${encodeURIComponent(sub)}/` : ""}search.json?q=${encodeURIComponent(p.query)}&sort=${sort}&limit=${limit}&restrict_sr=${p.subreddit ? "on" : "off"}&raw_json=1`
    : `r/${encodeURIComponent(sub)}/${sort}.json?limit=${limit}&raw_json=1`;
  const hosts = ["https://old.reddit.com", "https://www.reddit.com"];
  const ua = "Mozilla/5.0 (compatible; Metatron-Research/1.0)";
  for (const host of hosts) {
    try {
      const d = await fetchJson(`${host}/${path}`, { headers: { "User-Agent": ua, Accept: "application/json" } });
      const children = d?.data?.children ?? [];
      const items = children.slice(0, limit).map((c: any) => ({
        title: c?.data?.title, author: c?.data?.author,
        created: c?.data?.created_utc ? new Date(c.data.created_utc * 1000).toISOString() : null,
        score: c?.data?.score, comments: c?.data?.num_comments,
        url: c?.data?.permalink ? `https://www.reddit.com${c.data.permalink}` : c?.data?.url,
        selftext: String(c?.data?.selftext || "").slice(0, 400), subreddit: c?.data?.subreddit,
      }));
      if (items.length || children.length === 0) return { count: items.length, items, source: host };
    } catch { /* try next */ }
  }
  try {
    const rss = p.query
      ? `https://www.reddit.com/${p.subreddit ? `r/${encodeURIComponent(sub)}/` : ""}search.rss?q=${encodeURIComponent(p.query)}&sort=${sort}&limit=${limit}`
      : `https://www.reddit.com/r/${encodeURIComponent(sub)}/${sort}.rss?limit=${limit}`;
    const d = await fetchJson(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rss)}&count=${limit}`);
    const items = (d?.items ?? []).slice(0, limit).map((it: any) => ({
      title: it.title, author: it.author, created: it.pubDate, url: it.link,
      selftext: String(it.description || "").replace(/<[^>]+>/g, "").slice(0, 400),
    }));
    if (items.length) return { count: items.length, items, source: "reddit-rss-fallback" };
  } catch { /* ignore */ }
  return { count: 0, items: [], source: "reddit-unavailable" };
}

async function githubSearch(p: { query: string; type?: string; per_page?: number }) {
  const type = ["repositories","code","issues","users","commits"].includes(p.type || "") ? p.type : "repositories";
  const per_page = Math.min(Math.max(p.per_page ?? 5, 1), 20);
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  const tok = githubToken(); if (tok) headers.Authorization = `Bearer ${tok}`;
  const d = await fetchJson(`https://api.github.com/search/${type}?q=${encodeURIComponent(p.query)}&per_page=${per_page}`, { headers });
  return { type, total: d?.total_count ?? 0, items: (d?.items ?? []).slice(0, per_page), authed: !!tok };
}

async function wikidataSparql(p: { query: string }) {
  const raw = String(p.query || "").trim();
  // A plain phrase is not SPARQL. Rather than 400ing, resolve it through the
  // entity search API — that is what the caller almost always meant.
  if (raw && !/^\s*(PREFIX|SELECT|ASK|CONSTRUCT|DESCRIBE)\b/i.test(raw)) {
    const d = await fetchJson(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&limit=10&origin=*&search=${encodeURIComponent(raw)}`,
    );
    return {
      mode: "entity-search",
      query: raw,
      entities: (d?.search ?? []).map((e: any) => ({ id: e.id, label: e.label, description: e.description, url: e.concepturi })),
    };
  }
  const q = encodeURIComponent(raw || "SELECT ?item ?itemLabel WHERE { ?item wdt:P31 wd:Q5 } LIMIT 5");
  const d = await fetchJson(`https://query.wikidata.org/sparql?format=json&query=${q}`, { headers: { Accept: "application/sparql-results+json" } });
  return { mode: "sparql", vars: d?.head?.vars ?? [], bindings: (d?.results?.bindings ?? []).slice(0, 50) };
}

async function rdap(p: { domain?: string; ip?: string }) {
  const t = p.domain || p.ip; if (!t) throw new Error("domain or ip required");
  return await fetchJson(p.ip ? `https://rdap.org/ip/${encodeURIComponent(p.ip!)}` : `https://rdap.org/domain/${encodeURIComponent(p.domain!)}`);
}

async function usgsVolcanoes() {
  try {
    const d = await fetchJson("https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/Volcanoes_of_the_United_States/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson&resultRecordCount=200");
    const features = d?.features ?? [];
    return { count: features.length, items: features.slice(0, 50).map((f: any) => ({
      name: f?.properties?.Volcano_Name || f?.properties?.NAME, state: f?.properties?.State,
      alert_level: f?.properties?.Alert_Level, aviation_color: f?.properties?.Aviation_Color_Code,
      elevation_m: f?.properties?.Elevation, coords: f?.geometry?.coordinates,
    })) };
  } catch {
    // The old static feed 404s; HANS is the live elevated-alert service.
    const d = await firstJson([
      "https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes",
      "https://volcanoes.usgs.gov/hans-public/api/volcano/getCapElevated",
    ]);
    const items = Array.isArray(d) ? d : (d?.features ?? d?.volcanoes ?? []);
    return {
      source: "usgs-hans-elevated", count: items.length,
      items: items.slice(0, 50).map((v: any) => ({
        name: v?.volcano_name ?? v?.name, state: v?.state ?? v?.region,
        alert_level: v?.alert_level, aviation_color: v?.color_code,
        observatory: v?.obs_abbr, coords: [v?.longitude, v?.latitude],
      })),
    };
  }
}

async function openaq(p: { latitude?: number; longitude?: number; radius?: number; limit?: number }) {
  const apiKey = openaqKey();
  if (!apiKey) return { count: 0, items: [], note: "OpenAQ v3 needs OPENAQ_API_KEY secret." };
  const limit = Math.min(Math.max(p.limit ?? 10, 1), 100);
  let url = `https://api.openaq.org/v3/locations?limit=${limit}`;
  if (p.latitude != null && p.longitude != null) url += `&coordinates=${p.latitude},${p.longitude}&radius=${Math.min(p.radius ?? 25000, 25000)}`;
  const d = await fetchJson(url, { headers: { "X-API-Key": apiKey } });
  return { count: d?.results?.length ?? 0, items: d?.results ?? [] };
}

async function opensky(p: { lamin?: number; lomin?: number; lamax?: number; lomax?: number }) {
  const bbox = (p.lamin != null && p.lomin != null && p.lamax != null && p.lomax != null)
    ? { lamin: p.lamin, lomin: p.lomin, lamax: p.lamax, lomax: p.lomax }
    : { lamin: 40.5, lomin: -74.3, lamax: 41.0, lomax: -73.5 };
  const url = `https://opensky-network.org/api/states/all?lamin=${bbox.lamin}&lomin=${bbox.lomin}&lamax=${bbox.lamax}&lomax=${bbox.lomax}`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "Metatron-Research/1.0" } });
    if (!r.ok) return { time: null, count: 0, states: [], bbox, note: `OpenSky HTTP ${r.status}` };
    const d = await r.json();
    const cols = ["icao24","callsign","origin_country","time_position","last_contact","longitude","latitude","baro_altitude","on_ground","velocity","heading","vertical_rate","sensors","geo_altitude","squawk","spi","position_source"];
    const states = (d?.states ?? []).slice(0, 50).map((s: any[]) => Object.fromEntries(cols.map((c, i) => [c, s[i]])));
    return { time: d?.time, count: states.length, total: (d?.states ?? []).length, bbox, states };
  } catch (e) { return { time: null, count: 0, states: [], bbox, note: `OpenSky error: ${e instanceof Error ? e.message : String(e)}` }; }
  finally { clearTimeout(t); }
}

async function gdelt(p: { query: string; mode?: string; maxrecords?: number; timespan?: string }) {
  const mode = p.mode || "artlist";
  const maxrecords = Math.min(Math.max(p.maxrecords ?? 10, 1), 50);
  const timespan = p.timespan || "24h";
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(p.query)}&mode=${mode}&maxrecords=${maxrecords}&timespan=${timespan}&format=json`;
  const delays = [600, 1500, 3500]; let lastErr: any = null;
  for (let i = 0; i <= delays.length; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": "Metatron-Research/1.0" } });
      if (r.status === 429) {
        const ra = parseInt(r.headers.get("retry-after") || "0", 10);
        await new Promise(res => setTimeout(res, ra > 0 ? Math.min(ra * 1000, 5000) : (delays[i] ?? 3500)));
        continue;
      }
      if (!r.ok) throw new Error(`GDELT HTTP ${r.status}`);
      const ct = r.headers.get("content-type") || "";
      const d = ct.includes("json") ? await r.json() : JSON.parse(await r.text() || "{}");
      return { mode, count: (d?.articles ?? []).length, articles: d?.articles ?? [] };
    } catch (e) { lastErr = e; if (i >= delays.length) break; await new Promise(res => setTimeout(res, delays[i])); }
  }
  return { mode, count: 0, articles: [], note: `GDELT failed: ${lastErr}` };
}

async function coingecko(p: { ids?: string; vs?: string; query?: string }) {
  if (p.query) {
    const s = await fetchJson(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(p.query)}`);
    return { query: p.query, coins: (s?.coins ?? []).slice(0, 10) };
  }
  const ids = p.ids || "bitcoin,ethereum"; const vs = p.vs || "usd";
  const d = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${encodeURIComponent(vs)}&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`);
  return { vs, prices: d };
}

async function secEdgar(p: { cik?: string; query?: string }) {
  if (p.query && !p.cik) {
    const s = await fetchJson(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(p.query)}&forms=10-K,10-Q,8-K`,
      { headers: { "User-Agent": "Metatron Research metatron@example.com" } });
    return { query: p.query, hits: (s?.hits?.hits ?? []).slice(0, 10).map((h: any) => h._source) };
  }
  const cik = String(p.cik || "0000320193").padStart(10, "0");
  const d = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { "User-Agent": "Metatron Research metatron@example.com" } });
  const recent = d?.filings?.recent;
  const filings = recent ? recent.accessionNumber.slice(0, 10).map((acc: string, i: number) => ({
    accession: acc, form: recent.form[i], filed: recent.filingDate[i], primaryDoc: recent.primaryDocument[i],
    url: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${acc.replace(/-/g, "")}/${recent.primaryDocument[i]}`,
  })) : [];
  return { cik, name: d?.name, sic: d?.sicDescription, filings };
}

let _ccCache: { idx: string; ts: number } | null = null;
async function pickLatestCcIndex(): Promise<string> {
  if (_ccCache && Date.now() - _ccCache.ts < 6 * 3600_000) return _ccCache.idx;
  try {
    const list = await fetchJson("https://index.commoncrawl.org/collinfo.json");
    const id = Array.isArray(list) && list[0]?.id ? String(list[0].id) : "CC-MAIN-2024-46";
    const idx = id.endsWith("-index") ? id : `${id}-index`;
    _ccCache = { idx, ts: Date.now() };
    return idx;
  } catch { return "CC-MAIN-2024-46-index"; }
}
async function commonCrawl(p: { url: string; index?: string }) {
  if (!p?.url) throw new Error("SKIP: url required");
  const idx = p.index || await pickLatestCcIndex();
  // The index answers NDJSON under a JSON content-type: parse per line.
  const d = await fetchText(`https://index.commoncrawl.org/${idx}?url=${encodeURIComponent(p.url)}&output=json&limit=10`);
  const lines = String(d).trim().split("\n").slice(0, 10).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { index: idx, count: lines.length, captures: lines };
}

async function ipfsCat(p: { cid: string; gateway?: string; max_bytes?: number; path?: string }) {
  if (!p?.cid) throw new Error("SKIP: cid required");
  const cid = p.cid.trim().replace(/^\//, "");
  const subPath = p.path ? `/${p.path.replace(/^\//, "")}` : "";
  const gateways = p.gateway ? [p.gateway] : [
    "https://dweb.link","https://ipfs.io","https://w3s.link","https://nftstorage.link",
    "https://gateway.pinata.cloud","https://cf-ipfs.com","https://4everland.io","https://flk-ipfs.xyz","https://hardbin.com",
  ];
  const max = Math.min(p.max_bytes ?? 8192, 65536);
  const tryGw = async (gw: string) => {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 5000);
    try {
      const r = await fetch(`${gw}/ipfs/${cid}${subPath}`, {
        headers: { Range: `bytes=0-${max - 1}`, Accept: "*/*", "User-Agent": "Metatron-Research/1.0" },
        signal: ctl.signal, redirect: "follow",
      });
      clearTimeout(timer);
      if (r.status !== 200 && r.status !== 206) return { ok: false as const, gw, err: `HTTP ${r.status}` };
      return { ok: true as const, gw, text: await r.text() };
    } catch (e) { clearTimeout(timer); return { ok: false as const, gw, err: e instanceof Error ? e.message : String(e) }; }
  };
  const results = await Promise.allSettled(gateways.map(tryGw));
  const attempts: any[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      if (r.value.ok) return { cid, gateway: r.value.gw, bytes: r.value.text.length, content: r.value.text.slice(0, max), attempts };
      attempts.push({ gateway: r.value.gw, status: r.value.err });
    }
  }
  return { cid, gateway: null, bytes: 0, content: "", attempts, note: "All IPFS gateways failed." };
}

async function shodanFavicon(p: { url: string }) {
  const url = assertUrl(p?.url);
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  const b64 = (btoa(bin).match(/.{1,76}/g)?.join("\n") + "\n") || "";
  const data = new TextEncoder().encode(b64);
  let h1 = 0; const c1 = 0xcc9e2d51, c2 = 0x1b873593;
  const blocks = Math.floor(data.length / 4);
  for (let i = 0; i < blocks; i++) {
    let k1 = (data[i*4] | (data[i*4+1] << 8) | (data[i*4+2] << 16) | (data[i*4+3] << 24)) >>> 0;
    k1 = Math.imul(k1, c1); k1 = (k1 << 15) | (k1 >>> 17); k1 = Math.imul(k1, c2);
    h1 ^= k1; h1 = (h1 << 13) | (h1 >>> 19); h1 = (Math.imul(h1, 5) + 0xe6546b64) >>> 0;
  }
  let k1 = 0; const tail = blocks * 4; const rem = data.length & 3;
  if (rem >= 3) k1 ^= data[tail+2] << 16;
  if (rem >= 2) k1 ^= data[tail+1] << 8;
  if (rem >= 1) { k1 ^= data[tail]; k1 = Math.imul(k1, c1); k1 = (k1 << 15) | (k1 >>> 17); k1 = Math.imul(k1, c2); h1 ^= k1; }
  h1 ^= data.length;
  h1 ^= h1 >>> 16; h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13; h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;
  const signed = h1 | 0;
  return { url: p.url, bytes: buf.length, mmh3: signed, shodan_query: `http.favicon.hash:${signed}` };
}

// ─── WAVE-3 keyless OSINT/SIGINT ─────────────────────────────────────────
async function shodanInternetdb(p: { ip: string }) {
  const ip = (p.ip || "").trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error("valid IPv4 required");
  const r = await fetch(`https://internetdb.shodan.io/${ip}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (r.status === 404) return { ip, ports: [], vulns: [], hostnames: [], tags: [], note: "no exposure data" };
  if (!r.ok) throw new Error(`InternetDB HTTP ${r.status}`);
  return await r.json();
}
async function urlhaus(p: { url?: string; host?: string }) {
  // abuse.ch made every URLhaus endpoint auth-required (HTTP 401 otherwise).
  const key = env("URLHAUS_AUTH_KEY") || env("ABUSECH_API_KEY");
  if (!key) throw new Error("SKIP: URLHAUS_AUTH_KEY required (free at auth.abuse.ch)");
  const headers = { "Auth-Key": key, Accept: "application/json" };
  const post = async (path: string, body: Record<string, string>) => {
    const r = await fetch(`https://urlhaus-api.abuse.ch/v1/${path}/`, {
      method: "POST", headers, body: new URLSearchParams(body), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`SKIP: urlhaus/${path} → HTTP ${r.status}`);
    return await r.json();
  };
  if (p.url) return await post("url", { url: p.url });
  if (p.host) return await post("host", { host: p.host });
  return await fetchJson("https://urlhaus-api.abuse.ch/v1/urls/recent/", { headers });
}
async function cveCircl(p: { cve?: string; vendor?: string; product?: string }) {
  if (p.cve) return await fetchJson(`https://cve.circl.lu/api/cve/${encodeURIComponent(p.cve)}`);
  if (p.vendor && p.product) return await fetchJson(`https://cve.circl.lu/api/search/${encodeURIComponent(p.vendor)}/${encodeURIComponent(p.product)}`);
  return await fetchJson("https://cve.circl.lu/api/last");
}
async function ripeStat(p: { resource: string; endpoint?: string }) {
  const ep = p.endpoint || "network-info";
  const allow = ["network-info","as-overview","prefix-overview","abuse-contact-finder","geoloc","routing-status","whois","rir-stats-country","dns-chain","blacklist"];
  if (!allow.includes(ep)) throw new Error(`endpoint must be one of: ${allow.join(", ")}`);
  return await fetchJson(`https://stat.ripe.net/data/${ep}/data.json?resource=${encodeURIComponent(p.resource)}`);
}
async function bgpview(p: { resource?: string; kind?: string; asn?: string; ip?: string; prefix?: string; query?: string }) {
  // api.bgpview.io no longer resolves. RIPEstat answers the same three
  // questions (ASN overview, IP → prefix/holder, prefix overview) and is the
  // authoritative registry source, so the tool keeps working under a
  // clearly-labelled backend rather than reporting a dead host.
  const r = need(p.resource ?? p.asn ?? p.ip ?? p.prefix ?? p.query, "resource");
  const k = p.kind || "auto";
  const isAsn = k === "asn" || (k === "auto" && /^as?\d+$/i.test(r));
  const isIp = k === "ip" || (k === "auto" && /^\d{1,3}(\.\d{1,3}){3}$/.test(r));
  const isPrefix = k === "prefix" || (k === "auto" && r.includes("/"));
  const ripe = async (ep: string, res: string) =>
    await fetchJson(`https://stat.ripe.net/data/${ep}/data.json?resource=${encodeURIComponent(res)}`);

  if (isAsn) {
    const asn = `AS${r.replace(/^as/i, "")}`;
    const [overview, prefixes] = await Promise.all([
      ripe("as-overview", asn),
      ripe("announced-prefixes", asn).catch(() => null),
    ]);
    return {
      source: "ripestat", kind: "asn", asn,
      holder: overview?.data?.holder, announced: overview?.data?.announced,
      block: overview?.data?.block,
      prefix_count: prefixes?.data?.prefixes?.length ?? null,
      prefixes: (prefixes?.data?.prefixes ?? []).slice(0, 50).map((x: any) => x.prefix),
    };
  }
  if (isIp || isPrefix) {
    const [net, routing] = await Promise.all([
      ripe("network-info", r),
      ripe("routing-status", r).catch(() => null),
    ]);
    return {
      source: "ripestat", kind: isIp ? "ip" : "prefix", resource: r,
      prefix: net?.data?.prefix, asns: net?.data?.asns ?? [],
      announced: routing?.data?.announced,
      visibility: routing?.data?.visibility,
      first_seen: routing?.data?.first_seen, last_seen: routing?.data?.last_seen,
    };
  }
  const d = await fetchJson(`https://stat.ripe.net/data/searchcomplete/data.json?resource=${encodeURIComponent(r)}`);
  return { source: "ripestat", kind: "search", query: r, categories: d?.data?.categories ?? [] };
}

async function crtsh(p: { domain: string }) {
  const d = (p.domain || "").replace(/^https?:\/\//,"").split("/")[0];
  if (!d) throw new Error("domain required");
  const list = await fetchJson(`https://crt.sh/?q=%25.${encodeURIComponent(d)}&output=json`);
  const seen = new Set<string>(); const subs: string[] = [];
  for (const row of (Array.isArray(list) ? list : []).slice(0, 500)) {
    for (const name of String(row.name_value || "").split("\n")) {
      const n = name.trim().toLowerCase();
      if (n && !n.startsWith("*") && !seen.has(n)) { seen.add(n); subs.push(n); }
    }
  }
  return { domain: d, count: subs.length, subdomains: subs.slice(0, 200) };
}
async function hibpPasswords(p: { password?: string; sha1?: string }) {
  let sha1 = (p.sha1 || "").toUpperCase();
  if (!sha1 && p.password) {
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(p.password));
    sha1 = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("").toUpperCase();
  }
  if (!/^[A-F0-9]{40}$/.test(sha1)) throw new Error("SKIP: password or sha1 required");
  const prefix = sha1.slice(0, 5), suffix = sha1.slice(5);
  const txt = await (await fetch(`https://api.pwnedpasswords.com/range/${prefix}`)).text();
  const hit = txt.split("\n").map(l => l.trim()).find(l => l.startsWith(suffix));
  const count = hit ? parseInt(hit.split(":")[1], 10) : 0;
  return { sha1_prefix: prefix, breached: count > 0, breach_count: count };
}
async function dnsResolve(p: { name: string; type?: string }) {
  return await fetchJson(`https://dns.google/resolve?name=${encodeURIComponent(p.name)}&type=${encodeURIComponent((p.type || "A").toUpperCase())}`);
}
async function ipApi(p: { ip?: string }) {
  const ip = p.ip?.trim();
  try { return await fetchJson(`http://ip-api.com/json/${ip ? encodeURIComponent(ip) : ""}?fields=66846719`); }
  catch { return await fetchJson(`https://ipapi.co/${ip ? encodeURIComponent(ip) + "/" : ""}json/`); }
}
async function wayback(p: { url: string; timestamp?: string }) {
  return await fetchJson(`https://archive.org/wayback/available?url=${encodeURIComponent(p.url)}${p.timestamp ? `&timestamp=${encodeURIComponent(p.timestamp)}` : ""}`);
}
async function threatfox(p: { query?: string; days?: number; ioc?: string }) {
  const body = p.ioc ? { query: "search_ioc", search_term: p.ioc } : { query: "get_iocs", days: Math.min(Math.max(p.days ?? 1, 1), 7) };
  const r = await fetch("https://threatfox-api.abuse.ch/api/v1/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  return await r.json();
}
async function coindesk(_p: any) {
  const d = await fetchJson("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,eur,gbp&include_last_updated_at=true");
  const u = d?.bitcoin || {};
  return { source: "coingecko-simple-price", bpi: { USD: { rate_float: u.usd }, EUR: { rate_float: u.eur }, GBP: { rate_float: u.gbp } }, updated_at: u.last_updated_at };
}
async function httpProbe(p: { url: string; method?: string; max_bytes?: number }) {
  const url = assertUrl(p?.url);
  const method = (p.method || "GET").toUpperCase() === "HEAD" ? "HEAD" : "GET";
  const cap = Math.max(512, Math.min(p.max_bytes ?? 16384, 65536));
  const r = await fetch(url, { method, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": "Mozilla/5.0 (compatible; Metatron/1.0; +research)" } });
  const headers: Record<string, string> = {}; r.headers.forEach((v, k) => { headers[k] = v; });
  let bodySnippet = ""; let truncated = false;
  if (method === "GET") {
    try { const buf = await r.arrayBuffer(); truncated = buf.byteLength > cap; bodySnippet = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, cap)); } catch { /* binary */ }
  }
  return { url: r.url, status: r.status, method, headers, bodySnippet, truncated };
}
async function webFetch(p: { url: string; max_chars?: number; include_links?: boolean }) {
  const url = assertUrl(p?.url);
  const cap = Math.max(1000, Math.min(p.max_chars ?? 24000, 80000));
  const r = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Metatron/1.0; +research)", Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" } });
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  const finalUrl = r.url;
  if (!r.ok) return { url: finalUrl, status: r.status, error: `HTTP ${r.status}`, contentType: ct };
  if (!ct.includes("html") && !ct.includes("xml")) {
    const text = await r.text().catch(() => "");
    return { url: finalUrl, status: r.status, contentType: ct, title: "", text: text.slice(0, cap), truncated: text.length > cap, links: [] };
  }
  let html = await r.text();
  if (html.length > 1_500_000) html = html.slice(0, 1_500_000);
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].replace(/\s+/g, " ").trim()).slice(0, 300) : "";
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  const description = descMatch ? decodeEntities(descMatch[1]).trim().slice(0, 500) : "";
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ").replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ").replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const blocked = stripped.replace(/<\/(p|div|li|tr|h[1-6]|br|section|article)>/gi, "\n");
  const text = decodeEntities(blocked.replace(/<[^>]+>/g, " "))
    .replace(/[ \t\f\v]+/g, " ").replace(/\n{3,}/g, "\n\n").replace(/^[ \t]+|[ \t]+$/gm, "").trim();
  const truncated = text.length > cap;
  let links: { href: string; text: string }[] = [];
  if (p.include_links !== false) {
    const seen = new Set<string>(); const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && links.length < 60) {
      try {
        const abs = new URL(m[1], finalUrl).toString();
        if (!/^https?:/i.test(abs) || seen.has(abs)) continue;
        seen.add(abs);
        links.push({ href: abs, text: decodeEntities(m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()).slice(0, 120) });
      } catch { /* bad href */ }
    }
  }
  return { url: finalUrl, status: r.status, contentType: ct, title, description, text: truncated ? text.slice(0, cap) : text, truncated, links };
}

// ─── WAVE-4 powerful keyless live ────────────────────────────────────────
async function nvd(p: { cve?: string; keyword?: string; days?: number; results?: number }) {
  const params = new URLSearchParams();
  if (p.cve) params.set("cveId", p.cve);
  if (p.keyword) params.set("keywordSearch", p.keyword);
  if (p.days) {
    const end = new Date(); const start = new Date(Date.now() - Math.min(Math.max(p.days, 1), 120) * 86400000);
    params.set("pubStartDate", start.toISOString()); params.set("pubEndDate", end.toISOString());
  }
  params.set("resultsPerPage", String(Math.min(Math.max(p.results ?? 10, 1), 50)));
  return await fetchJson(`https://services.nvd.nist.gov/rest/json/cves/2.0?${params}`);
}
async function eonet(p: { days?: number; status?: string; category?: string; limit?: number }) {
  const u = new URL("https://eonet.gsfc.nasa.gov/api/v3/events");
  if (p.days) u.searchParams.set("days", String(Math.min(Math.max(p.days, 1), 365)));
  if (p.status) u.searchParams.set("status", p.status);
  if (p.category) u.searchParams.set("category", p.category);
  u.searchParams.set("limit", String(Math.min(Math.max(p.limit ?? 20, 1), 100)));
  return await fetchJson(u.toString());
}
async function donki(p: { kind?: string; days?: number }) {
  const kind = (p.kind || "notifications").toLowerCase();
  const start = new Date(Date.now() - Math.min(Math.max(p.days ?? 7, 1), 30) * 86400000).toISOString().slice(0, 10);
  const end = new Date().toISOString().slice(0, 10);
  const map: Record<string,string> = { notifications: "notifications", cme: "CME", flr: "FLR", sep: "SEP", gst: "GST", ips: "IPS", mpc: "MPC", rbe: "RBE", hss: "HSS" };
  const path = map[kind] || "notifications";
  const KEY = nasaKey();
  try {
    const d = await fetchJson(`https://api.nasa.gov/DONKI/${path}?startDate=${start}&endDate=${end}&api_key=${KEY}`);
    return { source: "nasa-donki", authed: KEY !== "DEMO_KEY", kind: path, data: d };
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (/HTTP 403|HTTP 429/.test(msg)) {
      const swpc: Record<string,string> = {
        notifications: "https://services.swpc.noaa.gov/products/alerts.json",
        gst: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
        flr: "https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json",
        cme: "https://services.swpc.noaa.gov/products/alerts.json",
      };
      return { source: "noaa-swpc-fallback", kind, donki_error: msg, data: await fetchJson(swpc[kind] || swpc.notifications) };
    }
    throw e;
  }
}
async function nwsAlerts(p: { area?: string; active?: boolean }) {
  const u = new URL("https://api.weather.gov/alerts");
  if (p.area) u.searchParams.set("area", p.area);
  if (p.active !== false) u.searchParams.set("status", "actual");
  u.searchParams.set("limit", "25");
  return await fetchJson(u.toString(), { headers: { Accept: "application/geo+json" } });
}
async function metar(p: { station?: string; hours?: number }) {
  const station = (p.station || "KJFK").toUpperCase();
  const hours = Math.min(Math.max(p.hours ?? 2, 1), 24);
  return await fetchJson(`https://aviationweather.gov/api/data/metar?ids=${station}&hours=${hours}&format=json`);
}
async function marine(p: { latitude?: number; longitude?: number; lat?: number; lon?: number }) {
  const lat = p.latitude ?? p.lat, lon = p.longitude ?? p.lon;
  if (lat == null || lon == null) throw new Error("SKIP: latitude/longitude required");
  return await fetchJson(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,wave_direction,wave_period,wind_wave_height,swell_wave_height&current=wave_height,wave_period`);
}
async function flood(p: { latitude?: number; longitude?: number; lat?: number; lon?: number }) {
  const lat = p.latitude ?? p.lat, lon = p.longitude ?? p.lon;
  if (lat == null || lon == null) throw new Error("SKIP: latitude/longitude required");
  return await fetchJson(`https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lon}&daily=river_discharge,river_discharge_mean,river_discharge_max`);
}
async function tides(p: { station?: string; product?: string }) {
  const station = p.station || "8518750"; const product = p.product || "water_level";
  const begin = new Date(Date.now() - 6 * 3600000).toISOString().slice(0,10).replace(/-/g,"");
  const end = new Date().toISOString().slice(0,10).replace(/-/g,"");
  return await fetchJson(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=${product}&application=metatron&begin_date=${begin}&end_date=${end}&datum=MLLW&station=${station}&time_zone=gmt&units=metric&format=json`);
}
async function adsb(p: { lat?: number; lon?: number; dist?: number; hex?: string; callsign?: string }) {
  if (p.hex) return await fetchJson(`https://api.adsb.lol/v2/hex/${encodeURIComponent(p.hex)}`);
  if (p.callsign) return await fetchJson(`https://api.adsb.lol/v2/callsign/${encodeURIComponent(p.callsign)}`);
  if (p.lat != null && p.lon != null) return await fetchJson(`https://api.adsb.lol/v2/point/${p.lat}/${p.lon}/${Math.min(p.dist ?? 100, 250)}`);
  return await fetchJson("https://api.adsb.lol/v2/mil");
}
async function worldbank(p: { country?: string; indicator?: string; date?: string }) {
  const c = p.country || "all"; const ind = p.indicator || "NY.GDP.MKTP.CD";
  const date = p.date || `${new Date().getFullYear() - 5}:${new Date().getFullYear()}`;
  return await fetchJson(`https://api.worldbank.org/v2/country/${encodeURIComponent(c)}/indicator/${encodeURIComponent(ind)}?date=${date}&format=json&per_page=50`);
}
async function frankfurter(p: { from?: string; to?: string; amount?: number; date?: string }) {
  const base = (p.from || "USD").toUpperCase(); const to = (p.to || "EUR,GBP,JPY,ZAR,CNY").toUpperCase();
  return await fetchJson(`https://api.frankfurter.app${p.date ? `/${p.date}` : "/latest"}?from=${base}&to=${to}&amount=${p.amount ?? 1}`);
}
async function carbonIntensity(_p: any) {
  const [now, fw] = await Promise.all([
    fetchJson("https://api.carbonintensity.org.uk/intensity"),
    fetchJson("https://api.carbonintensity.org.uk/intensity/factors"),
  ]);
  return { now, factors: fw };
}
async function otx(p: { indicator?: string; type?: string; pulses?: boolean }) {
  if (p.pulses) return await fetchJson("https://otx.alienvault.com/api/v1/pulses/subscribed?limit=10");
  return await fetchJson(`https://otx.alienvault.com/api/v1/indicators/${encodeURIComponent(p.type || "IPv4")}/${encodeURIComponent(p.indicator || "8.8.8.8")}/general`);
}
async function urlscan(p: { q?: string }) {
  return await fetchJson(`https://urlscan.io/api/v1/search/?q=${encodeURIComponent(p.q || "page.domain:example.com")}&size=20`);
}
async function blocklistDe(p: { ip?: string }) {
  if (p.ip) return await fetchJson(`https://api.blocklist.de/api.php?ip=${encodeURIComponent(p.ip)}&format=json`);
  const txt = await fetchJson("https://lists.blocklist.de/lists/all.txt");
  const ips = String(txt).split("\n").filter(Boolean).slice(0, 200);
  return { count: ips.length, sample: ips };
}
async function usgsWater(p: { sites?: string; param?: string }) {
  return await fetchJson(`https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${encodeURIComponent(p.sites || "01646500")}&parameterCd=${encodeURIComponent(p.param || "00060,00065")}&siteStatus=all`);
}
async function openLibrary(p: { q: string; limit?: number }) {
  return await fetchJson(`https://openlibrary.org/search.json?q=${encodeURIComponent(p.q || "consciousness")}&limit=${Math.min(Math.max(p.limit ?? 10, 1), 25)}`);
}
async function googleNews(p: { q?: string; lang?: string }) {
  const rss = `https://news.google.com/rss/search?q=${encodeURIComponent(p.q || "world")}&hl=${p.lang || "en-US"}`;
  const r = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rss)}`);
  return await r.json();
}
async function huggingface(p: { q?: string; limit?: number }) {
  return await fetchJson(`https://huggingface.co/api/models?search=${encodeURIComponent(p.q || "llama")}&limit=${Math.min(p.limit ?? 10, 30)}`);
}
async function arxivCat(p: { cat?: string; max?: number }) {
  const xml = await fetchJson(`https://export.arxiv.org/api/query?search_query=cat:${encodeURIComponent(p.cat || "physics.gen-ph")}&sortBy=submittedDate&sortOrder=descending&max_results=${Math.min(p.max ?? 10, 30)}`);
  return { cat: p.cat, raw: String(xml).slice(0, 8000) };
}

// ─── WAVE-5 key-required ─────────────────────────────────────────────────
async function openWeather(p: { latitude?: number; longitude?: number; city?: string; kind?: string }) {
  const KEY = openweather();
  if (!KEY) throw new Error("SKIP: OPENWEATHER_API_KEY not configured");
  const kind = (p.kind || "current").toLowerCase();
  const base = kind === "air" ? "https://api.openweathermap.org/data/2.5/air_pollution"
    : kind === "forecast" ? "https://api.openweathermap.org/data/2.5/forecast"
    : "https://api.openweathermap.org/data/2.5/weather";
  const u = new URL(base);
  u.searchParams.set("appid", KEY); u.searchParams.set("units", "metric");
  if (p.latitude != null && p.longitude != null) { u.searchParams.set("lat", String(p.latitude)); u.searchParams.set("lon", String(p.longitude)); }
  else if (p.city) { if (kind === "air") throw new Error("SKIP: air requires lat/lon"); u.searchParams.set("q", p.city); }
  else throw new Error("SKIP: lat/lon or city required");
  return await fetchJson(u.toString());
}
async function newsApi(p: { query?: string; q?: string; country?: string; category?: string; kind?: string; page_size?: number; pageSize?: number }) {
  const KEY = newsapiKey();
  if (!KEY) throw new Error("SKIP: NEWSAPI_KEY not configured");
  const query = p.query ?? p.q;
  const kind = (p.kind || (query ? "everything" : "top-headlines")).toLowerCase() === "everything" ? "everything" : "top-headlines";
  const u = new URL(`https://newsapi.org/v2/${kind}`);
  if (query) u.searchParams.set("q", query);
  if (kind !== "everything") { u.searchParams.set("country", p.country || "us"); if (p.category) u.searchParams.set("category", p.category); }
  else { u.searchParams.set("sortBy", "publishedAt"); u.searchParams.set("language", "en"); }
  const ps = p.page_size ?? p.pageSize ?? 20;
  u.searchParams.set("pageSize", String(Math.min(Math.max(ps, 1), 100)));
  const d = await fetchJson(u.toString(), { headers: { "X-Api-Key": KEY } });
  return { count: (d?.articles ?? []).length, total: d?.totalResults ?? 0, items: (d?.articles ?? []).map((a: any) => ({ title: a.title, source: a.source?.name, author: a.author, published: a.publishedAt, url: a.url, description: a.description })) };
}
async function virusTotal(p: { kind?: string; resource?: string }) {
  const KEY = virustotalKey(); if (!KEY) throw new Error("SKIP: VIRUSTOTAL_API_KEY not configured");
  const kind = (p.kind || "ip").toLowerCase(); const resource = String(p.resource || "").trim();
  if (!resource) throw new Error("SKIP: resource required");
  const map: Record<string,string> = {
    file: `files/${encodeURIComponent(resource)}`,
    url: `urls/${btoa(resource).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}`,
    domain: `domains/${encodeURIComponent(resource)}`,
    ip: `ip_addresses/${encodeURIComponent(resource)}`,
  };
  const path = map[kind]; if (!path) throw new Error("SKIP: kind must be file|url|domain|ip");
  const d = await fetchJson(`https://www.virustotal.com/api/v3/${path}`, { headers: { accept: "application/json", "x-apikey": KEY } });
  const a = d?.data?.attributes ?? {};
  return { kind, resource, last_analysis_stats: a.last_analysis_stats ?? null, reputation: a.reputation ?? null,
    total_votes: a.total_votes ?? null, last_analysis_date: a.last_analysis_date ?? null, categories: a.categories ?? null, raw_id: d?.data?.id ?? null };
}
async function abuseIpDb(p: { ip?: string; max_age_days?: number; verbose?: boolean }) {
  const KEY = abuseipdbKey(); if (!KEY) throw new Error("SKIP: ABUSEIPDB_API_KEY not configured");
  const ip = String(p.ip || "").trim();
  if (!/^[0-9a-fA-F:.]+$/.test(ip)) throw new Error("SKIP: ip required");
  const u = new URL("https://api.abuseipdb.com/api/v2/check");
  u.searchParams.set("ipAddress", ip);
  u.searchParams.set("maxAgeInDays", String(Math.min(Math.max(p.max_age_days ?? 90, 1), 365)));
  if (p.verbose) u.searchParams.set("verbose", "");
  const d = await fetchJson(u.toString(), { headers: { Accept: "application/json", Key: KEY } });
  return d?.data ?? d;
}

// ─── SHODAN (key-required) ───────────────────────────────────────────────
async function shodanCall(p: { endpoint?: string; params?: Record<string,string>; method?: string; body?: any }) {
  const KEY = shodanKey(); if (!KEY) throw new Error("SKIP: SHODAN_API_KEY not configured");
  const ep = String(p?.endpoint || "/api-info").trim();
  const path = ep.startsWith("/") ? ep : `/${ep}`;
  const usp = new URLSearchParams({ key: KEY });
  if (p.params) for (const [k, v] of Object.entries(p.params)) if (v != null && v !== "") usp.set(k, String(v));
  const url = `https://api.shodan.io${path}?${usp.toString()}`;
  const method = (p.method || "GET").toUpperCase();
  const init: RequestInit = { method };
  if (p.body && method !== "GET") { init.headers = { "Content-Type": "application/json" }; init.body = typeof p.body === "string" ? p.body : JSON.stringify(p.body); }
  return await fetchJson(url, init);
}
const shodanHost = (p: any) => shodanCall({ endpoint: `/shodan/host/${encodeURIComponent(need(p.ip, "ip"))}`, params: { history: p.history, minify: p.minify } });
const shodanHostCount = (p: any) => shodanCall({ endpoint: "/shodan/host/count", params: { query: need(p.query, "query"), facets: p.facets || "" } });
const shodanHostSearch = async (p: any) => {
  const q = need(p.query, "query");
  try { return await shodanCall({ endpoint: "/shodan/host/search", params: { query: q, facets: p.facets || "", page: p.page || "1", minify: p.minify ?? "true" } }); }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/HTTP 403|forbidden/i.test(msg)) {
      try { const c = await shodanCall({ endpoint: "/shodan/host/count", params: { query: q, facets: p.facets || "" } });
        return { matches: [], total: c?.total ?? 0, facets: c?.facets ?? {}, note: "host/search needs paid plan; returned counts." }; }
      catch { return { matches: [], total: 0, note: "host/search forbidden." }; }
    }
    throw e;
  }
};
const shodanSearchFacets  = () => shodanCall({ endpoint: "/shodan/host/search/facets" });
const shodanSearchFilters = () => shodanCall({ endpoint: "/shodan/host/search/filters" });
const shodanSearchTokens  = (p: any) => shodanCall({ endpoint: "/shodan/host/search/tokens", params: { query: need(p.query, "query") } });
const shodanPorts         = () => shodanCall({ endpoint: "/shodan/ports" });
const shodanProtocols     = () => shodanCall({ endpoint: "/shodan/protocols" });
const shodanScans         = () => shodanCall({ endpoint: "/shodan/scans" });
const shodanScanInfo      = (p: any) => shodanCall({ endpoint: `/shodan/scan/${encodeURIComponent(need(p.id, "id"))}` });
const shodanAccountProf   = () => shodanCall({ endpoint: "/account/profile" });
const shodanApiInfo       = () => shodanCall({ endpoint: "/api-info" });
const shodanMyIp          = () => shodanCall({ endpoint: "/tools/myip" });
const shodanHttpHeaders   = () => shodanCall({ endpoint: "/tools/httpheaders" });
const shodanDnsDomain     = (p: any) => shodanCall({ endpoint: `/dns/domain/${encodeURIComponent(need(p.domain, "domain"))}`, params: { history: p.history, type: p.type, page: p.page } });
const shodanDnsResolve    = (p: any) => shodanCall({ endpoint: "/dns/resolve", params: { hostnames: need(p.hostnames, "hostnames") } });
const shodanDnsReverse    = (p: any) => shodanCall({ endpoint: "/dns/reverse", params: { ips: need(p.ips, "ips") } });
const shodanAlertList     = () => shodanCall({ endpoint: "/shodan/alert/info" });
const shodanAlertInfo     = (p: any) => shodanCall({ endpoint: `/shodan/alert/${encodeURIComponent(p.id || "")}/info` });

// ─── WOLFRAM ─────────────────────────────────────────────────────────────
async function wolfram(p: { query?: string; mode?: "short" | "llm" | "full"; units?: "metric" | "imperial" }) {
  const KEY = wolframKey(); if (!KEY) throw new Error("SKIP: WOLFRAM_APP_ID not configured");
  const q = need(p.query, "query"); const mode = (p.mode || "short").toLowerCase(); const units = p.units || "metric";
  if (mode === "short") {
    const r = await fetch(`https://api.wolframalpha.com/v1/result?appid=${KEY}&i=${encodeURIComponent(q)}&units=${units}`, { signal: AbortSignal.timeout(15_000) });
    return { mode, ok: r.ok, status: r.status, answer: await r.text() };
  }
  if (mode === "llm") {
    const r = await fetch(`https://www.wolframalpha.com/api/v1/llm-api?appid=${KEY}&input=${encodeURIComponent(q)}&units=${units}`, { signal: AbortSignal.timeout(20_000) });
    return { mode, ok: r.ok, status: r.status, content: (await r.text()).slice(0, 8000) };
  }
  const r = await fetch(`https://api.wolframalpha.com/v2/query?appid=${KEY}&input=${encodeURIComponent(q)}&output=JSON&units=${units}&format=plaintext`, { signal: AbortSignal.timeout(25_000) });
  const j = await r.json().catch(() => ({}));
  return { mode, ok: r.ok, status: r.status, query: (j as any).queryresult };
}

/**
 * Offline constant verification — NEVER called inside an engine tick.
 *
 * Runs on `WOLFRAM_APP_ID_RESEARCH` with its own 20 queries/min token bucket,
 * so a busy chat session cannot starve verification (and vice versa). The exact
 * query string is returned alongside the digits so it can be recorded next to
 * the constant it verifies; a verification whose provenance is not recorded is
 * not a verification.
 */
const RESEARCH_BUDGET_PER_MIN = 20;
let researchWindowStart = 0;
let researchCount = 0;
function researchBudget(): { ok: boolean; remaining: number; resetInSec: number } {
  const now = Date.now();
  if (now - researchWindowStart >= 60_000) { researchWindowStart = now; researchCount = 0; }
  const resetInSec = Math.max(0, Math.ceil((researchWindowStart + 60_000 - now) / 1000));
  if (researchCount >= RESEARCH_BUDGET_PER_MIN) return { ok: false, remaining: 0, resetInSec };
  researchCount++;
  return { ok: true, remaining: RESEARCH_BUDGET_PER_MIN - researchCount, resetInSec };
}

async function wolframVerify(p: { expression?: string; digits?: number }) {
  const KEY = wolframResearchKey();
  if (!KEY) throw new Error("SKIP: WOLFRAM_APP_ID_RESEARCH not configured");
  const expr = need(p.expression, "expression");
  const digits = Math.max(10, Math.min(60, Math.floor(p.digits ?? 40)));
  const budget = researchBudget();
  if (!budget.ok) {
    return {
      channel: "research", ok: false, budgeted: false,
      reason: `Verification budget exhausted (${RESEARCH_BUDGET_PER_MIN}/min).`,
      resetInSec: budget.resetInSec,
    };
  }
  const query = `N[${expr}, ${digits}]`;
  const r = await fetch(
    `https://api.wolframalpha.com/v1/result?appid=${KEY}&i=${encodeURIComponent(query)}`,
    { signal: AbortSignal.timeout(20_000) },
  );
  const answer = (await r.text()).trim();
  return {
    channel: "research", ok: r.ok, status: r.status,
    expression: expr, digits, query, answer,
    budgetRemaining: budget.remaining, budgetResetInSec: budget.resetInSec,
  };
}


// ─── WAVE-6 keyless expansion ────────────────────────────────────────────
async function usgsQuakes(p: { mag?: string; window?: string }) {
  const mag = ["significant","4.5","2.5","1.0","all"].includes(p.mag || "") ? p.mag : "2.5";
  const w = ["hour","day","week","month"].includes(p.window || "") ? p.window : "day";
  return await fetchJson(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${mag}_${w}.geojson`);
}
async function gdacs(_p: any) { const t = await fetchJson("https://www.gdacs.org/xml/rss.xml"); return { format: "rss", raw: String(t).slice(0, 12000) }; }
async function noaaHurricane(_p: any) { return await fetchJson("https://www.nhc.noaa.gov/CurrentStorms.json"); }
async function noaaKpForecast(_p: any) { return await fetchJson("https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json"); }
async function gibsImagery(p: { layer?: string; date?: string; z?: number; x?: number; y?: number }) {
  const layer = p.layer || "MODIS_Terra_CorrectedReflectance_TrueColor";
  const date = p.date || new Date(Date.now() - 86400000).toISOString().slice(0,10);
  const z = p.z ?? 3, x = p.x ?? 2, y = p.y ?? 2;
  return { layer, date, z, x, y, image_url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/GoogleMapsCompatible_Level9/${z}/${y}/${x}.jpg` };
}
async function tsunamiAlerts(_p: any) { const t = await fetchJson("https://www.tsunami.gov/events/xml/PAAQAtom.xml"); return { format: "atom", raw: String(t).slice(0, 12000) }; }
async function noaaBuoys(p: { station?: string }) {
  const s = p.station || "46026";
  const t = await fetchJson(`https://www.ndbc.noaa.gov/data/realtime2/${encodeURIComponent(s)}.txt`);
  return { station: s, raw: String(t).slice(0, 4000) };
}
async function meteostatPoint(p: { lat?: number; lon?: number }) {
  const lat = p.lat ?? -33.92, lon = p.lon ?? 18.42;
  // ERA5 reanalysis lags real time by ~5 days; asking for today is a 400.
  const day = 86400000;
  const end = new Date(Date.now() - 7 * day).toISOString().slice(0, 10);
  const start = new Date(Date.now() - 37 * day).toISOString().slice(0, 10);
  return await fetchJson(`https://archive-api.open-meteo.com/v1/era5?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}&daily=temperature_2m_mean,precipitation_sum&timezone=UTC`);
}
async function cisaKev(_p: any) { return await fetchJson("https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"); }
async function epss(p: { cve?: string }) {
  const cve = (p.cve || "").toUpperCase().trim();
  return await fetchJson(cve ? `https://api.first.org/data/v1/epss?cve=${encodeURIComponent(cve)}` : "https://api.first.org/data/v1/epss?order=!epss&limit=20");
}
async function osvDev(p: { package?: string; ecosystem?: string; version?: string; commit?: string }) {
  const body: any = {};
  if (p.package) body.package = { name: p.package, ecosystem: p.ecosystem || "npm" };
  if (p.version) body.version = p.version;
  if (p.commit) body.commit = p.commit;
  const r = await fetch("https://api.osv.dev/v1/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  return await r.json();
}
async function torExitNodes(_p: any) {
  const t = await fetchJson("https://check.torproject.org/torbulkexitlist");
  const ips = String(t).split("\n").filter(Boolean);
  return { count: ips.length, sample: ips.slice(0, 100) };
}
async function spamhausDrop(p: { list?: string }) {
  const list = ["drop","edrop","dropv6"].includes(p.list || "") ? p.list : "drop";
  const t = await fetchJson(`https://www.spamhaus.org/drop/${list}.txt`);
  const lines = String(t).split("\n").filter(l => l && !l.startsWith(";")).slice(0, 200);
  return { list, count: lines.length, sample: lines };
}
async function openphish(_p: any) {
  const t = await fetchJson("https://openphish.com/feed.txt");
  const urls = String(t).split("\n").filter(Boolean).slice(0, 200);
  return { count: urls.length, sample: urls };
}
async function mitreAttack(p: { id?: string; query?: string }) {
  const j = await fetchJson("https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json");
  const items = (j?.objects || []).filter((o: any) => o.type === "attack-pattern");
  if (p.id) return items.find((o: any) => (o.external_references || []).some((r: any) => r.external_id === p.id)) || { error: `not found: ${p.id}` };
  if (p.query) { const q = p.query.toLowerCase(); return { matches: items.filter((o: any) => (o.name || "").toLowerCase().includes(q)).slice(0, 20).map((o: any) => ({ id: o.external_references?.[0]?.external_id, name: o.name })) }; }
  return { count: items.length, sample: items.slice(0, 10).map((o: any) => ({ id: o.external_references?.[0]?.external_id, name: o.name })) };
}
async function europePmc(p: { query: string; pageSize?: number }) {
  return await fetchJson(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(p.query || "consciousness")}&format=json&pageSize=${Math.min(p.pageSize ?? 10, 25)}`);
}
async function coreAcUk(p: { query: string }) { return await fetchJson(`https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(p.query || "consciousness")}&limit=10`); }
async function pubchem(p: { name?: string; cid?: string }) {
  const path = p.cid ? `cid/${encodeURIComponent(p.cid)}` : `name/${encodeURIComponent(p.name || "aspirin")}`;
  return await fetchJson(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/${path}/JSON`);
}
async function uniprot(p: { query: string }) { return await fetchJson(`https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(p.query || "insulin")}&format=json&size=10`); }
async function ncbiTaxonomy(p: { name?: string }) { return await fetchJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=taxonomy&term=${encodeURIComponent(p.name || "Homo sapiens")}&retmode=json`); }
async function rcsbPdb(p: { id?: string }) { return await fetchJson(`https://data.rcsb.org/rest/v1/core/entry/${encodeURIComponent((p.id || "4HHB").toUpperCase())}`); }
async function inspireHep(p: { query: string }) { return await fetchJson(`https://inspirehep.net/api/literature?q=${encodeURIComponent(p.query || "higgs boson")}&size=10&format=json`); }
async function gbif(p: { name?: string; limit?: number }) {
  if (p.name) return await fetchJson(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(p.name)}`);
  return await fetchJson(`https://api.gbif.org/v1/occurrence/search?limit=${Math.min(p.limit ?? 20, 100)}`);
}
async function inaturalist(p: { q?: string }) { return await fetchJson(`https://api.inaturalist.org/v1/observations?q=${encodeURIComponent(p.q || "butterfly")}&per_page=20`); }
async function worms(p: { name?: string }) { return await fetchJson(`https://www.marinespecies.org/rest/AphiaRecordsByName/${encodeURIComponent(p.name || "Carcharodon carcharias")}?like=true&marine_only=true`); }
async function sbdbNeo(p: { dist_max?: string }) { return await fetchJson(`https://ssd-api.jpl.nasa.gov/cad.api?dist-max=${encodeURIComponent(p.dist_max || "0.05")}&date-min=now&date-max=%2B60`); }
async function cneosFireballs(_p: any) { return await fetchJson("https://ssd-api.jpl.nasa.gov/fireball.api?limit=20"); }
async function goesXray(_p: any) { return await fetchJson("https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json"); }
async function exoplanetArchive(p: { query?: string }) {
  const adql = p.query || "select pl_name,hostname,pl_orbper,pl_rade,disc_year from ps where default_flag=1 order by disc_year desc";
  return await fetchJson(`https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=${encodeURIComponent(adql)}&format=json`);
}
async function silsoSunspots(_p: any) {
  const t = await fetchJson("https://www.sidc.be/SILSO/INFO/sndtotcsv.php");
  return { recent: String(t).trim().split("\n").slice(-30).map(l => l.split(";").map(s => s.trim())) };
}
async function nominatimReverse(p: { lat: number; lon: number }) {
  return await fetchJson(`https://nominatim.openstreetmap.org/reverse?lat=${p.lat}&lon=${p.lon}&format=jsonv2`, { headers: { "User-Agent": "Metatron-Research/1.0" } });
}
async function geonamesSearch(p: { q?: string }) { return await fetchJson(`http://api.geonames.org/searchJSON?q=${encodeURIComponent(p.q || "cape town")}&maxRows=10&username=demo`); }
async function worldTime(p: { zone?: string }) {
  const zone = (p.zone || "Etc/UTC").trim();
  // worldtimeapi.org drops connections under load. Try it, then timeapi.io,
  // then compute the answer locally — the runtime carries the full tz
  // database, so this tool can always answer rather than failing.
  for (const url of [
    `https://worldtimeapi.org/api/timezone/${encodeURIComponent(zone)}`,
    `https://timeapi.io/api/Time/current/zone?timeZone=${encodeURIComponent(zone)}`,
  ]) {
    try { return { source: new URL(url).host, ...(await fetchJson(url)) }; } catch { /* next */ }
  }
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "shortOffset",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  return {
    source: "local-tzdb", timezone: zone,
    datetime: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`,
    utc_datetime: now.toISOString(),
    utc_offset: String(parts.timeZoneName || "").replace(/^GMT/, "") || "+00:00",
    unixtime: Math.floor(now.getTime() / 1000),
  };
}
async function defillama(p: { protocol?: string }) {
  if (p.protocol) return await fetchJson(`https://api.llama.fi/protocol/${encodeURIComponent(p.protocol)}`);
  return await fetchJson("https://api.llama.fi/protocols");
}
async function coincap(p: { id?: string }) {
  // CoinCap v2 was retired; v3 is key-gated. Use it when a key exists,
  // otherwise answer the same question from CoinGecko's keyless endpoint.
  const key = env("COINCAP_API_KEY");
  if (key) {
    const base = "https://rest.coincap.io/v3";
    const url = p.id ? `${base}/assets/${encodeURIComponent(p.id)}` : `${base}/assets?limit=20`;
    return { source: "coincap-v3", ...(await fetchJson(url, { headers: { Authorization: `Bearer ${key}` } })) };
  }
  if (p.id) {
    const d = await fetchJson(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(p.id)}?localization=false&tickers=false&community_data=false&developer_data=false`);
    return { source: "coingecko-fallback", id: d?.id, symbol: d?.symbol, name: d?.name,
             priceUsd: d?.market_data?.current_price?.usd, marketCapUsd: d?.market_data?.market_cap?.usd,
             changePercent24Hr: d?.market_data?.price_change_percentage_24h };
  }
  const list = await fetchJson("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1");
  return { source: "coingecko-fallback", data: (list ?? []).map((c: any) => ({
    id: c.id, symbol: c.symbol, name: c.name, priceUsd: c.current_price, marketCapUsd: c.market_cap,
    changePercent24Hr: c.price_change_percentage_24h })) };
}
async function imfDataflow(_p: any) {
  // The DataMapper edge rejects generic agents with 403; a browser Accept
  // header clears it. SDMX dataflow is the fallback for the same catalogue.
  try {
    return await fetchJson("https://www.imf.org/external/datamapper/api/v1/indicators", {
      headers: { Accept: "application/json,text/plain,*/*", "Accept-Language": "en-US,en;q=0.9", Referer: "https://www.imf.org/external/datamapper/" },
    });
  } catch {
    // IMF's edge blocks datacentre egress outright and the SDMX host is
    // unreachable from here. Rather than a dead tool, serve the equivalent
    // macro-indicator catalogue from the World Bank, explicitly labelled so
    // no caller mistakes it for IMF data.
    const d = await fetchJson("https://api.worldbank.org/v2/indicator?format=json&per_page=200&page=1");
    const rows = Array.isArray(d) ? d[1] ?? [] : [];
    return {
      source: "worldbank-fallback",
      note: "IMF DataMapper unreachable from this runtime; World Bank indicator catalogue returned instead",
      count: rows.length,
      indicators: rows.slice(0, 200).map((i: any) => ({ id: i.id, name: i.name, source: i?.source?.value })),
    };
  }
}
async function frankfurterHistory(p: { from?: string; to?: string; start?: string; end?: string }) {
  const start = p.start || new Date(Date.now() - 365*86400000).toISOString().slice(0,10);
  const end = p.end || new Date().toISOString().slice(0,10);
  return await fetchJson(`https://api.frankfurter.app/${start}..${end}?from=${(p.from||"USD").toUpperCase()}&to=${(p.to||"EUR").toUpperCase()}`);
}
async function wikipediaGeo(p: { lat: number; lon: number; radius?: number }) {
  return await fetchJson(`https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${p.lat}|${p.lon}&gsradius=${Math.min(p.radius ?? 5000, 10000)}&gslimit=20&format=json&origin=*`);
}
async function wikipediaPageviews(p: { article: string; days?: number }) {
  const end = new Date(); const start = new Date(Date.now() - (p.days ?? 30)*86400000);
  const fmt = (d: Date) => d.toISOString().slice(0,10).replace(/-/g, "");
  return await fetchJson(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/all-agents/${encodeURIComponent(p.article)}/daily/${fmt(start)}/${fmt(end)}`);
}
async function wiktionary(p: { word: string; lang?: string }) {
  return await fetchJson(`https://${p.lang || "en"}.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(p.word || "consciousness")}`);
}
async function dictionaryDev(p: { word: string }) { return await fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(p.word || "consciousness")}`); }
async function urbanDictionary(p: { term: string }) { return await fetchJson(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(p.term || "phi")}`); }
async function quotable(_p: any) {
  // api.quotable.io went offline; ZenQuotes serves the same shape of answer.
  try {
    const d = await fetchJson("https://zenquotes.io/api/random");
    const q = Array.isArray(d) ? d[0] : d;
    return { source: "zenquotes", content: q?.q, author: q?.a };
  } catch {
    const d = await fetchJson("https://api.quotable.io/random");
    return { source: "quotable", content: d?.content, author: d?.author };
  }
}
async function unsplashKeyless(p: { query: string; w?: number; h?: number; n?: number }) {
  const w = p.w || 1024, h = p.h || 768, n = Math.min(p.n || 4, 9);
  return { query: p.query, count: n, image_urls: Array.from({length: n}).map((_, i) => `https://source.unsplash.com/${w}x${h}/?${encodeURIComponent(p.query || "cosmos")}&sig=${i}`) };
}
async function loremPicsum(p: { w?: number; h?: number; n?: number }) {
  const w = p.w || 800, h = p.h || 600, n = Math.min(p.n || 4, 9);
  return { count: n, image_urls: Array.from({length: n}).map((_, i) => `https://picsum.photos/seed/${i}/${w}/${h}`) };
}
async function archiveOrg(p: { query: string }) {
  return await fetchJson(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(p.query || "consciousness")}&fl[]=identifier,title,mediatype&rows=20&output=json`);
}
async function librivox(p: { query: string }) {
  // LibriVox answers 404 for "no match" rather than an empty list.
  const url = `https://librivox.org/api/feed/audiobooks/?title=${encodeURIComponent(p.query || "plato")}&format=json&limit=10`;
  try {
    return await fetchJson(url);
  } catch (e: any) {
    if (/HTTP 404/.test(String(e?.message))) return { books: [], count: 0, note: "no LibriVox title matched" };
    throw e;
  }
}
async function npmRegistry(p: { name: string }) { return await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(p.name || "react")}`); }
async function pypiMetadata(p: { name: string }) { return await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(p.name || "numpy")}/json`); }
async function cratesIo(p: { name?: string; query?: string }) {
  if (p.name) return await fetchJson(`https://crates.io/api/v1/crates/${encodeURIComponent(p.name)}`);
  return await fetchJson(`https://crates.io/api/v1/crates?q=${encodeURIComponent(p.query || "tokio")}&per_page=10`);
}
async function bundlephobia(p: { name: string }) { return await fetchJson(`https://bundlephobia.com/api/size?package=${encodeURIComponent(p.name || "lodash")}`); }
async function caniuse(p: { feature?: string }) {
  const j = await fetchJson("https://raw.githubusercontent.com/Fyrd/caniuse/main/data.json");
  if (p.feature) return j?.data?.[p.feature] || { error: `unknown: ${p.feature}` };
  return { count: Object.keys(j?.data || {}).length, sample: Object.keys(j?.data || {}).slice(0, 30) };
}
async function httpbinDiag(p: { kind?: string }) { return await fetchJson(`https://httpbin.org/${p.kind || "ip"}`); }
async function dataGovCkan(p: { query: string }) {
  const q = encodeURIComponent(p.query || "climate");
  // catalog.data.gov moved the CKAN mount; try both, newest first.
  for (const url of [
    `https://catalog.data.gov/api/action/package_search?q=${q}&rows=10`,
    `https://catalog.data.gov/api/3/action/package_search?q=${q}&rows=10`,
  ]) {
    try { return await fetchJson(url); } catch { /* next */ }
  }
  throw new Error("SKIP: catalog.data.gov unavailable");
}
async function whoIndicators(p: { code?: string }) {
  if (p.code) return await fetchJson(`https://ghoapi.azureedge.net/api/${encodeURIComponent(p.code)}`);
  return await fetchJson("https://ghoapi.azureedge.net/api/Indicator");
}
async function gleifLei(p: { lei?: string; query?: string }) {
  if (p.lei) return await fetchJson(`https://api.gleif.org/api/v1/lei-records/${encodeURIComponent(p.lei)}`);
  return await fetchJson(`https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]=${encodeURIComponent(p.query || "apple")}&page[size]=10`);
}
async function euOpenData(p: { query: string }) { return await fetchJson(`https://data.europa.eu/api/hub/search/search?q=${encodeURIComponent(p.query || "climate")}&limit=10`); }

// arxiv direct search (V11 already had it as a Kimi tool; expose here too for uniformity)
async function arxivSearch(p: { query: string; max_results?: number }) {
  const max = Math.min(Math.max(p.max_results ?? 5, 1), 20);
  const r = await fetch(`http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(p.query || "consciousness")}&max_results=${max}`,
    { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": "Metatron-Research/1.0" } });
  return { status: r.status, atom: (await r.text()).slice(0, 16000) };
}

// ─── Phase S1 — live sensor feeds (real endpoints, no mocks) ─────────────
async function openMeteo(p: { lat: number; lon: number; hourly?: string }) {
  const hourly = (p.hourly || "temperature_2m,wind_speed_10m,pressure_msl,shortwave_radiation,soil_moisture_0_to_1cm").trim();
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&hourly=${encodeURIComponent(hourly)}&current_weather=true`;
  return await fetchJson(url);
}

async function openMeteoAir(p: { lat: number; lon: number }) {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${p.lat}&longitude=${p.lon}&hourly=pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,ozone,sulphur_dioxide,uv_index,european_aqi`;
  return await fetchJson(url);
}

async function sensorCommunity(p: { lamin?: number; lomin?: number; lamax?: number; lomax?: number; limit?: number }) {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 500);
  const all = await fetchJson("https://data.sensor.community/static/v2/data.1h.json");
  if (!Array.isArray(all)) return { count: 0, items: [], note: "unexpected payload" };
  const bbox = (p.lamin != null && p.lomin != null && p.lamax != null && p.lomax != null);
  const items: any[] = [];
  for (const s of all) {
    const lat = +s?.location?.latitude, lon = +s?.location?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (bbox && (lat < p.lamin! || lat > p.lamax! || lon < p.lomin! || lon > p.lomax!)) continue;
    items.push({
      id: s.id, sensor: s.sensor?.id, type: s.sensor?.sensor_type?.name,
      lat, lon, country: s.location?.country, timestamp: s.timestamp,
      values: (s.sensordatavalues || []).map((v: any) => ({ k: v.value_type, v: +v.value })),
    });
    if (items.length >= limit) break;
  }
  return { count: items.length, total_sensors: all.length, items };
}

async function copernicusOdata(p: { collection?: string; lat?: number; lon?: number; days?: number; top?: number }) {
  const top = Math.min(Math.max(p.top ?? 10, 1), 20);
  const days = Math.min(Math.max(p.days ?? 7, 1), 90);
  const collection = (p.collection || "SENTINEL-2").toUpperCase();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const filters: string[] = [`Collection/Name eq '${collection}'`, `ContentDate/Start gt ${since}`];
  if (p.lat != null && p.lon != null) {
    const d = 0.5;
    const poly = `POLYGON((${p.lon - d} ${p.lat - d},${p.lon + d} ${p.lat - d},${p.lon + d} ${p.lat + d},${p.lon - d} ${p.lat + d},${p.lon - d} ${p.lat - d}))`;
    filters.push(`OData.CSC.Intersects(area=geography'SRID=4326;${poly}')`);
  }
  const url = `https://catalogue.dataspace.copernicus.eu/odata/v1/Products?$filter=${encodeURIComponent(filters.join(" and "))}&$top=${top}&$orderby=ContentDate/Start desc`;
  const d = await fetchJson(url);
  const items = (d?.value ?? []).map((x: any) => ({
    id: x.Id, name: x.Name, start: x.ContentDate?.Start, end: x.ContentDate?.End,
    size: x.ContentLength, online: x.Online, footprint: x.Footprint,
  }));
  return { collection, count: items.length, items };
}

async function nasaModisNrt(p: { area?: string; days?: number }) {
  const mapKey = nasaFirmsKey().trim();
  if (!mapKey) return { area: p.area || "world", days: p.days ?? 1, count: 0, items: [], note: "NASA_FIRMS_KEY required for MODIS NRT." };
  const area = (p.area || "world").toLowerCase();
  const days = Math.min(Math.max(p.days ?? 1, 1), 7);
  try {
    const csv = await fetchJson(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/MODIS_NRT/${area}/${days}`);
    const rows = String(csv).trim().split("\n");
    const header = rows[0].split(",");
    const items = rows.slice(1, 21).map(r => { const c = r.split(","); return Object.fromEntries(header.map((h, i) => [h.trim(), c[i]])); });
    return { sensor: "MODIS_NRT", area, days, header, count: items.length, items };
  } catch (e) { return { sensor: "MODIS_NRT", area, days, count: 0, items: [], error: e instanceof Error ? e.message : String(e) }; }
}

async function crtshRecent(p: { domain: string; limit?: number }) {
  const domain = need(p.domain, "domain");
  const limit = Math.min(Math.max(p.limit ?? 20, 1), 50);
  const url = `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`;
  const d = await fetchJson(url);
  const arr = Array.isArray(d) ? d.slice(0, limit) : [];
  const items = arr.map((c: any) => ({
    id: c.id, logged_at: c.entry_timestamp, not_before: c.not_before, not_after: c.not_after,
    issuer: c.issuer_name, common_name: c.common_name, name_value: c.name_value,
  }));
  return { domain, count: items.length, items };
}

async function openGliderNetwork(p: { lamin?: number; lomin?: number; lamax?: number; lomax?: number }) {
  const b = {
    lamin: p.lamin ?? 45, lomin: p.lomin ?? 5, lamax: p.lamax ?? 50, lomax: p.lomax ?? 15,
  };
  const url = `https://live.glidernet.org/lxml.php?a=0&b=${b.lamax}&c=${b.lamin}&d=${b.lomax}&e=${b.lomin}`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "Metatron-Research/1.0" } });
    if (!r.ok) return { bbox: b, count: 0, items: [], note: `OGN HTTP ${r.status}` };
    const xml = await r.text();
    const items: any[] = [];
    const re = /<m a="([^"]+)"\s*\/>/g; let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) && items.length < 100) {
      const parts = m[1].split(",");
      items.push({
        lat: +parts[0], lon: +parts[1], callsign: parts[2], altitude_m: +parts[4],
        ground_speed_kmh: +parts[5], track_deg: +parts[6], climb_ms: +parts[8],
        type_code: parts[10], receiver: parts[11],
      });
    }
    return { bbox: b, count: items.length, items };
  } catch (e) { return { bbox: b, count: 0, items: [], note: `OGN error: ${e instanceof Error ? e.message : String(e)}` }; }
  finally { clearTimeout(t); }
}

/** Newest sample from either SWPC shape: object array, or header + rows. */
function latestSwpc(d: any): Record<string, unknown> | null {
  if (!Array.isArray(d) || d.length === 0) return null;
  const last = d[d.length - 1];
  if (Array.isArray(last) && Array.isArray(d[0])) {
    return Object.fromEntries((d[0] as string[]).map((k, i) => [k, last[i]]));
  }
  return typeof last === "object" && last ? last : null;
}

async function noaaSwpcSolarWind(p: { kind?: string }) {
  const kind = (p.kind || "both").toLowerCase();
  const out: any = { source: "NOAA SWPC / DSCOVR L1", sampled_at: new Date().toISOString() };
  if (kind === "plasma" || kind === "both") {
    // SWPC retired products/solar-wind/* in favour of the RTSW JSON feed,
    // which is an array of objects rather than a header + rows matrix.
    const plasma = await firstJson([
      "https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json",
      "https://services.swpc.noaa.gov/products/solar-wind/plasma-5-minute.json",
    ]);
    out.plasma = latestSwpc(plasma);
  }
  if (kind === "mag" || kind === "both") {
    const mag = await firstJson([
      "https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json",
      "https://services.swpc.noaa.gov/products/solar-wind/mag-5-minute.json",
    ]);
    out.mag = latestSwpc(mag);
  }
  return out;
}


// ─── Phase D1 — open-vocabulary visual locator (Grounding-DINO via HF) ───
// Honest deployment notes (in chat-format for the agent if it inspects this):
//   • The NVIDIA "Locate Anything" / NV-DINOv2 weights are ~1.4 GB and need
//     a CUDA GPU at inference time — they cannot run inside this Cloudflare
//     Worker (no GPU, 128 MB memory cap). For server-side calls we route
//     through HuggingFace Inference using the much smaller Grounding-DINO
//     Tiny checkpoint (~170 MB), which is open-vocab and free with a token.
//   • A second-stage WebGPU/ONNX path that runs the same Tiny model directly
//     in the user's browser (no API key, no per-call cost) is planned as
//     Phase D2 — see .lovable/plan.md.
function coerceBox(d: any): { xmin: number; ymin: number; xmax: number; ymax: number } | null {
  const b = d?.box ?? d?.bbox ?? d?.box_2d ?? d?.bounding_box;
  if (!b) return null;
  if (Array.isArray(b) && b.length >= 4) {
    return { xmin: +b[0], ymin: +b[1], xmax: +b[2], ymax: +b[3] };
  }
  if (typeof b === 'object') {
    const xmin = b.xmin ?? b.x1 ?? b.left;
    const ymin = b.ymin ?? b.y1 ?? b.top;
    const xmax = b.xmax ?? b.x2 ?? b.right;
    const ymax = b.ymax ?? b.y2 ?? b.bottom;
    if ([xmin, ymin, xmax, ymax].every((v) => typeof v === 'number')) {
      return { xmin, ymin, xmax, ymax };
    }
  }
  return null;
}

// ─── locate_anything retry + circuit breaker ──────────────────────────────
// Per-model breaker: tracks consecutive failures. After FAIL_THRESHOLD
// failures, opens for COOLDOWN_MS; first call after cooldown is HALF_OPEN
// (single trial). Any success resets state. Retries use exponential backoff
// jittered around base = 400ms, capped at 4s, max 3 attempts. The total
// in-call wait is bounded by RETRY_BUDGET_MS so we never starve the caller.
type BreakerState = { fails: number; openedAt: number; halfOpen: boolean };
const LOCATE_BREAKERS = new Map<string, BreakerState>();
const FAIL_THRESHOLD = 4;
const COOLDOWN_MS = 30_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 400;
const RETRY_CAP_MS = 4_000;
const RETRY_BUDGET_MS = 8_000;

function breakerGet(model: string): BreakerState {
  let s = LOCATE_BREAKERS.get(model);
  if (!s) { s = { fails: 0, openedAt: 0, halfOpen: false }; LOCATE_BREAKERS.set(model, s); }
  return s;
}
function breakerCheck(model: string): { allow: boolean; retryInSec?: number; halfOpen?: boolean } {
  const s = breakerGet(model);
  if (s.openedAt === 0) return { allow: true };
  const elapsed = Date.now() - s.openedAt;
  if (elapsed >= COOLDOWN_MS) { s.halfOpen = true; return { allow: true, halfOpen: true }; }
  return { allow: false, retryInSec: +((COOLDOWN_MS - elapsed) / 1000).toFixed(1) };
}
function breakerOnSuccess(model: string) {
  const s = breakerGet(model);
  s.fails = 0; s.openedAt = 0; s.halfOpen = false;
}
function breakerOnFailure(model: string) {
  const s = breakerGet(model);
  if (s.halfOpen) { s.openedAt = Date.now(); s.halfOpen = false; return; }
  s.fails += 1;
  if (s.fails >= FAIL_THRESHOLD) { s.openedAt = Date.now(); s.fails = 0; }
}
function backoffDelay(attempt: number, hintSec?: number | null): number {
  if (typeof hintSec === 'number' && hintSec > 0) {
    return Math.min(hintSec * 1000, RETRY_CAP_MS);
  }
  const exp = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_CAP_MS);
  return Math.floor(exp * (0.5 + Math.random() * 0.5));
}

async function locateAnythingOnce(url: string, tok: string, body: unknown): Promise<{ http: number; payload: any; ct: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: ctl.signal,
      headers: { "Authorization": `Bearer ${tok}`, "Content-Type": "application/json", "x-wait-for-model": "true" },
      body: JSON.stringify(body),
    });
    const ct = r.headers.get("content-type") || "";
    const payload = ct.includes("json") ? await r.json() : await r.text();
    return { http: r.status, payload, ct };
  } finally { clearTimeout(t); }
}

async function locateAnything(p: { image: string; prompt: string; threshold?: number; model?: string }) {
  const tok = hfToken();
  if (!tok) {
    return {
      status: 'unavailable',
      reason: 'HF_TOKEN secret is not set. Add a HuggingFace inference token via Project Settings to enable open-vocab locate-anything detection.',
      image: p.image?.slice(0, 96), prompt: p.prompt,
    };
  }
  const model = (p.model || "IDEA-Research/grounding-dino-tiny").trim();
  const threshold = Math.max(0, Math.min(1, p.threshold ?? 0.25));
  const url = `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`;
  const labels = p.prompt.split(/[.,;]/).map(s => s.trim()).filter(Boolean);
  const body = {
    inputs: p.image,
    parameters: { candidate_labels: labels, threshold, box_threshold: threshold, text_threshold: threshold, text: p.prompt },
  };

  // Circuit breaker gate
  const gate = breakerCheck(model);
  if (!gate.allow) {
    return { status: 'unavailable', reason: 'Circuit breaker open after repeated failures — cooling down.', retryInSec: gate.retryInSec, model, breaker: 'open' };
  }

  const started = Date.now();
  let lastErr: any = null;
  let attempt = 0;
  while (attempt < MAX_ATTEMPTS) {
    let result: { http: number; payload: any; ct: string };
    try {
      result = await locateAnythingOnce(url, tok, body);
    } catch (e) {
      lastErr = e;
      breakerOnFailure(model);
      attempt += 1;
      if (attempt >= MAX_ATTEMPTS || Date.now() - started > RETRY_BUDGET_MS) break;
      await new Promise((res) => setTimeout(res, backoffDelay(attempt)));
      continue;
    }
    const { http, payload } = result;
    if (http >= 200 && http < 300) {
      breakerOnSuccess(model);
      const detections = Array.isArray(payload) ? payload.map((d: any) => ({
        label: d?.label ?? d?.box_label ?? null,
        score: typeof d?.score === 'number' ? +d.score.toFixed(4) : null,
        bbox: coerceBox(d),
      })) : [];
      return { status: 'ok', model, prompt: p.prompt, threshold, count: detections.length, detections, attempts: attempt + 1 };
    }
    const detail = typeof payload === 'string' ? payload.slice(0, 512) : payload;
    // Non-retryable: auth / bad request — bail immediately
    if (http === 401 || http === 403) {
      breakerOnFailure(model);
      return { status: 'unavailable', reason: 'HF_TOKEN rejected — rotate the HuggingFace token in Project Settings.', http, model };
    }
    if (http === 400 || http === 422) {
      // Treat as caller error; do NOT trip the breaker
      return { status: 'bad_request', reason: 'HF rejected the request — most likely a malformed image URL or unsupported data: payload.', http, detail, model };
    }
    // Retryable: 503 warming, 429 rate limit, 5xx
    const retryInSec = typeof payload === 'object' && payload && typeof (payload as any).estimated_time === 'number'
      ? +(payload as any).estimated_time.toFixed(1) : null;
    attempt += 1;
    breakerOnFailure(model);
    if (attempt >= MAX_ATTEMPTS || Date.now() - started > RETRY_BUDGET_MS) {
      if (http === 503) return { status: 'warming', reason: 'Model still cold after retries.', retryInSec, http, model, attempts: attempt };
      if (http === 429) return { status: 'unavailable', reason: 'HuggingFace rate-limited after retries.', retryInSec, http, model, attempts: attempt };
      return { status: 'error', http, model, prompt: p.prompt, detail, attempts: attempt };
    }
    const wait = backoffDelay(attempt, retryInSec);
    if (Date.now() - started + wait > RETRY_BUDGET_MS) {
      if (http === 503) return { status: 'warming', reason: 'Retry budget exhausted before warm-up completed.', retryInSec, http, model, attempts: attempt };
      return { status: 'error', http, model, prompt: p.prompt, detail, attempts: attempt };
    }
    await new Promise((res) => setTimeout(res, wait));
  }
  return { status: 'error', model, prompt: p.prompt, error: lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'exhausted'), attempts: attempt };
}

// ─── Phase C1 — CAD / BIM arsenal (keyless) ──────────────────────────────

const BSDD = "https://api.bsdd.buildingsmart.org/api";

async function bsddSearch(p: { query: string; limit?: number; dictionary?: string }) {
  const q = String(p?.query ?? "").trim();
  if (!q) throw new Error("SKIP: 'query' required");
  const limit = Math.max(1, Math.min(p.limit ?? 10, 50));
  const url = new URL(`${BSDD}/TextSearch/v2`);
  url.searchParams.set("SearchText", q);
  url.searchParams.set("limit", String(limit));
  if (p.dictionary) url.searchParams.set("DictionaryUris", p.dictionary);
  const d = await fetchJson(url.toString());
  const classes = (d?.classes ?? []).slice(0, limit).map((c: any) => ({
    name: c?.name, code: c?.code ?? c?.referenceCode, uri: c?.uri,
    type: c?.classType, parent: c?.parentClassName,
    dictionary: c?.dictionaryName ?? c?.dictionaryUri,
    description: typeof c?.description === "string" ? c.description.slice(0, 600) : undefined,
  }));
  return { query: q, count: classes.length, classes };
}

async function bsddDictionaries(p: { limit?: number }) {
  const limit = Math.max(1, Math.min(p?.limit ?? 25, 100));
  const d = await fetchJson(`${BSDD}/Dictionary/v1?limit=${limit}`);
  const dictionaries = (d?.dictionaries ?? []).slice(0, limit).map((x: any) => ({
    name: x?.name, code: x?.code, version: x?.version, uri: x?.uri,
    organization: x?.organizationNameOwner,
    languages: (x?.availableLanguages ?? []).map((l: any) => l?.code).filter(Boolean),
  }));
  return { count: dictionaries.length, dictionaries };
}

async function bsddClass(p: { uri?: string; ifc?: string; version?: string }) {
  let uri = String(p?.uri ?? "").trim();
  if (!uri) {
    const ifc = String(p?.ifc ?? "").trim();
    if (!ifc) throw new Error("SKIP: 'uri' or 'ifc' required");
    const ver = String(p?.version ?? "4.3").trim();
    uri = `https://identifier.buildingsmart.org/uri/buildingsmart/ifc/${ver}/class/${ifc}`;
  }
  const d = await fetchJson(`${BSDD}/Class/v1?uri=${encodeURIComponent(uri)}`);
  return {
    uri,
    name: d?.name, code: d?.code ?? d?.referenceCode, type: d?.classType,
    definition: typeof d?.definition === "string" ? d.definition.slice(0, 2000) : d?.description,
    parent: d?.parentClassReference?.name,
    hierarchy: (d?.hierarchy ?? []).map((h: any) => h?.code ?? h?.name).filter(Boolean),
    properties: (d?.classProperties ?? []).slice(0, 60).map((pr: any) => ({
      name: pr?.name, code: pr?.code, dataType: pr?.dataType, unit: pr?.unit,
      set: pr?.propertySet, values: (pr?.allowedValues ?? []).slice(0, 12).map((v: any) => v?.value ?? v?.code),
    })),
  };
}

async function speckleGraphql(p: { query?: string; variables?: Record<string, unknown>; server?: string }) {
  const server = assertUrl(String(p?.server ?? "https://app.speckle.systems"), "server").replace(/\/+$/, "");
  const query = String(p?.query ?? "").trim() || "{ serverInfo { name description version } }";
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${server}/graphql`, {
      method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json", "User-Agent": "Metatron/1.0 (+research)" },
      body: JSON.stringify({ query, variables: p?.variables ?? {} }),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${r.status >= 500 || r.status === 429 ? "SKIP: " : ""}speckle → HTTP ${r.status}`);
    if (body?.errors?.length) return { server, errors: body.errors.map((e: any) => e?.message).slice(0, 5), data: body?.data ?? null };
    return { server, data: body?.data ?? null };
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`SKIP: speckle → timeout (${TIMEOUT_MS}ms)`);
    throw new Error(redact(String(e?.message ?? e)));
  } finally { clearTimeout(t); }
}

async function osmBuildings(p: { lat: number; lon: number; radius?: number; limit?: number }) {
  const lat = Number(p?.lat), lon = Number(p?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("SKIP: 'lat' and 'lon' required");
  const radius = Math.max(25, Math.min(p?.radius ?? 300, 2000));
  const limit = Math.max(1, Math.min(p?.limit ?? 60, 300));
  const ql = `[out:json][timeout:20];(way["building"](around:${radius},${lat},${lon});relation["building"](around:${radius},${lat},${lon}););out tags center ${limit};`;
  const raw = await overpass({ query: ql });
  const els = (raw?.elements ?? []) as any[];
  const buildings = els.slice(0, limit).map((e) => ({
    id: e?.id, type: e?.type,
    lat: e?.center?.lat ?? e?.lat, lon: e?.center?.lon ?? e?.lon,
    building: e?.tags?.building, name: e?.tags?.name,
    levels: e?.tags?.["building:levels"], height: e?.tags?.height,
    material: e?.tags?.["building:material"], roof: e?.tags?.["roof:shape"],
    start_date: e?.tags?.start_date,
  }));
  return { lat, lon, radius, count: buildings.length, buildings };
}

const CAD_EXT = /\.(dxf|svg|obj|stl|ifc|ifcxml|step|stp)(?:$|[?#])/i;

async function cadFetch(p: { url: string; max_chars?: number }) {
  const url = assertUrl(p?.url);
  const cap = Math.max(10_000, Math.min(p?.max_chars ?? 400_000, 2_000_000));
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS * 2);
  try {
    const r = await fetch(url, {
      redirect: "follow", signal: ctl.signal,
      headers: { "User-Agent": "Metatron/1.0 (+research)", Accept: "*/*" },
    });
    const ct = (r.headers.get("content-type") ?? "").toLowerCase();
    if (!r.ok) return { url: r.url, status: r.status, error: `HTTP ${r.status}`, contentType: ct };
    const buf = new Uint8Array(await r.arrayBuffer());
    // Binary refusal: STL/DXF/IFC all have text variants; a binary payload is
    // reported as such rather than decoded into noise.
    let nonPrintable = 0;
    const probe = Math.min(buf.length, 4096);
    for (let i = 0; i < probe; i++) {
      const b = buf[i];
      if (b === 0 || (b < 9) || (b > 13 && b < 32)) nonPrintable++;
    }
    if (probe > 0 && nonPrintable / probe > 0.05) {
      return { url: r.url, status: r.status, contentType: ct, binary: true, bytes: buf.length,
        error: "binary CAD payload — text form (DXF/OBJ/STL-ASCII/IFC-SPF/SVG) required" };
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    const ext = url.match(CAD_EXT)?.[1]?.toLowerCase() ?? "";
    return {
      url: r.url, status: r.status, contentType: ct, format: ext || "sniff",
      bytes: buf.length, truncated: text.length > cap, text: text.slice(0, cap),
    };
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`SKIP: ${redact(url)} → timeout`);
    throw new Error(redact(String(e?.message ?? e)));
  } finally { clearTimeout(t); }
}

export const INTEL_HANDLERS: Record<string, (p: any) => Promise<any>> = {
  // Phase C1 — CAD / BIM
  bsdd_search: bsddSearch, bsdd_dictionaries: bsddDictionaries, bsdd_class: bsddClass,
  speckle_graphql: speckleGraphql, osm_buildings: osmBuildings, cad_fetch: cadFetch,
  // wave 1 + 5
  wolfram, wolfram_alpha: wolfram,
  openweather: openWeather, newsapi: newsApi, virustotal: virusTotal, abuseipdb: abuseIpDb,
  crossref, semantic_scholar: semanticScholar, pubmed, patents: patentsview,
  osm_geocode: osmNominatim, overpass, binance, mastodon, celestrak,
  nasa_firms: nasaFirms, jpl_horizons: jplHorizons,
  // wave 2
  greynoise, hackernews, reddit, github_search: githubSearch, wikidata: wikidataSparql,
  rdap, usgs_volcanoes: usgsVolcanoes, openaq, opensky, gdelt, coingecko,
  sec_edgar: secEdgar, common_crawl: commonCrawl, ipfs: ipfsCat, favicon_hash: shodanFavicon,
  // wave 3
  shodan_internetdb: shodanInternetdb, urlhaus, cve: cveCircl, ripe_stat: ripeStat,
  bgpview, crtsh, hibp_passwords: hibpPasswords, dns_resolve: dnsResolve, ip_api: ipApi,
  wayback, threatfox, coindesk, http_probe: httpProbe, web_fetch: webFetch,
  // wave 4
  nvd, eonet, donki, nws_alerts: nwsAlerts, metar, marine, flood, tides, adsb,
  worldbank, frankfurter, carbon_intensity: carbonIntensity, otx, urlscan,
  blocklist_de: blocklistDe, usgs_water: usgsWater, open_library: openLibrary,
  google_news: googleNews, huggingface, arxiv_cat: arxivCat, arxiv_search: arxivSearch,
  // shodan official
  shodan: shodanCall, shodan_host: shodanHost, shodan_host_count: shodanHostCount,
  shodan_host_search: shodanHostSearch, shodan_search_facets: shodanSearchFacets,
  shodan_search_filters: shodanSearchFilters, shodan_search_tokens: shodanSearchTokens,
  shodan_ports: shodanPorts, shodan_protocols: shodanProtocols, shodan_scans: shodanScans,
  shodan_scan_info: shodanScanInfo, shodan_account_profile: shodanAccountProf,
  shodan_api_info: shodanApiInfo, shodan_myip: shodanMyIp, shodan_httpheaders: shodanHttpHeaders,
  shodan_dns_domain: shodanDnsDomain, shodan_dns_resolve: shodanDnsResolve,
  shodan_dns_reverse: shodanDnsReverse, shodan_alerts: shodanAlertList, shodan_alert_info: shodanAlertInfo,
  // wave 6
  usgs_quakes: usgsQuakes, gdacs, noaa_hurricane: noaaHurricane, noaa_kp_forecast: noaaKpForecast,
  gibs_imagery: gibsImagery, tsunami_alerts: tsunamiAlerts, noaa_buoys: noaaBuoys,
  meteostat: meteostatPoint,
  cisa_kev: cisaKev, epss, osv: osvDev, tor_exit_nodes: torExitNodes,
  spamhaus_drop: spamhausDrop, openphish, mitre_attack: mitreAttack,
  europepmc: europePmc, core_ac_uk: coreAcUk, pubchem, uniprot, ncbi_taxonomy: ncbiTaxonomy,
  rcsb_pdb: rcsbPdb, inspire_hep: inspireHep,
  gbif, inaturalist, worms,
  sbdb_neo: sbdbNeo, cneos_fireballs: cneosFireballs, goes_xray: goesXray,
  exoplanet_archive: exoplanetArchive, silso_sunspots: silsoSunspots,
  nominatim_reverse: nominatimReverse, geonames_search: geonamesSearch, worldtime: worldTime,
  defillama, coincap, imf_dataflow: imfDataflow, frankfurter_history: frankfurterHistory,
  wikipedia_geo: wikipediaGeo, wikipedia_pageviews: wikipediaPageviews,
  wiktionary, dictionary_dev: dictionaryDev, urban_dictionary: urbanDictionary, quotable,
  unsplash_keyless: unsplashKeyless, lorem_picsum: loremPicsum, archive_org: archiveOrg, librivox,
  npm_registry: npmRegistry, pypi_metadata: pypiMetadata, crates_io: cratesIo,
  bundlephobia, caniuse, httpbin: httpbinDiag,
  data_gov: dataGovCkan, who_indicators: whoIndicators, gleif_lei: gleifLei, eu_open_data: euOpenData,
  // Phase S1 — live sensor feeds
  open_meteo: openMeteo, open_meteo_air: openMeteoAir, sensor_community: sensorCommunity,
  copernicus_odata: copernicusOdata, nasa_modis_nrt: nasaModisNrt,
  crtsh_recent: crtshRecent, open_glider_network: openGliderNetwork,
  noaa_swpc_solarwind: noaaSwpcSolarWind,
  // Phase D1 — open-vocabulary visual locator
  locate_anything: locateAnything,
};

export function hasIntelHandler(name: string) {
  return Object.prototype.hasOwnProperty.call(INTEL_HANDLERS, name);
}
