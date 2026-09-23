/**
 * METATRON V11 — Intel tool metadata + OpenAI tool-spec generation.
 *
 * Client-safe: pure data, no runtime imports. Drives the Tools-panel catalogue
 * and the OpenAI/Kimi function list. Adding an action = add one row.
 */

export type IntelAuth = "none" | "key" | "demo";
export type IntelCategory =
  | "research" | "geo" | "finance" | "osint" | "space"
  | "web" | "weather" | "civic" | "dev" | "knowledge" | "cad" | "misc";

export interface IntelToolMeta {
  name: string;
  category: IntelCategory;
  auth: IntelAuth;
  description: string;
  envKey?: string;
  parameters: Record<string, unknown>;
}

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: "object", properties: props, required, additionalProperties: true,
});
const str = (desc?: string) => ({ type: "string", description: desc });
const num = (desc?: string) => ({ type: "number", description: desc });
const int = (desc?: string) => ({ type: "integer", description: desc });
const bool = (desc?: string) => ({ type: "boolean", description: desc });

export const INTEL_META: IntelToolMeta[] = [
  // ── Research ─────────────────────────────────────────────────────────
  { name: "crossref", category: "research", auth: "none", description: "CrossRef DOI metadata search (title, authors, journal, year, abstract).", parameters: obj({ query: str(), rows: int("1–20, default 5") }, ["query"]) },
  { name: "semantic_scholar", category: "research", auth: "none", description: "Semantic Scholar paper search w/ citations + abstracts. Falls back to Crossref on 429.", parameters: obj({ query: str(), limit: int("1–20") }, ["query"]) },
  { name: "pubmed", category: "research", auth: "none", description: "NCBI PubMed biomedical literature search (PMIDs + summaries).", parameters: obj({ query: str(), retmax: int("1–20") }, ["query"]) },
  { name: "europepmc", category: "research", auth: "none", description: "Europe PMC full-text & metadata search.", parameters: obj({ query: str(), pageSize: int() }, ["query"]) },
  { name: "core_ac_uk", category: "research", auth: "none", description: "CORE.ac.uk open-access works search.", parameters: obj({ query: str() }, ["query"]) },
  { name: "inspire_hep", category: "research", auth: "none", description: "INSPIRE-HEP high-energy physics literature.", parameters: obj({ query: str() }, ["query"]) },
  { name: "pubchem", category: "research", auth: "none", description: "PubChem compound lookup by name or CID.", parameters: obj({ name: str(), cid: str() }) },
  { name: "uniprot", category: "research", auth: "none", description: "UniProt protein knowledgebase search.", parameters: obj({ query: str() }, ["query"]) },
  { name: "ncbi_taxonomy", category: "research", auth: "none", description: "NCBI taxonomy search.", parameters: obj({ name: str() }) },
  { name: "rcsb_pdb", category: "research", auth: "none", description: "RCSB PDB entry lookup.", parameters: obj({ id: str("PDB id e.g. 4HHB") }) },
  { name: "patents", category: "research", auth: "none", description: "PatentsView keyword search (titles, dates, assignees).", parameters: obj({ query: str(), per_page: int() }, ["query"]) },
  { name: "arxiv_search", category: "research", auth: "none", description: "arXiv preprint full-text search (Atom feed).", parameters: obj({ query: str(), max_results: int() }, ["query"]) },
  { name: "arxiv_cat", category: "research", auth: "none", description: "arXiv by category, newest first.", parameters: obj({ cat: str("e.g. physics.gen-ph"), max: int() }) },
  { name: "open_library", category: "research", auth: "none", description: "Open Library book search.", parameters: obj({ q: str(), limit: int() }, ["q"]) },
  { name: "huggingface", category: "research", auth: "none", description: "Hugging Face model search.", parameters: obj({ q: str(), limit: int() }) },

  // ── Bio / conservation ───────────────────────────────────────────────
  { name: "gbif", category: "research", auth: "none", description: "GBIF biodiversity occurrence & species match.", parameters: obj({ name: str(), limit: int() }) },
  { name: "inaturalist", category: "research", auth: "none", description: "iNaturalist observation search.", parameters: obj({ q: str() }) },
  { name: "worms", category: "research", auth: "none", description: "WoRMS marine species records.", parameters: obj({ name: str() }) },

  // ── Geo ──────────────────────────────────────────────────────────────
  { name: "osm_geocode", category: "geo", auth: "none", description: "Nominatim forward geocoder w/ Open-Meteo fallback.", parameters: obj({ query: str() }, ["query"]) },
  { name: "nominatim_reverse", category: "geo", auth: "none", description: "Reverse geocoding lat/lon → address.", parameters: obj({ lat: num(), lon: num() }, ["lat","lon"]) },
  { name: "geonames_search", category: "geo", auth: "none", description: "GeoNames place lookup (demo user).", parameters: obj({ q: str() }) },
  { name: "overpass", category: "geo", auth: "none", description: "Raw Overpass QL passthrough for OSM.", parameters: obj({ query: str("Overpass QL") }, ["query"]) },
  { name: "worldtime", category: "geo", auth: "none", description: "Current time + UTC offset for a timezone.", parameters: obj({ zone: str("e.g. Europe/London") }) },

  // ── Space / Earth ────────────────────────────────────────────────────
  { name: "eonet", category: "space", auth: "none", description: "NASA EONET natural-event tracker.", parameters: obj({ days: int(), status: str(), category: str(), limit: int() }) },
  { name: "donki", category: "space", auth: "demo", envKey: "NASA_API_KEY", description: "NASA DONKI space-weather (CME/FLR/GST/…). NOAA SWPC fallback on 403/429.", parameters: obj({ kind: str("notifications|cme|flr|sep|gst|ips|mpc|rbe|hss"), days: int() }) },
  { name: "nasa_firms", category: "space", auth: "key", envKey: "NASA_FIRMS_KEY", description: "Active fire detections (VIIRS) — needs MAP_KEY.", parameters: obj({ area: str(), days: int(), map_key: str() }) },
  { name: "jpl_horizons", category: "space", auth: "none", description: "JPL Horizons planetary ephemerides.", parameters: obj({ body: str("e.g. 499 Mars"), observer: str("e.g. 500@399"), days: int() }) },
  { name: "celestrak", category: "space", auth: "none", description: "CelesTrak satellite TLE feeds by group.", parameters: obj({ group: str("e.g. stations") }) },
  { name: "sbdb_neo", category: "space", auth: "none", description: "JPL SBDB close-approach data for near-Earth objects.", parameters: obj({ dist_max: str() }) },
  { name: "cneos_fireballs", category: "space", auth: "none", description: "CNEOS recent fireball events.", parameters: obj({}) },
  { name: "goes_xray", category: "space", auth: "none", description: "GOES X-ray flux (1-day).", parameters: obj({}) },
  { name: "exoplanet_archive", category: "space", auth: "none", description: "NASA Exoplanet Archive TAP/ADQL.", parameters: obj({ query: str("ADQL") }) },
  { name: "silso_sunspots", category: "space", auth: "none", description: "SILSO daily total sunspot numbers (recent 30).", parameters: obj({}) },
  { name: "gibs_imagery", category: "space", auth: "none", description: "NASA GIBS imagery WMTS tile URL.", parameters: obj({ layer: str(), date: str(), z: int(), x: int(), y: int() }) },
  { name: "noaa_kp_forecast", category: "space", auth: "none", description: "NOAA SWPC planetary K-index forecast.", parameters: obj({}) },

  // ── Geophysical / Earth-system ───────────────────────────────────────
  { name: "usgs_quakes", category: "space", auth: "none", description: "USGS earthquake feed (GeoJSON).", parameters: obj({ mag: str("significant|4.5|2.5|1.0|all"), window: str("hour|day|week|month") }) },
  { name: "usgs_volcanoes", category: "space", auth: "none", description: "USGS volcano status (US ArcGIS feature service).", parameters: obj({}) },
  { name: "usgs_water", category: "space", auth: "none", description: "USGS instantaneous water values (discharge/gage).", parameters: obj({ sites: str(), param: str() }) },
  { name: "gdacs", category: "space", auth: "none", description: "GDACS global disaster RSS (raw).", parameters: obj({}) },
  { name: "noaa_hurricane", category: "space", auth: "none", description: "NHC current tropical storms.", parameters: obj({}) },
  { name: "tsunami_alerts", category: "space", auth: "none", description: "PTWC tsunami alerts (atom).", parameters: obj({}) },
  { name: "noaa_buoys", category: "space", auth: "none", description: "NOAA NDBC realtime buoy observations.", parameters: obj({ station: str() }) },

  // ── Weather ──────────────────────────────────────────────────────────
  { name: "openweather", category: "weather", auth: "key", envKey: "OPENWEATHER_API_KEY", description: "OpenWeatherMap current/forecast/air.", parameters: obj({ latitude: num(), longitude: num(), city: str(), kind: str("current|forecast|air") }) },
  { name: "metar", category: "weather", auth: "none", description: "Aviation METAR observations (ICAO id).", parameters: obj({ station: str(), hours: int() }) },
  { name: "nws_alerts", category: "weather", auth: "none", description: "US NWS active alerts.", parameters: obj({ area: str(), active: bool() }) },
  { name: "marine", category: "weather", auth: "none", description: "Open-Meteo marine wave/swell forecast.", parameters: obj({ latitude: num(), longitude: num() }, ["latitude","longitude"]) },
  { name: "flood", category: "weather", auth: "none", description: "Open-Meteo river-discharge flood forecast.", parameters: obj({ latitude: num(), longitude: num() }, ["latitude","longitude"]) },
  { name: "tides", category: "weather", auth: "none", description: "NOAA tides and currents.", parameters: obj({ station: str(), product: str() }) },
  { name: "meteostat", category: "weather", auth: "none", description: "ERA5-derived daily climate point.", parameters: obj({ lat: num(), lon: num() }) },
  { name: "carbon_intensity", category: "weather", auth: "none", description: "UK Carbon Intensity (now + factors).", parameters: obj({}) },

  // ── Finance ─────────────────────────────────────────────────────────
  { name: "binance", category: "finance", auth: "none", description: "Binance 24h ticker + depth.", parameters: obj({ symbol: str("e.g. BTCUSDT") }) },
  { name: "coingecko", category: "finance", auth: "none", description: "CoinGecko simple price or search.", parameters: obj({ ids: str(), vs: str(), query: str() }) },
  { name: "coincap", category: "finance", auth: "none", description: "CoinCap assets list or one asset.", parameters: obj({ id: str() }) },
  { name: "coindesk", category: "finance", auth: "none", description: "BTC price across USD/EUR/GBP (via CoinGecko).", parameters: obj({}) },
  { name: "frankfurter", category: "finance", auth: "none", description: "ECB-derived FX (frankfurter.app).", parameters: obj({ from: str(), to: str(), amount: num(), date: str() }) },
  { name: "frankfurter_history", category: "finance", auth: "none", description: "FX time-series (start..end).", parameters: obj({ from: str(), to: str(), start: str(), end: str() }) },
  { name: "sec_edgar", category: "finance", auth: "none", description: "SEC EDGAR filings by CIK or search.", parameters: obj({ cik: str(), query: str() }) },
  { name: "worldbank", category: "finance", auth: "none", description: "World Bank indicators (per country/code).", parameters: obj({ country: str(), indicator: str(), date: str() }) },
  { name: "imf_dataflow", category: "finance", auth: "none", description: "IMF datamapper indicator list.", parameters: obj({}) },
  { name: "defillama", category: "finance", auth: "none", description: "DeFiLlama TVL across protocols.", parameters: obj({ protocol: str() }) },
  { name: "gleif_lei", category: "finance", auth: "none", description: "GLEIF Legal Entity Identifier lookup.", parameters: obj({ lei: str(), query: str() }) },

  // ── OSINT / Cybersecurity ────────────────────────────────────────────
  { name: "shodan_internetdb", category: "osint", auth: "none", description: "Keyless Shodan InternetDB (ports/CVEs per IP).", parameters: obj({ ip: str() }, ["ip"]) },
  { name: "greynoise", category: "osint", auth: "none", description: "GreyNoise community IP intel.", parameters: obj({ ip: str() }, ["ip"]) },
  { name: "urlhaus", category: "osint", auth: "none", description: "abuse.ch URLhaus malware URL lookup.", parameters: obj({ url: str(), host: str() }) },
  { name: "threatfox", category: "osint", auth: "none", description: "abuse.ch ThreatFox IOC query.", parameters: obj({ ioc: str(), days: int(), query: str() }) },
  { name: "cve", category: "osint", auth: "none", description: "CIRCL CVE search by id or vendor/product.", parameters: obj({ cve: str(), vendor: str(), product: str() }) },
  { name: "nvd", category: "osint", auth: "none", description: "NIST NVD CVE 2.0 search.", parameters: obj({ cve: str(), keyword: str(), days: int(), results: int() }) },
  { name: "cisa_kev", category: "osint", auth: "none", description: "CISA Known Exploited Vulnerabilities catalog.", parameters: obj({}) },
  { name: "epss", category: "osint", auth: "none", description: "FIRST EPSS exploit-prediction scores.", parameters: obj({ cve: str() }) },
  { name: "osv", category: "osint", auth: "none", description: "OSV.dev open-source vuln query.", parameters: obj({ package: str(), ecosystem: str(), version: str(), commit: str() }) },
  { name: "ripe_stat", category: "osint", auth: "none", description: "RIPE Stat (BGP/ASN/WHOIS/geoloc).", parameters: obj({ resource: str(), endpoint: str() }, ["resource"]) },
  { name: "bgpview", category: "osint", auth: "none", description: "BGPView ASN/IP/prefix/search.", parameters: obj({ resource: str(), kind: str() }, ["resource"]) },
  { name: "crtsh", category: "osint", auth: "none", description: "crt.sh CT-log subdomain enumeration.", parameters: obj({ domain: str() }, ["domain"]) },
  { name: "hibp_passwords", category: "osint", auth: "none", description: "HIBP Pwned Passwords k-anonymity check.", parameters: obj({ password: str(), sha1: str() }) },
  { name: "dns_resolve", category: "osint", auth: "none", description: "Google DNS-over-HTTPS resolver.", parameters: obj({ name: str(), type: str() }, ["name"]) },
  { name: "ip_api", category: "osint", auth: "none", description: "Keyless IP geo / ASN (ip-api.com).", parameters: obj({ ip: str() }) },
  { name: "rdap", category: "osint", auth: "none", description: "RDAP domain or IP lookup.", parameters: obj({ domain: str(), ip: str() }) },
  { name: "wayback", category: "osint", auth: "none", description: "Wayback Machine availability.", parameters: obj({ url: str(), timestamp: str() }, ["url"]) },
  { name: "common_crawl", category: "osint", auth: "none", description: "Common Crawl URL captures (latest index).", parameters: obj({ url: str(), index: str() }, ["url"]) },
  { name: "favicon_hash", category: "osint", auth: "none", description: "Compute Shodan-style mmh3 favicon hash for pivoting.", parameters: obj({ url: str() }, ["url"]) },
  { name: "otx", category: "osint", auth: "none", description: "AlienVault OTX indicator general info.", parameters: obj({ indicator: str(), type: str(), pulses: bool() }) },
  { name: "urlscan", category: "osint", auth: "none", description: "urlscan.io public search.", parameters: obj({ q: str() }) },
  { name: "blocklist_de", category: "osint", auth: "none", description: "blocklist.de abusive IPs.", parameters: obj({ ip: str() }) },
  { name: "tor_exit_nodes", category: "osint", auth: "none", description: "Current Tor exit-node list.", parameters: obj({}) },
  { name: "spamhaus_drop", category: "osint", auth: "none", description: "Spamhaus DROP/EDROP/DROPv6 list.", parameters: obj({ list: str() }) },
  { name: "openphish", category: "osint", auth: "none", description: "OpenPhish current phishing feed.", parameters: obj({}) },
  { name: "mitre_attack", category: "osint", auth: "none", description: "MITRE ATT&CK technique lookup.", parameters: obj({ id: str(), query: str() }) },
  { name: "virustotal", category: "osint", auth: "key", envKey: "VIRUSTOTAL_API_KEY", description: "VirusTotal v3 file/url/domain/ip report.", parameters: obj({ kind: str("file|url|domain|ip"), resource: str() }, ["resource"]) },
  { name: "abuseipdb", category: "osint", auth: "key", envKey: "ABUSEIPDB_API_KEY", description: "AbuseIPDB IP reputation.", parameters: obj({ ip: str(), max_age_days: int(), verbose: bool() }, ["ip"]) },
  { name: "openaq", category: "osint", auth: "key", envKey: "OPENAQ_API_KEY", description: "OpenAQ v3 air-quality locations.", parameters: obj({ latitude: num(), longitude: num(), radius: int(), limit: int() }) },

  // ── Shodan official (key) ────────────────────────────────────────────
  { name: "shodan", category: "osint", auth: "key", envKey: "SHODAN_API_KEY", description: "Raw Shodan API passthrough.", parameters: obj({ endpoint: str(), params: { type: "object" }, method: str(), body: {} }) },
  { name: "shodan_host", category: "osint", auth: "key", envKey: "SHODAN_API_KEY", description: "Shodan /host/{ip}.", parameters: obj({ ip: str(), history: str(), minify: str() }, ["ip"]) },
  { name: "shodan_host_count", category: "osint", auth: "key", envKey: "SHODAN_API_KEY", description: "Shodan host count (free tier OK).", parameters: obj({ query: str(), facets: str() }, ["query"]) },
  { name: "shodan_host_search", category: "osint", auth: "key", envKey: "SHODAN_API_KEY", description: "Shodan search (paid). Falls back to count on 403.", parameters: obj({ query: str(), facets: str(), page: str(), minify: str() }, ["query"]) },
  { name: "shodan_search_facets", category: "osint", auth: "key", envKey: "SHODAN_API_KEY", description: "List Shodan search facets.", parameters: obj({}) },
  { name: "shodan_search_filters", category: "osint", auth: "key", envKey: "SHODAN_API_KEY", description: "List Shodan search filters.", parameters: obj({}) },
  { name: "shodan_search_tokens", category: "osint", auth: "key", envKey: "SHODAN_API_KEY", description: "Tokenize a Shodan query.", parameters: obj({ query: str() }, ["query"]) },
  { name: "shodan_ports", category: "osint", auth: "key", envKey: "SHODAN_API_KEY", description: "List Shodan crawled ports.", parameters: obj({}) },
  { name: "shodan_protocols", category: "osint", auth: "key", envKey: "SHODAN_API_KEY", description: "List Shodan protocols.", parameters: obj({}) },
  { name: "shodan_scans", category: "osint", auth: "key", envKey: "SHODAN_API_KEY", description: "List your Shodan scans.", parameters: obj({}) },
  { name: "shodan_scan_info", category: "osint", auth: "key", envKey: "SHODAN_API_KEY", description: "Shodan scan info by id.", parameters: obj({ id: str() }, ["id"]) },
  { name: "shodan_account_profile", category: "osint", auth: "key", envKey: "SHODAN_API_KEY", description: "Shodan account profile.", parameters: obj({}) },
  { name: "shodan_api_info", category: "osint", auth: "key", envKey: "SHODAN_API_KEY", description: "Shodan API key info.", parameters: obj({}) },
  { name: "shodan_myip", category: "osint", auth: "key", envKey: "SHODAN_API_KEY", description: "Shodan myip echo.", parameters: obj({}) },
  { name: "shodan_httpheaders", category: "osint", auth: "key", envKey: "SHODAN_API_KEY", description: "Shodan httpheaders echo.", parameters: obj({}) },
  { name: "shodan_dns_domain", category: "osint", auth: "key", envKey: "SHODAN_API_KEY", description: "Shodan DNS subdomain enum.", parameters: obj({ domain: str(), history: str(), type: str(), page: str() }, ["domain"]) },
  { name: "shodan_dns_resolve", category: "osint", auth: "key", envKey: "SHODAN_API_KEY", description: "Shodan DNS resolve.", parameters: obj({ hostnames: str() }, ["hostnames"]) },
  { name: "shodan_dns_reverse", category: "osint", auth: "key", envKey: "SHODAN_API_KEY", description: "Shodan DNS reverse.", parameters: obj({ ips: str() }, ["ips"]) },
  { name: "shodan_alerts", category: "osint", auth: "key", envKey: "SHODAN_API_KEY", description: "Shodan alert list.", parameters: obj({}) },
  { name: "shodan_alert_info", category: "osint", auth: "key", envKey: "SHODAN_API_KEY", description: "Shodan alert info by id.", parameters: obj({ id: str() }) },

  // ── Web / social / news ──────────────────────────────────────────────
  { name: "hackernews", category: "web", auth: "none", description: "HN search (Algolia).", parameters: obj({ query: str(), tags: str(), hits: int() }, ["query"]) },
  { name: "reddit", category: "web", auth: "none", description: "Reddit JSON w/ RSS fallback (Edge IPs often blocked).", parameters: obj({ query: str(), subreddit: str(), sort: str(), limit: int() }) },
  { name: "mastodon", category: "web", auth: "none", description: "Mastodon status search.", parameters: obj({ query: str(), instance: str() }, ["query"]) },
  { name: "google_news", category: "web", auth: "none", description: "Google News RSS as JSON.", parameters: obj({ q: str(), lang: str() }) },
  { name: "gdelt", category: "web", auth: "none", description: "GDELT 2.0 doc/article search.", parameters: obj({ query: str(), mode: str(), maxrecords: int(), timespan: str() }, ["query"]) },
  { name: "newsapi", category: "web", auth: "key", envKey: "NEWSAPI_KEY", description: "NewsAPI everything/top-headlines.", parameters: obj({ query: str(), country: str(), category: str(), kind: str(), pageSize: int() }) },
  { name: "github_search", category: "web", auth: "demo", envKey: "GITHUB_TOKEN", description: "GitHub search (repositories|code|issues|users|commits).", parameters: obj({ query: str(), type: str(), per_page: int() }, ["query"]) },
  { name: "wikidata", category: "web", auth: "none", description: "Wikidata SPARQL passthrough.", parameters: obj({ query: str("SPARQL") }) },
  { name: "wikipedia_geo", category: "web", auth: "none", description: "Wikipedia geosearch (lat/lon, radius m).", parameters: obj({ lat: num(), lon: num(), radius: int() }, ["lat","lon"]) },
  { name: "wikipedia_pageviews", category: "web", auth: "none", description: "Wikipedia daily pageviews for an article.", parameters: obj({ article: str(), days: int() }, ["article"]) },
  { name: "wiktionary", category: "knowledge", auth: "none", description: "Wiktionary definitions.", parameters: obj({ word: str(), lang: str() }) },
  { name: "dictionary_dev", category: "knowledge", auth: "none", description: "Free Dictionary API definitions.", parameters: obj({ word: str() }) },
  { name: "urban_dictionary", category: "knowledge", auth: "none", description: "Urban Dictionary definitions.", parameters: obj({ term: str() }) },
  { name: "quotable", category: "knowledge", auth: "none", description: "Random quotable quote.", parameters: obj({}) },
  { name: "http_probe", category: "web", auth: "none", description: "GET/HEAD a URL → status, headers, body snippet.", parameters: obj({ url: str(), method: str(), max_bytes: int() }, ["url"]) },
  { name: "web_fetch", category: "web", auth: "none", description: "Readable extraction: title, description, plain text, links.", parameters: obj({ url: str(), max_chars: int(), include_links: bool() }, ["url"]) },
  { name: "ipfs", category: "web", auth: "none", description: "Multi-gateway IPFS fetch (parallel race).", parameters: obj({ cid: str(), gateway: str(), max_bytes: int(), path: str() }, ["cid"]) },
  { name: "archive_org", category: "web", auth: "none", description: "Internet Archive advanced search.", parameters: obj({ query: str() }, ["query"]) },
  { name: "librivox", category: "web", auth: "none", description: "LibriVox public-domain audiobook search.", parameters: obj({ query: str() }, ["query"]) },
  { name: "unsplash_keyless", category: "web", auth: "none", description: "Unsplash source URL generator (keyless).", parameters: obj({ query: str(), w: int(), h: int(), n: int() }, ["query"]) },
  { name: "lorem_picsum", category: "web", auth: "none", description: "Picsum placeholder URLs.", parameters: obj({ w: int(), h: int(), n: int() }) },

  // ── Dev / packages ───────────────────────────────────────────────────
  { name: "npm_registry", category: "dev", auth: "none", description: "npm registry package metadata.", parameters: obj({ name: str() }, ["name"]) },
  { name: "pypi_metadata", category: "dev", auth: "none", description: "PyPI package metadata.", parameters: obj({ name: str() }, ["name"]) },
  { name: "crates_io", category: "dev", auth: "none", description: "crates.io package search/info.", parameters: obj({ name: str(), query: str() }) },
  { name: "bundlephobia", category: "dev", auth: "none", description: "Bundlephobia size for an npm package.", parameters: obj({ name: str() }, ["name"]) },
  { name: "caniuse", category: "dev", auth: "none", description: "caniuse feature support data.", parameters: obj({ feature: str() }) },
  { name: "httpbin", category: "dev", auth: "none", description: "httpbin echo helper.", parameters: obj({ kind: str("ip|user-agent|headers|...") }) },
  { name: "opensky", category: "dev", auth: "none", description: "OpenSky live flights in bbox.", parameters: obj({ lamin: num(), lomin: num(), lamax: num(), lomax: num() }) },
  { name: "adsb", category: "dev", auth: "none", description: "ADS-B.lol aircraft (hex|callsign|point).", parameters: obj({ lat: num(), lon: num(), dist: int(), hex: str(), callsign: str() }) },

  // ── Civic / open gov ─────────────────────────────────────────────────
  { name: "data_gov", category: "civic", auth: "none", description: "data.gov CKAN dataset search.", parameters: obj({ query: str() }, ["query"]) },
  { name: "who_indicators", category: "civic", auth: "none", description: "WHO Global Health Observatory indicators.", parameters: obj({ code: str() }) },
  { name: "eu_open_data", category: "civic", auth: "none", description: "EU Open Data Portal search.", parameters: obj({ query: str() }, ["query"]) },

  // ── Wolfram ──────────────────────────────────────────────────────────
  { name: "wolfram", category: "misc", auth: "key", envKey: "WOLFRAM_APP_ID", description: "Wolfram Alpha (short|llm|full).", parameters: obj({ query: str(), mode: str("short|llm|full"), units: str("metric|imperial") }, ["query"]) },
  { name: "wolfram_verify", category: "misc", auth: "key", envKey: "WOLFRAM_APP_ID_RESEARCH", description: "Offline constant verification on the research App ID: evaluates N[expr, digits] (default 40) on a separate 20/min budget and returns the exact query string for provenance. Never call inside an engine tick.", parameters: obj({ expression: str("Wolfram expression, e.g. Log2[22]"), digits: int("10-60, default 40") }, ["expression"]) },

  // ── Phase S1 — live sensor feeds (keyless unless noted) ──────────────
  { name: "open_meteo", category: "weather", auth: "none", description: "Open-Meteo keyless forecast: temperature, wind, pressure, solar radiation, soil moisture at lat/lon.", parameters: obj({ lat: num(), lon: num(), hourly: str("comma list e.g. temperature_2m,wind_speed_10m,shortwave_radiation,soil_moisture_0_to_1cm") }, ["lat","lon"]) },
  { name: "open_meteo_air", category: "weather", auth: "none", description: "Open-Meteo keyless air-quality: PM2.5/PM10/CO/NO2/O3/SO2/UV at lat/lon.", parameters: obj({ lat: num(), lon: num() }, ["lat","lon"]) },
  { name: "sensor_community", category: "geo", auth: "none", description: "Sensor.Community (Luftdaten) crowdsourced citizen PM + climate sensors, last hour averaged, filterable by bbox.", parameters: obj({ lamin: num(), lomin: num(), lamax: num(), lomax: num(), limit: int("default 50, max 500") }) },
  { name: "copernicus_odata", category: "space", auth: "none", description: "Copernicus Data Space Ecosystem OData query for Sentinel-1/2/3/5P scenes (keyless metadata search).", parameters: obj({ collection: str("SENTINEL-1|SENTINEL-2|SENTINEL-3|SENTINEL-5P"), lat: num(), lon: num(), days: int("look-back days, default 7"), top: int("max 20") }) },
  { name: "nasa_modis_nrt", category: "space", auth: "key", envKey: "NASA_FIRMS_KEY", description: "NASA FIRMS MODIS NRT thermal/fire detections for area in last N days.", parameters: obj({ area: str("country code or 'world'"), days: int("1-7") }) },
  { name: "crtsh_recent", category: "osint", auth: "none", description: "crt.sh Certificate Transparency — live TLS cert issuance for a domain (REST equivalent of CertStream).", parameters: obj({ domain: str("e.g. example.com or %.example.com"), limit: int("max 50") }, ["domain"]) },
  { name: "open_glider_network", category: "geo", auth: "none", description: "Open Glider Network (OGN) live aircraft/glider/drone positions inside a bbox from a global RF listening grid.", parameters: obj({ lamin: num(), lomin: num(), lamax: num(), lomax: num() }) },
  { name: "noaa_swpc_solarwind", category: "space", auth: "none", description: "NOAA SWPC live 5-minute solar wind plasma + magnetic field (DSCOVR/ACE sensors at Sun-Earth L1).", parameters: obj({ kind: str("plasma|mag|both, default both") }) },

  // ── Phase D1 — open-vocabulary visual locator (NVIDIA-style) ─────────
  { name: "locate_anything", category: "knowledge", auth: "key", envKey: "HF_TOKEN", description: "Open-vocabulary object detection (Grounding-DINO Tiny via HuggingFace Inference). Give an image (URL or data: base64) and a free-text prompt like 'a cat. a remote.'; returns boxes with labels and scores. Use for live camera frames, screenshots, or any image where the agent needs to know WHAT is WHERE.", parameters: obj({ image: str("https URL or data:image/...;base64,..."), prompt: str("free-text prompt, period-separated labels"), threshold: num("score cutoff 0..1, default 0.25"), model: str("HF model id, default IDEA-Research/grounding-dino-tiny") }, ["image","prompt"]) },

  // ── Phase C1 — CAD / BIM acquisition arsenal (all keyless) ───────────
  { name: "bsdd_search", category: "cad", auth: "none", description: "buildingSMART Data Dictionary free-text search across every published BIM/AEC classification (IFC, ETIM, Uniclass, CCI…). Returns classes with codes, definitions and parent hierarchy — the canonical vocabulary for what a building element IS.", parameters: obj({ query: str("e.g. 'fire door', 'HVAC duct'"), limit: int("1-50, default 10"), dictionary: str("optional dictionary URI filter") }, ["query"]) },
  { name: "bsdd_dictionaries", category: "cad", auth: "none", description: "List the published bSDD dictionaries (IFC 4.3, Uniclass, ETIM, CCI, national standards) with versions and languages.", parameters: obj({ limit: int("1-100, default 25") }) },
  { name: "bsdd_class", category: "cad", auth: "none", description: "Fetch one bSDD class by URI or by IFC entity name (e.g. IfcDoor) — full definition, inheritance chain, property sets and allowed values.", parameters: obj({ uri: str("full bSDD class URI"), ifc: str("IFC entity name e.g. IfcWall"), version: str("IFC version, default 4.3") }) },
  { name: "speckle_graphql", category: "cad", auth: "none", description: "Speckle (open-source AEC data platform) GraphQL passthrough — server info, public projects, model versions and commit metadata for real BIM/CAD streams.", parameters: obj({ query: str("GraphQL query; defaults to serverInfo"), variables: { type: "object", description: "GraphQL variables" }, server: str("Speckle server origin, default https://app.speckle.systems") }) },
  { name: "osm_buildings", category: "cad", auth: "none", description: "Real building footprints from OpenStreetMap via Overpass: geometry, levels, height, material and use. Ground truth for spatial/BIM learning.", parameters: obj({ lat: num(), lon: num(), radius: int("metres, default 300, max 2000"), limit: int("default 60") }, ["lat","lon"]) },
  { name: "cad_fetch", category: "cad", auth: "none", description: "Fetch a text-based CAD/BIM asset (DXF, SVG, OBJ, STL-ASCII, IFC/STEP) and return its raw source plus a detected format. Feeds the deterministic geometry descriptor pipeline; refuses binary payloads instead of returning garbage.", parameters: obj({ url: str("https URL to the CAD/BIM file"), max_chars: int("default 400000, max 2000000") }, ["url"]) },
];

export const INTEL_INDEX: Record<string, IntelToolMeta> = Object.fromEntries(INTEL_META.map(t => [t.name, t]));

export function intelToolsAsOpenAI() {
  return INTEL_META.map(t => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
