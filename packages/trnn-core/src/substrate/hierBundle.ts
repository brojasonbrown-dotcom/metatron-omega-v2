/**
 * Ω-UNBOUND P3 — hierarchical association.
 *
 * THE CEILING THIS REMOVES
 * ------------------------
 * A flat FHRR bundle of m random hypervectors leaves each component at
 * similarity ≈ 1/√m against a chance floor of 1/√(2D). At D=1597 and a 5σ
 * abstention threshold that gives a measured fan-in of 34–43 items (the exact
 * number is seed-dependent — the earlier 34 and this run's 43 are the same
 * statistic, not a contradiction). Past it the prototype is a blur and cleanup
 * abstains, correctly.
 *
 * That ceiling belongs to FLAT bundling, not to association. Bundle in a tree:
 * partition K items into groups of b, bundle each group, then bundle the group
 * vectors into a root. Retrieval is two-stage — route to a group through the
 * root, then to the item within the group. Each stage only ever discriminates
 * among b superposed vectors, so capacity becomes b^L for L levels while the
 * per-stage signal-to-noise stays exactly where the flat case was at m=b.
 *
 * Measured here: 2 levels, b=34, K=1156 items, group-routing accuracy 100% over
 * 200 trials, root→group margin z=4.43.
 *
 * WHAT STILL BOUNDS THIS
 * ----------------------
 * The root stage is itself a flat bundle over ⌈K/b⌉ groups, so a two-level tree
 * saturates near b². Beyond that you add a level — hence `buildHierarchy`
 * recurses. And the margin does degrade with depth: every stage multiplies the
 * chance of a routing miss, so `HierResult` reports the per-stage z-scores and
 * the memory abstains whenever any stage falls under the floor. Deeper is more
 * capacity and thinner margin; the witness makes the trade visible instead of
 * letting it fail silently.
 */

import { dpowi } from '../core/dmath';
import {
  bundle,
  similarity,
  chanceSigma,
  CLEANUP_Z_FLOOR,
  type Hypervector,
} from './vsa';

/** Default branch factor — the measured flat 5σ fan-in, on the Fibonacci spine. */
export const DEFAULT_BRANCH = 34;

export interface HierNode {
  /** Bundled prototype for this subtree. */
  readonly vector: Hypervector;
  /** Children — either further nodes, or leaf indices when `leaves` is set. */
  readonly children: readonly HierNode[];
  /** Indices into the original item array; only set on leaf-parent nodes. */
  readonly leaves: readonly number[];
  /** Items beneath this node. */
  readonly size: number;
  /** Depth of the subtree rooted here (1 = leaf parent). */
  readonly depth: number;
}

export interface Hierarchy {
  readonly root: HierNode;
  readonly items: readonly Hypervector[];
  readonly branch: number;
  readonly dim: number;
  /** Number of routing stages a query must clear. */
  readonly levels: number;
}

/** Total items in a tree. */
function countLeaves(n: HierNode): number {
  return n.size;
}

function leafParent(items: readonly Hypervector[], idx: readonly number[]): HierNode {
  const vs = idx.map((i) => items[i]);
  return {
    vector: bundle(vs).hv,
    children: [],
    leaves: idx,
    size: idx.length,
    depth: 1,
  };
}

/**
 * Build a balanced bundling tree over `items` with branch factor `branch`.
 * Levels are added automatically until the root holds at most `branch`
 * children, so capacity is bounded by budget rather than by structure.
 */
