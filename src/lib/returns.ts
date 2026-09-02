/**
 * Return math for option selling.
 *
 * The important property here: a contract's return is a property of the
 * contract, not of the user's bankroll. Premium collected divided by capital
 * secured is the same number whether you can afford one contract or fifty.
 * Mixing affordability into the ratio is what made every row read 0.00%.
 */

/** One contract covers 100 shares. */
export const SHARES_PER_CONTRACT = 100;

/** Premium collected on a single contract, from the per-share premium. */
export function premiumPerContract(premiumPerShare: number): number {
  return premiumPerShare * SHARES_PER_CONTRACT;
}

/**
 * Return on a single contract as a percentage of the capital that contract
 * ties up. Independent of how many contracts the user can afford.
 */
export function contractReturnPct(
  premiumForOneContract: number,
  capitalRequiredForOneContract: number
): number {
  if (capitalRequiredForOneContract <= 0) return 0;
  return (premiumForOneContract / capitalRequiredForOneContract) * 100;
}

/**
 * Scale a holding-period return to a yearly rate. A 1% return held 30 days
 * annualizes to 1 * 365/30 = 12.17%.
 */
export function annualizeReturn(returnPct: number, daysToExpiration: number): number {
  if (daysToExpiration <= 0) return 0;
  return returnPct * (365 / daysToExpiration);
}

/**
 * How many contracts the user's capital covers. Informational only — it must
 * never feed back into the return figures.
 */
export function maxContractsFor(capital: number, capitalRequiredForOneContract: number): number {
  if (capitalRequiredForOneContract <= 0) return 0;
  if (capital <= 0) return 0;
  return Math.floor(capital / capitalRequiredForOneContract);
}

/**
 * The premium a seller can realistically collect: the bid is what you can sell
 * into today, so prefer it, then the mid, then the last trade.
 */
export function effectivePremium(quote: {
  bid?: number;
  ask?: number;
  lastPrice?: number;
}): number {
  if (quote.bid !== undefined && quote.bid > 0) return quote.bid;
  if (quote.bid !== undefined && quote.ask !== undefined && quote.bid + quote.ask > 0) {
    return (quote.bid + quote.ask) / 2;
  }
  return quote.lastPrice ?? 0;
}
