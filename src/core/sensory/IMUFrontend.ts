/**
 * IMUFrontend — DeviceMotion → IMU feature at ~377 Hz (F14).
 *
 * Per hop produces a 14-dim feature:
 *   ax/ay/az (·0.1), gx/gy/gz (·0.01), |a|, |g|, jerk*3, tilt,
 *   step (0/1 from peak-pick on |a|), cadence (Hz EMA).
 *
 * The step detector (D8) is a high-pass + adaptive-threshold peak picker
 * on the magnitude of linear acceleration. Cadence is the inverse of the
 * EMA of inter-step intervals.
 *
 * Opt-in only. iOS Safari requires explicit permission grant.
 */

import type { SensoryGateway } from './SensoryGateway';

const FEATURE_HZ = 377;
const D = 14;
const STEP_HP = 0.85;
const STEP_THRESH_MIN = 0.06;
const STEP_REFRACTORY_MS = 250;

export class IMUFrontend {
  private running = false;
  private timer: number | null = null;
  private feature = new Float32Array(D);
  private prevAcc: [number, number, number] = [0, 0, 0];
  private latest = { ax: 0, ay: 0, az: 0, gx: 0, gy: 0, gz: 0 };
  private tickRef = { v: 0 };
  private handler: ((e: DeviceMotionEvent) => void) | null = null;
  // step detector state
  private aMagPrev = 0;
  private aMagHp = 0;
  private aMagHpPrev = 0;
  private stepThresh = STEP_THRESH_MIN;
  private lastStepTs = 0;
  private cadenceEMA = 0;
  private lastIntervalMs = 0;

  isRunning() { return this.running; }
  setTickRef(ref: { v: number }) { this.tickRef = ref; }
  recentFeatures() { return { cadence: this.cadenceEMA, threshold: this.stepThresh }; }

  async enable(gateway: SensoryGateway): Promise<void> {
    if (this.running) return;
    if (typeof window === 'undefined' || typeof DeviceMotionEvent === 'undefined') {
      throw new Error('imu: DeviceMotionEvent unavailable');
    }
    const reqPerm = (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    if (typeof reqPerm === 'function') {
      const res = await reqPerm();
      if (res !== 'granted') throw new Error('imu: permission denied');
    }
    this.handler = (e: DeviceMotionEvent) => {
      const a = e.acceleration ?? e.accelerationIncludingGravity;
      const g = e.rotationRate;
      if (a) { this.latest.ax = a.x ?? 0; this.latest.ay = a.y ?? 0; this.latest.az = a.z ?? 0; }
      if (g) { this.latest.gx = g.alpha ?? 0; this.latest.gy = g.beta ?? 0; this.latest.gz = g.gamma ?? 0; }
    };
    window.addEventListener('devicemotion', this.handler);
    this.running = true;

    const periodMs = 1000 / FEATURE_HZ;
    const loop = () => {
      if (!this.running) return;
      const { ax, ay, az, gx, gy, gz } = this.latest;
      const aMag = Math.hypot(ax, ay, az);
      const gMag = Math.hypot(gx, gy, gz);
      const jx = ax - this.prevAcc[0], jy = ay - this.prevAcc[1], jz = az - this.prevAcc[2];
      this.prevAcc = [ax, ay, az];
      const tilt = Math.atan2(Math.hypot(ax, ay), az || 1e-9);

      // step detector (1-pole high-pass on |a|, then adaptive threshold peak-pick)
      this.aMagHp = STEP_HP * (this.aMagHp + aMag - this.aMagPrev);
      this.aMagPrev = aMag;
      let step = 0;
      const nowMs = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      // adaptive threshold: 0.6 × EMA of recent |hp|
      this.stepThresh = 0.997 * this.stepThresh + 0.003 * Math.max(STEP_THRESH_MIN, Math.abs(this.aMagHp) * 0.6);
      if (this.aMagHpPrev > this.aMagHp &&            // local max (previous was the peak)
          this.aMagHpPrev > this.stepThresh &&
          (nowMs - this.lastStepTs) > STEP_REFRACTORY_MS) {
        step = 1;
        const intervalMs = nowMs - this.lastStepTs;
        if (this.lastStepTs > 0 && intervalMs < 2000) {
          this.lastIntervalMs = intervalMs;
          const inst = 1000 / intervalMs;
          this.cadenceEMA = this.cadenceEMA === 0 ? inst : 0.7 * this.cadenceEMA + 0.3 * inst;
        }
        this.lastStepTs = nowMs;
      }
      this.aMagHpPrev = this.aMagHp;
      void this.lastIntervalMs;

      const f = this.feature;
      f[0] = ax * 0.1; f[1] = ay * 0.1; f[2] = az * 0.1;
      f[3] = gx * 0.01; f[4] = gy * 0.01; f[5] = gz * 0.01;
      f[6] = Math.min(1, aMag * 0.05); f[7] = Math.min(1, gMag * 0.005);
      f[8] = jx * 0.1; f[9] = jy * 0.1; f[10] = jz * 0.1;
      f[11] = tilt / Math.PI;
      f[12] = step;
      f[13] = Math.min(1, this.cadenceEMA / 4); // ~4 Hz = sprint
      gateway.ingest(f, 'imu', this.tickRef.v);
      this.timer = window.setTimeout(loop, periodMs);
    };
    this.timer = window.setTimeout(loop, periodMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.handler) { window.removeEventListener('devicemotion', this.handler); this.handler = null; }
  }
}
