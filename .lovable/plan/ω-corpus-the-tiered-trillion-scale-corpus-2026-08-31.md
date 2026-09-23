# Ω-CORPUS — the tiered trillion-scale corpus

Goal: raise what *survives* the tick from ~10³ numbers/s to a durable store that
can grow toward 10¹² numbers, without touching the hot engine path, without
changing any engine digest, and with every stored byte provable against the
Merkle ledger.

Today `TieredCorpus` (Ω-SCALE P2) is an in-memory policy only: it decides
admission and eviction but nothing is written to disk, and nothing links a
retained frame to the evidence log. This plan makes each tier real, one area at
a time, each shippable and independently testable.

---

## A. Physical layout (what lives where)

```text
 tick ──► HOT   in-RAM signature cache      ~10⁴ frames    read every tick
            │  demote (never delete)
            ▼
         WARM  IndexedDB tape shards        ~10⁷ numbers   read on recall
            │  seal + compact
            ▼
         COLD  OPFS archive segments        ~10¹² numbers  read on proof/audit
            │
            └─► LEDGER  Merkle leaf per sealed segment ── inclusion proof
```

Rules that hold at every tier:
1. Demotion only. A frame leaves a tier by being offered to the tier below.
2. Append-only below HOT. WARM shards and COLD segments are immutable once sealed.
3. Every sealed unit is addressed by its content hash, and that hash is a leaf
   in the existing RFC-6962 log — so a segment is either provably ours or it is
   not ours.

---

## B. Area 1 — HOT: signature cache (in RAM)

- New `src/core/corpus/HotCache.ts` wrapping the existing `TieredCorpus` `hot`
  tier with a typed frame: `{ tick, rank, signature: Float64Array, witnesses }`.
- Fixed capacity from `MemoryGovernor`'s RAM envelope (not a constant), so the
  cache shrinks on a small host instead of pushing the engine into GC.
- Admission stays surprise-based (`|actual − predicted| / halfWidth`) against the
  conformal band, so a frame inside its own 90% interval never occupies HOT.
- Eviction emits a `demote` event carrying the evicted entries in tick order.
- Zero allocation on the steady-state path: ring of pre-sized `Float64Array`s,
  same discipline as `FieldTape`.

Exit test: capacity respected under 10⁵ offers; evicted set is exactly the
least-surprising; no allocation growth after warm-up.

## C. Area 2 — WARM: IndexedDB tape shards

- New `src/core/corpus/WarmShards.ts`. Demoted HOT frames accumulate into a
  shard buffer; a shard seals at N frames (φ-spaced default 1597) or on idle.
- Binary encoding, not JSON: header (schema, tick range, width, count) followed
  by a packed `Float32Array` payload — the same decimation the WARM tier width
  (233 numbers) already assumes. ~4 bytes/number vs ~20 for JSON.
- Written through the existing adapter pattern in `MemoryPersistence`
  (IndexedDB primary, in-memory fallback for SSR/tests), one record per shard,
  keyed `warm:<logIndex>:<contentHashPrefix>`.
- Atomic put; a crash mid-seal loses at most the open buffer, never a sealed shard.
- Index record `warm:index` holds `{ shardKey, tickFrom, tickTo, count, hashHex }`
  so recall can select shards by tick range without reading payloads.

Exit test: seal → reload → byte-identical payload; index range query returns
exactly the covering shards; corrupt payload is rejected by hash, not parsed.

## D. Area 3 — COLD: OPFS archive segments

- New `src/core/corpus/ColdArchive.ts` reusing `LocalArchive`'s OPFS-first
  adapter ladder (OPFS → IndexedDB → memory).
- A cold segment is a compaction of K sealed WARM shards down to signature
  width (13 numbers/frame), written as one immutable binary file
  `cold/<segmentIndex>-<hashPrefix>.bin` with a temp-file → rename write.
- Compaction is the only lossy step in the system and it is explicit: the
  spectral resample used is the exact one from `operator/resample.ts`, so the
  loss is band-limitation, not truncation, and is stated in the segment header.
- Quota-aware: query `navigator.storage.estimate()` before each write; on
  pressure, stop admitting rather than evicting COLD (COLD is the archive of
  record). Report the refusal instead of failing silently.

Exit test: K shards → 1 segment; resampled reconstruction error matches the
`resample` bound; a full-quota host refuses admission and says so.

## E. Area 4 — Ledger index (the spine of trust)

- New `src/core/corpus/CorpusLedger.ts` on top of `ledger/merkle.ts` + `ledger/sth.ts`.
- One canonical leaf per sealed unit (WARM shard and COLD segment):
  `{ kind, tier, index, tickFrom, tickTo, count, width, payloadHashHex }`,
  hashed via `canonicalJson` — identical discipline to `findingLedger`.
- Signed tree head after each seal, persisted alongside the index so a reload
  can prove continuity (`verifyConsistency`) against the previous head.
- Retrieval path is proof-carrying: reading a segment returns
  `{ data, inclusionProof, head }`; a caller can verify without the store.
- Never `Date.now()` inside: timestamps are passed in, so replays reproduce.

Exit test: inclusion verifies for every sealed unit; consistency verifies across
reloads; a mutated payload byte fails verification before it is ever decoded.

## F. Area 5 — Retrieval and budget

- `src/core/corpus/CorpusRecall.ts`: tick-range or barcode prefilter →
  HOT (exact) → WARM (shard load) → COLD (segment load), stopping at the first
  tier that satisfies the budget.
- Budget is explicit in numbers-read and milliseconds; an unsatisfiable query
  abstains with a reason rather than scanning the archive.
- Reuses the existing Hamming prefilter (`BarcodeIndex`) before any I/O.

## G. Area 6 — UI

- MEMORY deck gains a CORPUS block: per-tier occupancy, numbers held vs the
  policy ceiling, bytes on disk, last sealed head (short hex) and verification
  state, admission/rejection/demotion counters, quota headroom.
- Read-only, same discipline as the ANALYSIS deck — never a control surface for
  the engine.

---

## Technical notes

- New code lives in `src/core/corpus/`; `packages/trnn-core/src/operator/retention.ts`
  stays the pure policy and gains no I/O.
- All persistence is local-only (IndexedDB / OPFS). No network, ever.
- All writes happen off the tick: sealing runs in `requestIdleCallback` with a
  `setTimeout` fallback, so no engine tick ever awaits disk.
- Determinism: identical frame stream ⇒ identical shard bytes ⇒ identical Merkle
  root. This becomes a golden test.
- No existing engine, analysis or knowledge module changes behaviour; the corpus
  subscribes to what already exists.

## Reality check on 10¹²

10¹² float32 numbers is ~4 TB — beyond any browser quota. The honest ceiling is
what the host grants (typically tens of GB on desktop Chromium via OPFS), which
at 13 numbers/frame signature width is ~10⁹–10¹⁰ retained numbers. The plan
therefore makes the *policy* trillion-scale and unbounded in COLD, reports the
measured host ceiling on the deck, and refuses rather than pretends when the
quota is reached.

## Order of work

A → B → C → D → E → F, each with tests green and build OK before the next.
Areas B–D are independently useful; E is what makes the archive evidence.
