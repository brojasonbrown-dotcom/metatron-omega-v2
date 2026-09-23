/**
 * Ω transplant seam — the SOLE export surface.
 *
 * Law (BRAINMAP § Transplant seam): a host integrates against this module only.
 * No host file may reach past this barrel into field math, memory layers or UI,
 * and no Ω module needs to know a host exists.
 */

export * from './contract';
export * from './bn128';
export * from './rumf';
export * from './evidence';
export * from './tierGate';
export * from './recall';
export * from './intake';
export * from './facade';
