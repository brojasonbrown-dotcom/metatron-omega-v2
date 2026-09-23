# Omega Workstation: persistent field view + main visual stage

## What's wrong today

In the FIELD tab, the rung selector and the pull-rate slider live as `useState` inside `FieldDeckPanel`. The workstation renders only the active tab, so switching tabs unmounts the panel and both selections reset to defaults (rung 0, 12 Hz) — and the pull loop stops, so the field looks "switched off". Nothing is persisted anywhere.

## What we'll build

1. **A persistent field view store** — rung, pull rate, and render options survive tab switches, remounts and page reloads.
2. **A large main visual stage** — the toroidal field render moves to the top half of the screen, always visible, no longer tied to whether the FIELD tab is open.
3. **A colour legend** — a compact key explaining hue = phase (arg z), brightness/size = amplitude (|z| / peak), the guide ring, and the unwrapped strip.
4. **Tabs move down** — the tab bar and deck content occupy the bottom half; the FIELD tab keeps its detail readouts (signature, peak/mean, coherence, regime, obstruction) without duplicating the big render.

## Layout after the change

```text
┌──────────────────────────────── header (METATRON OMEGA) ─────────────────┐
├──────────────────── MAIN VISUAL STAGE (top ~50%) ────────────┬───────────┤
│  large torus render + rung / pull controls + colour legend   │  Kokoro   │
├──────────────────── tab bar: ENGINE LADDER FIELD … ──────────┤   Chat    │
│  active deck content (bottom ~50%)                           │   Kimi    │
└──────────────────────────────────────────────────────────────┴───────────┘
```

The stage is collapsible (a small toggle in its header) so decks that need height can reclaim the space; the collapsed/expanded choice is persisted too.

## Risk controls (no engine or tab regressions)

- **Presentation-only.** No change to `omegaRuntime`, the worker, the protocol, `trnn-core`, or any engine math. The stage calls the same existing `requestField(rank, maxSamples)` read path the FIELD deck already uses.
- **One puller, not two.** The pull loop moves into the always-mounted stage. `FieldDeckPanel` stops running its own `useOmegaPull` and reads `state.frame` from the store, so request rate does not double when the FIELD tab is open.
- **Pull stays gated** on an engine snapshot existing and pauses when the stage is collapsed or the document is hidden — no background work when nothing is drawn.
- **Tab logic untouched.** The `Tab` union, `TABS` array, and the active-tab conditional rendering stay exactly as they are; only their container's grid rows change.
- **Storage is defensive.** Values are read through a guarded `localStorage` accessor (same pattern as `memoryRuntime.ts`), validated and clamped on load, with fallback to current defaults — SSR-safe, and corrupt values can't break the render.
- **Canvas sizing** already uses `clientWidth/clientHeight` with a DPR-aware backing store, so it adapts to the larger area with no fixed-pixel assumptions; the strip/legend degrade gracefully at narrow widths.

## Technical detail

- New `src/ui/omega/fieldViewStore.ts`: tiny `useSyncExternalStore`-compatible store holding `{ rank, hz, stageOpen, showStrip }`, persisted under an `omega.field.view` key, exported via a `useFieldView()` hook.
- New `src/ui/omega/FieldStage.tsx`: the enlarged torus canvas (extracted drawing code, unchanged maths), rung select, pull slider, frame status line, and the legend. Owns the single `useOmegaPull`.
- `src/ui/omega/panels/FieldDeckPanel.tsx`: drops its local state and pull loop; keeps the unwrapped strip, φ-weighted signature and numeric readouts, reading rank/frame from the store.
- `src/ui/omega/OmegaWorkstation.tsx`: left column becomes a two-row flex — stage on top, tab section below — with `min-h-0` on both so neither overflows.

Visual enhancement stays inside the existing token system (no hardcoded colour classes): a subtle guide-ring grid, phase-hue ring in the legend, and amplitude-scaled node glow. Draw cost stays O(sampled nodes) exactly as now.
