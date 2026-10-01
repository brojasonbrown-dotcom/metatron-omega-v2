/**
 * HearDeckPanel — hearing, reading and the words the field holds.
 *
 * One switch starts both ears on one microphone: the spectral channel (sound
 * features into Ψ) and the speech teacher (words). Heard and typed words wait
 * in a review strip — fix, remove or confirm them — and only reviewed words
 * are learned. Every word can be inspected down to its exact code, Zeckendorf
 * address, torus position and meaning neighbours.
 */
import { useEffect, useMemo, useState } from 'react';
import { getMemoryRuntime } from '../memoryRuntime';
import { useMemoryVersion } from '../useMemoryRuntime';
import { groundingStats } from '@/core/knowledge/lexicon';

const deg = (r: number) => `${((r * 180) / Math.PI).toFixed(1)}°`;
const ago = (t: number | null, now: number) => {
  if (t === null) return 'never';
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border/40 px-2 py-1">
      <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="tabular-nums truncate">{value}</div>
    </div>
  );
}

function useNow(ms = 500) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export function ActivityMap() {
  const rt = getMemoryRuntime();
  useMemoryVersion();
  const now = useNow(1000);
  const a = rt.activity();
  const dormant = a.rows.filter((r) => r.dormant).length;
  return (
    <section className="rounded border border-border/60 p-2 space-y-1">
      <div className="flex items-center gap-2">
        <span className="font-display text-[10px] tracking-[0.28em] text-primary">ACTIVITY</span>
        <span className="text-muted-foreground">
          {dormant} of {a.rows.length} dormant · saved {ago(a.savedAt, now)}
          {a.unsaved ? ' · unsaved changes' : ''}
        </span>
      </div>
      <table className="w-full tabular-nums">
        <tbody>
          {a.rows.map((r) => (
            <tr key={r.id} className="border-t border-border/20">
              <td>{r.label}</td>
              <td className="text-right">{r.value}</td>
              <td className="text-right text-muted-foreground">
                {r.dormant ? '—' : `changed ${ago(r.lastChange, now)}`}
              </td>
              <td className={`text-right ${r.dormant ? 'text-destructive' : 'text-primary'}`}>
                {r.dormant ? 'dormant' : 'live'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function list<T>(xs: readonly T[], fmt: (x: T) => string): string {
  return xs.length ? xs.map(fmt).join(' · ') : '—';
}

function Inspector({ word }: { word: string }) {
  const rt = getMemoryRuntime();
  const v = useMemoryVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalidates the mutable-store read
  const info = useMemo(() => rt.inspectWord(word), [rt, word, v]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalidates the mutable-store read
  const assoc = useMemo(() => rt.associateWord(word), [rt, word, v]);
  return (
    <section className="rounded border border-primary/40 p-2 space-y-1">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[10px] tracking-[0.28em] text-primary">PATTERN</span>
        <span className="text-sm">{info.token || word}</span>
        <span className="text-muted-foreground">learned {info.count}×</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat
          label="exact code (base-27)"
          value={`${info.value}${info.exact ? '' : ' · truncated'}`}
        />
        <Stat label="Zeckendorf address" value={info.address} />
        <Stat
          label="torus rungs · phase"
          value={`${info.torus.rungs.join(',')} · ${deg(info.torus.minor)}`}
        />
        <Stat label="fingerprint · residue" value={`${info.fingerprint} · ${info.residue}/22`} />
      </div>
      <div className="text-muted-foreground">
        nearest:{' '}
        {info.neighbours.length
          ? info.neighbours.map((n) => `${n.word} ${n.score.toFixed(2)}`).join(' · ')
          : '—'}
        {info.neighbours.length ? ` · ${info.crisp ? 'crisp' : 'blend'}` : ''}
      </div>
      <div className="space-y-0.5 text-muted-foreground">
        <div>
          seen in {assoc.occurrences} sentence{assoc.occurrences === 1 ? '' : 's'}
          {assoc.episodes.length ? ` · ${assoc.episodes.length} saved moment(s)` : ''}
        </div>
        <div>
          spelled like:{' '}
          {list(assoc.spelling, (x) => `${x.word} ${x.score.toFixed(2)}`)}
        </div>
        <div>
          follows:{' '}
          {list(assoc.precedes, (x) => `${x.word} ${(x.p * 100).toFixed(0)}%`)}
        </div>
        <div>
          leads to:{' '}
          {list(assoc.follows, (x) => `${x.word} ${(x.p * 100).toFixed(0)}%`)}
        </div>
        <div>
          appears with:{' '}
          {list(assoc.together, (x) => `${x.word} ${x.assoc.toFixed(2)}`)}
        </div>
        <div>
          spreads to:{' '}
          {list(
            assoc.spread,
            (x) =>
              `${x.word} ${x.activation.toFixed(2)}${x.hop === 2 ? '²' : ''}`,
          )}
        </div>
        {assoc.sentences.length > 0 && (
          <ul className="list-disc pl-4">
            {assoc.sentences.slice(0, 4).map((s, i) => (
              <li key={i}>{s.text}</li>
            ))}
          </ul>
        )}
        {assoc.episodes.some((e) => e.next.length > 0) && (
          <div>
            then the field moved to:{' '}
            {assoc.episodes
              .flatMap((e) => e.next)
              .slice(0, 4)
              .map((n) => n.text ?? n.hash.slice(0, 8))
              .join(' · ')}
          </div>
        )}
      </div>
      <div className="text-muted-foreground">
        meaning:{' '}
        {info.catalog.length
          ? info.catalog
              .map(
                (c) =>
                  `${c.type || c.section}: ${c.condition}${c.predicate ? ` → fires on ${c.predicate}` : ' (ungrounded)'}`,
              )
              .join(' | ')
          : 'not in the vocabulary list — meaning comes only from context'}
      </div>
    </section>
  );
}

export default function HearDeckPanel() {
  const rt = getMemoryRuntime();
  useMemoryVersion();
  const now = useNow();
  const st = rt.lexiconStats();
  const pending = rt.pendingWords();
  const history = rt.heardHistory();
  const [draft, setDraft] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number; i: number; text: string } | null>(null);
  const grounding = useMemo(() => groundingStats(), []);
  const listening = st.hearing === 'listening' || st.hearing === 'starting';

  return (
    <div className="h-full overflow-auto p-3 space-y-3 text-[11px]">
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-display text-[10px] tracking-[0.28em] text-primary">HEAR</span>
        <button
          onClick={() => void rt.setListening(!listening)}
          className={`px-3 py-1 rounded border text-[10px] tracking-wider ${listening ? 'border-primary bg-primary/15 text-primary' : 'border-primary/60 text-primary'}`}
        >
          {listening ? 'STOP HEARING' : 'START HEARING'}
        </button>
        <span className="text-muted-foreground">
          {st.hearing}
          {listening && st.sharedMic ? ' · sound + words on one mic' : ''}
        </span>
        <label className="ml-auto flex items-center gap-1 text-muted-foreground">
          review {Math.round(st.holdMs / 1000)}s
          <input
            type="range"
            min={2}
            max={30}
            value={Math.round(st.holdMs / 1000)}
            onChange={(e) => rt.setHold(Number(e.target.value) * 1000)}
          />
        </label>
        <button
          onClick={() => rt.setHoldPaused(!st.paused)}
          className="px-2 py-0.5 rounded border border-border/60 text-[10px]"
        >
          {st.paused ? 'RESUME' : 'HOLD'}
        </button>
        <button
          onClick={() => rt.confirmAll()}
          disabled={pending.length === 0}
          className="px-2 py-0.5 rounded border border-border/60 text-[10px] disabled:opacity-40"
        >
          CONFIRM ALL
        </button>
      </header>

      <section className="rounded border border-border/60 p-2 space-y-2">
        <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
          waiting for review — click a word to fix it, × to remove, ✓ to keep now
        </div>
        {pending.length === 0 && (
          <div className="text-muted-foreground">Nothing waiting. Start hearing or type below.</div>
        )}
        {pending.map((u) => {
          const left = st.paused ? null : Math.max(0, Math.ceil((u.at + st.holdMs - now) / 1000));
          return (
            <div key={u.id} className="flex flex-wrap items-center gap-1">
              <span className="text-muted-foreground w-14">
                {u.source}
                {left !== null ? ` ${left}s` : ' held'}
              </span>
              {u.words.map((w, i) =>
                editing && editing.id === u.id && editing.i === i ? (
                  <form
                    key={i}
                    onSubmit={(e) => {
                      e.preventDefault();
                      rt.correctWord(u.id, i, editing.text);
                      setEditing(null);
                    }}
                  >
                    <input
                      autoFocus
                      value={editing.text}
                      onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                      onBlur={() => {
                        rt.correctWord(u.id, i, editing.text);
                        setEditing(null);
                      }}
                      className="w-24 rounded border border-primary/60 bg-background px-1"
                    />
                  </form>
                ) : (
                  <button
                    key={i}
                    onClick={() => {
                      rt.setHoldPaused(true);
                      setEditing({ id: u.id, i, text: w });
                    }}
                    className="px-1.5 py-0.5 rounded border border-amber-400/50 hover:border-primary"
                  >
                    {w}
                  </button>
                ),
              )}
              {u.guess && <span className="text-muted-foreground">field guessed “{u.guess}”</span>}
              <button onClick={() => rt.confirmPending(u.id)} className="px-1.5 text-primary">
                ✓
              </button>
              <button onClick={() => rt.dropPending(u.id)} className="px-1.5 text-destructive">
                ×
              </button>
            </div>
          );
        })}
      </section>

      <section className="rounded border border-border/60 p-2 space-y-1">
        <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
          last {history.length} words in memory — click one to see its pattern
        </div>
        <div className="flex flex-wrap gap-1">
          {history.length === 0 && <span className="text-muted-foreground">—</span>}
          {history.map((h, i) => (
            <button
              key={i}
              onClick={() => setSelected(h.word)}
              title={
                h.hit === null
                  ? 'no sound guess'
                  : h.hit
                    ? 'field guessed this from sound'
                    : "field's sound guess was different"
              }
              className={`px-1.5 py-0.5 rounded border ${selected === h.word ? 'border-primary text-primary' : 'border-border/50'}`}
            >
              {h.word}
              {h.corrected ? '*' : ''}
              {h.hit === true ? ' ✓' : ''}
            </button>
          ))}
        </div>
      </section>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) {
            rt.hear(draft);
            setDraft('');
          }
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a sentence for the brain to read"
          className="flex-1 rounded border border-border/60 bg-background px-2 py-1"
        />
        <button className="px-2 py-1 rounded border border-primary/60 text-primary text-[10px]">
          READ
        </button>
        <input
          onChange={(e) => setSelected(e.target.value.trim() || null)}
          placeholder="Inspect any word"
          className="w-40 rounded border border-border/60 bg-background px-2 py-1"
        />
      </form>

      {selected && <Inspector word={selected} />}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="sound→word scored" value={String(st.sound.scored)} />
        <Stat
          label="top-1 / top-5"
          value={
            st.sound.scored
              ? `${(st.sound.top1 * 100).toFixed(0)}% / ${(st.sound.top5 * 100).toFixed(0)}%`
              : '—'
          }
        />
        <Stat
          label={`last ${st.sound.recentN} chunks`}
          value={
            st.sound.recentN
              ? `${(st.sound.recent * 100).toFixed(0)}%${st.sound.selfSufficient ? ' · hears alone' : ''}`
              : '—'
          }
        />
        <Stat label="corrected · removed" value={`${st.corrections} · ${st.drops}`} />
        <Stat label="words known" value={String(st.words)} />
        <Stat label="queued → placed in field" value={`${st.enqueued} → ${st.injected}`} />
        <Stat label="grounded words" value={`${grounding.grounded}/${grounding.entries}`} />
        <Stat
          label="field reads"
          value={
            st.readout && st.readout.words.length > 0
              ? `${st.readout.words
                  .slice(0, 4)
                  .map((w) => w.word)
                  .join(
                    ' ',
                  )} · ${(st.readout.explained * 100).toFixed(0)}%${st.readout.crisp ? ' · crisp' : ''}`
              : '—'
          }
        />
        <Stat label="field says" value={st.description ?? '—'} />
      </div>

      <ActivityMap />
    </div>
  );
}
