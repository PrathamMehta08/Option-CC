/**
 * The raw option chain for one underlying, fetched once and then filtered
 * locally.
 *
 * The screener used to ask the server for a *screened* board, which meant every
 * knob — capital, delta, months, strategy — was a round trip to Yahoo for data
 * we already had. This is the whole board instead: both sides, every
 * expiration, trimmed to the fields the screener actually reads. One fetch per
 * ticker, and every filter after that is local arithmetic.
 */
import type { YahooOptionQuote } from './optionChain';

/** One expiration's board, both sides. */
export interface RawExpiration {
  /** ISO date, e.g. "2026-09-04". */
  expiration: string;
  daysToExpiration: number;
  calls: YahooOptionQuote[];
  puts: YahooOptionQuote[];
}

export interface ChainResponse {
  ticker: string;
  /**
   * The company's actual name ("Apple Inc."), which is what a person reads.
   * Falls back to the symbol when Yahoo has no name for it.
   */
  companyName: string;
  currentPrice: number;
  /**
   * When the server pulled this, as an ISO timestamp. The client anchors its
   * month window to this rather than to the browser clock, so the days-to-expiry
   * the user filters on are the same ones the rows were built with.
   */
  fetchedAt: string;
  expirations: RawExpiration[];
}

/**
 * Trim a Yahoo contract to the fields the screener reads.
 *
 * Yahoo returns ~20 fields per contract and a full board runs to thousands of
 * contracts; shipping the rest would multiply the payload for data nothing
 * touches. Undefined fields are dropped rather than serialised as null.
 */
export function trimQuote(q: YahooOptionQuote): YahooOptionQuote {
  const out: YahooOptionQuote = { strike: q.strike };
  if (q.impliedVolatility !== undefined) out.impliedVolatility = q.impliedVolatility;
  if (q.bid !== undefined) out.bid = q.bid;
  if (q.ask !== undefined) out.ask = q.ask;
  if (q.lastPrice !== undefined) out.lastPrice = q.lastPrice;
  if (q.openInterest !== undefined) out.openInterest = q.openInterest;
  if (q.volume !== undefined) out.volume = q.volume;
  return out;
}
