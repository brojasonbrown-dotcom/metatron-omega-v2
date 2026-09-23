/**
 * Re-export shim — `@/core/runtime/portFlags`.
 *
 * The canonical flag registry lives in
 * `packages/field-kernel-core/src/portFlags.ts` so the browser bundle, the
 * daemon, and offline scripts all read the same table. This module exists
 * because a number of runtime modules and freeze scripts import the flag
 * API through the `src/core/runtime/` path (see the header comment in the
 * canonical module, which documents this file as a pure re-export).
 *
 * It intentionally adds no behaviour: same symbols, same values, one
 * source of truth.
 */

export { portFlag, PORT_FLAGS } from '@metatron/field-kernel-core/portFlags';
export type { FlagKey } from '@metatron/field-kernel-core/portFlags';
