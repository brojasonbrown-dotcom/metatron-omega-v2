/**
 * Bounds-checked accessors (BRAINMAP section 4 gap).
 *
 * The engine hot path uses raw indexing; these are for law modules, decks and
 * tests where an out-of-range read must be a loud error rather than NaN.
 */

export function assertIndex(i: number, length: number, what = 'index'): number {
  if (!Number.isInteger(i)) throw new RangeError(`${what}: ${i} is not an integer`);
  if (i < 0 || i >= length) throw new RangeError(`${what}: ${i} out of range [0, ${length})`);
  return i;
}

/** Bounds-checked read. */
export function at<T>(xs: ArrayLike<T>, i: number, what = 'at'): T {
  return xs[assertIndex(i, xs.length, what)];
}

/** Bounds-checked read with a wrap-around for toroidal (periodic) indices. */
export function wrapAt<T>(xs: ArrayLike<T>, i: number): T {
  const n = xs.length;
  if (n === 0) throw new RangeError('wrapAt: empty');
  return xs[((i % n) + n) % n];
}

/** Bounds-checked read from a plain object map. */
export function get<T>(map: Readonly<Record<string, T>>, key: string, what = 'get'): T {
  if (!Object.prototype.hasOwnProperty.call(map, key))
    throw new RangeError(`${what}: missing key ${key}`);
  return map[key];
}
