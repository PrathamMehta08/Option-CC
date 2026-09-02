import { describe, it, expect } from 'vitest';
import { coveredCall } from './coveredCall';
import { cashSecuredPut } from './cashSecuredPut';
import { STRATEGIES, STRATEGY_IDS, getStrategy, isStrategyId, DEFAULT_STRATEGY_ID } from './index';
import { screenExpiration, screenChain } from '../screen';
import type { YahooOptionQuote } from '../optionChain';

/**
 * A fixed synthetic chain around a $100 underlying. Deltas are computed by the
 * strategy, so the assertions below are about which contracts survive and what
 * capital each demands — not about hand-copied delta values.
 */
const SPOT = 100;

const CHAIN: YahooOptionQuote[] = [
  { strike: 80, impliedVolatility: 0.35, bid: 21.0, ask: 21.4, openInterest: 100, volume: 10 },
  { strike: 90, impliedVolatility: 0.32, bid: 12.0, ask: 12.4, openInterest: 200, volume: 20 },
  { strike: 95, impliedVolatility: 0.31, bid: 7.5, ask: 7.9, openInterest: 300, volume: 30 },
  { strike: 100, impliedVolatility: 0.3, bid: 4.0, ask: 4.4, openInterest: 900, volume: 90 },
  { strike: 105, impliedVolatility: 0.31, bid: 2.2, ask: 2.5, openInterest: 500, volume: 50 },
  { strike: 110, impliedVolatility: 0.32, bid: 1.1, ask: 1.4, openInterest: 400, volume: 40 },
  { strike: 120, impliedVolatility: 0.35, bid: 0.35, ask: 0.5, openInterest: 150, volume: 15 },
];

const EXPIRATION = { expiration: '2026-12-18', daysToExpiration: 90, contracts: CHAIN };

describe('the registry', () => {
  it('exposes both strategies and defaults to covered calls', () => {
    expect(STRATEGY_IDS).toEqual(['covered-call', 'cash-secured-put']);
    expect(DEFAULT_STRATEGY_ID).toBe('covered-call');
    expect(getStrategy(null).id).toBe('covered-call');
  });

  it('falls back to the default for unknown ids rather than throwing', () => {
    expect(getStrategy('wheel').id).toBe(DEFAULT_STRATEGY_ID);
    expect(getStrategy(undefined).id).toBe(DEFAULT_STRATEGY_ID);
    expect(isStrategyId('covered-call')).toBe(true);
    expect(isStrategyId('nope')).toBe(false);
  });

  it('keeps every strategy internally consistent', () => {
    for (const id of STRATEGY_IDS) {
      const strategy = STRATEGIES[id];
      expect(strategy.id).toBe(id);
      expect(['calls', 'puts']).toContain(strategy.chainSide);
      expect(strategy.defaults.deltaMagnitude).toBeGreaterThan(0);
      const [lo, hi] = strategy.deltaWindow(strategy.defaults.deltaMagnitude);
      expect(lo).toBeLessThan(hi);
    }
  });
});

