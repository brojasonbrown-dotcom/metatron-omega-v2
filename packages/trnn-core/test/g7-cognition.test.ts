/**
 * Gate G7 — cognition + self-model.
 *
 * Contract under test:
 *   • the concept store returns exact-cosine ordering, PQ or no PQ
 *   • HNSW recall against brute force stays at or above the recorded floor
 *   • construction and search are deterministic from the seed
 *   • the λ-SSM cannot leave |λ| < φ⁻¹ for any parameter value
 *   • the self-model is only "enabled" when it measurably beats RLS
 *   • the mind's novelty gate spends capacity on distinct experience
 */
import { describe, it, expect } from 'vitest';
import { ConceptStore } from '../src/cognition/concepts';
import { DiagonalRLS, DiagonalSSM, SelfModel, LAMBDA_MAX } from '../src/cognition/selfModel';
import { Mind, NOVELTY_THRESHOLD } from '../src/cognition/mind';
import { SeedStream } from '../src/core/determinism';
import { PHI, phiPow } from '../src/core/constants';

const DIM = 32;

function randomVec(rng: SeedStream, dim = DIM): Float64Array {
  const v = new Float64Array(dim);
  for (let i = 0; i < dim; i++) v[i] = rng.next() * 2 - 1;
  return v;
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? d / Math.sqrt(na * nb) : 0;
}

function buildStore(n: number, seed = 'g7', opts: Record<string, unknown> = {}) {
  const store = new ConceptStore({
    dim: DIM,
    capacity: n + 8,
    seed,
    sub: 8,
    centroids: 16,
    ...opts,
  });
  const rng = new SeedStream(`${seed}-data`);
  const raw: Float64Array[] = [];
  for (let i = 0; i < n; i++) {
    const v = randomVec(rng);
    raw.push(v);
    store.add(`k${i}`, v, i);
  }
  return { store, raw };
}

function bruteBest(raw: Float64Array[], q: ArrayLike<number>): number {
  let bi = -1;
  let bs = -Infinity;
  raw.forEach((v, i) => {
    const s = cosine(v, q);
    if (s > bs) {
      bs = s;
      bi = i;
    }
  });
  return bi;
}

describe('G7 · concept store', () => {
  it('returns the exact nearest neighbour for a stored vector', () => {
    const { store, raw } = buildStore(120);
    for (let i = 0; i < 120; i += 17) {
      const hit = store.search(raw[i], 1).hits[0];
      expect(hit.key).toBe(`k${i}`);
      expect(hit.score).toBeGreaterThan(1 - 1e-12);
    }
  });

  it('matches brute force on random probes at the recorded recall floor', () => {
    const { store, raw } = buildStore(300);
    const rng = new SeedStream('g7-probes');
    let agree = 0;
    const trials = 60;
    for (let t = 0; t < trials; t++) {
      const q = randomVec(rng);
      const got = store.search(q, 1).hits[0];
      const want = bruteBest(raw, q);
      if (got && got.key === `k${want}`) agree++;
    }
    // Recorded floor: φ⁻¹ of probes must land on the exact nearest neighbour.
    expect(agree / trials).toBeGreaterThanOrEqual(1 / PHI);
  });

  it('scores are exact cosines, never PQ estimates', () => {
    const { store, raw } = buildStore(200);
    expect(store.pqReady).toBe(true);
    const rng = new SeedStream('g7-exact');
    for (let t = 0; t < 10; t++) {
      const q = randomVec(rng);
      for (const h of store.search(q, 3).hits) {
        const idx = Number(h.key.slice(1));
        expect(Math.abs(h.score - cosine(raw[idx], q))).toBeLessThan(1e-12);
      }
    }
  });

  it('keeps the PQ approximation error small enough to prune with', () => {
    const { store } = buildStore(200);
    const rng = new SeedStream('g7-pqerr');
    let worst = 0;
    for (let t = 0; t < 20; t++) {
      store.search(randomVec(rng), 5);
      worst = Math.max(worst, store.stats().pqError);
    }
    expect(worst).toBeLessThan(0.5);
    expect(worst).toBeGreaterThan(0); // it *is* an approximation, not a copy
  });

  it('spends fewer exact comparisons than brute force', () => {
    const { store } = buildStore(400);
    const rng = new SeedStream('g7-cost');
    let ops = 0;
    for (let t = 0; t < 20; t++) ops += store.search(randomVec(rng), 5).exactOps;
    expect(ops / 20).toBeLessThan(400);
  });

  it('is deterministic: same seed, same graph, same answers', () => {
    const a = buildStore(150, 'twin');
    const b = buildStore(150, 'twin');
    const rng = new SeedStream('twin-probe');
    for (let t = 0; t < 15; t++) {
      const q = randomVec(rng);
      expect(a.store.search(q, 5).hits).toEqual(b.store.search(q, 5).hits);
    }
    expect(a.store.stats().levels).toBe(b.store.stats().levels);
  });

  it('re-adding a key updates in place instead of consuming capacity', () => {
    const { store } = buildStore(50);
    const before = store.size;
    const rng = new SeedStream('g7-update');
    store.add('k7', randomVec(rng), 999);
    expect(store.size).toBe(before);
    expect(store.records()[7].tick).toBe(999);
  });

  it('evicts under capacity pressure and stays searchable', () => {
    const store = new ConceptStore({ dim: DIM, capacity: 40, seed: 'g7-evict' });
    const rng = new SeedStream('g7-evict-data');
    for (let i = 0; i < 200; i++) store.add(`k${i}`, randomVec(rng), i);
    expect(store.size).toBe(40);
    expect(store.stats().evictions).toBeGreaterThan(0);
    const hit = store.search(randomVec(rng), 1).hits[0];
    expect(hit).toBeDefined();
    expect(Number.isFinite(hit.score)).toBe(true);
  });

  it('holds PQ codes at a fraction of the vector footprint', () => {
    const { store } = buildStore(200);
    const s = store.stats();
    expect(s.codeBytes).toBeLessThan(s.vectorBytes / 16);
  });

  it('survives degenerate input without poisoning the graph', () => {
    const store = new ConceptStore({ dim: DIM, capacity: 16, seed: 'g7-zero' });
    store.add('zero', new Float64Array(DIM), 0);
    store.add('nan', new Float64Array(DIM).fill(NaN), 1);
    const rng = new SeedStream('g7-zero-probe');
    const hits = store.search(randomVec(rng), 2).hits;
    for (const h of hits) expect(Number.isFinite(h.score)).toBe(true);
  });
});

