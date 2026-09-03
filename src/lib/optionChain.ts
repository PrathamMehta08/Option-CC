/**
 * Types for the option chain: the raw rows Yahoo returns, and the enriched rows
 * this app's API hands to the UI. Both sides of the fetch share these so the
 * core data model is actually checked.
 */

/** A single contract as returned by yahoo-finance2's `options()` call. */
export interface YahooOptionQuote {
  strike: number;
  impliedVolatility?: number;
  bid?: number;
  ask?: number;
  lastPrice?: number;
  openInterest?: number;
  volume?: number;
}

/** One expiration's chain, as returned by yahoo-finance2. */
export interface YahooOptionChain {
  calls: YahooOptionQuote[];
  puts: YahooOptionQuote[];
}

/**
 * A contract after this app enriches it: delta, moneyness, premium and return
 * figures. This is the row shape the table, charts and filters all operate on.
 */
export interface ScreenedOption {
  expiration: string;
  daysToExpiration: number;
  strike: number;
  /** Premium per share actually used: the bid when available, else the mid. */
  lastPrice: number;
  high: number;
  delta: number;
  /** Implied volatility as a percentage, e.g. 42.5 for 42.5%. */
  iv: number;
  /** Percentage distance of strike from spot, signed. */
  moneyness: number;
  openInterest: number;
  volume: number;

  /** Capital to secure ONE contract. Independent of the user's capital. */
  capitalRequiredPerContract: number;
  /** Premium collected on ONE contract (per-share premium * 100). */
  premiumPerContract: number;
  /** Return on one contract, as a percentage. Never depends on affordability. */
  returnPct: number;
  /** `returnPct` scaled to a year. Never depends on affordability. */
  annualizedReturn: number;

  /**
   * Return if the option is assigned: the premium PLUS the capital gain from
   * transacting at the strike instead of today's price, over the same capital.
   * For a covered call this is the classic "return if called"; for a
   * cash-secured put there is no sale, so it equals the premium-only figure.
   */
  returnWithGainPct: number;
  /** `returnWithGainPct` scaled to a year. */
  annualizedReturnWithGain: number;

  /** Informational: how many contracts the user's capital covers. May be 0. */
  maxContracts: number;
  totalCapitalRequired: number;
  totalPremiumReceived: number;
}

export interface ScreenerResponse {
  ticker: string;
  strategy: string;
  currentPrice: number;
  options: ScreenedOption[];
  /** How many returned rows the user's capital covers at least one contract of. */
  affordableCount: number;
  /** Cheapest single contract on the board, so the UI can say what it'd take. */
  minCapitalRequired: number;
  message?: string;
}

/** Numeric columns a user (or the assistant) may filter on. */
export const NUMERIC_FIELDS = [
  'strike',
  'lastPrice',
  'delta',
  'iv',
  'moneyness',
  'openInterest',
  'volume',
  'maxContracts',
  'totalCapitalRequired',
  'totalPremiumReceived',
  'annualizedReturn',
  'annualizedReturnWithGain',
  'daysToExpiration',
] as const;

export type NumericField = (typeof NUMERIC_FIELDS)[number];
