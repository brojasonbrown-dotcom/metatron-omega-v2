# P0.3 — Determinism freeze
Info-flow: source = frozen kernel files + their outputs; destination = docs/FROZEN.md (single home for digests) read by test/determinism/p0-frozen.test.ts, run by the gate. Indicates: any change in source text or numeric behaviour of state-reaching math.
Options: hard-coded digests in test (two homes — dropped); git hash checks (platform-managed git — dropped); snapshot files (opaque — dropped); doc table + bit-pattern parity (chosen).
Scan: Math.pow/Math.random/Date.now reported, not removed.
