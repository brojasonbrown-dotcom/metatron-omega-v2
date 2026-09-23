/**
 * MULTIMODAL deck — the non-text intake surface.
 *
 *   · OCR ladder status: browser (Tesseract WASM) → gateway (vision model)
 *     → sidecar (self-hosted GPU). Each tier is probed for real; the reason a
 *     tier is unavailable is shown verbatim, never hidden.
 *   · Drop target for CAD/BIM assets (DXF, SVG, OBJ, STL, IFC, STEP) and
 *     raster drawings. Geometry is measured on-device by the geometry core and
 *     bound to the corpus as a descriptor; images go down the OCR ladder.
 *
 * Nothing here fabricates content: a file that cannot be parsed or read is
 * reported as a failure with the measured reason.
 */
import { useCallback, useEffect, useState } from "react";
import {
  probeTiers, runOcr, gatewayVision, getSidecarUrl, setSidecarUrl,
  getPreferredOrder, setPreferredOrder, type OcrTierState, type OcrTierId,
} from "@/core/ocr/ocrLadder";
import { describeAsset } from "@/core/geometry";
import { getKnowledgeRuntime } from "../knowledgeRuntime";

interface Row {
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
}

const IMAGE_RE = /\.(png|jpe?g|webp|bmp|tiff?|gif)$/i;

