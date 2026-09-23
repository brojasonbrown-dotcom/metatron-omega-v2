/**
 * flush — one place that guarantees in-flight state reaches disk.
 *
 * Browsers do not run `beforeunload` reliably on mobile, and a debounced
 * autosave can always be caught mid-timer by a tab close, a reload, or the OS
 * backgrounding the page. Every subsystem that holds unsaved state registers a
 * flush callback here; the listeners below fire it on `pagehide`,
 * `visibilitychange → hidden`, and `beforeunload`, so no progress is lost.
 *
 * Callbacks must be synchronous-fast and must never throw.
 */

type FlushFn = () => void;

const flushers = new Set<FlushFn>();
let installed = false;

function runAll(): void {
  for (const fn of flushers) {
    try { fn(); } catch { /* a failing flusher must not block the others */ }
  }
}

function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('pagehide', runAll);
  window.addEventListener('beforeunload', runAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') runAll();
  });
}

/** Register a flush callback. Returns an unregister function. */
export function registerFlush(fn: FlushFn): () => void {
  install();
  flushers.add(fn);
  return () => { flushers.delete(fn); };
}

/** Force every registered flush now (used by tests and explicit saves). */
export function flushAll(): void { runAll(); }

/**
 * A tiny debounced-writer helper: coalesces bursts of writes into one, and
 * exposes `flush()` so the page-hide path can force the trailing write.
 */
export function makeDebouncedWriter(write: () => void, delayMs = 600) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;

  const flush = () => {
    if (timer != null) { clearTimeout(timer); timer = null; }
    if (!pending) return;
    pending = false;
    try { write(); } catch { /* never throw from a save path */ }
  };

  const schedule = () => {
    pending = true;
    if (timer != null) return;
    timer = setTimeout(() => { timer = null; flush(); }, delayMs);
  };

  registerFlush(flush);
  return { schedule, flush };
}

/** Read a JSON value from localStorage, never throwing. */
export function readJSON<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch { return fallback; }
}

/** Write a JSON value to localStorage, never throwing (quota-safe). */
export function writeJSON(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}
