import { describe, it, expect } from 'vitest';
import { screenExpiration } from './screen';
import { coveredCall } from './strategies/coveredCall';
import { cashSecuredPut } from './strategies/cashSecuredPut';
import type { YahooOptionQuote } from './optionChain';

/**
 * Return if assigned = (premium + capital gain at the strike) / capital, annualised.
 *
 * The plain annualizedReturn only counts premium. This adds what the strike is
 * worth against today's price, which for a covered call is the difference
 * between "I collected $1.70" and "I collected $1.70 and sold my shares $10
 * higher than they trade now".
 */
const SPOT = 100;

/** One contract, 90 days out, $2.00 bid. */
function chain(strike: number): YahooOptionQuote[] {
  return [{ strike, impliedVolatility: 0.3, bid: 2, ask: 2.2, openInterest: 100, volume: 10 }];
}

const screen = (strategy: typeof coveredCall, strike: number, days = 90) =>
  screenExpiration(
    { expiration: '2026-12-18', daysToExpiration: days, contracts: chain(strike) },
    { strategy, currentPrice: SPOT, capital: 1_000_000, deltaMagnitude: 1 }
  )[0];

describe('covered call: return if called', () => {
  it('adds the gain from selling at a strike above spot', () => {
    // $110 strike: $2 premium + $10 gain = $12 on $10,000 of stock = 12%.
    const row = screen(coveredCall, 110);
    expect(row.returnPct).toBeCloseTo(2, 10);
    expect(row.returnWithGainPct).toBeCloseTo(12, 10);
  });

  it('annualises it over the holding period', () => {
    const row = screen(coveredCall, 110, 90);
    expect(row.annualizedReturnWithGain).toBeCloseTo(12 * (365 / 90), 8);
    // And is a bigger number than the premium-only figure, as it must be.
    expect(row.annualizedReturnWithGain).toBeGreaterThan(row.annualizedReturn);
  });

  it('scales with the time to expiry, not just the payoff', () => {
    const near = screen(coveredCall, 110, 30);
    const far = screen(coveredCall, 110, 180);
    expect(near.returnWithGainPct).toBeCloseTo(far.returnWithGainPct, 10);
    expect(near.annualizedReturnWithGain).toBeGreaterThan(far.annualizedReturnWithGain);
  });

  it('equals the premium-only return at the money, where there is no gain', () => {
    const row = screen(coveredCall, 100);
    expect(row.returnWithGainPct).toBeCloseTo(row.returnPct, 10);
  });

  // The case that would flatter a bad screen: selling a call below spot means
  // giving the shares up at a loss, and the metric has to show that.
  it('goes below the premium-only return on an in-the-money call', () => {
    const row = screen(coveredCall, 90);
    expect(row.returnWithGainPct).toBeCloseTo(-8, 10);
    expect(row.returnWithGainPct).toBeLessThan(row.returnPct);
    expect(row.annualizedReturnWithGain).toBeLessThan(0);
  });
});

describe('cash-secured put: no sale, so no gain', () => {
  it('matches the premium-only return', () => {
    // A put assigns you INTO the stock at the strike. There is no sale to book
    // a gain on, so counting (strike - spot) would invent a profit.
    const row = screen(cashSecuredPut, 90);
    expect(row.returnWithGainPct).toBeCloseTo(row.returnPct, 10);
    expect(row.annualizedReturnWithGain).toBeCloseTo(row.annualizedReturn, 10);
  });

  it('never reports a negative assignment return just because the strike is below spot', () => {
    for (const strike of [80, 90, 95, 99]) {
      expect(screen(cashSecuredPut, strike).returnWithGainPct).toBeGreaterThan(0);
    }
  });
});

describe('the strategies disagree, which is the point', () => {
  it('gives a covered call a higher assignment return than a put at the same strike', () => {
    const call = screen(coveredCall, 110);
    const put = screen(cashSecuredPut, 90);
    expect(call.returnWithGainPct).toBeGreaterThan(call.returnPct);
    expect(put.returnWithGainPct).toBeCloseTo(put.returnPct, 10);
  });
});
