# AGENTS

Canonical context: `.lovable/plan/00-project-context-sheet.md` (read before every task).

- One prompt = one task ID (P#.#); never expand scope or touch files outside it — prevents clobbering manual work.
- Delete, never soften: failed-verification numerology is removed, not renamed or commented — lore must not survive as noise.
- Replacement before deletion: a live thing is removed only after its substitute is in and green — no regressions.
- Gate per task: lint → tsgo → vitest → build all green; red gate blocks the next task.
- Determinism: no Math.pow/Math.random/Date.now on any path reaching state; use dpow/dmath/SeedStream — bit-reproducibility is a product feature.
- Lore never scores: no coincidence term feeds recall, learning, consolidation, or any gate.
- Frozen unless a task says otherwise: vite.config.ts plugins, trnn-core constants/dmath/Neumaier kernels, dmd.ts/vsa.ts core math, live engine math dirs, persisted snapshot state.
- Minimal diff; match the file's existing idiom; small edits over rewrites.
- Save each task's plan as `.lovable/plan/ω-<topic>-<date>.md` before coding.
- Every plan runs an information-flow review first: source, destination, what it indicates, storage layering, pattern-recognition/field use, improvement methods; enumerate all solutions per question, filter rigorously, keep the best combination — prevents unexamined designs.
- Before any task, consult docs/BRAINMAP.md and scan existing files; extend, never duplicate — one home per concern.
- Baseline and expected test counts live in docs/BASELINE.md — the gate compares against it.
