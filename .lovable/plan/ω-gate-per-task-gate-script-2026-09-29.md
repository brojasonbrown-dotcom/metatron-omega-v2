# P0.2 — Gate script
Info-flow: source = eslint/tsgo/vitest JSON/vite build/build-errors.log; destination = one-line GATE GREEN/RED verdict; indicates whether a task may close; baseline stored once, as a marker in docs/BASELINE.md (single home).
Options considered: CI (not run by Lovable sync), git hooks (same), shell chain `&&` (no count check), bun script (chosen: stops at first red, parses vitest JSON, compares count).
Drop policy: count below marker fails; lowering the marker in BASELINE.md is the written note.
