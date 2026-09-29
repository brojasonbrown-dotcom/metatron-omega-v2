/**
 * METATRON V13 — Chat settings popover.
 *
 * Gear button that lives in the bottom-right of the chat compose bar. Opens
 * a popover exposing every knob the /api/kimi and /api/chat routes accept:
 *
 *   • Model — full Kimi/Moonshot catalogue + Gemini + GPT alternatives.
 *     Kimi/Moonshot IDs route through the agentic native tool-loop.
 *   • Temperature — 0..1 (Moonshot cap); applied to both paths.
 *   • Max iterations — agentic loop cap (1..16).
 *   • Tool choice — auto | required | none.
 *
 * State lives in `chatSettings.ts` (localStorage-backed) so it survives
 * reloads and stays consistent across ChatTab, KimiTab and any future
 * launcher.
 */
import { useMemo } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { AVAILABLE_MODELS, type ModelOption } from '@/lib/chat/types';
import {
  useChatSettings,
  setChatSettings,
  resetChatSettings,
  type ToolChoice,
} from '@/lib/chat/chatSettings';
import { isAgenticModel } from '@/lib/chat/client';

export function ChatSettingsPopover() {
  const s = useChatSettings();
  const agentic = isAgenticModel(s.model);

  const groups = useMemo(() => {
    const out: Record<string, ModelOption[]> = {};
    for (const m of AVAILABLE_MODELS) (out[m.group] ??= []).push(m);
    return out;
  }, []);

  const selected = AVAILABLE_MODELS.find((m) => m.id === s.model);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="LLM settings — model, temperature, agent loop, tool choice"
          className="px-2 py-1 border border-border rounded text-xs font-mono hover:bg-accent/20 flex items-center gap-1"
        >
          <span aria-hidden>⚙</span>
          <span className="hidden sm:inline text-[10px] text-muted-foreground">
            {selected?.label.replace(/\s*\(.*\)$/, '') ?? s.model}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-[340px] p-0 bg-card/95 backdrop-blur border-border font-mono text-xs"
      >
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <div className="text-[10px] font-display tracking-[0.25em] text-primary">
            ◆ LLM SETTINGS
          </div>
          <button
            onClick={resetChatSettings}
            className="text-[10px] text-muted-foreground hover:text-destructive"
            title="Restore defaults"
          >
            reset
          </button>
        </div>

        <div className="p-3 space-y-3">
          {/* Model */}
          <label className="block">
            <div className="text-[10px] text-muted-foreground mb-1">Model</div>
            <select
              value={s.model}
              onChange={(e) => setChatSettings({ model: e.target.value })}
              className="w-full bg-background border border-border rounded px-2 py-1 text-xs"
            >
              {Object.entries(groups).map(([g, list]) => (
                <optgroup key={g} label={g}>
                  {list.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                      {m.hint ? ` — ${m.hint}` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div className="mt-1 text-[10px] text-muted-foreground">
              path:{' '}
              <span className={agentic ? 'text-primary' : 'text-accent'}>
                {agentic ? 'native tool-loop (/api/kimi)' : 'streaming markers (/api/chat)'}
              </span>
            </div>
          </label>

          {/* Temperature */}
          <div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
              <span>Temperature</span>
              <span className="tabular-nums text-foreground">{s.temperature.toFixed(2)}</span>
            </div>
            <Slider
              value={[s.temperature]}
              min={0}
              max={1}
              step={0.05}
              onValueChange={(v) => setChatSettings({ temperature: v[0] })}
            />
            <div className="text-[9px] text-muted-foreground mt-1">
              0 = deterministic, 1 = exploratory (Moonshot cap)
            </div>
          </div>

          {/* Max iterations */}
          <div className={agentic ? '' : 'opacity-50'}>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
              <span>Max agent iterations</span>
              <span className="tabular-nums text-foreground">{s.maxIterations}</span>
            </div>
            <Slider
              value={[s.maxIterations]}
              min={1}
              max={16}
              step={1}
              onValueChange={(v) => setChatSettings({ maxIterations: v[0] })}
            />
            <div className="text-[9px] text-muted-foreground mt-1">
              Kimi tool-loop cap per turn.
            </div>
          </div>

          {/* Tool choice */}
          <div className={agentic ? '' : 'opacity-50'}>
            <div className="text-[10px] text-muted-foreground mb-1">Tool choice</div>
            <div className="grid grid-cols-3 gap-1">
              {(['auto', 'required', 'none'] as ToolChoice[]).map((c) => {
                const on = s.toolChoice === c;
                return (
                  <button
                    key={c}
                    onClick={() => setChatSettings({ toolChoice: c })}
                    className={`px-2 py-1 rounded border text-[10px] tabular-nums ${
                      on
                        ? 'border-primary text-primary bg-primary/10'
                        : 'border-border text-muted-foreground hover:border-primary/40'
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
            <div className="text-[9px] text-muted-foreground mt-1">
              <b>auto</b>: model decides · <b>required</b>: must call a tool · <b>none</b>: pure
              text.
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