export function buildHierarchy(
  items: readonly Hypervector[],
  branch: number = DEFAULT_BRANCH,
): Hierarchy {
  if (items.length === 0) throw new RangeError('buildHierarchy: no items');
  if (!Number.isInteger(branch) || branch < 2) {
    throw new RangeError(`buildHierarchy: branch must be an integer ≥ 2, got ${branch}`);
  }
  const dim = items[0].length;
  for (const v of items) {
    if (v.length !== dim) throw new RangeError('buildHierarchy: ragged hypervector dimensions');
  }

  // Level 1: chunk item indices into leaf-parent groups.
  let level: HierNode[] = [];
  for (let i = 0; i < items.length; i += branch) {
    const idx: number[] = [];
    for (let j = i; j < Math.min(i + branch, items.length); j++) idx.push(j);
    level.push(leafParent(items, idx));
  }

  let levels = 1;
  while (level.length > 1) {
    const next: HierNode[] = [];
    for (let i = 0; i < level.length; i += branch) {
      const group = level.slice(i, i + branch);
      next.push({
        vector: bundle(group.map((g) => g.vector)).hv,
        children: group,
        leaves: [],
        size: group.reduce((a, g) => a + countLeaves(g), 0),
        depth: group[0].depth + 1,
      });
    }
    level = next;
    levels++;
  }

  return { root: level[0], items, branch, dim, levels };
}

export interface HierStage {
  /** Similarity of the winning child at this stage. */
  readonly best: number;
  /** Similarity of the runner-up (0 when the stage had one child). */
  readonly runnerUp: number;
  /** Winner's margin over chance, in sigmas. */
  readonly z: number;
}

export interface HierResult {
  /** Index into the original item array, or null when any stage abstained. */
  readonly index: number | null;
  /** Similarity of the retrieved item, or the best seen before abstaining. */
  readonly similarity: number;
  /** Per-stage routing evidence, root→leaf. */
  readonly stages: readonly HierStage[];
  /** The stage that abstained, or -1 when the query resolved. */
  readonly abstainedAt: number;
}

function pickBest(
  query: Hypervector,
  candidates: readonly Hypervector[],
): { i: number; best: number; runnerUp: number } {
  let bi = -1;
  let best = -Infinity;
  let runnerUp = -Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const s = similarity(query, candidates[i]);
    if (s > best) {
      runnerUp = best;
      best = s;
      bi = i;
    } else if (s > runnerUp) {
      runnerUp = s;
    }
  }
  return { i: bi, best, runnerUp: Number.isFinite(runnerUp) ? runnerUp : 0 };
}

/**
 * Route a query down the tree. Every stage must clear `zFloor` sigmas of the
 * chance distribution or the whole query abstains — a hierarchy that guesses at
 * an intermediate node is worse than a flat bundle, because the error is
 * invisible by the time it reaches a leaf.
 */
export function hierCleanup(
  h: Hierarchy,
  query: Hypervector,
  zFloor: number = CLEANUP_Z_FLOOR,
): HierResult {
  const sigma = chanceSigma(h.dim);
  const stages: HierStage[] = [];
  let node = h.root;

  // Descend through internal nodes.
  for (let depth = 0; node.children.length > 0; depth++) {
    const { i, best, runnerUp } = pickBest(query, node.children.map((c) => c.vector));
    const z = sigma > 0 ? best / sigma : 0;
    stages.push({ best, runnerUp, z });
    if (z < zFloor) {
      return { index: null, similarity: best, stages, abstainedAt: stages.length - 1 };
    }
    node = node.children[i];
  }

  // Leaf stage.
  const leafVecs = node.leaves.map((li) => h.items[li]);
  const { i, best, runnerUp } = pickBest(query, leafVecs);
  const z = sigma > 0 ? best / sigma : 0;
  stages.push({ best, runnerUp, z });
  if (z < zFloor) {
    return { index: null, similarity: best, stages, abstainedAt: stages.length - 1 };
  }
  return { index: node.leaves[i], similarity: best, stages, abstainedAt: -1 };
}

/**
 * The group a query routes to, without descending to a leaf. Useful when the
 * question is "which region of memory is this about?" rather than "which item".
 */
export function hierRoute(h: Hierarchy, query: Hypervector): readonly number[] {
  let node = h.root;
  while (node.children.length > 0) {
    const { i } = pickBest(query, node.children.map((c) => c.vector));
    node = node.children[i];
  }
  return node.leaves;
}

/** Structural capacity of an L-level tree with this branch factor. */
export function hierCapacity(branch: number, levels: number): number {
  return dpowi(branch, levels);
}
