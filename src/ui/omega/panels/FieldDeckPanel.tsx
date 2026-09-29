/**
 * FIELD deck — detail readouts for the rung shown on the main FieldStage.
 *
 * The large torus projection and the pull loop now live in FieldStage (always
 * mounted), so this deck neither owns state nor requests frames: it reads the
 * shared rung selection and the frame the stage already pulled. That keeps a
 * single puller and makes the selection survive tab switches.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useOmegaState } from '../useOmegaRuntime';
import { useFieldView } from '../fieldViewStore';

const num = (x: number, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : '—');

export default function FieldDeckPanel() {
  const s = useOmegaState();
  const { rank } = useFieldView();
  const strip = useRef<HTMLCanvasElement | null>(null);

  const frame = s.frame && s.frame.rank === rank ? s.frame : null;

  const drawStrip = useCallback(() => {
    const c = strip.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (w === 0 || h === 0) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!frame || frame.amp.length === 0) return;
    const peak = frame.peak > 0 ? frame.peak : 1;
    const n = frame.amp.length;
    for (let i = 0; i < n; i++) {
      const x = (i / n) * w;
      const a = frame.amp[i] / peak;
      const hue = ((frame.phase[i] + Math.PI) / (2 * Math.PI)) * 360;
      g.fillStyle = `hsl(${hue.toFixed(1)}, 80%, 55%)`;
      g.fillRect(x, h - a * h, Math.max(1, w / n), a * h);
    }
  }, [frame]);

  useEffect(() => {
    drawStrip();
  }, [drawStrip]);

  const sig = frame?.signature ?? [];
  const sigMax = useMemo(() => Math.max(1e-12, ...sig), [sig]);

  return (
    <div className="h-full overflow-auto p-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/40 bg-background/40 px-2.5 py-2 text-[9px] font-mono text-muted-foreground">
        <span className="font-display tracking-[0.2em]">RUNG {rank}</span>
        <span>·</span>
        <span>rung and pull rate are set on the FIELD STAGE above</span>
        <div className="flex-1" />
        <span>
          {frame
            ? `tick ${frame.tick} · ${frame.u.length}/${frame.nodes} nodes (÷${frame.stride}) · digest ${frame.digest}`
            : s.snapshot
              ? 'waiting for frame…'
              : 'no engine built'}
        </span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
        <div className="rounded-md border border-border/40 bg-card/30 p-2">
          <h3 className="text-[9px] font-display tracking-[0.28em] text-primary/80 mb-1">
            UNWRAPPED |z| BY NODE INDEX
          </h3>
          <canvas ref={strip} className="w-full h-[140px]" />
        </div>

        <div className="rounded-md border border-border/40 bg-card/30 p-2">
          <h3 className="text-[9px] font-display tracking-[0.28em] text-primary/80 mb-1">
            φ-WEIGHTED SIGNATURE ({sig.length} MODES)
          </h3>
          <div className="flex items-end gap-[3px] h-[140px]">
            {sig.map((x, i) => (
              <div
                key={i}
                title={`mode ${i}: ${x.toExponential(3)}`}
                className="flex-1 bg-primary/60 rounded-sm"
                style={{ height: `${Math.max(1, (x / sigMax) * 100)}%` }}
              />
            ))}
            {sig.length === 0 && (
              <span className="text-[10px] font-mono text-muted-foreground">—</span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border/40 bg-card/30 p-2 grid grid-cols-2 md:grid-cols-4 gap-x-4 text-[10px] font-mono">
        <span className="text-muted-foreground">peak |z|</span>
        <span className="text-right tabular-nums">{frame ? frame.peak.toExponential(4) : '—'}</span>
        <span className="text-muted-foreground">mean |z|</span>
        <span className="text-right tabular-nums">{frame ? frame.mean.toExponential(4) : '—'}</span>
        <span className="text-muted-foreground">coherence</span>
        <span className="text-right tabular-nums">
          {s.snapshot?.rungs[rank] ? num(s.snapshot.rungs[rank].coherence, 6) : '—'}
        </span>
        <span className="text-muted-foreground">regime</span>
        <span className="text-right">{s.snapshot?.rungs[rank]?.regime ?? '—'}</span>
        <span className="text-muted-foreground">clamped nodes</span>
        <span className="text-right tabular-nums">{s.snapshot?.rungs[rank]?.clamped ?? '—'}</span>
        <span className="text-muted-foreground">closure γ</span>
        <span className="text-right tabular-nums">
          {s.snapshot?.rungs[rank] ? num(s.snapshot.rungs[rank].closureQuality, 6) : '—'}
        </span>
        <span className="text-muted-foreground">closure defect</span>
        <span className="text-right tabular-nums">
          {s.snapshot?.rungs[rank] ? num(s.snapshot.rungs[rank].closureDefect, 6) : '—'}
        </span>
        <span className="text-muted-foreground">corridor skill</span>
        <span className="text-right tabular-nums">
          {s.snapshot?.rungs[rank] ? num(s.snapshot.rungs[rank].skill, 6) : '—'}
        </span>
        <span className="text-muted-foreground">obstruction (flux)</span>
        <span className="text-right tabular-nums">
          {s.snapshot?.rungs[rank] ? num(s.snapshot.rungs[rank].obstruction, 6) : '—'}
        </span>
      </div>
    </div>
  );
}
