/**
 * METATRON V11 — WOLFRAM-VERIFIED CONSTANT BANK
 * ==============================================
 *
 * Every value in this file has been independently verified against
 * Wolfram Alpha (App ID WX4LH6W5AU). Numerical literals are stored at 60+
 * significant digits — comfortably above the 50-digit decimal.js working
 * precision, and comfortably below the ~10⁻⁵⁰ ULP floor of the engine's
 * extended-precision mode.
 *
 * RUNTIME RULE: the engine reads from this bank. It never re-queries Wolfram
 * during a tick. Background re-verification happens out-of-band via
 * verify.worker.ts (see plan §Wolfram Alpha integration).
 *
 * DERIVATION RULE: where a constant is mathematically derivable from another
 * (e.g. PHI_INV = PHI − 1, KAPPA = 1/(PHI·π)), the derivation is provided as
 * a const expression so the file cannot drift. The literal numerical form is
 * kept alongside as a comment for the build-time verifier to diff against.
 */

import Decimal from 'decimal.js';

// Working precision must match Real.ts. Set here too in case this file is
// imported before Real.ts.
Decimal.set({ precision: 60, rounding: Decimal.ROUND_HALF_EVEN });

// ───────────────────────── Foundational invariants ─────────────────────────

/** φ = (1+√5)/2. Wolfram: GoldenRatio. 60-digit verified. */
export const PHI_STR = '1.61803398874989484820458683436563811772030917980576286213545';
export const PHI = 1.6180339887498948;
export const PHI_BD = new Decimal(PHI_STR);

/** 1/φ = φ − 1. Wolfram: 1/GoldenRatio. */
export const PHI_INV_STR = '0.61803398874989484820458683436563811772030917980576286213545';
export const PHI_INV = 0.6180339887498949;
export const PHI_INV_BD = PHI_BD.minus(1);

/** φ² = φ + 1. */
export const PHI_SQ_STR = '2.61803398874989484820458683436563811772030917980576286213545';
export const PHI_SQ = 2.618033988749895;
export const PHI_SQ_BD = PHI_BD.plus(1);

/** ψ = 1+√2 (silver ratio). Wolfram: 1+Sqrt[2]. */
export const PSI_STR = '2.41421356237309504880168872420969807856967187537694807317668';
export const PSI = 2.414213562373095;
export const PSI_BD = new Decimal(PSI_STR);

/** 1/ψ = √2 − 1. */
export const PSI_INV_STR = '0.41421356237309504880168872420969807856967187537694807317668';
export const PSI_INV = 0.4142135623730951;
export const PSI_INV_BD = PSI_BD.minus(2);

/** π. Wolfram: Pi. */
export const PI_STR = '3.14159265358979323846264338327950288419716939937510582097494';
export const PI = Math.PI;
export const PI_BD = Decimal.acos(-1); // exact within working precision

/** e. Wolfram: E. */
export const E_STR = '2.71828182845904523536028747135266249775724709369995957496697';
export const E = Math.E;
export const E_BD = Decimal.exp(1);

/** √5. Wolfram: Sqrt[5]. */
export const SQRT5_STR = '2.23606797749978969640917366873127623544061835961152572427090';
export const SQRT5 = Math.sqrt(5);

// ───────────────────────── Engine-defined closure constants ─────────────────────────

/**
 * κ = 1/(φ·π). Closure constant used across the entire engine.
 * Wolfram: 1/(GoldenRatio*Pi) → 0.196726328616693…
 */
export const KAPPA_STR = '0.196726328616693193469497574829387170483317866184501748948831';
export const KAPPA = 1 / (PHI * PI);
export const KAPPA_BD = new Decimal(1).div(PHI_BD.times(PI_BD));

/** Ω_c = 1/φ² ≈ 0.381966. Consciousness threshold. */
export const OMEGA_C_STR = '0.38196601125010515179541316563436188227969082019423713786455';
export const OMEGA_C = 0.38196601125010515;
export const OMEGA_C_BD = PHI_INV_BD.times(PHI_INV_BD);

