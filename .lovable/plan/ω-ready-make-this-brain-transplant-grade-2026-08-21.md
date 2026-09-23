# Ω-READY — make this brain transplant-grade

Goal: bring METATRON Ω to the state where it can be lifted into RAFFY U v16 as a drop-in cognitive substrate, with nothing left to discover at transplant time. Everything here happens **in this project only** — the Raffy snapshot stays read-only.

## Correction carried forward


## Host scan result — one blocker to record before we build (verified just now)

I re-scanned the readable Raffy snapshot (commit c03ab362) against the three audit pages. The two sides do not describe the same repo:

- **Present and confirmed:** `deploy/rust-api/src/rumf/*` (hierarchy, trust, maturation, retrieval, scheduler, persistence_api), `deploy/rust-api/src/memory_orchestrator/merge.rs` with the exact φ⁻¹/φ⁻²/φ⁻³ BigNum128 weights, SHA3-256 throughout the Rust evidence and merkle paths, HLC in `packages/types/src/hlc.ts`, the host brain `src/brain/*` (ontology, ledger, recall, resonance, learning, hash, validate), `src/metatron/*` and `src/metatron-v11/*`, `src/components/intelligence/EngineAuditCard.tsx`.
- **Absent from the snapshot:** `packages/metatron-brain`, `packages/metatron-field-v12`, `deploy/metatron-service`, `src/metatron-v2`, any `IMetatron` declaration, and anything named `opencore`/`openspace`. `packages/` holds only api-client, governance, telemetry, test-utils, types.

So the audit pages were written against a **newer state of RaffyU_SIMPLE than the snapshot I can read** — the very paths they call the load-bearing seams (`brain.ts`, `field-service.ts`, `factory.ts`, `determinism.worker.ts`) do not exist here, while the paths they call stale (`src/metatron`, `src/metatron-v11`) do. The GitHub remote you gave is private: `git ls-remote` fails with no credentials, and this workspace has no GitHub connection (only Stripe). **I cannot verify the seam surface myself until GitHub is connected** — so nothing in this plan is allowed to hard-code those paths.

