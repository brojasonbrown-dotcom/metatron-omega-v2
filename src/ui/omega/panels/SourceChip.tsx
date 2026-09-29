/**
 * SourceChip — presentational SRC:<label> tag used across IO panels.
 * Ported verbatim from reference project; colors rewritten to our
 * oklch design tokens (no `hsl(var(--...))` wrapper — our tokens are
 * already-resolved oklch values).
 */

export type SourceTone = 'ok' | 'idle' | 'warn' | 'error';

interface Props {
  state: string;
  tone?: SourceTone;
  prefix?: string;
  title?: string;
}

const toneToColor: Record<SourceTone, string> = {
  ok: 'var(--primary)',
  idle: 'var(--muted-foreground)',
  warn: 'var(--accent)',
  error: 'var(--destructive)',
};

export default function SourceChip({ state, tone = 'idle', prefix = 'SRC', title }: Props) {
  return (
    <span
      className="text-[8px] font-display tracking-[0.15em] tabular-nums"
      style={{ color: toneToColor[tone] }}
      title={title}
    >
      {prefix}: {state}
    </span>
  );
}