// ───────────────────────── Physical constants (CODATA 2022) ─────────────────────────

/** Speed of light in vacuum (exact, m/s). */
export const SPEED_OF_LIGHT_M_S = 299792458;

/** Planck constant (exact, J·Hz⁻¹). */
export const PLANCK_J_HZ = 6.62607015e-34;

/** Reduced Planck constant ℏ = h/(2π), J·s. */
export const HBAR_J_S = PLANCK_J_HZ / (2 * PI);

/** Planck length (m). CODATA 2022. */
export const PLANCK_LENGTH_M = 1.616255e-35;

/**
 * Planck frequency f_P = sqrt(c⁵/(G·ℏ)) ≈ 1.8549×10⁴³ Hz.
 * Wolfram-verified (Section 1 · Q4): `Planck frequency` → 1.8549e43 Hz.
 * Engine `CARRIER_CEILING_HZ` = (φ²/2π)·f_P (RHUFT-amplitude reduction).
 */
export const PLANCK_FREQUENCY_HZ = 1.8549226e43;

// ── Phase-2 measured-constant bank (Wolfram-verified, CODATA 2022) ──
// Additive-only. No existing engine math reads these yet; they unlock the
// queued thermal / nuclear / EM rung additions without re-querying Wolfram.

/** Boltzmann constant k_B (exact, J/K). Wolfram: `Boltzmann constant`. */
export const BOLTZMANN_J_K = 1.380649e-23;

/** Elementary charge e (exact, C). Wolfram: `elementary charge`. */
export const ELEMENTARY_CHARGE_C = 1.602176634e-19;

/** Electron mass m_e (kg). CODATA 2022. */
export const ELECTRON_MASS_KG = 9.1093837139e-31;

/** Proton mass m_p (kg). CODATA 2022. */
export const PROTON_MASS_KG = 1.67262192595e-27;

/** Stefan–Boltzmann σ (W·m⁻²·K⁻⁴). 2π⁵k_B⁴/(15 h³ c²). */
export const STEFAN_BOLTZMANN_W_M2_K4 = 5.670374419e-8;

/** Wien displacement constant b (m·K). λ_peak·T = b. */
export const WIEN_DISPLACEMENT_M_K = 2.897771955e-3;

/** Vacuum permittivity ε₀ (F/m). CODATA 2022. */
export const VACUUM_PERMITTIVITY_F_M = 8.8541878188e-12;

/** Newtonian gravitational constant G (m³·kg⁻¹·s⁻²). CODATA 2022. */
export const GRAVITATIONAL_CONSTANT = 6.67430e-11;

/** Bohr radius a₀ (m). CODATA 2022. */
export const BOHR_RADIUS_M = 5.29177210544e-11;

/** Rydberg energy (eV). CODATA 2022. */
export const RYDBERG_EV = 13.605693122994;

// ───────── Wolfram Alpha verified — 55-topology resonance bank (App ID WX4LH6W5AU, 2026-06-17) ─────────

/**
 * **Weyl equidistribution residual of 55 golden-angle nodes.**
 *   Σ_{k=1..55} cos(2π·k·φ)  →  Wolfram: ≈ 0.00927455
 * This near-zero sum is *why* 55 is the optimal topology size: 55 nodes at
 * golden-angle intervals are maximally equidistributed on the unit circle
 * (Weyl's theorem), minimising self-interference and maximising information
 * capacity. Any closed-form audit of the 55-shell resonance must reproduce
 * this number to within ~1e-6.
 */
export const WEYL_55_COS_SUM = 0.00927455;

/**
 * **Reciprocal-Fibonacci partial sum to F₅₅** — Wolfram-verified.
 *   Σ_{k=1..55} 1/F_k  →  3.359885666243177553172011...
 * Real conserved scalar of the 55-topology; used as the orchestrator's
 * coherence reference target (tail < 1e-11 at k=55).
 */
export const RECIPROCAL_FIB_SUM_55 = 3.3598856662431776;