export default function MultimodalDeck() {
  const rt = getKnowledgeRuntime();
  const [tiers, setTiers] = useState<OcrTierState[]>([]);
  const [probing, setProbing] = useState(false);
  const [sidecar, setSide] = useState(getSidecarUrl());
  const [order, setOrder] = useState<OcrTierId[]>(getPreferredOrder());
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState("");
  const [field, setField] = useState(rt.getStats().field || "cad");
  const [caption, setCaption] = useState(true);

  const probe = useCallback(async () => {
    setProbing(true);
    try { setTiers(await probeTiers()); } finally { setProbing(false); }
  }, []);

  useEffect(() => { void probe(); }, [probe]);

  const push = (r: Row) => setRows((p) => [r, ...p].slice(0, 40));

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      const t0 = Date.now();
      setBusy(file.name);
      try {
        if (IMAGE_RE.test(file.name) || file.type.startsWith("image/")) {
          const dataUrl = await new Promise<string>((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(String(fr.result));
            fr.onerror = () => rej(new Error("file read failed"));
            fr.readAsDataURL(file);
          });
          const ocr = await runOcr(dataUrl, order);
          let text = ocr.ok ? ocr.text : "";
          let detail = ocr.ok ? `${ocr.chars} chars via ${ocr.tier}` : (ocr.reason ?? "no tier read it");
          if (caption) {
            const cap = await gatewayVision(dataUrl, "caption", file.name);
            if (cap.ok) {
              // Model-derived label, kept explicitly separate from the transcription.
              text = `${text ? text + "\n\n" : ""}[visual description · model-derived]\n${cap.text}`;
              detail += ` · +caption ${cap.chars}c`;
            }
          }
          if (!text.trim()) { push({ name: file.name, ok: false, detail, ms: Date.now() - t0 }); continue; }
          const out = rt.ingestLocal({
            field: field.trim() || "cad", url: `local:image/${file.name}`,
            title: file.name, source: `ocr:${ocr.tier ?? "caption"}`, text,
            modality: "image", trust: 0.7,
          });
          push({ name: file.name, ok: true, detail: `${out.newChunks}/${out.chunks} chunks · ${detail}`, ms: Date.now() - t0 });
          continue;
        }

        const raw = await file.text();
        const asset = describeAsset(raw, file.name, file.type, file.name);
        if (!asset.ok || !asset.text || !asset.descriptor) {
          push({ name: file.name, ok: false, detail: asset.reason ?? "unrecognised", ms: Date.now() - t0 });
          continue;
        }
        const out = rt.ingestLocal({
          field: field.trim() || "cad", url: `local:${asset.kind}/${file.name}`,
          title: file.name, source: "geometry", text: asset.text,
          descriptor: asset.descriptor.vector, modality: "geometry", trust: 1,
        });
        push({
          name: file.name, ok: true,
          detail: `${asset.kind} · ${asset.descriptor.segments} seg · ${asset.descriptor.topology.loops} loops · ${out.newChunks}/${out.chunks} chunks`,
          ms: Date.now() - t0,
        });
      } catch (e) {
        push({ name: file.name, ok: false, detail: String((e as Error)?.message ?? e).slice(0, 180), ms: Date.now() - t0 });
      } finally {
        setBusy("");
      }
    }
  }, [rt, field, order, caption]);

  return (
    <div className="h-full overflow-auto p-2 space-y-2">
      {/* OCR ladder */}
      <div className="rounded-md border border-border/40 bg-background/40">
        <div className="px-2.5 py-1.5 border-b border-border/30 flex items-center justify-between">
          <span className="text-[9px] tracking-[0.28em] text-muted-foreground">OCR LADDER</span>
          <button onClick={() => void probe()} disabled={probing}
            className="px-2 py-0.5 rounded border border-border/60 text-[9px] font-display tracking-[0.2em] hover:bg-muted/30 disabled:opacity-40">
            {probing ? "PROBING…" : "PROBE TIERS"}
          </button>
        </div>
        <div className="divide-y divide-border/20">
          {tiers.map((t) => (
            <div key={t.id} className="px-2.5 py-1.5 flex items-center gap-2 text-[10px] font-mono">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.available ? "bg-primary" : "bg-destructive/70"}`} />
              <span className="w-52 shrink-0">{t.label}</span>
              <span className="flex-1 text-muted-foreground truncate">{t.detail}</span>
              <span className="text-muted-foreground tabular-nums">{t.ms}ms</span>
            </div>
          ))}
          {tiers.length === 0 && <div className="px-2.5 py-3 text-[10px] text-muted-foreground font-mono">not probed yet</div>}
        </div>
        <div className="px-2.5 py-2 border-t border-border/30 space-y-2">
          <div className="flex gap-2 items-center">
            <span className="text-[9px] tracking-[0.2em] text-muted-foreground w-20">SIDECAR</span>
            <input
              value={sidecar}
              onChange={(e) => setSide(e.target.value)}
              onBlur={() => { setSidecarUrl(sidecar); void probe(); }}
              placeholder="http://localhost:8000  (self-hosted OCR: POST /ocr, GET /health)"
              className="flex-1 bg-background/60 border border-border/50 rounded px-2 py-1 text-[10px] font-mono outline-none focus:border-primary/60"
            />
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-[9px] tracking-[0.2em] text-muted-foreground w-20">ORDER</span>
            {(["sidecar", "browser", "gateway"] as OcrTierId[]).map((id) => {
              const idx = order.indexOf(id);
              return (
                <button key={id}
                  onClick={() => {
                    const next = [id, ...order.filter((o) => o !== id)];
                    setOrder(next); setPreferredOrder(next);
                  }}
                  className={`px-2 py-0.5 rounded border text-[9px] font-display tracking-[0.18em] ${
                    idx === 0 ? "border-primary/60 text-primary" : "border-border/50 text-muted-foreground hover:bg-muted/30"
                  }`}>
                  {idx + 1}·{id.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Ingest */}
      <div className="rounded-md border border-border/40 bg-background/40 p-2.5 space-y-2">
        <div className="flex gap-2 items-center">
          <span className="text-[9px] tracking-[0.2em] text-muted-foreground w-20">FIELD</span>
          <input value={field} onChange={(e) => setField(e.target.value)}
            className="flex-1 bg-background/60 border border-border/50 rounded px-2 py-1 text-[10px] font-mono outline-none focus:border-primary/60" />
          <label className="flex items-center gap-1.5 text-[9px] tracking-[0.18em] text-muted-foreground">
            <input type="checkbox" checked={caption} onChange={(e) => setCaption(e.target.checked)} className="accent-primary" />
            VISION CAPTION
          </label>
        </div>
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void handleFiles(e.dataTransfer.files); }}
          className="block rounded border border-dashed border-border/60 px-3 py-6 text-center cursor-pointer hover:border-primary/60 transition-colors"
        >
          <input type="file" multiple className="hidden"
            accept=".dxf,.svg,.obj,.stl,.ifc,.step,.stp,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff"
            onChange={(e) => void handleFiles(e.target.files)} />
          <div className="text-[10px] font-mono text-muted-foreground">
            {busy ? `reading ${busy}…` : "drop CAD / BIM / drawing files here — DXF · SVG · OBJ · STL · IFC · STEP · raster images"}
          </div>
          <div className="text-[9px] text-muted-foreground/70 mt-1">
            geometry is measured on-device and bound to the corpus as a descriptor; images go down the OCR ladder
          </div>
        </label>
      </div>

      {/* Log */}
      <div className="rounded-md border border-border/40 bg-background/40">
        <div className="px-2.5 py-1.5 border-b border-border/30 text-[9px] tracking-[0.28em] text-muted-foreground">
          INGEST LOG
        </div>
        <div className="max-h-56 overflow-auto divide-y divide-border/20">
          {rows.length === 0 && <div className="px-2.5 py-3 text-[10px] text-muted-foreground font-mono">nothing ingested yet</div>}
          {rows.map((r, i) => (
            <div key={`${r.name}-${i}`} className="px-2.5 py-1 flex gap-2 text-[9px] font-mono">
              <span className={`w-16 shrink-0 ${r.ok ? "text-primary" : "text-destructive"}`}>{r.ok ? "STORED" : "FAILED"}</span>
              <span className="w-44 shrink-0 truncate">{r.name}</span>
              <span className="flex-1 truncate text-muted-foreground">{r.detail}</span>
              <span className="text-muted-foreground tabular-nums">{r.ms}ms</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
