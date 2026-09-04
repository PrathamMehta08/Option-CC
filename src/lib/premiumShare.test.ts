import { describe, it, expect } from 'vitest';
import { screenExpiration } from './screen';
import { coveredCall } from './strategies/coveredCall';
import { cashSecuredPut } from './strategies/cashSecuredPut';
import type { YahooOptionQuote } from './optionChain';

/**
 * Two figures that answer "where does the money come from, and how much of it
 * is there":
 *
 *   premiumSharePct      premium return / assignment return, as a percentage
 *   totalProfitIfAssigned  (premium + gain) * however many contracts fit
 *
 * The share matters because two contracts can show the same assignment return
 * while one is paid up front and the other only pays if the stock cooperates.
 */
const SPOT = 100;

/** One contract, 90 days out, $2.00 bid — $200 of premium per contract. */
function chain(strike: number): YahooOptionQuote[] {
  return [{ strike, impliedVolatility: 0.3, bid: 2, ask: 2.2, openInterest: 100, volume: 10 }];
}

const screen = (strategy: typeof coveredCall, strike: number, capital = 1_000_000, days = 90) =>
  screenExpiration(
    { expiration: '2026-12-18', daysToExpiration: days, contracts: chain(strike) },
    { strategy, currentPrice: SPOT, capital, deltaMagnitude: 1 }
  )[0];

describe('premium share', () => {
  it('is the premium slice of the assignment return', () => {
    // $110 call: 2% premium out of a 12% total, so premium is one sixth of it.
    const row = screen(coveredCall, 110);
    expect(row.premiumSharePct).toBeCloseTo((2 / 12) * 100, 8);
  });

  it('is 100% when there is no capital gain to share with', () => {
    // At the money for a call, and at any strike for a put: assignment adds
    // nothing beyond the premium, so the premium is the whole return.
    expect(screen(coveredCall, 100).premiumSharePct).toBeCloseTo(100, 8);
    expect(screen(cashSecuredPut, 90).premiumSharePct).toBeCloseTo(100, 8);
  });

  it('falls as the strike moves further out of the money', () => {
    // Further out, more of the return is a bet on the stock rising.
    const near = screen(coveredCall, 105).premiumSharePct;
    const far = screen(coveredCall, 120).premiumSharePct;
    expect(near).toBeGreaterThan(far);
  });

  it('is NaN when the assignment return is negative, not a signed percentage', () => {
    // A $90 call assigns at a loss: -8% total against +2% premium. "-25%"
    // would read as a ratio the user could compare; NaN renders as a dash.
    const row = screen(coveredCall, 90);
    expect(row.returnWithGainPct).toBeLessThan(0);
    expect(Number.isNaN(row.premiumSharePct)).toBe(true);
  });

  it('is unaffected by annualisation, since both legs scale together', () => {
    const near = screen(coveredCall, 110, 1_000_000, 30);
    const far = screen(coveredCall, 110, 1_000_000, 180);
    expect(near.premiumSharePct).toBeCloseTo(far.premiumSharePct, 8);
  });
});

describe('total profit if assigned', () => {
  it('multiplies premium plus gain by the contracts the capital covers', () => {
    // $110 call needs $10,000 of stock per contract, so $25,000 buys two.
    // Each pays $200 premium + $1,000 gain.
    const row = screen(coveredCall, 110, 25_000);
    expect(row.maxContracts).toBe(2);
    expect(row.totalProfitIfAssigned).toBeCloseTo(2 * 1_200, 8);
  });

  it('counts premium only for a put, which books no gain', () => {
    // $90 put reserves $9,000 per contract; $25,000 covers two.
    const row = screen(cashSecuredPut, 90, 25_000);
    expect(row.maxContracts).toBe(2);
    expect(row.totalProfitIfAssigned).toBeCloseTo(2 * 200, 8);
  });

  it('is zero when nothing is affordable, rather than a per-contract figure', () => {
    const row = screen(coveredCall, 110, 5_000);
    expect(row.maxContracts).toBe(0);
    expect(row.totalProfitIfAssigned).toBe(0);
    // The per-contract return is still reported — affordability never folds in.
    expect(row.returnWithGainPct).toBeCloseTo(12, 10);
  });

  it('goes negative on an in-the-money call, where assignment is a loss', () => {
    const row = screen(coveredCall, 90, 25_000);
    expect(row.totalProfitIfAssigned).toBeLessThan(0);
  });
});

describe('strategies declare which side of spot is out of the money', () => {
  it('puts a covered call above spot and a cash-secured put below it', () => {
    expect(coveredCall.otmDirection).toBe('above');
    expect(cashSecuredPut.otmDirection).toBe('below');
  });
});
