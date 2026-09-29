 METATRON / RHUFT — Project Context Sheet (for the Lovable agent)

   0. What's happening

   You are the coding agent on this repo. The human drives you one scoped
   prompt at a time, each prompt mapping to exactly one task ID (e.g. P1.1).
   You execute that task, verify it, commit it, and stop. You never expand
   scope, never "clean up while you're in there," and never touch files outside
   the prompt's stated scope.

   1. The goal (one sentence to stay anchored)

   Turn this project from a "unified-field-theory" narrative with a real
   computational engine hidden inside it, into a clean, honest,
   enterprise-deployable reservoir-computing + hyperdimensional-computing
   intelligence engine — every line either measurable, recalled, or deleted.

   2. What this machine actually is (mental model — read once, don't re-derive)

   • Real substrate (keep, harden): a deterministic φ-spaced
     harmonic-oscillator reservoir (packages/field-kernel-core/src/kernel.ts),
     exact Dynamic Mode Decomposition
     (packages/trnn-core/src/substrate/dmd.ts), FHRR vector-symbolic memory
     (.../substrate/vsa.ts), spectral phase attention
     (.../learn/spectralAttention.ts), Hebbian + LSH memory (src/core/memory/),
     real sensory frontends (src/core/sensory/).
   • Lore wrapper (remove): src/core/frameworks/F1–F9, src/core/gematria/,
     src/core/constants/Chapter47.ts, field/Qualia.ts, Reflect.ts —
     numerology/mysticism labels on top of real arithmetic.
   • The split that already exists: src/core/MetatronCore.ts separates
     metatronWitnessCoherence (scored, keep) from metatronCoherence
     (display-only lore blend, delete). Respect and complete this split.

   3. Hard rules (non-negotiable)

   1. Delete, never soften. A numerology constant that fails 40-digit
      verification is deleted, not renamed, not "quarantined as a comment."
   2. A change lands only after its replacement passes. Never remove a live
      thing before its substitute is in and green.
   3. The test suite is the gate. Every task ends with typecheck → Vitest →
      build all green (~883 tests). A red gate blocks the next prompt.
   4. Determinism is law. No Math.pow/Math.random/Date.now on any path that
      reaches state; route through dpow/dmath/SeedStream. Bit-reproducibility
      across engines is a product feature, not a nicety.
   5. Lore never scores. No coincidence term may feed recall, learning,
      consolidation, or any gate. If it's numeric, it's measured; if it's
      symbolic, it's a label.
   6. Minimal diff. Three similar lines beat a premature abstraction. No
      speculative generality.

   4. Workflow (how each prompt is structured)

   • Every prompt uses @file references and an exact change description — never
     an open-ended verb like "clean up the brain." Open-ended prompts are how
     Lovable's agent regenerates and clobbers work.
   • One concern per prompt. One file family, one task ID, one gate.
   • Prefer small Edit over full-file rewrites; a one-line edit must not
     rewrite a 500-line file.
   • After the change, run the gate, then commit with a message that names the
     task ID (e.g. P1.1 delete numerology constants in F1–F9). Commit-per-task
     keeps the two-way git sync clean and reversible.
   • If a change can be done as a plain git edit, do it via git (free) rather
     than Lovable chat (spends credits). Reserve Lovable chat for edits you
     can't do by hand.

   5. Verification gate (run this after every task)

   ```
     npm run lint            # 0 errors
     npx tsgo --noEmit       # 0 errors  (or `npx tsc --noEmit`)
     npx vitest run          # green; expected count drops only when a plan
   says so
     npm run build           # success
   ```

   If any of the four fails, the task is not done. Revert or fix within the
   same task — never push a red gate and move on.

   6. Canonical boundaries

   Do NOT touch (frozen or load-bearing):
   • vite.config.ts plugin config — @lovable.dev/vite-tanstack-config already
     wires TanStack/React/Tailwind/Cloudflare. Adding duplicate plugins breaks
     the build. Only extend aliases, never re-add plugins.
   • packages/trnn-core/src/core/constants.ts, core/dmath.ts, the Neumaier
     kernels, substrate/dmd.ts + substrate/vsa.ts core math — freeze unless a
     task explicitly says otherwise.
   • Live engine math: src/core/rhuft/, src/core/runtime/rhuftf/,
     src/core/memory/, src/core/sensory/, packages/trnn-core/,
     packages/field-kernel-core/.
   • Persisted memory/snapshot state and docs/, .lovable/.

   On the delete list (already audited — reference, don't re-audit):
   • Numerology in F1–F9; Weave.ts, TapeDmd.ts, MemoryStore.replay(),
     trajectoryAt(), bitmapResonance, fibCode/fibDecode, zeckDensity,
     digitSumTrajectory, empty L4.pathway body.
   • The gematria meaning layer, F6_Hebrew letter routing, Chapter47.ts,
     solfeggio/432Hz constants, metatronCoherence.

   Read these first — the answers already exist, don't re-derive them:
   • .lovable/plan/metatron-rhuft-rigour-audit-deletion-list-and-the-word-field
     -2026-09-23.md
   • .lovable/plan/ω-clean-remove-dead-weight-without-touching-the-brain-2026-0
     8-24.md
   • roadmap.md (the MEASURED-vs-LORE quarantine and the "falsifiable by a test
     or deleted" rule)

   7. Efficiency rules

   1. Reference, don't re-derive. The deletion list and the 6-step plan already
      live in .lovable/plan/. Read them; extend them; never regenerate the same
      analysis.
   2. Scope tightly. Use @file + exact line-level intent. The tighter the
      scope, the less likely a regeneration clobbers manual work.
   3. Batch verification. Run the gate once per task, not once per edit.
   4. Save each task's plan to .lovable/plan/ in the ω-<topic>-<date>.md
      convention before coding, so the agent has a target to hit.
   5. Work on one branch. Lovable syncs one branch at a time; keep prod vs
      staging explicit and never interleave.
   6. Prefer the existing idiom. Match the file's comment density, naming, and
      structure — don't import your own style.

   8. Prompt template (for the human — copy and fill)

   ```
     @file: .lovable/plan/00-project-context-sheet.md

     TASK: P#.# — <short title>
     GOAL: <one sentence on the outcome>
     SCOPE: <exact files/dirs; explicitly list what NOT to touch>
     CHANGES: <concrete edits, not intent>
     REPLACEMENT-BEFORE-DELETION: <what must be in place first, if any>
     GATE: lint → typecheck → vitest → build (all green)
     COMMIT: P#.# <title>
   ```

   9. The task arc (so you stay oriented across prompts)

   P0 foundation/gate → P1 strip lore & dead code → P2 input→field→meaning
   correctness ∥ P3 store/recall correctness → P4 learning signal (readout +
   task + benchmark) → P5 sensory/multimodal → P6 enterprise platform → P7
   verification & launch. One prompt = one task ID, in order; never skip the
   gate.