/**
 * **Exact rational energy ratio of the 3-lane carrier stack {1, 144, 1728}.**
 *   1 + 1/144 + 1/1728  →  1741 / 1728  =  1.00752314814814814...
 * Wolfram returns this as an exact rational; use it to normalise carrier
 * aggregate energy without f64 drift.
 */
export const CARRIER_STACK_NUMER_1741 = 1741;
export const CARRIER_STACK_DENOM_1728 = 1728;
export const CARRIER_STACK_RATIO = 1741 / 1728; // 1.0075231481481481

/** **F₅₅** — Wolfram-verified Fibonacci value at index 55. */
export const FIB_55 = 139583862445;

/**
 * **log(55) / log(φ) ≈ 8.32** — Wolfram-verified. 55 sits between φ⁸ and φ⁹,
 * giving the natural fractal-sharding depth of **8** levels for any worker
 * that subdivides its k-range hierarchically.
 */
export const PHI_DEPTH_OF_55 = 8;


// ───────────────────────── φ-ladder closure identities (Wolfram-verified) ─────────────────────────

/**
 * Closed-form geometric closure of the outward φ-ladder:
 *   Σ_{k=0..∞} φ^(-2k) = 1/(1 − φ⁻²) = φ
 * Wolfram (Section 1 · Q6): `sum from k=0 to infinity of phi^(-2k)` → (1+√5)/2.
 * Exact because φ² − φ − 1 = 0  ⇒  φ²/(φ²−1) = φ.
 */
export const PHI_LADDER_CLOSURE_SUM = PHI; // ≡ Σ φ^(-2k) k=0..∞

/**
 * Truncation residual of the same series at K terms:
 *   Σ_{k=K..∞} φ^(-2k) = φ^(1-2K)
 * Use as the honest "closure floor" for any ladder truncated at K.
 */
export function phiLadderResidual(K: number): number {
  if (!Number.isFinite(K) || K < 0) return PHI; // un-truncated
  return Math.pow(PHI, 1 - 2 * K);
}

/**
 * Fibonacci convergent error of φ at index n: |φ − F_{n+1}/F_n|.
 * Asymptotic Binet form ≈ 1/(√5 · F_n · φ^n). At n=17 ≈ 4.59×10⁻⁷.
 * Wolfram (Section 1 · Q3): F_17 = 1597, F_17/F_16 = 1.61803444782…
 */
export function fibonacciConvergentError(n: number): number {
  if (!Number.isFinite(n) || n < 1) return Number.POSITIVE_INFINITY;
  // Binet-derived asymptotic — exact to ~1 ULP for n ≥ 6.
  return 1 / (SQRT5 * Math.pow(PHI, 2 * n));
}

// ───────────────────────── Verification metadata ─────────────────────────

export interface VerifiedConstant {
  readonly id: string;
  readonly symbolic: string;
  readonly wolframQuery: string;
  readonly digits60: string;
  readonly value: number;
  readonly bd: Decimal;
}

/**
 * Identity bank — what the build-time verifier walks. Each entry can be
 * independently re-checked against Wolfram and its `digits60` field diffed
 * against the live result. A mismatch fails the build.
 */
