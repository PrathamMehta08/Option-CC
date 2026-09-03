import { describe, it, expect } from 'vitest';
import { compileFormula } from './formula';
import type { ScreenedOption } from './optionChain';

function row(overrides: Partial<ScreenedOption> = {}): ScreenedOption {
  return {
    expiration: '2026-10-16',
    daysToExpiration: 45,
    strike: 220,
    lastPrice: 2,
    high: 2.2,
    delta: 0.3,
    iv: 40,
    moneyness: 5,
    openInterest: 1000,
    volume: 500,
    capitalRequiredPerContract: 22000,
    premiumPerContract: 200,
    returnPct: 0.9,
    annualizedReturn: 20,
    returnWithGainPct: 0,
    annualizedReturnWithGain: 0,
    maxContracts: 4,
    totalCapitalRequired: 88000,
    totalPremiumReceived: 800,
    ...overrides,
  };
}

const evalOn = (src: string, option = row()) => {
  const result = compileFormula(src);
  if (!result.ok) throw new Error(`expected "${src}" to compile: ${result.error}`);
  return result.formula.evaluate(option);
};

describe('arithmetic', () => {
  it('evaluates the example from the brief', () => {
    // oi^2 + ann return^2 = 1000^2 + 20^2
    expect(evalOn('oi^2 + ann return^2')).toBe(1_000_000 + 400);
  });

  it('applies standard precedence', () => {
    expect(evalOn('2 + 3 * strike')).toBe(2 + 3 * 220);
    expect(evalOn('(2 + 3) * strike')).toBe(5 * 220);
  });

  it('treats ^ as right associative', () => {
    // 2^3^2 is 2^9, not 8^2
    expect(evalOn('2 ^ 3 ^ 2 + strike * 0')).toBe(512);
  });

  it('binds ^ tighter than unary minus, as maths does', () => {
    // -delta^2 is -(delta^2), not (-delta)^2. The difference matters: a put's
    // delta is negative, and the wrong reading silently flips the sign.
    expect(evalOn('-delta^2')).toBeCloseTo(-0.09, 10);
    expect(evalOn('-delta^2', row({ delta: -0.3 }))).toBeCloseTo(-0.09, 10);
    expect(evalOn('(0 - delta)^2', row({ delta: -0.3 }))).toBeCloseTo(0.09, 10);
  });

  it('allows a negative exponent', () => {
    expect(evalOn('strike * 2^-2')).toBe(55);
  });

  it('supports the remaining operators', () => {
    expect(evalOn('volume / 100')).toBe(5);
    expect(evalOn('openInterest % 7')).toBe(1000 % 7);
    expect(evalOn('iv - delta')).toBeCloseTo(39.7, 10);
  });

  it('supports functions', () => {
    expect(evalOn('sqrt(openInterest)')).toBeCloseTo(Math.sqrt(1000), 10);
    expect(evalOn('max(iv, annualizedReturn)')).toBe(40);
    expect(evalOn('min(iv, annualizedReturn)')).toBe(20);
    expect(evalOn('abs(0 - delta)')).toBeCloseTo(0.3, 10);
    expect(evalOn('round(iv / 3)')).toBe(13);
  });
});

describe('column names', () => {
  it('accepts the trader shorthand a person would type', () => {
    expect(evalOn('oi')).toBe(1000);
    expect(evalOn('dte')).toBe(45);
    expect(evalOn('premium')).toBe(2);
    expect(evalOn('vol')).toBe(500);
    expect(evalOn('yield')).toBe(20);
  });

  it('accepts spaces, underscores and any casing in a name', () => {
    expect(evalOn('ann return')).toBe(20);
    expect(evalOn('ANN_RETURN')).toBe(20);
    expect(evalOn('Annualized Return')).toBe(20);
  });

  it('accepts the real column keys', () => {
    expect(evalOn('annualizedReturn')).toBe(20);
    expect(evalOn('totalPremiumReceived')).toBe(800);
  });

  it('reports which columns a formula reads', () => {
    const result = compileFormula('oi^2 + ann return^2');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect([...result.formula.fields].sort()).toEqual(['annualizedReturn', 'openInterest']);
    }
  });
});

describe('rejects anything outside the grammar', () => {
  const bad = (src: string) => {
    const r = compileFormula(src);
    expect(r.ok, `"${src}" should not compile`).toBe(false);
    return r.ok ? '' : r.error;
  };

  it('unknown columns', () => {
    expect(bad('sharpeRatio * 2')).toMatch(/unknown column/);
  });

  it('unknown functions', () => {
    expect(bad('fetch(1)')).toMatch(/unknown function/);
  });

  // The whole reason this parser exists rather than new Function.
  it('property access and globals', () => {
    bad('opt.iv');
    bad('window');
    bad('globalThis.fetch');
    bad('process.exit(1)');
    bad('constructor');
    bad('this.iv');
  });

  it('statements and calls that are not in the grammar', () => {
    bad('iv; fetch("http://x")');
    bad('(() => 1)()');
    bad('iv => iv');
    bad('new Date()');
    bad('iv && fetch(1)');
    bad('iv ? 1 : 2');
    bad('`${iv}`');
  });

  it('malformed arithmetic', () => {
    bad('iv +');
    bad('* iv');
    bad('(iv');
    bad('iv)');
    bad('iv 5');
  });

  it('the wrong number of function arguments', () => {
    expect(bad('min(iv)')).toMatch(/argument/);
    expect(bad('sqrt(1, 2)')).toMatch(/argument/);
  });

  it('a formula with no column in it', () => {
    expect(bad('1 + 2')).toMatch(/does not reference any column/);
  });

  it('empty and oversized input', () => {
    expect(bad('')).toMatch(/empty/);
    expect(bad('   ')).toMatch(/empty/);
    expect(bad('iv + '.repeat(60) + 'iv')).toMatch(/too long/);
  });
});

describe('numeric edge cases', () => {
  it('returns NaN rather than Infinity on division by zero', () => {
    expect(evalOn('iv / 0')).toBeNaN();
    expect(evalOn('iv % 0')).toBeNaN();
    // A row whose divisor happens to be zero should not sort to the top.
    expect(evalOn('annualizedReturn / openInterest', row({ openInterest: 0 }))).toBeNaN();
  });

  it('returns NaN rather than a complex or infinite value', () => {
    expect(evalOn('sqrt(0 - iv)')).toBeNaN();
    expect(evalOn('ln(iv * 0)')).toBeNaN();
  });

  it('handles a negative delta, as puts have', () => {
    expect(evalOn('delta^2', row({ delta: -0.3 }))).toBeCloseTo(0.09, 10);
    expect(evalOn('abs(delta)', row({ delta: -0.3 }))).toBeCloseTo(0.3, 10);
  });
});
