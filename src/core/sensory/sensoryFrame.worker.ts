/**
 * sensoryFrame.worker — off-main-thread video/screen frame decode + cortex.
 *
 * Main thread captures a frame as an ImageBitmap (zero-copy GPU→GPU via
 * createImageBitmap) and posts it as a Transferable. We draw it into a 32×32
 * OffscreenCanvas, decode RGBA → luminance + mean RGB / Cb / Cr, then run
 * VideoCortex.process() and post the feature back as a Transferable
 * Float32Array. The main thread only does gateway.ingest(...).
 *
 * One worker per source (camera / screen) so the per-source VideoCortex
 * (which holds prev-frame state) is private.
 */
import { VideoCortex } from './VideoCortex';

const W = 32, H = 32;

type InitMsg = { type: 'init'; id: number };
type FrameMsg = { type: 'frame'; id: number; bitmap: ImageBitmap; tick: number };
type StopMsg = { type: 'stop'; id: number };
type Msg = InitMsg | FrameMsg | StopMsg;

const self_ = self as unknown as {
  postMessage(m: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<Msg>) => void) | null;
};

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let lum = new Float32Array(W * H);
let cortex: VideoCortex | null = null;

function ensure(): void {
  if (canvas) return;
  canvas = new OffscreenCanvas(W, H);
  ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  cortex = new VideoCortex();
}

self_.onmessage = (e: MessageEvent<Msg>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    ensure();
    self_.postMessage({ type: 'ready', id: msg.id });
    return;
  }
  if (msg.type === 'stop') {
    canvas = null; ctx = null; cortex = null;
    self_.postMessage({ type: 'stopped', id: msg.id });
    return;
  }
  if (msg.type !== 'frame') return;
  ensure();
  if (!ctx || !cortex) {
    msg.bitmap.close();
    return;
  }
  ctx.drawImage(msg.bitmap, 0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H).data;
  msg.bitmap.close();
  let rSum = 0, gSum = 0, bSum = 0, cbSum = 0, crSum = 0;
  for (let i = 0, j = 0; i < img.length; i += 4, j++) {
    const r = img[i], g = img[i + 1], b = img[i + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    lum[j] = y / 255 - 0.5;
    const cb = (-0.169 * r - 0.331 * g + 0.500 * b) / 255;
    const cr = (0.500 * r - 0.419 * g - 0.081 * b) / 255;
    rSum += r; gSum += g; bSum += b;
    cbSum += cb; crSum += cr;
  }
  const nRGB = W * H * 255;
  const n = W * H;
  const feat = cortex.process(lum, rSum / nRGB, gSum / nRGB, bSum / nRGB, cbSum / n, crSum / n);
  // Copy so the cortex's internal buffer isn't transferred away.
  const out = new Float32Array(feat.feature.length);
  out.set(feat.feature);
  // Also copy the luma buffer so the main thread can render the
  // "what Metatron sees" downsample without re-decoding.
  const lumOut = new Float32Array(W * H);
  lumOut.set(lum);
  self_.postMessage(
    {
      type: 'features',
      id: msg.id,
      tick: msg.tick,
      feature: out.buffer,
      lum: lumOut.buffer,
      motion: feat.motion,
      salience: feat.salience,
      flowU: feat.flowU,
      flowV: feat.flowV,
      sceneCut: feat.sceneCut,
      skin: feat.skin,
    },
    [out.buffer, lumOut.buffer],
  );
};

export {};
