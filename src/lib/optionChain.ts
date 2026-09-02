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

  maxContracts: number;
  totalCapitalRequired: number;
  totalPremiumReceived: number;
  annualizedReturn: number;
}

export interface ScreenerResponse {
  ticker: string;
  strategy: string;
  currentPrice: number;
  options: ScreenedOption[];
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
  'daysToExpiration',
] as const;

export type NumericField = (typeof NUMERIC_FIELDS)[number];
