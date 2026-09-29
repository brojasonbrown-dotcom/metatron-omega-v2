/**
 * AudioFrontend — WebAudio → AudioCortex feature vector → SensoryGateway.
 *
 * Per 233 Hz hop:
 *   • read float time-domain (length = fftSize)
 *   • read float freq-domain (dB), convert to linear magnitude
 *   • AudioCortex.process(time, mag) → ~99-dim feature
 *     (mel + MFCC + chroma + scalars incl. onset / LUFS)
 *   • gateway.ingest(feature, 'audio', tick)
 *
 * Opt-in only. On stop() releases tracks & disconnects nodes.
 *
 * NOTE on cadence: AnalyserNode's underlying buffer updates at the audio
 * graph rate (~128-sample quantum). Pulling at 4.3 ms re-reads the same
 * buffer multiple times in some browsers; this is fine — the cortex's
 * difference-based features (flux, onset, K-weighting) self-stabilise.
 * Moving to an AudioWorkletNode for true sample-accurate hops is a
 * planned follow-up (B6).
 */

import type { SensoryGateway } from './SensoryGateway';
import { AudioCortex } from './AudioCortex';
import { publishSolfeggio, publishFlowerBands } from './sensoryFieldBridge';

const FFT_SIZE = 1024;
const ENVELOPE_HZ = 233;
/**
 * Backpressure floor. Under heavy engine load we drop the audio ingest
 * rate to the φ-natural 89 Hz visual tick so the field worker pool keeps
 * headroom. The cortex still sees every analyser read; only `gateway.ingest`
 * is throttled.
 */
const ENVELOPE_HZ_FLOOR = 89;

/**
 * Cross-module hook the engine can poke (FallbackEngine writes
 * window.__metatronComputePressure each tick). Kept as a soft getter so
 * the audio frontend has zero hard dependency on the engine module.
 */
function readEnginePressure(): number {
  if (typeof window === 'undefined') return 0;
  const v = (window as unknown as { __metatronComputePressure?: number }).__metatronComputePressure;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export class AudioFrontend {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private timer: number | null = null;
  private time = new Float32Array(FFT_SIZE);
  private freqDb = new Float32Array(FFT_SIZE / 2);
  private mag = new Float32Array(FFT_SIZE / 2);
  private cortex: AudioCortex | null = null;
  private tickRef = { v: 0 };
  private running = false;
  private lastFeatures: {
    f0: number;
    rms: number;
    flux: number;
    voicing: number;
    onset: number;
    bpm: number;
    lufs: number;
  } = { f0: 0, rms: 0, flux: 0, voicing: 0, onset: 0, bpm: 0, lufs: -120 };

  isRunning(): boolean {
    return this.running;
  }
  setTickRef(ref: { v: number }): void {
    this.tickRef = ref;
  }
  recentFeatures() {
    return this.lastFeatures;
  }
  /** The live microphone stream, shared with the speech teacher (owned here). */
  mediaStream(): MediaStream | null {
    return this.stream;
  }

  async enable(gateway: SensoryGateway): Promise<void> {
    if (this.running) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      throw new Error('audio: getUserMedia unavailable');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const Ctx: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0;
    this.source.connect(this.analyser);
    this.cortex = new AudioCortex(this.ctx.sampleRate, FFT_SIZE);
    this.running = true;

    const fastPeriodMs = 1000 / ENVELOPE_HZ;
    const slowPeriodMs = 1000 / ENVELOPE_HZ_FLOOR;
    const loop = () => {
      if (!this.running || !this.analyser || !this.cortex) return;
      this.analyser.getFloatTimeDomainData(this.time);
      this.analyser.getFloatFrequencyData(this.freqDb);
      // dB → linear magnitude
      for (let i = 0; i < this.mag.length; i++) {
        const db = this.freqDb[i];
        this.mag[i] = db <= -160 ? 0 : Math.pow(10, db / 20);
      }
      const feat = this.cortex.process(this.time, this.mag);
      this.lastFeatures = {
        f0: feat.f0,
        rms: feat.rms,
        flux: feat.flux,
        voicing: feat.voicing,
        onset: feat.onset,
        bpm: feat.bpm,
        lufs: feat.lufs,
      };
      gateway.ingest(feat.feature, 'audio', this.tickRef.v);
      // Publish per-band activity to the field bridge so FallbackEngine
      // can feed F5 / F6 / F7 real spectral structure instead of the
      // scalar-broadcast placeholder. Cheap (reuses same FFT mag).
      publishSolfeggio(this.cortex.solfeggio9(this.mag));
      publishFlowerBands(this.cortex.flowerBands55(this.mag));
      const pressure = readEnginePressure();
      const period = pressure > 0.85 ? slowPeriodMs : fastPeriodMs;
      this.timer = window.setTimeout(loop, period);
    };

    this.timer = window.setTimeout(loop, fastPeriodMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      this.source?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.analyser?.disconnect();
    } catch {
      /* ignore */
    }
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    try {
      this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.source = null;
    this.cortex = null;
  }
}
