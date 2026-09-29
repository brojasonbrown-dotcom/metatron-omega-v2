// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from '@lovable.dev/vite-tanstack-config';
import path from 'node:path';

// Vitest budget. The engine batteries are CPU-bound simulations; the 5 s default
// measures machine load, not code health, so a busy box turns the suite red for
// no reason. 30 s means a failure is a real hang. Vitest reads `test` off the
// resolved Vite config; the cast keeps `tsc` happy since vitest is not a dep.
const vitestBudget = {
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
} as Record<string, unknown>;

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: 'server' },
  },
  vite: {
    worker: { format: 'es' },
    ...vitestBudget,
    resolve: {
      alias: {
        // Phase 1 · Step 3 — shared field kernel package. Aliased here
        // (not just in tsconfig) because Vite's worker plugin runs a
        // separate Rollup pass that does not pick up tsconfig paths.
        // Map the bare package name to the src directory so Vite's
        // prefix-alias correctly resolves both `@metatron/field-kernel-core`
        // (→ src/index.ts) and `@metatron/field-kernel-core/cos`
        // (→ src/cos.ts) without producing a `index.ts/cos` path.
        '@metatron/field-kernel-core': path.resolve(__dirname, 'packages/field-kernel-core/src'),
        // METATRON Omega certified core (Ω-P0/P1): pure TS, zero deps.

        '@metatron/trnn-core/': path.resolve(__dirname, 'packages/trnn-core/src') + '/',
        '@metatron/trnn-core': path.resolve(__dirname, 'packages/trnn-core/src/index.ts'),
      },
    },
  },
});