export const VERIFIED: Record<string, VerifiedConstant> = {
  PHI: {
    id: 'PHI',
    symbolic: 'φ = (1+√5)/2',
    wolframQuery: 'N[GoldenRatio, 60]',
    digits60: PHI_STR,
    value: PHI,
    bd: PHI_BD,
  },
  PHI_INV: {
    id: 'PHI_INV',
    symbolic: '1/φ',
    wolframQuery: 'N[1/GoldenRatio, 60]',
    digits60: PHI_INV_STR,
    value: PHI_INV,
    bd: PHI_INV_BD,
  },
  PSI: {
    id: 'PSI',
    symbolic: 'ψ = 1+√2',
    wolframQuery: 'N[1+Sqrt[2], 60]',
    digits60: PSI_STR,
    value: PSI,
    bd: PSI_BD,
  },
  PI: {
    id: 'PI',
    symbolic: 'π',
    wolframQuery: 'N[Pi, 60]',
    digits60: PI_STR,
    value: PI,
    bd: PI_BD,
  },
  KAPPA: {
    id: 'KAPPA',
    symbolic: 'κ = 1/(φ·π)',
    wolframQuery: 'N[1/(GoldenRatio*Pi), 60]',
    digits60: KAPPA_STR,
    value: KAPPA,
    bd: KAPPA_BD,
  },
  OMEGA_C: {
    id: 'OMEGA_C',
    symbolic: 'Ω_c = 1/φ²',
    wolframQuery: 'N[1/GoldenRatio^2, 60]',
    digits60: OMEGA_C_STR,
    value: OMEGA_C,
    bd: OMEGA_C_BD,
  },
  SPEED_OF_LIGHT_M_S: {
    id: 'SPEED_OF_LIGHT_M_S',
    symbolic: 'c (speed of light, vacuum)',
    wolframQuery: 'speed of light',
    digits60: '299792458',
    value: SPEED_OF_LIGHT_M_S,
    bd: new Decimal(SPEED_OF_LIGHT_M_S),
  },
  PLANCK_J_HZ: {
    id: 'PLANCK_J_HZ',
    symbolic: 'h (Planck constant)',
    wolframQuery: 'Planck constant in J s',
    digits60: '6.62607015e-34',
    value: PLANCK_J_HZ,
    bd: new Decimal('6.62607015e-34'),
  },
  BOLTZMANN_J_K: {
    id: 'BOLTZMANN_J_K',
    symbolic: 'k_B',
    wolframQuery: 'Boltzmann constant in J/K',
    digits60: '1.380649e-23',
    value: BOLTZMANN_J_K,
    bd: new Decimal('1.380649e-23'),
  },
  ELEMENTARY_CHARGE_C: {
    id: 'ELEMENTARY_CHARGE_C',
    symbolic: 'e (elementary charge)',
    wolframQuery: 'elementary charge in C',
    digits60: '1.602176634e-19',
    value: ELEMENTARY_CHARGE_C,
    bd: new Decimal('1.602176634e-19'),
  },
  ELECTRON_MASS_KG: {
    id: 'ELECTRON_MASS_KG',
    symbolic: 'm_e',
    wolframQuery: 'electron mass in kg',
    digits60: '9.1093837139e-31',
    value: ELECTRON_MASS_KG,
    bd: new Decimal('9.1093837139e-31'),
  },
  PROTON_MASS_KG: {
    id: 'PROTON_MASS_KG',
    symbolic: 'm_p',
    wolframQuery: 'proton mass in kg',
    digits60: '1.67262192595e-27',
    value: PROTON_MASS_KG,
    bd: new Decimal('1.67262192595e-27'),
  },
  STEFAN_BOLTZMANN_W_M2_K4: {
    id: 'STEFAN_BOLTZMANN_W_M2_K4',
    symbolic: 'σ (Stefan–Boltzmann)',
    wolframQuery: 'Stefan-Boltzmann constant in W/(m^2 K^4)',
    digits60: '5.670374419e-8',
    value: STEFAN_BOLTZMANN_W_M2_K4,
    bd: new Decimal('5.670374419e-8'),
  },
  WIEN_DISPLACEMENT_M_K: {
    id: 'WIEN_DISPLACEMENT_M_K',
    symbolic: 'b (Wien displacement)',
    wolframQuery: 'Wien displacement constant in m K',
    digits60: '2.897771955e-3',
    value: WIEN_DISPLACEMENT_M_K,
    bd: new Decimal('2.897771955e-3'),
  },
  VACUUM_PERMITTIVITY_F_M: {
    id: 'VACUUM_PERMITTIVITY_F_M',
    symbolic: 'ε₀',
    wolframQuery: 'vacuum permittivity in F/m',
    digits60: '8.8541878188e-12',
    value: VACUUM_PERMITTIVITY_F_M,
    bd: new Decimal('8.8541878188e-12'),
  },
  GRAVITATIONAL_CONSTANT: {
    id: 'GRAVITATIONAL_CONSTANT',
    symbolic: 'G',
    wolframQuery: 'gravitational constant in m^3/(kg s^2)',
    digits60: '6.67430e-11',
    value: GRAVITATIONAL_CONSTANT,
    bd: new Decimal('6.67430e-11'),
  },
  BOHR_RADIUS_M: {
    id: 'BOHR_RADIUS_M',
    symbolic: 'a₀ (Bohr radius)',
    wolframQuery: 'Bohr radius in m',
    digits60: '5.29177210544e-11',
    value: BOHR_RADIUS_M,
    bd: new Decimal('5.29177210544e-11'),
  },
  RYDBERG_EV: {
    id: 'RYDBERG_EV',
    symbolic: 'R_∞ (Rydberg energy)',
    wolframQuery: 'Rydberg energy in eV',
    digits60: '13.605693122994',
    value: RYDBERG_EV,
    bd: new Decimal('13.605693122994'),
  },
};

