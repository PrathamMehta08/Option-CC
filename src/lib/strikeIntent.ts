/**
 * A strike bound the assistant expressed as a percentage of the price.
 *
 * "Strikes 115% of spot to max" is a rule, not a number. Resolving it once and
 * keeping only the answer meant that switching to a stock at a different price
 * carried the OLD stock's dollar figure across — 115% of NVDA at $230 became a
 * $265 floor under a $335 stock, which is 79% of spot and not what was asked
 * for. The percentage is the filter; the dollars are just how it looks today.
 *
 * Only the assistant sets these. Touching the strike fields by hand is a
 * person naming an actual number, and it clears the rule for that edge.
 */
export interface StrikePct {
  min: number | null;
  max: number | null;
}

export const NO_STRIKE_PCT: StrikePct = { min: null, max: null };

/** A price as a percentage of spot, to the cent. */
export function strikeFromPct(pct: number | null, spot: number): number | null {
  if (pct == null || !Number.isFinite(pct) || !(spot > 0)) return null;
  return Number(((pct / 100) * spot).toFixed(2));
}

/**
 * The strike range for a newly loaded board: the standing percentages where
 * there are any, the board's own edges where there are not.
 */
export function strikeRangeForBoard(
  bounds: [number, number],
  pct: StrikePct,
  spot: number
): [number, number] {
  const [lowest, highest] = bounds;
  const low = strikeFromPct(pct.min, spot) ?? lowest;
  const high = strikeFromPct(pct.max, spot) ?? highest;
  // A percentage can land outside the strikes this board actually lists, and a
  // bound past the end of the track is one the slider cannot reach.
  const clamped = (v: number) => Math.min(Math.max(v, lowest), highest);
  const lowClamped = clamped(low);
  const highClamped = clamped(high);
  // Crossed bounds would silently show everything; keep them ordered instead,
  // which shows nothing and is at least the truth.
  return lowClamped > highClamped ? [highClamped, highClamped] : [lowClamped, highClamped];
}

/**
 * The standing rule after a change. A percentage sets it; an absolute number on
 * the same edge clears it; an edge left alone keeps whatever it had.
 */
export function nextStrikePct(
  previous: StrikePct,
  change: { min: number | null; max: number | null; minPct: number | null; maxPct: number | null }
): StrikePct {
  return {
    min: change.minPct ?? (change.min != null ? null : previous.min),
    max: change.maxPct ?? (change.max != null ? null : previous.max),
  };
}
