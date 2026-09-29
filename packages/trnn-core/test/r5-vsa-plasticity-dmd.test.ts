/**
 * R5 — Ω-REAL P5 certification: FHRR algebra + cleanup memory, memristive /
 * Oja plasticity, DMD trajectory prediction.
 *
 * These are the tests that would catch a plausible-looking but wrong
 * implementation: exact invertibility of bind, capacity of bundling against
 * the chance floor, the fan-in ceiling, Oja's convergence to the principal
 * eigenvector, the memristor's hard rails and hysteresis, and DMD recovering a
 * KNOWN frequency and decay rate from a synthetic trajectory.
 */
import { describe, it, expect } from 'vitest';
import {
  randomHv,
  identityHv,
  bind,
  unbind,
  permute,
  bundle,
  similarity,
  chanceSigma,
  conjugateHv,
  phiWeights,
  CleanupMemory,
  CLEANUP_FAN_IN,
  encodeRecord,
  decodeRole,
  encodeSequence,
  decodePosition,
  wrapPhase,
  angularDistance,
  ojaStep,
  sangerStep,
  memristiveStep,
  joglekarWindow,
  memristiveVector,
  BcmThreshold,
  fitDmd,
  MIN_SNAPSHOTS,
  generalEigenvalues,
} from '../src/index';

const D = 1024;
const hv = (name: string) => randomHv(D, `r5:${name}`);

describe('R5.1 FHRR algebra', () => {
  it('random hypervectors are near-orthogonal within the chance floor', () => {
    const s = similarity(hv('a'), hv('b'));
    expect(Math.abs(s)).toBeLessThan(6 * chanceSigma(D));
  });

  it('bind is exactly invertible', () => {
    const a = hv('a'),
      b = hv('b');
    const rec = unbind(bind(a, b), a);
    for (let i = 0; i < D; i++) expect(Math.abs(wrapPhase(rec[i] - b[i]))).toBeLessThan(1e-12);
    expect(similarity(rec, b)).toBeCloseTo(1, 12);
  });

  it('bind is commutative and associative', () => {
    const a = hv('a'),
      b = hv('b'),
      c = hv('c');
    expect(similarity(bind(a, b), bind(b, a))).toBeCloseTo(1, 12);
    expect(similarity(bind(bind(a, b), c), bind(a, bind(b, c)))).toBeCloseTo(1, 12);
  });

  it('identity and conjugate behave as a group', () => {
    const a = hv('a');
    expect(similarity(bind(a, identityHv(D)), a)).toBeCloseTo(1, 12);
    expect(similarity(bind(a, conjugateHv(a)), identityHv(D))).toBeCloseTo(1, 12);
  });

  it('bind randomises: the product resembles neither factor', () => {
    const a = hv('a'),
      b = hv('b');
    const p = bind(a, b);
    expect(Math.abs(similarity(p, a))).toBeLessThan(6 * chanceSigma(D));
    expect(Math.abs(similarity(p, b))).toBeLessThan(6 * chanceSigma(D));
  });

  it('permute is invertible and dissimilar to its input', () => {
    const a = hv('a');
    expect(similarity(permute(permute(a, 3), -3), a)).toBeCloseTo(1, 12);
    expect(Math.abs(similarity(permute(a, 1), a))).toBeLessThan(6 * chanceSigma(D));
  });

  it('bind distributes over bundle', () => {
    const a = hv('a'),
      b = hv('b'),
      k = hv('k');
    const lhs = bind(bundle([a, b]).hv, k);
    const rhs = bundle([bind(a, k), bind(b, k)]).hv;
    expect(similarity(lhs, rhs)).toBeGreaterThan(0.999);
  });
});

