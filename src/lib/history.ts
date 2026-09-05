/**
 * Price history for the chart the assistant can put in the conversation.
 *
 * Separate from the option chain: it is a different question, asked far less
 * often, and folding it into /api/chain would make every screener load pay for
 * history nothing on the page draws.
 */

export const CHART_RANGES = ['1mo', '3mo', '6mo', '1y', '5y'] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

export interface HistoryPoint {
  /** ISO date, e.g. "2026-09-04". */
  date: string;
  close: number;
}

export interface HistoryResponse {
  ticker: string;
  companyName: string;
  range: ChartRange;
  points: HistoryPoint[];
  first: number;
  last: number;
  low: number;
  high: number;
  /** Percent change across the window. */
  changePct: number;
  currency: string;
}

/** How each range reads in a sentence. */
export const RANGE_LABEL: Record<ChartRange, string> = {
  '1mo': 'past month',
  '3mo': 'past 3 months',
  '6mo': 'past 6 months',
  '1y': 'past year',
  '5y': 'past 5 years',
};

/**
 * What the model is told after a chart is drawn.
 *
 * The chart is for the user's eyes; this is the model's only view of it. Giving
 * it the shape of the move means it can talk about what is on screen instead of
 * saying "here is a chart" and inventing the rest — the same reason readScreen
 * exists.
 */
export function describeHistory(h: HistoryResponse): string {
  const sign = h.changePct >= 0 ? '+' : '';
  const money = (n: number) => `${n.toFixed(2)}`;
  return [
    `Chart shown to the user: ${h.companyName} (${h.ticker}), ${RANGE_LABEL[h.range]}.`,
    `Start ${money(h.first)}, latest ${money(h.last)} (${sign}${h.changePct.toFixed(1)}%).`,
    `Range over the period: low ${money(h.low)}, high ${money(h.high)}.`,
    `${h.points.length} closes, ${h.points[0]?.date} to ${h.points[h.points.length - 1]?.date}.`,
    'These are closing prices from the chart, not live quotes.',
  ].join(' ');
}