describe('G7 · self-model', () => {
  it('the λ-SSM cannot leave the stability disc for any parameter value', () => {
    const ssm = new DiagonalSSM(8, 1e3); // absurd learning rate on purpose
    const rng = new SeedStream('g7-lambda');
    const x = new Float64Array(8);
    const y = new Float64Array(8);
    for (let t = 0; t < 2000; t++) {
      for (let i = 0; i < 8; i++) {
        x[i] = rng.next() * 20 - 10;
        y[i] = rng.next() * 20 - 10;
      }
      ssm.update(x, y);
      expect(ssm.spectralRadius()).toBeLessThan(LAMBDA_MAX);
    }
    for (const l of ssm.lambdas()) expect(Number.isFinite(l)).toBe(true);
  });

  it('RLS recovers an exact affine map', () => {
    const rls = new DiagonalRLS(4, 1);
    const rng = new SeedStream('g7-rls');
    const x = new Float64Array(4);
    const y = new Float64Array(4);
    const a = [0.5, -1.25, 2, 0.1];
    const b = [1, 0, -0.5, 3];
    for (let t = 0; t < 500; t++) {
      for (let i = 0; i < 4; i++) {
        x[i] = rng.next() * 4 - 2;
        y[i] = a[i] * x[i] + b[i];
      }
      rls.update(x, y);
    }
    const out = new Float64Array(4);
    for (let i = 0; i < 4; i++) x[i] = 1.234;
    rls.predict(x, out);
    for (let i = 0; i < 4; i++) expect(out[i]).toBeCloseTo(a[i] * 1.234 + b[i], 5);
  });

  it('predictions stay finite on a chaotic stream', () => {
    const sm = new SelfModel(6, 55);
    const rng = new SeedStream('g7-chaos');
    const x = new Float64Array(6);
    for (let t = 0; t < 800; t++) {
      for (let i = 0; i < 6; i++) x[i] = Math.sin(t * phiPow(i - 3)) + rng.signed() * 0.1;
      const p = sm.observe(x, t);
      for (const v of p) expect(Number.isFinite(v)).toBe(true);
    }
    const r = sm.report();
    expect(Number.isFinite(r.ssmMse)).toBe(true);
    expect(Number.isFinite(r.rlsMse)).toBe(true);
  });

  it('gate G7: enabled is measured, never asserted', () => {
    const sm = new SelfModel(4, 89);
    const rng = new SeedStream('g7-gate');
    const x = new Float64Array(4);
    // pure white noise: nothing to model — the gate must not claim a win
    for (let t = 0; t < 400; t++) {
      for (let i = 0; i < 4; i++) x[i] = rng.signed();
      sm.observe(x, t);
    }
    const r = sm.report();
    expect(r.enabled).toBe(r.margin > 0);
    if (!r.enabled) expect(r.margin).toBeLessThanOrEqual(0);
  });

  it('tracks a smooth trajectory better than persistence', () => {
    const sm = new SelfModel(3, 144);
    const x = new Float64Array(3);
    for (let t = 0; t < 1500; t++) {
      for (let i = 0; i < 3; i++) x[i] = Math.sin((t + i * 7) / 21) * phiPow(-i);
      sm.observe(x, t);
    }
    const r = sm.report();
    expect(r.skill).toBeGreaterThan(0);
    expect(r.spectralRadius).toBeLessThan(LAMBDA_MAX);
  });

  it('is deterministic across identical streams', () => {
    const run = () => {
      const sm = new SelfModel(5, 55);
      const rng = new SeedStream('g7-det');
      const x = new Float64Array(5);
      for (let t = 0; t < 300; t++) {
        for (let i = 0; i < 5; i++) x[i] = rng.signed();
        sm.observe(x, t);
      }
      return sm.report();
    };
    const a = run();
    const b = run();
    expect(a.ssmMse).toBe(b.ssmMse);
    expect(a.rlsMse).toBe(b.rlsMse);
    expect(a.margin).toBe(b.margin);
  });
});

