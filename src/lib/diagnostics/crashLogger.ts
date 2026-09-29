/**
 * crashLogger — captures uncaught errors, promise rejections, console.error
 * output, and a ring buffer of recent breadcrumbs (events/log lines) so the
 * user can produce a one-click report after a freeze or crash.
 *
 * Pure client-side, zero deps, safe to import anywhere.
 */

export type CrashEntry = {
  t: number;
  kind: 'error' | 'unhandledrejection' | 'console.error' | 'manual';
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
};

export type Breadcrumb = {
  t: number;
  kind: string;
  msg: string;
};

const MAX_CRASHES = 50;
const MAX_BREADCRUMBS = 200;

const crashes: CrashEntry[] = [];
const breadcrumbs: Breadcrumb[] = [];
const listeners = new Set<() => void>();
let installed = false;
let lastReport = 0;

function notify() {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* noop */
    }
  }
}

function pushCrash(c: CrashEntry) {
  crashes.push(c);
  if (crashes.length > MAX_CRASHES) crashes.splice(0, crashes.length - MAX_CRASHES);
  notify();
}

export function recordCrash(message: string, stack?: string, kind: CrashEntry['kind'] = 'manual') {
  pushCrash({
    t: Date.now(),
    kind,
    message: String(message).slice(0, 4000),
    stack: stack?.slice(0, 8000),
  });
}

export function addBreadcrumb(kind: string, msg: string) {
  breadcrumbs.push({
    t: Date.now(),
    kind: String(kind).slice(0, 32),
    msg: String(msg).slice(0, 240),
  });
  if (breadcrumbs.length > MAX_BREADCRUMBS) {
    breadcrumbs.splice(0, breadcrumbs.length - MAX_BREADCRUMBS);
  }
}

export function getCrashes(): readonly CrashEntry[] {
  return crashes;
}
export function getBreadcrumbs(): readonly Breadcrumb[] {
  return breadcrumbs;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function clearCrashes() {
  crashes.length = 0;
  notify();
}

export function installCrashLogger() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (e) => {
    pushCrash({
      t: Date.now(),
      kind: 'error',
      message: e.message || 'window error',
      stack: e.error?.stack,
      source: e.filename,
      line: e.lineno,
      column: e.colno,
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = (e as PromiseRejectionEvent).reason;
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : JSON.stringify(reason);
    pushCrash({
      t: Date.now(),
      kind: 'unhandledrejection',
      message: msg || 'unhandled rejection',
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  // Mirror console.error into the ring (don't suppress original output).
  const origErr = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      const msg = args
        .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : safeStringify(a)))
        .join(' ');
      const stack = args.find((a) => a instanceof Error) as Error | undefined;
      pushCrash({
        t: Date.now(),
        kind: 'console.error',
        message: msg.slice(0, 2000),
        stack: stack?.stack,
      });
    } catch {
      /* noop */
    }
    origErr(...args);
  };
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function buildReport(extra?: Record<string, unknown>): string {
  lastReport = Date.now();
  const env =
    typeof window !== 'undefined'
      ? {
          href: window.location.href,
          ua: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`,
          cores: (navigator as Navigator & { hardwareConcurrency?: number }).hardwareConcurrency,
          memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
          online: navigator.onLine,
          lang: navigator.language,
          time: new Date().toISOString(),
        }
      : {};
  const report = {
    schema: 'lovable.crashReport/v1',
    generatedAt: new Date().toISOString(),
    env,
    crashes,
    breadcrumbs,
    extra: extra ?? null,
  };
  return JSON.stringify(report, null, 2);
}

export function lastReportAt(): number {
  return lastReport;
}
