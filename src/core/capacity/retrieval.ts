/**
 * Ω-CAPACITY C5 — what a recall budget actually buys.
 *
 * The first version of this probe measured against "the k nearest members of a
 * uniformly random population". That is a badly posed question: in a random
 * population every member past the first is equidistant noise, so the truth set
 * is arbitrary and the prefilter can only ever score 1/k. The measurement is
 * therefore built on *planted structure*: the population is a set of clusters,
 * each cluster a base vector plus perturbations of it, and the truth set for a
 * query is exactly the cluster it was drawn from. That is a question with a
 * right answer, so precision and recall mean something.
 *
 * Reported alongside is the diagnostic that motivated the change: the mean
 * Hamming displacement the barcode suffers per unit of input noise.
 */

import { BarcodeIndex } from '@/core/knowledge/BarcodeIndex';
import { encodeBitmap, hamming } from '@/core/gematria/bitmap';
import { SeedStream } from '@metatron/trnn-core/core/determinism';
import type { RetrievalCapacity, RetrievalPoint } from './types';

const CANDIDATE_SIZES = [8, 13, 21, 34, 55, 89, 144, 233] as const;

export interface RetrievalOptions {
  readonly population?: number;
  readonly queries?: number;
  readonly dim?: number;
  /** Members per planted cluster — the size of the truth set. */
  readonly clusterSize?: number;
  /** Perturbation applied within a cluster and to the cue. */
  readonly noise?: number;
  /** Numbers a single candidate rescore reads (signature width). */
  readonly widthPerCandidate?: number;
}

function vec(dim: number, seed: string, base?: Float64Array, noise = 0): Float64Array {
  const rng = new SeedStream(seed);
  const v = new Float64Array(dim);
  for (let i = 0; i < dim; i++) v[i] = (base ? base[i] : 0) + rng.signed() * (base ? noise : 1);
  return v;
}

/** Mean bit displacement of the barcode for a given input perturbation. */
export function measureBarcodeSensitivity(noise: number, dim = 233, trials = 16): number {
  let h = 0;
  for (let t = 0; t < trials; t++) {
    const base = vec(dim, `sens:${t}`);
    const near = vec(dim, `sens:${t}:n`, base, noise);
    h += hamming(encodeBitmap(base), encodeBitmap(near));
  }
  return h / trials;
}

export function measureRetrieval(o: RetrievalOptions = {}): RetrievalCapacity {
  const population = o.population ?? 512;
  const queries = o.queries ?? 32;
  const dim = o.dim ?? 233;
  const k = o.clusterSize ?? 8;
  const noise = o.noise ?? 0.15;
  const width = o.widthPerCandidate ?? 13;

  const clusters = Math.max(1, Math.floor(population / k));
  const index = new BarcodeIndex();
  const truthOf: string[][] = [];
  const bases: Float64Array[] = [];

  for (let c = 0; c < clusters; c++) {
    const base = vec(dim, `cluster:${c}`);
    bases.push(base);
    const ids: string[] = [];
    for (let m = 0; m < k; m++) {
      const v = m === 0 ? base : vec(dim, `cluster:${c}:${m}`, base, noise);
      const id = `${c}:${m}`;
      index.add(id, encodeBitmap(v));
      ids.push(id);
    }
    truthOf.push(ids);
  }

  const cues: Array<{ bm: Uint32Array; truth: Set<string> }> = [];
  for (let q = 0; q < queries; q++) {
    const c = q % clusters;
    cues.push({
      bm: encodeBitmap(vec(dim, `cue:${q}`, bases[c], noise)),
      truth: new Set(truthOf[c]),
    });
  }

  const points: RetrievalPoint[] = CANDIDATE_SIZES.filter((c) => c <= clusters * k).map((cand) => {
    let hits = 0,
      returned = 0;
    for (const { bm, truth } of cues) {
      const got = index.query(bm, cand).slice(0, k);
      returned += got.length;
      for (const g of got) if (truth.has(g.id)) hits++;
    }
    const denom = queries * k;
    return {
      candidates: cand,
      precision: returned > 0 ? hits / returned : 0,
      recall: denom > 0 ? hits / denom : 0,
      numbersRead: cand * width,
    };
  });

  const kneePoint = points.find((p) => p.recall >= 0.9) ?? null;
  return {
    population: clusters * k,
    queries,
    points,
    knee: kneePoint?.candidates ?? null,
    kneeNumbersRead: kneePoint?.numbersRead ?? 0,
  };
}