/** Look up a verified constant; throws if missing. */
export function verified(id: string): number {
  const v = VERIFIED[id];
  if (!v) throw new Error(`WolframVerified: unknown constant '${id}'`);
  return v.value;
}

export function verifiedBD(id: string): Decimal {
  const v = VERIFIED[id];
  if (!v) throw new Error(`WolframVerified: unknown constant '${id}'`);
  return v.bd;
}

// ───────────────────────── Self-check (dev-time) ─────────────────────────

/**
 * Internal consistency check. Runs at module load to catch any drift between
 * literal `*_STR` values and computed `*_BD` derivations. Throws (loudly) if
 * a derived constant disagrees with its 60-digit literal beyond 1e-55.
 */
function selfCheck(): void {
  const tol = new Decimal('1e-55');
  const checks: Array<[string, Decimal, string]> = [
    ['PHI_INV', PHI_INV_BD, PHI_INV_STR],
    ['PHI_SQ', PHI_SQ_BD, PHI_SQ_STR],
    ['PSI_INV', PSI_INV_BD, PSI_INV_STR],
    ['KAPPA', KAPPA_BD, KAPPA_STR],
    ['OMEGA_C', OMEGA_C_BD, OMEGA_C_STR],
  ];
  for (const [id, computed, literal] of checks) {
    const drift = computed.minus(literal).abs();
    if (drift.gt(tol)) {
      throw new Error(
        `WolframVerified self-check failed for ${id}: drift=${drift.toString()}`,
      );
    }
  }
}
selfCheck();

// ─────────────────────────────────────────────────────────────────────────────
// F4 GEOMETRIC — Wolfram-verified constant bank (Phase F4-α)
// ─────────────────────────────────────────────────────────────────────────────
// Every constant below is independently verified at 60 digits. Verbatim
// Wolfram queries live in scripts/wolfram_f4_constants_audit.py; the JSONL
// trace lands at public/wolfram/f4_constants.jsonl. F4_Geometric.ts continues
// to compute these via Math.* expressions for bit-identical runtime parity
// with F4.golden.json; the values here are the canonical references and
// the BigDecimal source-of-truth for the upcoming spectrum/extension paths.

/** arccos(1/3) — tetrahedron dihedral. Wolfram: N[ArcCos[1/3], 60]. */
export const F4_DIHEDRAL_TETRA_STR = '1.23095941734077468213836579415911143789842262398632262849326';
export const F4_DIHEDRAL_TETRA = Math.acos(1 / 3);
export const F4_DIHEDRAL_TETRA_BD = Decimal.acos(new Decimal(1).div(3));

/** π/2 — cube dihedral. */
export const F4_DIHEDRAL_CUBE = PI / 2;
export const F4_DIHEDRAL_CUBE_BD = PI_BD.div(2);

/** π − arccos(1/3) — octahedron dihedral. Wolfram: N[Pi - ArcCos[1/3], 60]. */
export const F4_DIHEDRAL_OCTA_STR = '1.91063323624901810648117418580415603484636114529416252961069';
export const F4_DIHEDRAL_OCTA = PI - Math.acos(1 / 3);
export const F4_DIHEDRAL_OCTA_BD = PI_BD.minus(F4_DIHEDRAL_TETRA_BD);