describe('R5.2 bundling capacity and agreement', () => {
  it('a bundled member is recoverable well above chance, and capacity decays as 1/√m', () => {
    const sims: number[] = [];
    for (const m of [2, 8, 32]) {
      const vs = Array.from({ length: m }, (_, i) => hv(`m${m}:${i}`));
      const b = bundle(vs).hv;
      sims.push(similarity(b, vs[0]));
      expect(similarity(b, vs[0])).toBeGreaterThan(6 * chanceSigma(D));
    }
    expect(sims[0]).toBeGreaterThan(sims[1]);
    expect(sims[1]).toBeGreaterThan(sims[2]);
    // 1/√m law: sim(m) ≈ (π/4)/√m for FHRR phases — check the ratio, not the constant
    expect(sims[0] / sims[2]).toBeGreaterThan(2.5);
    expect(sims[0] / sims[2]).toBeLessThan(5.5);
  });

  it('a non-member stays at chance', () => {
    const vs = Array.from({ length: 8 }, (_, i) => hv(`nm:${i}`));
    expect(Math.abs(similarity(bundle(vs).hv, hv('outsider')))).toBeLessThan(6 * chanceSigma(D));
  });

  it('agreement is 1 for identical inputs and near 1/√m for random ones', () => {
    const a = hv('a');
    expect(bundle([a, a, a]).meanAgreement).toBeCloseTo(1, 12);
    const rnd = bundle(Array.from({ length: 16 }, (_, i) => hv(`ag:${i}`))).meanAgreement;
    expect(rnd).toBeGreaterThan(0.1);
    expect(rnd).toBeLessThan(0.45);
  });

  it('φ weights bias the bundle toward the head of the list', () => {
    const vs = Array.from({ length: 6 }, (_, i) => hv(`w:${i}`));
    const b = bundle(vs, phiWeights(6)).hv;
    expect(similarity(b, vs[0])).toBeGreaterThan(similarity(b, vs[5]));
  });

  it('an empty bundle abstains instead of returning a zero vector score', () => {
    expect(bundle([]).meanAgreement).toBeNaN();
  });
});

describe('R5.3 cleanup memory', () => {
  const build = () => {
    const cm = new CleanupMemory(D);
    for (const label of ['alpha', 'beta', 'gamma']) cm.add(label, hv(label));
    return cm;
  };

  it('recovers a clean prototype', () => {
    const hit = build().query(hv('beta'));
    expect(hit?.label).toBe('beta');
    expect(hit!.z).toBeGreaterThan(20);
  });

  it('recovers a prototype under heavy phase noise', () => {
    const cm = build();
    const base = hv('gamma');
    const noise = hv('noise');
    const noisy = new Float64Array(D);
    for (let i = 0; i < D; i++) noisy[i] = wrapPhase(base[i] + 0.6 * noise[i]);
    expect(cm.query(noisy)?.label).toBe('gamma');
  });

  it('ABSTAINS on an unrelated cue rather than returning its nearest prototype', () => {
    expect(build().query(hv('unrelated-cue'))).toBeNull();
  });

  it('abstains when two prototypes are effectively tied', () => {
    const cm = new CleanupMemory(D);
    const a = hv('twin');
    cm.add('one', a);
    cm.add('two', a);
    expect(cm.query(a)).toBeNull(); // margin is zero → no confident answer
  });

  it('an empty memory abstains', () => {
    expect(new CleanupMemory(D).query(hv('a'))).toBeNull();
  });

  it('averaging exemplars denoises the prototype', () => {
    const truth = hv('truth');
    const cm = new CleanupMemory(D);
    for (let k = 0; k < 40; k++) {
      const n = randomHv(D, `noise:${k}`);
      const s = new Float64Array(D);
      for (let i = 0; i < D; i++) s[i] = wrapPhase(truth[i] + 0.5 * n[i]);
      cm.add('truth', s);
    }
    const oneShot = similarity(
      truth,
      (() => {
        const n = randomHv(D, 'noise:0');
        const s = new Float64Array(D);
        for (let i = 0; i < D; i++) s[i] = wrapPhase(truth[i] + 0.5 * n[i]);
        return s;
      })(),
    );
    expect(similarity(truth, cm.prototype('truth')!)).toBeGreaterThan(oneShot);
  });

  it('enforces the fan-in ceiling and keeps tracking instead of freezing', () => {
    const cm = new CleanupMemory(D, CLEANUP_FAN_IN);
    const first = hv('first');
    for (let k = 0; k < CLEANUP_FAN_IN; k++) cm.add('p', first);
    expect(cm.stats('p')!.saturated).toBe(true);
    expect(cm.stats('p')!.fanIn).toBe(CLEANUP_FAN_IN);
    const second = hv('second');
    for (let k = 0; k < 300; k++) cm.add('p', second);
    expect(cm.stats('p')!.fanIn).toBeLessThanOrEqual(CLEANUP_FAN_IN);
    // the prototype migrated to the new evidence rather than staying pinned
    expect(similarity(cm.prototype('p')!, second)).toBeGreaterThan(
      similarity(cm.prototype('p')!, first),
    );
  });

  it('reports unknown labels as null, not as an empty prototype', () => {
    expect(build().prototype('nope')).toBeNull();
    expect(build().stats('nope')).toBeNull();
  });
});

