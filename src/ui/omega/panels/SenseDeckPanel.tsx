/**
 * SENSE deck — Ω-P6 sensory plane and braid memory.
 *
 * Left: the live ξ-channels feeding the engine (declared, encoded, injected),
 * with the two laws they must obey shown as measured numbers:
 *   L-S1  ‖S‖∞ ≤ φ         (injection never outruns the field bound)
 *   L-S2  loop gain ≤ φ⁻²  (the actuator path cannot self-excite)
 * Right: the TorusBraid — rated capacity, inverse temperature β, the novelty
 * gate's store/skip split, and the tail of what the engine actually retained.
 *
 * Everything here is pulled on demand from the worker; nothing is simulated.
 */
import { useCallback, useState } from 'react';
import { getOmegaRuntime } from '../omegaRuntime';
import { useOmegaState } from '../useOmegaRuntime';
import { useOmegaPull } from '../useOmegaPull';
import { getSensoryDriver, type SensoryChannelId } from '../sensoryDriver';
import { useSensoryState } from '../useSensoryDriver';

const PHI = 1.618033988749895;
const PHI_INV2 = 1 / (PHI * PHI);

const num = (x: number | undefined, d = 4) =>
  x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(d);

export default function SenseDeckPanel() {
  const s = useOmegaState();
  const rt = getOmegaRuntime();
  const [text, setText] = useState('metatron omega');
  const [gain, setGain] = useState(PHI_INV2);

  const request = useCallback(() => {
    rt.requestSense();
    rt.requestBraid();
  }, [rt]);
  useOmegaPull(request, 4, Boolean(s.snapshot));

  if (!s.snapshot) {
    return (
      <div className="h-full grid place-items-center text-[11px] font-mono text-muted-foreground">
        Build the engine on the ENGINE deck to open the sensory plane.
      </div>
    );
  }

  const sense = s.sense;
  const braid = s.braid;
  const rep = sense?.report;
  const hasText = sense?.channels.some((c) => c.id === 'text');

  const declareText = () => rt.declareChannel('text', 'text');
  const push = () => {
    if (!hasText) rt.declareChannel('text', 'text');
    rt.pushText('text', text);
  };

  return (
    <div className="h-full overflow-auto p-2 space-y-2">
      {/* laws */}
      <div className="rounded-md border border-border/40 bg-background/40 px-2.5 py-2 grid grid-cols-2 md:grid-cols-6 gap-x-4 gap-y-1 text-[10px] font-mono">
        <span className="text-muted-foreground">channels</span>
        <span className="tabular-nums">{rep?.channels ?? 0}</span>
        <span className="text-muted-foreground">peak ‖S‖∞</span>
        <span
          className={`tabular-nums ${(rep?.maxPeak ?? 0) > PHI + 1e-12 ? 'text-rose-400' : 'text-emerald-400'}`}
        >
          {num(rep?.maxPeak)} ≤ {PHI.toFixed(4)}
        </span>
        <span className="text-muted-foreground">loop gain</span>
        <span
          className={`tabular-nums ${(rep?.loopGain ?? 0) > PHI_INV2 + 1e-12 ? 'text-rose-400' : 'text-emerald-400'}`}
        >
          {num(rep?.loopGain)} ≤ {PHI_INV2.toFixed(4)}
        </span>
      </div>

      <LiveSenses />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
        {/* channels */}
        <div className="rounded-md border border-border/40 bg-card/30 p-2 space-y-2">
          <h3 className="text-[9px] font-display tracking-[0.28em] text-primary/80">ξ CHANNELS</h3>

          <div className="flex items-center gap-1.5">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="cue text…"
              className="flex-1 min-w-0 bg-background/60 border border-border/50 rounded px-2 py-1 text-[10px] font-mono outline-none focus:border-primary/60"
            />
            <button
              onClick={push}
              className="px-2 py-1 rounded border border-primary/50 text-primary text-[9px] font-display tracking-[0.2em] hover:bg-primary/10"
            >
              INJECT
            </button>
            <button
              onClick={hasText ? () => rt.muteChannel('text') : declareText}
              className="px-2 py-1 rounded border border-border/60 text-muted-foreground text-[9px] font-display tracking-[0.2em] hover:text-foreground"
            >
              {hasText ? 'MUTE' : 'DECLARE'}
            </button>
          </div>

          <label className="block text-[9px] font-mono text-muted-foreground">
            actuator loop gain · {gain.toFixed(4)}
            <input
              type="range"
              min={0}
              max={PHI_INV2}
              step={PHI_INV2 / 100}
              value={gain}
              onChange={(e) => {
                const g = Number(e.target.value);
                setGain(g);
                rt.setSenseGain(g);
              }}
              className="w-full accent-primary"
            />
          </label>

          <table className="w-full text-[9px] font-mono">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-normal px-1">id</th>
                <th className="text-left font-normal px-1">modality</th>
                <th className="text-right font-normal px-1">nodes</th>
                <th className="text-right font-normal px-1">peak</th>
                <th className="text-right font-normal px-1">energy</th>
                <th className="text-right font-normal px-1">support</th>
                <th className="text-right font-normal px-1">t</th>
              </tr>
            </thead>
            <tbody>
              {(sense?.channels ?? []).map((c) => (
                <tr key={c.id} className="border-t border-border/20">
                  <td className="px-1 text-foreground">{c.id}</td>
                  <td className="px-1 text-muted-foreground">{c.modality}</td>
                  <td className="px-1 text-right tabular-nums">{c.nodes}</td>
                  <td className="px-1 text-right tabular-nums">{num(c.peak, 3)}</td>
                  <td className="px-1 text-right tabular-nums">{num(c.energy, 3)}</td>
                  <td className="px-1 text-right tabular-nums">{c.support}</td>
                  <td className="px-1 text-right tabular-nums text-muted-foreground">
                    {c.updatedAt < 0 ? '—' : c.updatedAt}
                  </td>
                </tr>
              ))}
              {(sense?.channels.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={7} className="px-1 py-2 text-muted-foreground">
                    no channels declared — the field runs on its own relaxation
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* braid */}
        <div className="rounded-md border border-border/40 bg-card/30 p-2 space-y-2">
          <h3 className="text-[9px] font-display tracking-[0.28em] text-primary/80">
            TORUS BRAID · DENSE ASSOCIATIVE MEMORY
          </h3>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 text-[10px] font-mono">
            <span className="text-muted-foreground">load</span>
            <span className="tabular-nums">
              {braid?.load ?? 0} / {braid?.capacity ?? 0}
            </span>
            <span className="text-muted-foreground">β</span>
            <span className="tabular-nums">{num(braid?.beta, 4)}</span>
            <span className="text-muted-foreground">fold stride</span>
            <span className="tabular-nums">{braid?.stride ?? '—'}</span>
            <span className="text-muted-foreground">last fold</span>
            <span className="tabular-nums">
              {braid && braid.lastFoldTick >= 0 ? `t${braid.lastFoldTick}` : '—'}
            </span>
            <span className="text-muted-foreground">stored / skipped</span>
            <span className="tabular-nums">
              {braid?.stored ?? 0} / {braid?.skipped ?? 0}
            </span>
            <span className="text-muted-foreground">familiarity</span>
            <span
              className={`tabular-nums ${(braid?.familiarity ?? 0) >= 0.618 ? 'text-emerald-400' : 'text-muted-foreground'}`}
            >
              {num(braid?.familiarity, 4)}
            </span>
            <span className="text-muted-foreground">stage</span>
            <span className="tabular-nums">{braid?.lastRecall?.stage ?? 'idle'}</span>
            <span className="text-muted-foreground">sweeps</span>
            <span className="tabular-nums">{braid?.lastRecall?.sweeps ?? 0}</span>
          </div>

          <div className="h-1.5 rounded bg-background/60 overflow-hidden">
            <div
              className="h-full bg-primary/70"
              style={{
                width: `${Math.min(100, ((braid?.load ?? 0) / Math.max(1, braid?.capacity ?? 1)) * 100)}%`,
              }}
            />
          </div>

          <table className="w-full text-[9px] font-mono">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-normal px-1">key</th>
                <th className="text-right font-normal px-1">stored at</th>
                <th className="text-right font-normal px-1">slot</th>
                <th className="text-right font-normal px-1">energy</th>
              </tr>
            </thead>
            <tbody>
              {(braid?.patterns ?? []).map((p) => (
                <tr key={`${p.key}-${p.storedAt}`} className="border-t border-border/20">
                  <td className="px-1 text-foreground truncate max-w-[10rem]">
                    {p.label ?? p.key}
                  </td>
                  <td className="px-1 text-right tabular-nums">t{p.storedAt}</td>
                  <td className="px-1 text-right tabular-nums">{p.index}</td>
                  <td className="px-1 text-right tabular-nums">{num(p.energy, 3)}</td>
                </tr>
              ))}
              {(braid?.patterns.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={4} className="px-1 py-2 text-muted-foreground">
                    nothing folded yet — the braid writes every {braid?.stride ?? 144} ticks
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * Ω-ACTIVATE A6 — live sense channels.
 *
 * Every channel is opt-in and individually revocable. Nothing raw leaves the
 * device: audio becomes mel/MFCC/chroma bands, video becomes a 32×32 cortex
 * feature (decoded inside sensoryFrame.worker) plus a semantic embedding, and
 * inertial data becomes a 14-dim kinematic feature. Only those derived atoms
 * reach the gateway.
 */
const STATE_TONE: Record<string, string> = {
  live: 'text-emerald-400',
  starting: 'text-amber-400',
  error: 'text-rose-400',
  unsupported: 'text-rose-400/70',
  idle: 'text-muted-foreground',
};

function LiveSenses() {
  const senses = useSensoryState();
  const driver = getSensoryDriver();
  const toggle = (id: SensoryChannelId) => {
    void driver.toggle(id);
  };

  return (
    <div className="rounded-md border border-border/40 bg-card/30 p-2 space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[9px] font-display tracking-[0.28em] text-primary/80">
          LIVE SENSES · GATEWAY INTAKE
        </h3>
        <span className="text-[9px] font-mono text-muted-foreground tabular-nums">
          t{senses.tick} · {senses.atoms} atoms · {senses.totalIngests} ingests · unique{' '}
          {num(senses.uniqueRatio, 3)} · arousal{' '}
          {senses.arousal === null ? '—' : num(senses.arousal, 3)}
        </span>
      </div>

      <table className="w-full text-[9px] font-mono">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left font-normal px-1">channel</th>
            <th className="text-right font-normal px-1">nominal</th>
            <th className="text-right font-normal px-1">atoms</th>
            <th className="text-left font-normal px-1 pl-3">state</th>
            <th className="text-right font-normal px-1">consent</th>
          </tr>
        </thead>
        <tbody>
          {senses.channels.map((c) => (
            <tr key={c.id} className="border-t border-border/20">
              <td className="px-1 text-foreground">
                {c.label}
                {c.requires && <span className="text-muted-foreground"> · needs {c.requires}</span>}
              </td>
              <td className="px-1 text-right tabular-nums text-muted-foreground">
                {c.nominalHz} Hz
              </td>
              <td className="px-1 text-right tabular-nums">{c.atoms}</td>
              <td className={`px-1 pl-3 ${STATE_TONE[c.state] ?? 'text-muted-foreground'}`}>
                {c.state}
                {c.error && <span className="text-rose-400/80"> · {c.error}</span>}
              </td>
              <td className="px-1 text-right">
                <button
                  onClick={() => toggle(c.id)}
                  className={`px-2 py-0.5 rounded border text-[9px] font-display tracking-[0.2em] ${
                    c.state === 'live'
                      ? 'border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10'
                      : 'border-border/60 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {c.state === 'live' ? 'STOP' : 'ENABLE'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-[9px] font-mono text-muted-foreground">
        Opt-in per channel. Capture stays on this device — only derived features enter the gateway,
        never raw audio or frames.
      </p>
    </div>
  );
}