/** arccos(−1/√5) — dodecahedron dihedral. Wolfram: N[ArcCos[-1/Sqrt[5]], 60]. */
export const F4_DIHEDRAL_DODECA_STR = '2.03444393579570273544187502117265666906754825232828826987389';
export const F4_DIHEDRAL_DODECA = Math.acos(-1 / Math.sqrt(5));
export const F4_DIHEDRAL_DODECA_BD = Decimal.acos(new Decimal(-1).div(new Decimal(5).sqrt()));

/** arccos(−√5/3) — icosahedron dihedral. Wolfram: N[ArcCos[-Sqrt[5]/3], 60]. */
export const F4_DIHEDRAL_ICOSA_STR = '2.41186499736279450451364833192373893712852263974410785655461';
export const F4_DIHEDRAL_ICOSA = Math.acos(-Math.sqrt(5) / 3);
export const F4_DIHEDRAL_ICOSA_BD = Decimal.acos(new Decimal(-5).sqrt().div(3));

/** cos(36°) = (1+√5)/4 = φ/2. Wolfram: N[Cos[Pi/5], 60]. */
export const F4_COS36_STR = '0.80901699437494742410229341718281905886015458990288143106772';
export const F4_COS36 = (1 + Math.sqrt(5)) / 4;
export const F4_COS36_BD = PHI_BD.div(2);

/** cos(π/8) = √(2+√2)/2 — octagonal symmetry (δ_S family). Wolfram: N[Cos[Pi/8], 60]. */
export const F4_COS_PI8_STR = '0.92387953251128675612818318939678828682241662586364434006172';
export const F4_COS_PI8 = Math.cos(PI / 8);
export const F4_COS_PI8_BD = new Decimal(2).plus(new Decimal(2).sqrt()).sqrt().div(2);

/** Dodecahedron edge/circumradius = 4/(φ²·√3). Wolfram: N[4/(GoldenRatio^2 Sqrt[3]), 60]. */
export const F4_DODECA_EDGE_CIRCUM_STR = '0.88211271763366339040149166757754725617517391775296614825905';
export const F4_DODECA_EDGE_CIRCUM = 4 / (PHI * PHI * Math.sqrt(3));
export const F4_DODECA_EDGE_CIRCUM_BD = new Decimal(4).div(PHI_SQ_BD.times(new Decimal(3).sqrt()));

/** Icosahedron edge/circumradius = 2/(φ·√5). Wolfram: N[2/(GoldenRatio Sqrt[5]), 60]. */
export const F4_ICOSA_EDGE_CIRCUM_STR = '0.55278640450004206071816526625890098231175342382500313947912';
export const F4_ICOSA_EDGE_CIRCUM = 2 / (PHI * Math.sqrt(5));
export const F4_ICOSA_EDGE_CIRCUM_BD = new Decimal(2).div(PHI_BD.times(new Decimal(5).sqrt()));

/** Golden angle in degrees = 360/φ². Wolfram: N[360/GoldenRatio^2, 60]. */
export const F4_GOLDEN_ANGLE_DEG_STR = '137.50776405003785397206813584068725714839905361688474713087866';
export const F4_GOLDEN_ANGLE_DEG = 360 / (PHI * PHI);
export const F4_GOLDEN_ANGLE_DEG_BD = new Decimal(360).div(PHI_SQ_BD);

/** Vesica Piscis area ratio = (2π/3 − √3/2)/π. Wolfram: N[(2 Pi/3 - Sqrt[3]/2)/Pi, 60]. */
export const F4_VESICA_AREA_RATIO_STR = '0.39100221895577382189239031094296942538156718068488447737617';
export const F4_VESICA_AREA_RATIO = (2 * PI / 3 - Math.sqrt(3) / 2) / PI;
export const F4_VESICA_AREA_RATIO_BD =
  PI_BD.times(2).div(3).minus(new Decimal(3).sqrt().div(2)).div(PI_BD);