describe('R5.4 structured records and sequences', () => {
  it('decodes role→filler through cleanup', () => {
    const roles = { colour: hv('role:colour'), shape: hv('role:shape') };
    const fillers = { red: hv('f:red'), blue: hv('f:blue'), disc: hv('f:disc') };
    const cm = new CleanupMemory(D);
    for (const [k, v] of Object.entries(fillers)) cm.add(k, v);
    const rec = encodeRecord([
      [roles.colour, fillers.red],
      [roles.shape, fillers.disc],
    ]).hv;
    expect(cm.query(decodeRole(rec, roles.colour))?.label).toBe('red');
    expect(cm.query(decodeRole(rec, roles.shape))?.label).toBe('disc');
  });

  it('an absent role decodes to noise and the cleanup abstains', () => {
    const cm = new CleanupMemory(D);
    cm.add('red', hv('f:red'));
    const rec = encodeRecord([[hv('role:colour'), hv('f:red')]]).hv;
    expect(cm.query(decodeRole(rec, hv('role:absent')))).toBeNull();
  });

  it('sequence encoding preserves order', () => {
    const items = ['a', 'b', 'c'].map((s) => hv(`seq:${s}`));
    const cm = new CleanupMemory(D);
    items.forEach((v, i) => cm.add(`i${i}`, v));
    const seq = encodeSequence(items).hv;
    for (let i = 0; i < items.length; i++) {
      expect(cm.query(decodePosition(seq, i))?.label).toBe(`i${i}`);
    }
  });

  it('a reordered sequence is NOT the same vector (order is really carried)', () => {
    const items = ['a', 'b', 'c'].map((s) => hv(`ord:${s}`));
    const fwd = encodeSequence(items).hv;
    const rev = encodeSequence([...items].reverse()).hv;
    expect(Math.abs(similarity(fwd, rev))).toBeLessThan(0.5);
    expect(angularDistance(fwd, rev)).toBeGreaterThan(0.5);
  });
});

describe('R5.5 Oja / Sanger plasticity', () => {
  /** Anisotropic 2-D source: principal axis along (1, 0.5)/‖·‖. */
  const sample = (k: number): Float64Array => {
    const t = k * 0.7;
    const a = 3 * Math.sin(t);
    const b = 0.3 * Math.cos(1.7 * t);
    return Float64Array.from([a + 0.5 * b, 0.5 * a - b]);
  };

  it('converges to the principal eigenvector with unit norm', () => {
    const w = Float64Array.from([0.3, -0.9]);
    let last = { y: 0, norm: 0, drift: 1 };
    for (let k = 0; k < 20000; k++) last = ojaStep(w, sample(k), 0.002);
    expect(last.norm).toBeCloseTo(1, 2);
    const align = Math.abs(w[0] * 0.8944 + w[1] * 0.4472); // (1,0.5) normalised
    expect(align).toBeGreaterThan(0.95);
  });

  it('is self-normalising: an over-long start shrinks, a short one grows', () => {
    const big = Float64Array.from([5, 5]);
    const small = Float64Array.from([0.01, 0.01]);
    for (let k = 0; k < 5000; k++) {
      ojaStep(big, sample(k), 0.001);
      ojaStep(small, sample(k), 0.001);
    }
    const n = (v: Float64Array) => Math.hypot(v[0], v[1]);
    expect(n(big)).toBeLessThan(5);
    expect(n(small)).toBeGreaterThan(0.02);
  });

  it('drift decays as the rule converges (it is learning, not oscillating)', () => {
    const w = Float64Array.from([0.3, -0.9]);
    let early = 0,
      late = 0;
    for (let k = 0; k < 3000; k++) early += ojaStep(w, sample(k), 0.001).drift;
    for (let k = 3000; k < 6000; k++) late += ojaStep(w, sample(k), 0.001).drift;
    expect(late).toBeLessThan(early);
  });

  it('Sanger extracts orthogonal components ordered by variance', () => {
    const k = 2,
      d = 2;
    const W = Float64Array.from([0.6, 0.1, -0.2, 0.7]);
    for (let s = 0; s < 20000; s++) sangerStep(W, k, d, sample(s), 0.0015);
    const dot = W[0] * W[2] + W[1] * W[3];
    expect(Math.abs(dot)).toBeLessThan(0.1);
    expect(Math.hypot(W[0], W[1])).toBeCloseTo(1, 1);
  });
});

