/**
 * The month window is a range, and a range cannot run backwards.
 *
 * Typing 8 into a "from" that sits beside a "to" of 6 used to leave the panel
 * reading 8 → 6: a window that selects nothing and explains nothing. The end
 * the user just set wins and the other end follows it.
 */

/** How far out the month window is allowed to reach. */
export const MAX_MONTHS = 24;

/**
 * Months are a count of months, not a measurement.
 *
 * Only NaN falls back to zero. An infinity is a value with a direction, so it
 * clamps to the end it points at rather than collapsing to the near edge.
 */
function normalize(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(Math.max(0, Math.round(v)), MAX_MONTHS);
}

/** Set the near edge; the far edge moves out of the way if it has to. */
export function withMonthsFrom(
  window: readonly [number, number],
  from: number
): [number, number] {
  const next = normalize(from);
  return [next, Math.max(window[1], next)];
}

/** Set the far edge; the near edge moves out of the way if it has to. */
export function withMonthsTo(window: readonly [number, number], to: number): [number, number] {
  const next = normalize(to);
  return [Math.min(window[0], next), next];
}

/** Set both at once, in whatever order they arrive. */
export function asMonthWindow(a: number, b: number): [number, number] {
  const [x, y] = [normalize(a), normalize(b)];
  return [Math.min(x, y), Math.max(x, y)];
}
