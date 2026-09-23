/**
 * Gematria field-resonance layer — deterministic, additive, engine-free.
 *
 * THE ONE LAW: a digit pattern is data; a digit meaning is numerology.
 * We compute invariants and report correlations with error bars; we never
 * assert that a number "means" anything.
 */

export * from './zphi';
export * from './zeckendorf';
export * from './lexeme';
export * from './residue';
export * from './bitmap';
export { resonance, resonanceSparse, hopfieldBeta, hopfieldStep, hopfieldEnergy, MERGE_THRESHOLD } from './resonanceKernel';