describe('R5.6 memristive plasticity', () => {
  const P = { etaSet: 0.05 };

  it('the window vanishes at both rails and peaks in the middle', () => {
    expect(joglekarWindow(0)).toBe(0);
    expect(joglekarWindow(1)).toBe(0);
    expect(joglekarWindow(0.5)).toBeCloseTo(1, 12);
  });

  it('the state can never leave its bounds, however hard it is driven', () => {
    let w = 0.5;
    for (let i = 0; i < 5000; i++) w = memristiveStep(w, 10, P);
    expect(w).toBeLessThanOrEqual(1);
    expect(w).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 5000; i++) w = memristiveStep(w, -10, P);
    expect(w).toBeGreaterThanOrEqual(0);
  });

  it('a learned synapse resists a single contrary event (rail sticking)', () => {
    let w = 0.5;
    for (let i = 0; i < 400; i++) w = memristiveStep(w, 1, P);
    const learned = w;
    const after = memristiveStep(w, -1, P);
    expect(learned).toBeGreaterThan(0.95);
    expect(learned - after).toBeLessThan(0.01);
  });

  it('forgetting is slower than learning by the φ⁻¹ asymmetry', () => {
    const up = memristiveStep(0.5, 1, P) - 0.5;
    const down = 0.5 - memristiveStep(0.5, -1, P);
    expect(up).toBeGreaterThan(down);
    expect(down / up).toBeCloseTo(0.618, 2);
  });

  it('is hysteretic: the same net drive in a different order lands elsewhere', () => {
    const seqA = [1, 1, -1, -1, 1, -1];
    const seqB = [1, -1, 1, -1, 1, -1];
    let a = 0.5,
      b = 0.5;
    for (const s of seqA) a = memristiveStep(a, s, P);
    for (const s of seqB) b = memristiveStep(b, s, P);
    expect(Math.abs(a - b)).toBeGreaterThan(1e-6);
  });

  it('a non-finite state or drive is left alone rather than poisoning the array', () => {
    expect(memristiveStep(0.4, NaN, P)).toBe(0.4);
    expect(Number.isNaN(memristiveStep(NaN, 1, P))).toBe(true);
  });

  it('vector form reports the drift it actually applied', () => {
    const w = Float64Array.from([0.5, 0.5, 0.5]);
    const drift = memristiveVector(w, [1, 0, -1], P);
    expect(drift).toBeGreaterThan(0);
    expect(w[1]).toBe(0.5);
    expect(w[0]).toBeGreaterThan(0.5);
    expect(w[2]).toBeLessThan(0.5);
  });

  it('BCM threshold slides with activity and flips the sign of the drive', () => {
    const bcm = new BcmThreshold(20);
    for (let i = 0; i < 200; i++) bcm.observe(1);
    expect(bcm.value).toBeCloseTo(1, 1);
    expect(bcm.observe(0.2)).toBeLessThan(0); // below threshold → depression
    expect(bcm.observe(5)).toBeGreaterThan(0); // above threshold → potentiation
  });
});

