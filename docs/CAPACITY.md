# Ω-CAPACITY — the measured ceiling table (C1–C6)

Every figure below was produced by `src/core/capacity` on a real run: transforms
that were timed and checked for correctness in the same loop, bundles that were
decoded, shards that were written through the real codec and read back, and a
prefilter scored against planted ground truth. Nothing here is a projection.

Reproduce with the CAPACITY section of the MEMORY deck, or in code:

```ts
import { measureCapacity, formatCapacityReport } from '@/core/capacity';
console.log(formatCapacityReport(await measureCapacity()));
```

The probe is read-only: it uses its own in-memory blob store and never writes to
the engine, the corpus of record, or any persisted archive.

## Reference run (sandbox host, single thread, 2026-08-31)

```text
C1 rung ceilings
  width  band   bytes/tick   ticks/s      numbers/s     rt-error
     13     6         208       3748        194,875  6.2e-16
     89    44        1424       1496        532,505  5.7e-16
    233   116        3728        922        858,924  6.3e-16
    987   493       15792        186        734,016  7.4e-16
   2584  1291       41344         37        385,846  6.4e-16
  RAM working 179 MiB · resident 8,560,080 numbers · provenance fallback

C2 superposition
  FHRR dim 1597 · chance σ 1.77e-2 · measured fan-in 34 (sim 0.115)
  barcode 256 bits · 1024/1024 distinct
  signature 15.2 digits/slot · 657 bits per 13-mode signature

C3 ingest layering
  sensory.fast          377 Hz  w=   89      67,106 num/s  lossless (1.7e-15)
  sensory.mid           233 Hz  w=  233     108,578 num/s  lossless (1.8e-15)
  memory.driver          64 Hz  w=  233      29,824 num/s  lossless (1.8e-15)
  engine.tick            60 Hz  w=  987     118,440 num/s  lossless (1.9e-15)
  spectral.analysis     2.6 Hz  w= 2584    13,437  num/s   lossless (0.0e+0)
  surviving band limit 44

C4 residency
  memory · 1024 frames × 233 · warm 963,040 B · cold 61,680 B
  4.07 bytes/number · seal 915 ms · read 16 ms · ledger 18 leaves

C5 retrieval (planted clusters, k = 8, noise 0.15)
  cand   precision  recall   numbers-read
      8       0.988   0.988            104
    233       0.988   0.988           3029
```

## What the numbers mean

**C1 — throughput peaks at rung 233, it does not saturate.** 858,924 float64
slots/s round-tripped through the unitary transform, with a round-trip error of
6e-16 (machine epsilon). Wider rungs cost more per tick than they return: 2584
is 2.2× slower in numbers/s than 233 because Bluestein overhead and cache misses
outrun the extra width. The engine tick at rung 987 (186 ticks/s measured) has
~3× headroom over its 60 Hz schedule.

**C2 — three carriers, three different ceilings.**
- FHRR hypervector at D=1597: measured fan-in **34** at the 5σ abstention floor,
  not the nominal 100. Beyond 34 the weakest bundled component falls under the
  threshold and cleanup would be guessing.
- Barcode: 256 bits, zero collisions over 1024 random vectors; displacement is
  smooth in input noise (1.1 bits at σ=0.01, 12.8 at σ=0.15, 39.8 at σ=0.5), so
  it is a genuine metric embedding rather than a hash.
- Signature: 15.2 usable digits/slot survive a transform round trip → ~657 bits
  of state in one 13-mode signature.

**C3 — every scheduled rate class decimates losslessly.** Spectral resample
between rungs is exact to 2e-15 for band-limited content, so ingesting wide and
analysing narrow costs nothing in information. The binding constraint is the
narrowest class: with `sensory.fast` at width 89, only wavenumbers ≤ 44 survive
the whole chain. Anything carrying energy above k=44 must be routed at its
native width or it is lost at the first hop.

**C4 — durable storage costs 4.07 bytes per retained number.** That is the
float32 payload plus an amortised 40-byte header, measured on sealed bytes. At a
10 GiB host grant this is **2.64 × 10⁹ retained numbers**, and at the 13-number
signature width, ~2 × 10⁸ retained frames. The honest ceiling is 10⁹, not 10¹²;
the policy is unbounded, the host is not, and COLD refuses admission rather than
pretending.

**C5 — 8 candidates is the whole recall budget.** The Hamming prefilter reaches
98.8% recall at the smallest probed candidate set (104 numbers read); larger sets
buy nothing. Recall is therefore budgeted at 8 candidates, and a query that
cannot afford 104 numbers should abstain rather than widen.

## Recommended layering

1. **Ingest** at native width; never upsample to "gain" resolution.
2. **Analyse** at rung 233 — the measured throughput peak and the corpus width.
3. **Retain** by surprise into HOT, demote to WARM, compact to COLD at the
   13-mode signature width; that is the only lossy step and it is band-limited,
   not truncated.
4. **Recall** through the barcode prefilter at 8 candidates, then rescore exactly.
5. **Bundle** at most 34 items per prototype; split rather than blur.
6. **Above k = 44**, do not route through the fast sensory class.
