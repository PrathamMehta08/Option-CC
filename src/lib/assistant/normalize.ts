/**
 * Coercions applied to what the model emits, before it reaches app state.
 *
 * The model is not the only source of these — a person typing in the sidebar
 * hits the same ambiguity — but it is the one that produces them most often,
 * because traders say "a 30 delta" far more than "a 0.30 delta".
 */

/**
 * Read a delta the way a trader means it.
 *
 * "30 delta" and "0.30 delta" are the same request. Anything above 1 is being
 * quoted in hundredths and is divided; 1 and below is already a delta and
 * passes through. 1 itself is deliberately left alone — a 1.00 delta is a real
 * thing (deep in the money) and reading it as 0.01 would be a stranger guess
 * than taking it at face value.
 *
 * The sign is dropped: the screener stores a magnitude and the strategy applies
 * the sign, so a put's -0.30 and a call's +0.30 arrive here the same.
 */
export function normalizeDelta(raw: number): number {
  // Only NaN falls back to zero. An infinity is a value with a direction, and
  // clamps to the end it points at rather than collapsing to the near edge.
  if (Number.isNaN(raw)) return 0;
  const magnitude = Math.abs(raw);
  const delta = magnitude > 1 ? magnitude / 100 : magnitude;
  // A delta cannot exceed 1. "300 delta" is nonsense either way; clamping beats
  // screening on an impossible window and returning nothing.
  return Math.min(delta, 1);
}