describe('G7 · mind', () => {
  it('seeds, stores novel observations and recognises repeats', () => {
    const mind = new Mind({ dim: DIM, capacity: 128, seed: 'g7-mind' });
    const rng = new SeedStream('g7-mind-data');
    const a = randomVec(rng);
    const first = mind.observe(a, 0);
    expect(first.action).toBe('seed');
    const again = mind.observe(a, 1);
    expect(again.action).toBe('recognise');
    expect(again.novelty).toBeLessThan(NOVELTY_THRESHOLD);
    const b = randomVec(rng);
    const other = mind.observe(b, 2);
    expect(other.action).toBe('store');
  });

  it('the novelty gate spends capacity on distinct experience only', () => {
    const mind = new Mind({ dim: DIM, capacity: 512, seed: 'g7-gate-mind' });
    const rng = new SeedStream('g7-gate-data');
    const patterns = [randomVec(rng), randomVec(rng), randomVec(rng)];
    for (let t = 0; t < 300; t++) mind.observe(patterns[t % 3], t);
    // three distinct experiences, repeated 100× each
    expect(mind.store.size).toBeLessThanOrEqual(4);
    const rep = mind.report();
    expect(rep.thoughts).toBe(300);
    expect(rep.meanNovelty).toBeLessThan(0.1);
  });

  it('surprise falls as the model learns a predictable stream', () => {
    const mind = new Mind({ dim: 8, capacity: 256, seed: 'g7-surprise' });
    const x = new Float64Array(8);
    const surprises: number[] = [];
    for (let t = 0; t < 600; t++) {
      for (let i = 0; i < 8; i++) x[i] = Math.sin((t + i * 5) / 13);
      surprises.push(mind.observe(x, t).surprise);
    }
    const early = surprises.slice(10, 60).reduce((a, b) => a + b, 0) / 50;
    const late = surprises.slice(-50).reduce((a, b) => a + b, 0) / 50;
    expect(late).toBeLessThan(early);
  });

  it('reports only measured quantities and stays finite', () => {
    const mind = new Mind({ dim: 16, capacity: 128, seed: 'g7-report' });
    const rng = new SeedStream('g7-report-data');
    for (let t = 0; t < 250; t++) mind.observe(randomVec(rng, 16), t);
    const r = mind.report();
    expect(Number.isFinite(r.meanNovelty)).toBe(true);
    expect(Number.isFinite(r.meanSurprise)).toBe(true);
    expect(r.concepts.size).toBe(mind.store.size);
    expect(r.selfModel.lambdaMax).toBe(LAMBDA_MAX);
    expect(r.recent.length).toBeLessThanOrEqual(13);
    expect(r.top.length).toBeLessThanOrEqual(13);
  });

  it('recall finds a stored concept from a degraded probe', () => {
    const mind = new Mind({ dim: DIM, capacity: 256, seed: 'g7-recall' });
    const rng = new SeedStream('g7-recall-data');
    const vs: Float64Array[] = [];
    for (let i = 0; i < 60; i++) {
      const v = randomVec(rng);
      vs.push(v);
      mind.observe(v, i, `p${i}`);
    }
    const probe = Float64Array.from(vs[21]);
    for (let i = 0; i < DIM; i += 3) probe[i] = 0; // knock out a third of the support
    const hit = mind.recall(probe, 3).hits[0];
    expect(hit.key).toBe('p21');
  });
});