describe('covered call', () => {
  it('reads the call side', () => {
    expect(coveredCall.chainSide).toBe('calls');
  });

  it('requires the market value of 100 shares, the same at every strike', () => {
    for (const contract of CHAIN) {
      expect(coveredCall.capitalRequiredPerContract(contract, SPOT)).toBe(10_000);
    }
  });

  it('treats every contract as eligible, including in the money', () => {
    expect(CHAIN.every((c) => coveredCall.isEligible(c, SPOT))).toBe(true);
  });

  it('maps a delta magnitude to a positive window', () => {
    expect(coveredCall.deltaWindow(0.3)).toEqual([0, 0.3]);
    // A negative magnitude from a confused caller is still read as a magnitude.
    expect(coveredCall.deltaWindow(-0.3)).toEqual([0, 0.3]);
  });

  it('keeps only contracts at or below the delta limit', () => {
    const rows = screenExpiration(EXPIRATION, {
      strategy: coveredCall,
      currentPrice: SPOT,
      capital: 100_000,
      deltaMagnitude: 0.3,
    });

    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.delta).toBeGreaterThanOrEqual(0);
      expect(r.delta).toBeLessThanOrEqual(0.3);
    }
    // Deep ITM strikes have deltas near 1 and must be screened out.
    expect(rows.map((r) => r.strike)).not.toContain(80);
    // A 0.3-delta call on this chain is out of the money.
    expect(rows.every((r) => r.strike > SPOT)).toBe(true);
  });

  it('widens the result set as the delta limit rises', () => {
    const tight = screenExpiration(EXPIRATION, {
      strategy: coveredCall,
      currentPrice: SPOT,
      capital: 100_000,
      deltaMagnitude: 0.2,
    });
    const loose = screenExpiration(EXPIRATION, {
      strategy: coveredCall,
      currentPrice: SPOT,
      capital: 100_000,
      deltaMagnitude: 0.6,
    });
    expect(loose.length).toBeGreaterThan(tight.length);
  });

  it('computes per-contract economics from the bid', () => {
    const rows = screenExpiration(EXPIRATION, {
      strategy: coveredCall,
      currentPrice: SPOT,
      capital: 100_000,
      deltaMagnitude: 1,
    });
    const row = rows.find((r) => r.strike === 110);
    expect(row).toBeDefined();
    // bid 1.1 -> $110 per contract against $10,000 of stock = 1.1%
    expect(row!.lastPrice).toBe(1.1);
    expect(row!.premiumPerContract).toBeCloseTo(110, 10);
    expect(row!.capitalRequiredPerContract).toBe(10_000);
    expect(row!.returnPct).toBeCloseTo(1.1, 10);
    // 90 days -> 1.1 * 365/90
    expect(row!.annualizedReturn).toBeCloseTo(1.1 * (365 / 90), 8);
  });
});

describe('cash-secured put', () => {
  it('reads the put side', () => {
    expect(cashSecuredPut.chainSide).toBe('puts');
  });

  it('requires the strike times 100, which varies by strike', () => {
    expect(cashSecuredPut.capitalRequiredPerContract({ strike: 95 }, SPOT)).toBe(9_500);
    expect(cashSecuredPut.capitalRequiredPerContract({ strike: 80 }, SPOT)).toBe(8_000);
  });

  it('screens out in-the-money and at-the-money puts', () => {
    expect(cashSecuredPut.isEligible({ strike: 95 }, SPOT)).toBe(true);
    expect(cashSecuredPut.isEligible({ strike: 100 }, SPOT)).toBe(false);
    expect(cashSecuredPut.isEligible({ strike: 105 }, SPOT)).toBe(false);
  });

  it('maps a delta magnitude to a negative window', () => {
    expect(cashSecuredPut.deltaWindow(0.3)).toEqual([-0.3, 0]);
    expect(cashSecuredPut.deltaWindow(-0.3)).toEqual([-0.3, 0]);
  });

  it('returns only out-of-the-money strikes within the delta window', () => {
    const rows = screenExpiration(EXPIRATION, {
      strategy: cashSecuredPut,
      currentPrice: SPOT,
      capital: 100_000,
      deltaMagnitude: 0.3,
    });

    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.strike).toBeLessThan(SPOT);
      expect(r.delta).toBeLessThanOrEqual(0);
      expect(r.delta).toBeGreaterThanOrEqual(-0.3);
      // Capital scales with the strike, unlike the covered call.
      expect(r.capitalRequiredPerContract).toBe(r.strike * 100);
    }
  });

  it('never returns a strike at or above spot, whatever the delta limit', () => {
    const rows = screenExpiration(EXPIRATION, {
      strategy: cashSecuredPut,
      currentPrice: SPOT,
      capital: 100_000,
      deltaMagnitude: 1,
    });
    expect(rows.every((r) => r.strike < SPOT)).toBe(true);
  });

  it('computes per-contract economics from the strike, not the spot', () => {
    const rows = screenExpiration(EXPIRATION, {
      strategy: cashSecuredPut,
      currentPrice: SPOT,
      capital: 100_000,
      deltaMagnitude: 1,
    });
    const row = rows.find((r) => r.strike === 90);
    expect(row).toBeDefined();
    // bid 12.0 -> $1,200 against 90 * 100 = $9,000
    expect(row!.premiumPerContract).toBeCloseTo(1_200, 10);
    expect(row!.capitalRequiredPerContract).toBe(9_000);
    expect(row!.returnPct).toBeCloseTo((1200 / 9000) * 100, 10);
  });
});