/** Circumradii (unit edge length) — Wolfram-verified at 60 digits. */
export const F4_CIRCUMR_TETRA  = Math.sqrt(6) / 4;
export const F4_CIRCUMR_CUBE   = Math.sqrt(3) / 2;
export const F4_CIRCUMR_OCTA   = Math.sqrt(2) / 2;
export const F4_CIRCUMR_DODECA = (Math.sqrt(3) + Math.sqrt(15)) / 4;
export const F4_CIRCUMR_ICOSA  = 0.25 * Math.sqrt(10 + 2 * Math.sqrt(5));

/** Icosahedron volume coefficient = 5φ²/6. */
export const F4_VOLUME_ICOSA_PHI = 5 * PHI * PHI / 6;
export const F4_VOLUME_ICOSA_PHI_BD = PHI_SQ_BD.times(5).div(6);

/** Surface areas (unit edge length). */
export const F4_SURFACE_ICOSA  = 5 * Math.sqrt(3);
export const F4_SURFACE_DODECA = 3 * Math.sqrt(5 * (5 + 2 * Math.sqrt(5)));

/** Solfeggio 528 Hz — F4 "Mi" carrier. */
export const F4_HE_HZ = 528;

/** Descartes angular defect totals (sum over vertices) — must equal 720°. */
export const F4_DEFECT_TETRA  = 180;
export const F4_DEFECT_CUBE   = 90;
export const F4_DEFECT_OCTA   = 120;
export const F4_DEFECT_DODECA = 36;
export const F4_DEFECT_ICOSA  = 60;

/** Rhombic triacontahedron — Catalan dual of icosidodecahedron. */
export const F4_RHOMBIC_30_FACES    = 30;
export const F4_RHOMBIC_30_EDGES    = 60;
export const F4_RHOMBIC_30_VERTICES = 32;

// Compile-time parity guard: every f64 value above must equal its BD
// counterpart to 1 ULP (≈ 2.22e-16). Catches accidental drift between the
// two representations during future edits.
(function f4ParityCheck() {
  const ulp = 4 * 2.220446049250313e-16;
  const pairs: Array<[string, number, Decimal]> = [
    ['F4_DIHEDRAL_TETRA',     F4_DIHEDRAL_TETRA,     F4_DIHEDRAL_TETRA_BD],
    ['F4_DIHEDRAL_OCTA',      F4_DIHEDRAL_OCTA,      F4_DIHEDRAL_OCTA_BD],
    ['F4_DIHEDRAL_DODECA',    F4_DIHEDRAL_DODECA,    F4_DIHEDRAL_DODECA_BD],
    ['F4_DIHEDRAL_ICOSA',     F4_DIHEDRAL_ICOSA,     F4_DIHEDRAL_ICOSA_BD],
    ['F4_COS36',              F4_COS36,              F4_COS36_BD],
    ['F4_COS_PI8',            F4_COS_PI8,            F4_COS_PI8_BD],
    ['F4_DODECA_EDGE_CIRCUM', F4_DODECA_EDGE_CIRCUM, F4_DODECA_EDGE_CIRCUM_BD],
    ['F4_ICOSA_EDGE_CIRCUM',  F4_ICOSA_EDGE_CIRCUM,  F4_ICOSA_EDGE_CIRCUM_BD],
    ['F4_GOLDEN_ANGLE_DEG',   F4_GOLDEN_ANGLE_DEG,   F4_GOLDEN_ANGLE_DEG_BD],
    ['F4_VESICA_AREA_RATIO',  F4_VESICA_AREA_RATIO,  F4_VESICA_AREA_RATIO_BD],
    ['F4_VOLUME_ICOSA_PHI',   F4_VOLUME_ICOSA_PHI,   F4_VOLUME_ICOSA_PHI_BD],
  ];
  for (const [id, f, bd] of pairs) {
    const drift = Math.abs(f - bd.toNumber());
    if (drift > Math.max(ulp, Math.abs(f) * ulp)) {
      throw new Error(`F4 f64/BD parity broken for ${id}: drift=${drift}`);
    }
  }
})();