The consequence is deliberate and costs nothing: every section below targets the **contracts**, not the file paths — the CBOR/hash/HLC law, the Q60 merge, the single tier law, the evidence envelope names, the RUMF wing/room/drawer mapping, and an `IMetatron`-shaped facade. All of those are verified against artefacts that *are* readable (merge.rs, hlc.ts, the Rust RUMF modules, the audit pages' pinned event names). The path-level swap is decided later, against the real repo, with GitHub connected.

## Correction carried forward

The uploaded plan suite says the Ω TypeScript engine does not exist and the work is a Python→TS port. That was true of the Desktop source, not of this repo. The TS realization is here and certified: `packages/trnn-core` (cell, torus, spectral, web, measure, sense, memory braid, ledger, cognition, learn, fractal, algebra, harness, sweeps), `packages/brain-core`, `packages/field-kernel-core`, `src/core` (analysis spine, knowledge genome, memory planes L0–L-S, self atlas), `src/ui/omega`. So the transplant is a **module move of a certified engine**, and the Python TRNN keeps one job: parity oracle. What follows is the readiness work that has to land before that move is safe.

## What is not ready yet (verified)

- **No interop layer.** `src/core/interop/` does not exist. Every host contract — canonical CBOR, one declared hash law, HLC v2.1, Q60 fixed point, `IMetatron` — is currently unrepresented, so today the engine cannot be addressed by Raffy at all.
- **Two tier laws on the host, one on ours.** Raffy carries policy-gate 0.2/0.5 and `coherenceTier` Ω_c/0.2 side by side. Our warm coherence must map onto one declared law and must abstain rather than emit a false AUTO from a cold field.
- **f64 vs Q60.** Every score that the host hashes or merges (φ⁻¹/φ⁻²/φ⁻³, BigNum128, no floats) has to be reproducible from our numbers exactly, not approximately.
- **Nondeterminism in one substrate path.** `src/core/sensory/SensoryGateway.ts` is the only remaining `Math.random()` in the engine surface; anything that feeds an id, a hash or a ledger leaf must be seeded.
- **No packaged entry contract.** The engine is consumed today only by our own UI; nothing declares the public surface a host may depend on, so a transplant would drag internals with it.
- **Learning is proven per-module, not end to end.** The batteries certify each stage; there is no single measured run showing intake → field → measure → analyse → seal → consolidate → recall improving recall quality over baseline on the host's own artefact types.

## Sections

Each section: scan, implement, certify with its own battery, amend the brainmap. No section lands without its battery green and the full suite green.

**R1 Determinism sweep.** Seed or remove the last nondeterministic paths (sensory gateway ids first), then prove it: a fixed-seed replay of intake → planes → snapshot produces byte-identical snapshots and identical digests across two runs in the same process and across a save/restore cycle. Extends the Ω-03 transport law to every plane, not just L2/L3.

**R2 Contract law — `src/core/interop/contract.ts`.** Canonical CBOR encoder with a deterministic map ordering, **one** declared hash law (SHA3-256, with the SHA-256 compatibility path named explicitly rather than falling back silently), HLC v2.1 with a node id, and monotone deterministic ids for every ledger leaf. Battery: encode/decode round-trips, ordering stability under key permutation, hash vectors pinned, HLC monotonicity under clock regression.

**R3 Fixed point — `src/core/interop/q60.ts`.** Q60 (10^18 scale) integer arithmetic and the φ-weighted geometric merge, mirroring the host's BigNum128 semantics exactly, plus a declared f64→Q60 quantisation with a proven error bound. Battery: merge reproduces the φ⁻¹/φ⁻²/φ⁻³ weights on pinned vectors, no float in the path, quantisation bound holds across the engine's full coherence range.

**R4 Tier gate — `src/core/interop/tierGate.ts`.** One law: warm coherence → AUTO / APPROVE / HALT, ABSTAIN when the field is cold or the warm-rung count is below threshold, with φ⁻⁸ hysteresis and the conformal envelope already in the engine supplying the abstention. Battery: cold field never returns AUTO, hysteresis prevents flapping, every HALT carries a code.

**R5 Evidence — `src/core/interop/evidenceEnvelope.ts`.** Emit our finding-ledger and consolidation events as host-shaped envelopes (`metatron.cognitive.{understand,retrieve,reason,gate,critic,respond,persist}.v1`), CBOR + hash chain + prev-hash, ids deterministic, and a verifier that walks **genesis → head** rather than a trailing window. Battery: chain verifies whole, tamper anywhere fails, event names and halt codes pinned by contract test.

**R6 Memory bridge — `src/core/interop/rumfBridge.ts`.** Map our seven planes onto wing/room/drawer/entry, preserving trust tier and maturation stage, and prove a byte-identical plane → bridge → plane round-trip including L0 tape windows and L-S atoms. Battery: round-trip identity, recall invariance after the trip, capacity/eviction behaviour unchanged.

**R7 Typed business intake — `src/core/interop/intake/`.** Encoders from host artefacts into Ψ and into genome records, each with a declared field layout and a classification default of `sovereign`: RFI, submittal, change order, AIA payment application, drawing/BIM geometry, invoice, payroll, cashflow, time entry, SLA event, assignment, credit/budget, governance proposal and vote, marketplace skill, meeting transcript, institutional memory note. Battery per family: deterministic encoding, distinct artefacts stay distinguishable in recall, no encoder can widen classification.

**R8 Engine facade — `src/core/interop/imetatron.ts`.** Implement the host's only contract — process, stream, remember, recall, plan, reason, learn, getRAM, subscribeToRAM, getLedgerStatus — over Ω, with the RAM snapshot shape and the 4 Hz field snapshot shell preserved. Battery: every method answers on a cold engine without throwing, stream yields ordered chunks, determinism verification passes against the facade.

**R9 Learning proof end to end.** One measured run over R7 artefact types showing recall quality above a stated baseline with margins recorded, kill criteria declared in advance, and the whole run sealed into the ledger. Whatever fails its margin **ships disabled**, recorded, not hidden.

**R10 Package the surface.** Declare the public entry (`index.ts` exports only what a host may import), remove internals from that surface, keep every existing import path working, and add a sweep-check test that fails when a module is neither exported nor registered in the brainmap.

**R11 Brainmap amendment Ω-06 and the transplant dossier.** Update `docs/BRAINMAP.md` with the interop layer, the single tier law, the hash law, the Q60 boundary and the intake taxonomy; add a `PORTMAP` table mapping every module to its Raffy destination, its battery and its gate; and record the host defects we must not depend on (RUMF localStorage-only writes, silent SHA3 fallback, node-id-less HLC, missing Metatron persistence table, random evidence ids, truncated chain verification).

## Guardrails

Additive only — the interop layer sits over the engine and changes no field math. No new dependency. No mock or simulated data enters any plane. Existing batteries stay green at every step; a section that would regress one is redesigned, not forced. Security gates apply from the start: the engine never holds service-role credentials, sensory frames default to `sovereign`, engine evidence always goes through the sealed ledger path.

## Order

R1 → R2 → R3 → R4 → R5 → R6 → R7 → R8 → R9 → R10 → R11. R1–R5 are the hard prerequisites; R6–R8 make the engine addressable; R9–R11 make it defensible.
