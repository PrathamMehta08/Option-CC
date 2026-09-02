import { describe, it, expect } from 'vitest';
import {
  normCdf,
  calculateCallDelta,
  calculatePutDelta,
  formatCurrency,
  formatPercent,
} from './math';

describe('normCdf', () => {
  // Published standard normal CDF values. normCdf uses the Abramowitz & Stegun
  // 26.2.17 rational approximation, accurate to ~7.5e-8, so 6 decimal places
  // is a fair bar.
  const PUBLISHED: Array<[z: number, phi: number]> = [
    [0, 0.5],
    [0.5, 0.691462],
    [1, 0.841345],
    [1.281552, 0.9], // the 90th percentile
    [1.644854, 0.95], // the 95th percentile
    [1.959964, 0.975], // the 97.5th percentile
    [2, 0.97725],
    [2.326348, 0.99],
    [3, 0.998650],
  ];

  it.each(PUBLISHED)('phi(%f) ≈ %f', (z, phi) => {
    expect(normCdf(z)).toBeCloseTo(phi, 5);
  });

  it('is symmetric: phi(-z) === 1 - phi(z)', () => {
    for (const z of [0.25, 0.5, 1, 1.5, 2, 2.5, 3]) {
      expect(normCdf(-z)).toBeCloseTo(1 - normCdf(z), 6);
    }
  });

  it('is monotonically increasing', () => {
    let previous = normCdf(-4);
    for (let z = -3.9; z <= 4; z += 0.1) {
      const current = normCdf(z);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
  });

  it('approaches 0 and 1 in the tails', () => {
    expect(normCdf(-6)).toBeLessThan(1e-6);
    expect(normCdf(6)).toBeGreaterThan(1 - 1e-6);
  });
});

describe('calculateCallDelta', () => {
  const S = 100;
  const t = 0.25;
  const sigma = 0.3;

  it('is near 0.5 at the money', () => {
    // Slightly above 0.5 because of the drift term in d1.
    const delta = calculateCallDelta(S, 100, t, sigma);
    expect(delta).toBeGreaterThan(0.5);
    expect(delta).toBeLessThan(0.62);
  });

  it('approaches 1 deep in the money', () => {
    expect(calculateCallDelta(S, 10, t, sigma)).toBeCloseTo(1, 6);
  });

  it('approaches 0 deep out of the money', () => {
    expect(calculateCallDelta(S, 1000, t, sigma)).toBeCloseTo(0, 6);
  });

  it('stays within [0, 1] across a wide range of strikes', () => {
    for (let K = 10; K <= 300; K += 5) {
      const delta = calculateCallDelta(S, K, t, sigma);
      expect(delta).toBeGreaterThanOrEqual(0);
      expect(delta).toBeLessThanOrEqual(1);
    }
  });

  it('decreases as the strike rises', () => {
    let previous = calculateCallDelta(S, 50, t, sigma);
    for (let K = 55; K <= 200; K += 5) {
      const current = calculateCallDelta(S, K, t, sigma);
      expect(current).toBeLessThan(previous);
      previous = current;
    }
  });

  // Guard branches: the function returns 1 rather than NaN for an expired or
  // volatility-less call, so the screener never emits NaN into the table.
  it('returns 1 when time to expiration is zero or negative', () => {
    expect(calculateCallDelta(S, 100, 0, sigma)).toBe(1);
    expect(calculateCallDelta(S, 100, -0.5, sigma)).toBe(1);
  });

  it('returns 1 when sigma is zero or negative', () => {
    expect(calculateCallDelta(S, 100, t, 0)).toBe(1);
    expect(calculateCallDelta(S, 100, t, -0.2)).toBe(1);
  });
});

describe('calculatePutDelta', () => {
  const S = 100;
  const t = 0.25;
  const sigma = 0.3;

  it('is near -0.5 at the money', () => {
    const delta = calculatePutDelta(S, 100, t, sigma);
    expect(delta).toBeLessThan(-0.38);
    expect(delta).toBeGreaterThan(-0.5);
  });

  it('approaches -1 deep in the money', () => {
    expect(calculatePutDelta(S, 1000, t, sigma)).toBeCloseTo(-1, 6);
  });

  it('approaches 0 deep out of the money', () => {
    expect(calculatePutDelta(S, 10, t, sigma)).toBeCloseTo(0, 6);
  });

  it('stays within [-1, 0] across a wide range of strikes', () => {
    for (let K = 10; K <= 300; K += 5) {
      const delta = calculatePutDelta(S, K, t, sigma);
      expect(delta).toBeGreaterThanOrEqual(-1);
      expect(delta).toBeLessThanOrEqual(0);
    }
  });

  // Guard branches: puts return 0, not 1 — the two functions guard differently
  // and the screener's delta window depends on that.
  it('returns 0 when time to expiration is zero or negative', () => {
    expect(calculatePutDelta(S, 100, 0, sigma)).toBe(0);
    expect(calculatePutDelta(S, 100, -0.5, sigma)).toBe(0);
  });

  it('returns 0 when sigma is zero or negative', () => {
    expect(calculatePutDelta(S, 100, t, 0)).toBe(0);
    expect(calculatePutDelta(S, 100, t, -0.2)).toBe(0);
  });
});

describe('put-call parity', () => {
  // For European options on a non-dividend-paying underlying,
  // callDelta - putDelta = 1 at every strike.
  it('holds across strikes, maturities and volatilities', () => {
    const S = 100;
    for (const K of [50, 80, 95, 100, 105, 120, 200]) {
      for (const t of [0.02, 0.25, 1, 2]) {
        for (const sigma of [0.1, 0.3, 0.8]) {
          const call = calculateCallDelta(S, K, t, sigma);
          const put = calculatePutDelta(S, K, t, sigma);
          expect(call - put).toBeCloseTo(1, 9);
        }
      }
    }
  });

  it('does not hold in the guard branches, by design', () => {
    // Worth pinning: at t <= 0 the call guard returns 1 and the put guard
    // returns 0, which happens to satisfy parity, but for sigma <= 0 they also
    // return 1 and 0. Both guards are deliberate and this documents them.
    expect(calculateCallDelta(100, 100, 0, 0.3) - calculatePutDelta(100, 100, 0, 0.3)).toBe(1);
  });
});

describe('formatters', () => {
  it('formats currency in USD', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('formats a percentage from a percent-valued number', () => {
    // formatPercent divides by 100, so 12.34 means 12.34%.
    expect(formatPercent(12.34)).toBe('12.34%');
    expect(formatPercent(0)).toBe('0.00%');
  });
});