describe('R5.7 DMD', () => {
  /** Two rotating modes: 0.5 Hz sustained, 1.5 Hz decaying, sampled at 20 Hz. */
  const dt = 0.05;
  const traj = (n: number): Float64Array[] => {
    const out: Float64Array[] = [];
    for (let k = 0; k < n; k++) {
      const t = k * dt;
      const s = Math.exp(-0.4 * t);
      out.push(
        Float64Array.from([
          Math.cos(2 * Math.PI * 0.5 * t),
          Math.sin(2 * Math.PI * 0.5 * t),
          s * Math.cos(2 * Math.PI * 1.5 * t),
          s * Math.sin(2 * Math.PI * 1.5 * t),
        ]),
      );
    }
    return out;
  };

  it('abstains below the snapshot floor instead of fitting noise', () => {
    expect(fitDmd(traj(MIN_SNAPSHOTS - 1), { dt })).toBeNull();
    expect(fitDmd([], { dt })).toBeNull();
  });

  it('abstains on a non-finite snapshot', () => {
    const t = traj(40);
    t[7][0] = NaN;
    expect(fitDmd(t, { dt })).toBeNull();
  });

  it('recovers both frequencies to better than 1%', () => {
    const fit = fitDmd(traj(80), { dt })!;
    expect(fit).not.toBeNull();
    const freqs = fit.modes.map((m) => Math.abs(m.frequency)).sort((a, b) => a - b);
    const near = (target: number) => freqs.some((f) => Math.abs(f - target) < 0.01 * target);
    expect(near(0.5)).toBe(true);
    expect(near(1.5)).toBe(true);
  });

  it('recovers the decay rate and marks the sustained mode as neutral', () => {
    const fit = fitDmd(traj(80), { dt })!;
    const decaying = fit.modes.filter((m) => Math.abs(Math.abs(m.frequency) - 1.5) < 0.05);
    const sustained = fit.modes.filter((m) => Math.abs(Math.abs(m.frequency) - 0.5) < 0.05);
    expect(decaying.length).toBeGreaterThan(0);
    expect(sustained.length).toBeGreaterThan(0);
    expect(decaying[0].growth).toBeCloseTo(-0.4, 1);
    expect(Math.abs(sustained[0].growth)).toBeLessThan(0.02);
  });

  it('predicts one step ahead with small relative error', () => {
    const t = traj(80);
    const fit = fitDmd(t.slice(0, 60), { dt })!;
    expect(fit.relError).toBeLessThan(1e-6);
    const pred = fit.predict(t[60]);
    let num = 0,
      den = 0;
    for (let i = 0; i < pred.length; i++) {
      const e = t[61][i] - pred[i];
      num += e * e;
      den += t[61][i] * t[61][i];
    }
    expect(Math.sqrt(num / den)).toBeLessThan(1e-3);
  });

  it('truncates rank to the true dimensionality of the trajectory', () => {
    const fit = fitDmd(traj(80), { dt })!;
    expect(fit.rank).toBeLessThanOrEqual(6);
    expect(fit.rank).toBeGreaterThanOrEqual(4);
    expect(fit.singularValues[0]).toBeGreaterThan(fit.singularValues[fit.rank - 1]);
  });

  it('flags a growing system with a spectral radius above 1', () => {
    const grow: Float64Array[] = [];
    for (let k = 0; k < 40; k++) {
      const s = Math.exp(0.3 * k * dt);
      grow.push(Float64Array.from([s * Math.cos(k * 0.3), s * Math.sin(k * 0.3), s * 0.2]));
    }
    expect(fitDmd(grow, { dt })!.spectralRadius).toBeGreaterThan(1);
  });

  it('eigenvalue solver matches a known 2×2 complex pair', () => {
    const { re, im } = generalEigenvalues(Float64Array.from([0, -1, 1, 0]), 2);
    expect(re[0]).toBeCloseTo(0, 9);
    expect(Math.abs(im[0])).toBeCloseTo(1, 9);
  });
});