describe('the two strategies compared on the same chain', () => {
  const params = { currentPrice: SPOT, capital: 100_000, deltaMagnitude: 0.3 };

  it('demand different capital for the same strike', () => {
    const strike = { strike: 95 } as YahooOptionQuote;
    expect(coveredCall.capitalRequiredPerContract(strike, SPOT)).toBe(10_000); // spot * 100
    expect(cashSecuredPut.capitalRequiredPerContract(strike, SPOT)).toBe(9_500); // strike * 100
  });

  it('select opposite sides of the board', () => {
    const calls = screenExpiration(EXPIRATION, { ...params, strategy: coveredCall });
    const puts = screenExpiration(EXPIRATION, { ...params, strategy: cashSecuredPut });

    expect(calls.every((r) => r.strike > SPOT)).toBe(true);
    expect(puts.every((r) => r.strike < SPOT)).toBe(true);
    // No strike appears in both result sets.
    const overlap = calls.filter((c) => puts.some((p) => p.strike === c.strike));
    expect(overlap).toHaveLength(0);
  });

  it('produce deltas of opposite sign', () => {
    const calls = screenExpiration(EXPIRATION, { ...params, strategy: coveredCall });
    const puts = screenExpiration(EXPIRATION, { ...params, strategy: cashSecuredPut });
    expect(calls.every((r) => r.delta >= 0)).toBe(true);
    expect(puts.every((r) => r.delta <= 0)).toBe(true);
  });
});

describe('screenChain', () => {
  const second = { expiration: '2027-01-15', daysToExpiration: 120, contracts: CHAIN };

  it('merges expirations and ranks by annualized return', () => {
    const rows = screenChain([EXPIRATION, second], {
      strategy: coveredCall,
      currentPrice: SPOT,
      capital: 100_000,
      deltaMagnitude: 0.5,
    });

    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].annualizedReturn).toBeGreaterThanOrEqual(rows[i].annualizedReturn);
    }
    expect(new Set(rows.map((r) => r.expiration)).size).toBe(2);
  });

  // The zero-return regression, end to end through the screener.
  it('reports real returns even when capital covers zero contracts', () => {
    const rows = screenChain([EXPIRATION], {
      strategy: coveredCall,
      currentPrice: SPOT,
      capital: 500, // covers nothing: one contract needs $10,000
      deltaMagnitude: 0.5,
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.maxContracts === 0)).toBe(true);
    expect(rows.every((r) => r.totalCapitalRequired === 0)).toBe(true);
    // ...and yet every row still carries a real, non-zero return.
    expect(rows.every((r) => r.returnPct > 0)).toBe(true);
    expect(rows.every((r) => r.annualizedReturn > 0)).toBe(true);
  });

  it('gives identical returns for a large and a tiny account', () => {
    const rich = screenChain([EXPIRATION], {
      strategy: coveredCall,
      currentPrice: SPOT,
      capital: 10_000_000,
      deltaMagnitude: 0.5,
    });
    const poor = screenChain([EXPIRATION], {
      strategy: coveredCall,
      currentPrice: SPOT,
      capital: 1,
      deltaMagnitude: 0.5,
    });

    expect(rich.map((r) => r.annualizedReturn)).toEqual(poor.map((r) => r.annualizedReturn));
    expect(rich[0].maxContracts).toBeGreaterThan(0);
    expect(poor[0].maxContracts).toBe(0);
  });

  it('skips contracts with no implied volatility rather than emitting NaN', () => {
    const rows = screenChain(
      [{ ...EXPIRATION, contracts: [{ strike: 105, bid: 1, ask: 1.2 }] }],
      { strategy: coveredCall, currentPrice: SPOT, capital: 100_000, deltaMagnitude: 0.3 }
    );
    // sigma = 0 makes calculateCallDelta return its guard value of 1, which is
    // outside a 0.3 window, so the contract is dropped rather than shown as NaN.
    expect(rows).toHaveLength(0);
    expect(rows.every((r) => Number.isFinite(r.annualizedReturn))).toBe(true);
  });
});
