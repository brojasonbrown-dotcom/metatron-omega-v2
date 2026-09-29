/**
 * Ω-SELF — genome contract and cross-modal persistence.
 *
 * These assert the two properties the self-report depends on: the encoder is
 * deterministic, and a reload reproduces the exact vector a chunk was
 * ingested with (including its non-text descriptor).
 */
import { describe, it, expect } from 'vitest';
import { KnowledgeBase } from '@/core/knowledge/KnowledgeBase';
import {
  measureGenomeHealth,
  measureSelfRetrieval,
  encoderIsDeterministic,
  GENOME_CONTRACT,
} from '@/core/knowledge/genome';

function seeded(): KnowledgeBase {
  const kb = new KnowledgeBase();
  const texts = [
    'the toroidal ladder closes when the shift autocorrelation approaches unity across every rung',
    'eigenmode extraction uses power iteration for the leading mode and Lanczos for the outermost spiral mode',
    'hebbian coactivation weights decay geometrically and are capped by the memory governor',
    'zeckendorf addressing assigns each pattern a unique non consecutive fibonacci representation',
    'radial fourier transforms measure the spectral density of each node neighbourhood',
  ];
  texts.forEach((t, i) => {
    kb.ingest({ url: `local://doc${i}`, title: `doc${i}`, field: 'test', text: t });
  });
  return kb;
}

describe('genome contract', () => {
  it('encoder is deterministic for identical text', () => {
    expect(encoderIsDeterministic()).toBe(true);
  });

  it('stored vectors re-encode exactly from their text', () => {
    const h = measureGenomeHealth(seeded());
    expect(h.sampled).toBeGreaterThan(0);
    expect(h.driftedChunks).toBe(0);
    expect(h.reencodeExact).toBe(true);
    expect(h.version).toBe(GENOME_CONTRACT.version);
  });

  it('vector space is normalised and has not collapsed', () => {
    const h = measureGenomeHealth(seeded());
    expect(h.norm).toBeGreaterThan(0.9);
    expect(h.norm).toBeLessThan(1.1);
    expect(h.anisotropy).toBeLessThan(0.9);
  });

  it('the corpus can retrieve its own chunks', () => {
    const r = measureSelfRetrieval(seeded());
    expect(r.probes).toBeGreaterThan(0);
    expect(r.top5).toBeGreaterThanOrEqual(0.8);
  });

  it('cross-modal descriptors survive a snapshot/restore cycle', () => {
    const kb = new KnowledgeBase();
    const descriptor = [0.25, -0.5, 0.75, 0.125, -0.875, 0.5];
    kb.ingest({
      url: 'local://cad/beam.dxf',
      title: 'beam',
      field: 'test',
      text: 'steel beam profile with two flanges and a web of constant thickness',
      modality: 'geometry',
      descriptor,
    });
    const before = kb.chunkList();
    expect(before.length).toBeGreaterThan(0);

    const restored = new KnowledgeBase();
    restored.restore(JSON.parse(JSON.stringify(kb.snapshot())));
    const after = restored.chunkList();

    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      expect(after[i].modality).toBe('geometry');
      expect(after[i].descriptor).toEqual(descriptor);
      // The vector itself must be bit-identical, not merely similar: recall
      // geometry shifts silently otherwise.
      expect(Array.from(after[i].vec)).toEqual(Array.from(before[i].vec));
      expect(Array.from(after[i].barcode)).toEqual(Array.from(before[i].barcode));
    }
  });
});
