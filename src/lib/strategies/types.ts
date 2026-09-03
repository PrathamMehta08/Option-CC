import type { YahooOptionQuote } from '@/lib/optionChain';

export type StrategyId = 'covered-call' | 'cash-secured-put';

/**
 * Everything that differs between option-selling strategies, in one interface.
 *
 * Adding a third strategy (a cash-secured call, a naked put, a wheel leg) is a
 * new file implementing this and one entry in the registry — not a new branch
 * in the API route or the page.
 */
export interface StrategyDefinition {
  id: StrategyId;

  /** Which side of the Yahoo chain this strategy reads. */
  chainSide: 'calls' | 'puts';

  /**
   * Capital needed to secure ONE contract (100 shares' worth).
   *
   * Covered call: you must own the shares, so it is the market price of 100
   * shares. Cash-secured put: you must be able to buy at the strike, so it is
   * the strike times 100.
   */
  capitalRequiredPerContract(quote: YahooOptionQuote, currentPrice: number): number;

  /**
   * Capital gain per share if the option is assigned, versus today's price.
   *
   * A covered call sells the shares at the strike, so assignment realises
   * (strike - spot) — positive on an OTM call, negative on an ITM one. A
   * cash-secured put assigns you INTO the stock at the strike; there is no sale
   * and so no gain to book, which is why it returns 0 rather than the mirrored
   * figure. Getting that backwards would show a put seller a phantom profit.
   */
  assignmentGainPerShare(quote: YahooOptionQuote, currentPrice: number): number;

  /** Black-Scholes delta for this contract type. */
  delta(S: number, K: number, t: number, sigma: number, r: number): number;

  /**
   * Whether a contract belongs in the screen at all, before any user filter.
   * Cash-secured puts screen out-of-the-money only; covered calls show the
   * whole chain.
   */
  isEligible(quote: YahooOptionQuote, currentPrice: number): boolean;

  /**
   * Turn a delta magnitude (always a positive number the user types, e.g. 0.3
   * for a 30 delta) into the signed [min, max] window for this strategy. Call
   * deltas are positive, put deltas negative; the UI never has to know.
   */
  deltaWindow(magnitude: number): [min: number, max: number];

  defaults: {
    /** Delta magnitude, always positive. */
    deltaMagnitude: number;
    strikeRange: [number, number];
    minMonths: number;
    maxMonths: number;
  };

  /** User-facing strings. Keeps copy out of the components. */
  copy: {
    /** Short name for the strategy switcher, e.g. "Covered Calls". */
    name: string;
    /** Page heading, e.g. "Covered Call Analyzer". */
    heading: string;
    /** Results table heading. */
    tableTitle: string;
    /** Chart series name. */
    seriesName: string;
    /** Label for the total-capital column. */
    capitalColumnLabel: string;
    /** Label for the delta control. */
    deltaLabel: string;
    /** Trailing half of the empty-state hint. */
    emptyHint: string;
    /** Subtitle under the assistant's name. */
    assistantSubtitle: string;
  };
}
