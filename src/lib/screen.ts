import type { ScreenedOption, YahooOptionQuote } from './optionChain';
import type { StrategyDefinition } from './strategies/types';
import {
  annualizeReturn,
  contractReturnPct,
  effectivePremium,
  maxContractsFor,
  premiumPerContract,
} from './returns';

export const DEFAULT_RISK_FREE_RATE = 0.05;

export interface ScreenParams {
  strategy: StrategyDefinition;
  /** Spot price of the underlying. */
  currentPrice: number;
  /** The user's available capital, used only for the informational fields. */
  capital: number;
  /** Positive delta magnitude; the strategy applies the sign. */
  deltaMagnitude: number;
  riskFreeRate?: number;
}

export interface ExpirationInput {
  /** ISO date, e.g. "2026-09-04". */
  expiration: string;
  daysToExpiration: number;
  contracts: YahooOptionQuote[];
}

/**
 * Turn one expiration's raw contracts into screened rows.
 *
 * Pure: no network, no clock. Everything strategy-specific comes through the
 * StrategyDefinition, so this same function screens every strategy.
 */
export function screenExpiration(input: ExpirationInput, params: ScreenParams): ScreenedOption[] {
  const { strategy, currentPrice, capital } = params;
  const riskFreeRate = params.riskFreeRate ?? DEFAULT_RISK_FREE_RATE;
  const [minDelta, maxDelta] = strategy.deltaWindow(params.deltaMagnitude);

  const t = input.daysToExpiration / 365.0;
  const rows: ScreenedOption[] = [];

  for (const contract of input.contracts) {
    if (!strategy.isEligible(contract, currentPrice)) continue;

    const sigma = contract.impliedVolatility || 0;
    const delta = strategy.delta(currentPrice, contract.strike, t, sigma, riskFreeRate);
    if (delta < minDelta || delta > maxDelta) continue;

    const capitalRequired = strategy.capitalRequiredPerContract(contract, currentPrice);
    const premiumPerShare = effectivePremium(contract);

    // Per-contract economics: properties of the contract, never of the bankroll.
    const premium = premiumPerContract(premiumPerShare);
    const returnPct = contractReturnPct(premium, capitalRequired);

    // Assignment return: premium plus whatever the strike is worth against
    // today's price. Same capital, same annualisation.
    const gain = premiumPerContract(strategy.assignmentGainPerShare(contract, currentPrice));
    const returnWithGainPct = contractReturnPct(premium + gain, capitalRequired);

    // Affordability is reported alongside, never folded into the returns.
    const maxContracts = maxContractsFor(capital, capitalRequired);

    rows.push({
      expiration: input.expiration,
      daysToExpiration: input.daysToExpiration,
      strike: contract.strike,
      lastPrice: premiumPerShare,
      high: contract.ask ?? premiumPerShare,
      delta,
      iv: sigma * 100,
      moneyness: ((contract.strike - currentPrice) / currentPrice) * 100,
      openInterest: contract.openInterest || 0,
      volume: contract.volume || 0,
      capitalRequiredPerContract: capitalRequired,
      premiumPerContract: premium,
      returnPct,
      annualizedReturn: annualizeReturn(returnPct, input.daysToExpiration),
      returnWithGainPct,
      annualizedReturnWithGain: annualizeReturn(returnWithGainPct, input.daysToExpiration),
      maxContracts,
      totalCapitalRequired: maxContracts * capitalRequired,
      totalPremiumReceived: maxContracts * premium,
    });
  }

  return rows;
}

/** Screen several expirations and rank by annualized return, best first. */
export function screenChain(
  expirations: ExpirationInput[],
  params: ScreenParams
): ScreenedOption[] {
  const rows = expirations.flatMap((expiration) => screenExpiration(expiration, params));
  return rows.sort((a, b) => b.annualizedReturn - a.annualizedReturn);
}
