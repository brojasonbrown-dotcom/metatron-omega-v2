import { describe, expect, it } from 'vitest';
import { edgeCurrent, hodgeSplit, modeCirculation, phiStencil } from '../src/operator/modeCurrent';
import { modeLadder } from '../src/torus/eigenmodes';

const specs = modeLadder(13);
const edges = phiStencil(specs);

describe('O2 — mode-current Hodge witness', () => {
  it('the φ stencil is connected and carries cycles', () => {
    // 13 nodes, offsets {1,2} → 12 + 11 = 23 edges; cycles = E - V + 1 = 11.
    expect(edges.length).toBe(23);
    expect(edges.length - specs.length + 1).toBe(11);
  });

  it('a pure gradient current has zero circulation', () => {
    // J_e = ψ_b - ψ_a for an arbitrary node potential → exactly a gradient.
    const psi = Float64Array.from({ length: 13 }, (_, i) => Math.sin(i * 1.7) * (i + 1));
    const J = Float64Array.from(edges, (e) => psi[e.b] - psi[e.a]);
    const r = hodgeSplit(J, edges, specs.length);
    expect(r.valid).toBe(true);
    expect(r.circulation).toBeLessThan(1e-12);
  });

  it('a closed loop current is almost entirely circulation', () => {
    // Circulate on the triangle 0→1→2→0 using the ±1 and ±2 edges.
    const J = new Float64Array(edges.length);
    const idx = (a: number, b: number) =>
      edges.findIndex((e) => e.a === Math.min(a, b) && e.b === Math.max(a, b));
    J[idx(0, 1)] = 1; // 0 → 1
    J[idx(1, 2)] = 1; // 1 → 2
    J[idx(0, 2)] = -1; // 2 → 0
    const r = hodgeSplit(J, edges, specs.length);
    expect(r.valid).toBe(true);
    expect(r.circulation).toBeGreaterThan(0.99);
  });

  it('the ratio is invariant to a ×10 amplitude change (driver-free)', () => {
    const prev = Float64Array.from({ length: 13 }, (_, i) => 1 + 0.1 * i);
    const curr = Float64Array.from(
      { length: 13 },
      (_, i) => 1 + 0.1 * i + Math.sin(i * 2.3) * 0.05,
    );
    const a = modeCirculation(prev, curr, specs);
    const prev10 = Float64Array.from(prev, (v) => v * 10);
    const curr10 = Float64Array.from(curr, (v) => v * 10);
    const b = modeCirculation(prev10, curr10, specs);
    expect(Math.abs(a.circulation - b.circulation)).toBeLessThan(1e-9);
    expect(b.current).toBeCloseTo(a.current * 100, 6);
  });

  it('gradient + residual decomposition is energy-exact', () => {
    const prev = Float64Array.from({ length: 13 }, (_, i) => Math.abs(Math.cos(i)));
    const curr = Float64Array.from({ length: 13 }, (_, i) => Math.abs(Math.sin(i * 1.3)));
    const J = edgeCurrent(prev, curr, edges);
    const r = hodgeSplit(J, edges, specs.length);
    // Hodge orthogonality: ‖J‖² = ‖Bψ‖² + ‖r‖²
    expect(r.throughput + r.circulation * r.current).toBeCloseTo(r.current, 8);
  });

  it('a zero current reports invalid rather than NaN', () => {
    const z = new Float64Array(13);
    const r = modeCirculation(z, z, specs);
    expect(r.valid).toBe(false);
    expect(r.circulation).toBe(0);
    expect(Number.isFinite(r.circulation)).toBe(true);
  });
});
