# Plan: Clean up FIELD STAGE visuals — remove phase-vector ticks, add thin node mesh

## Goal
Make the main toroidal field visualization cleaner and faster without touching the engine, data model, or any computation that other decks depend on. The phase-vector ticks (small directional lines on every node) are removed; the nodes are linked by a very thin structural line instead. The Legend is updated to match.

## Current state
- `src/ui/omega/FieldStage.tsx` renders the field in a single loop that draws, per sampled node:
  - a bloom halo (if enabled)
  - a colored dot
  - a small phase-vector tick using `frame.phase[i]`, `Math.cos(ph)`, `Math.sin(ph)`
- The tick is purely decorative/presentational; the `phase` array itself is produced in `packages/trnn-core/src/runtime/views.ts` and is consumed by other decks (spectral, eigenmode, etc.), so the engine data must stay intact.
- The Legend contains a "TICK = PHASE VECTOR" section that explains the tick lines.
- The field frame is already decimated (`frame.stride`) and pulled at a fixed Hz, so any rendering optimization is local to the canvas loop.

## Changes

### 1. Remove phase-vector tick drawing in `src/ui/omega/FieldStage.tsx`
- Delete the `tickEvery` calculation.
- Delete the per-node `ph` read, the `Math.cos(ph)` / `Math.sin(ph)` line math, and the `g.stroke()` call inside the node loop.
- Keep the dot, the bloom halo, and all `frame.*` reads that are still used for color and size.

### 2. Add thin connecting lines between consecutive sampled nodes
- After the node loop, draw a single light path that connects each sampled node to the next (or use a second pass before dots for correct z-order).
- Line style: very thin (`lineWidth = 0.5` or `1`), low opacity (`rgba(255,255,255,0.06)` or similar), using the same torus projection.
- This is a structural mesh only; it does not add new data, interpolate, or smooth anything between engine samples.

### 3. Update the Legend in `src/ui/omega/FieldStage.tsx`
- Remove the "TICK = PHASE VECTOR" block.
- Add a short note about the thin mesh line: it connects consecutive sampled nodes in lattice order to show the toroidal structure.

### 4. Verify no computational regression
- The `FieldFrame` type and the `fieldFrame()` view in `packages/trnn-core/src/runtime/views.ts` remain unchanged.
- No engine code, runtime, or protocol is touched.
- The `phase` array is still available for other decks; only its visual use in the stage is removed.

## Success criteria
- [ ] Phase-vector ticks are no longer visible on the canvas.
- [ ] A thin, subtle line connects the nodes in the field.
- [ ] The FIELD tab still shows live, genuine engine frames.
- [ ] Other decks (SPECTRAL, WEB, SENSE, etc.) continue to work.
- [ ] The Legend no longer mentions phase-vector ticks and correctly explains the mesh line.
- [ ] No changes to `packages/trnn-core/` or any engine data path.

## Risk assessment
- **Low risk**: the change is entirely in the presentation layer of one React component. The engine cost model and the data pulled by the worker are untouched.
- **Performance**: removing `Math.cos`/`Math.sin` per node reduces per-frame CPU work; the single line path is cheap compared to thousands of tick strokes.
