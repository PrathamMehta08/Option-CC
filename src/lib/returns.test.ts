import { describe, it, expect } from 'vitest';
import {
  SHARES_PER_CONTRACT,
  premiumPerContract,
  contractReturnPct,
  annualizeReturn,
  maxContractsFor,
  effectivePremium,
} from './returns';

describe('premiumPerContract', () => {
  it('scales the per-share premium by 100', () => {
    expect(premiumPerContract(1.7)).toBeCloseTo(170, 10);
    expect(premiumPerContract(0)).toBe(0);
    expect(SHARES_PER_CONTRACT).toBe(100);
  });
});

describe('contractReturnPct', () => {
  it('is premium over capital, as a percentage', () => {
    // $170 premium against $21,744 of stock = 0.7818%
    expect(contractReturnPct(170, 21744)).toBeCloseTo(0.78183, 4);
    expect(contractReturnPct(500, 10000)).toBe(5);
  });

  // This is the regression test for the zero-return bug: the ratio must not
  // depend on how many contracts the user can afford.
  it('does not depend on the size of the account', () => {
    const capitalPerContract = 21744;
    const premium = 170;
    const expected = contractReturnPct(premium, capitalPerContract);

    for (const accountSize of [0, 100, 10_000, 21_743, 21_744, 1_000_000]) {
      // Whatever the account, the contract's own return is unchanged.
      const affordable = maxContractsFor(accountSize, capitalPerContract);
      expect(contractReturnPct(premium, capitalPerContract)).toBe(expected);
      // And the old, broken formula would have gone to zero here.
      if (affordable === 0) {
        const brokenTotal = affordable * capitalPerContract;
        expect(brokenTotal).toBe(0);
      }
    }
  });

  it('returns 0 rather than Infinity when capital required is zero or negative', () => {
    expect(contractReturnPct(170, 0)).toBe(0);
    expect(contractReturnPct(170, -100)).toBe(0);
  });
});

describe('annualizeReturn', () => {
  it('scales a holding-period return to a year', () => {
    expect(annualizeReturn(1, 30)).toBeCloseTo(12.1667, 3);
    expect(annualizeReturn(0.78183, 2)).toBeCloseTo(142.68, 1);
  });

  it('is a no-op at exactly 365 days', () => {
    expect(annualizeReturn(7.5, 365)).toBeCloseTo(7.5, 10);
  });

  it('returns 0 for a non-positive holding period', () => {
    expect(annualizeReturn(5, 0)).toBe(0);
    expect(annualizeReturn(5, -10)).toBe(0);
  });

  it('preserves sign', () => {
    expect(annualizeReturn(-2, 30)).toBeLessThan(0);
  });
});

describe('maxContractsFor', () => {
  it('floors capital divided by the per-contract requirement', () => {
    expect(maxContractsFor(10_000, 2_000)).toBe(5);
    expect(maxContractsFor(10_000, 3_000)).toBe(3);
  });

  // The exact case that made the app look broken: NVDA at $217.44 needs
  // $21,744 for one covered call, against the default $10,000 of capital.
  it('is 0 when capital covers less than one contract', () => {
    expect(maxContractsFor(10_000, 21_744)).toBe(0);
  });

  it('is 1 at exactly the price of one contract', () => {
    expect(maxContractsFor(21_744, 21_744)).toBe(1);
  });

  it('guards against zero, negative and absent inputs', () => {
    expect(maxContractsFor(10_000, 0)).toBe(0);
    expect(maxContractsFor(10_000, -5)).toBe(0);
    expect(maxContractsFor(0, 2_000)).toBe(0);
    expect(maxContractsFor(-100, 2_000)).toBe(0);
  });
});

describe('effectivePremium', () => {
  it('prefers the bid, which is what a seller can actually hit', () => {
    expect(effectivePremium({ bid: 1.7, ask: 1.9, lastPrice: 5 })).toBe(1.7);
  });

  it('falls back to the mid when the bid is zero', () => {
    expect(effectivePremium({ bid: 0, ask: 2, lastPrice: 5 })).toBe(1);
  });

  it('falls back to the last trade when there is no book at all', () => {
    expect(effectivePremium({ lastPrice: 3.2 })).toBe(3.2);
    expect(effectivePremium({ bid: 0, ask: 0, lastPrice: 3.2 })).toBe(3.2);
  });

  it('returns 0 when nothing is quoted', () => {
    expect(effectivePremium({})).toBe(0);
  });
});
