/**
 * Ω-OPERATOR — the neural-operator layer.
 *
 * Exported as a namespace (`operator.*`) rather than flattened into the root
 * barrel: names like `l2`, `derivative` and `resample` are generic enough that
 * a flat export would be an invitation to a future collision.
 */

export * from './fourierDiff';
export * from './modeCurrent';
export * from './resample';
export * from './sobolev';
export * from './modeCoupling';
export * from './abHarness';
export * from './conformal';
export * from './recurrentCell';
export * from './continuation';
export * from './retention';
export * from './throughput';
export * from './nestedField';
