import { addMonths } from 'date-fns';
import type { ScreenedOption, ScreenerResponse, YahooOptionQuote } from './optionChain';
import type { ChainResponse } from './chain';
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

    // Both figures are annualised by the same factor, so the ratio is the same
    // whether taken on the period or the annualised return.
    const premiumSharePct =
      returnWithGainPct > 0 ? (returnPct / returnWithGainPct) * 100 : NaN;

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
      premiumSharePct,
      totalProfitIfAssigned: maxContracts * (premium + gain),
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

/**
 * Which expirations fall inside a month window, anchored to a given date.
 *
 * The anchor is the moment the chain was fetched, not `new Date()`. The rows
 * carry a `daysToExpiration` computed at fetch time, so filtering against a
 * later clock could hide an expiration whose own row says it is still 3 days
 * out — a small inconsistency that reads as a bug.
 */
export function expirationsWithin<T extends { expiration: string }>(
  expirations: T[],
  minMonths: number,
  maxMonths: number,
  anchor: Date
): T[] {
  const start = addMonths(anchor, Math.min(minMonths, maxMonths));
  const end = addMonths(anchor, Math.max(minMonths, maxMonths));
  return expirations.filter((e) => {
    // Expiration dates are date-only; compare at the end of that day so an
    // expiry landing exactly on the window's first day is not excluded by the
    // anchor's time-of-day.
    const t = new Date(`${e.expiration}T23:59:59Z`).getTime();
    return t >= start.getTime() && t <= end.getTime();
  });
}

/**
 * Screen a fetched chain into the response shape the UI renders.
 *
 * This is the whole pipeline that used to live in the API route. Keeping it
 * pure means the client can re-run it whenever a knob moves — which is the
 * point: capital, delta, months and strategy are all local arithmetic over a
 * board we already have.
 */
export function screenLoadedChain(
  chain: ChainResponse,
  params: {
    strategy: StrategyDefinition;
    capital: number;
    deltaMagnitude: number;
    minMonths: number;
    maxMonths: number;
  }
): ScreenerResponse {
  const { strategy, capital, deltaMagnitude, minMonths, maxMonths } = params;
  const anchor = new Date(chain.fetchedAt);

  const inWindow = expirationsWithin(chain.expirations, minMonths, maxMonths, anchor);

  const inputs: ExpirationInput[] = inWindow.map((e) => ({
    expiration: e.expiration,
    daysToExpiration: e.daysToExpiration,
    contracts: e[strategy.chainSide],
  }));

  const options = screenChain(inputs, {
    strategy,
    currentPrice: chain.currentPrice,
    capital,
    deltaMagnitude,
  });

  return {
    ticker: chain.ticker,
    strategy: strategy.id,
    currentPrice: chain.currentPrice,
    options,
    affordableCount: options.filter((r) => r.maxContracts > 0).length,
    minCapitalRequired: options.length
      ? Math.min(...options.map((r) => r.capitalRequiredPerContract))
      : 0,
    message: inWindow.length === 0 ? 'No expirations in the selected range.' : undefined,
  };
}
