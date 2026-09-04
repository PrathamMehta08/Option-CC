import { describe, it, expect } from 'vitest';
import { screenLoadedChain, expirationsWithin } from './screen';
import { coveredCall } from './strategies/coveredCall';
import { cashSecuredPut } from './strategies/cashSecuredPut';
import { trimQuote, type ChainResponse } from './chain';

/**
 * The screener fetches one board per ticker and filters it locally. These cover
 * the part that used to be an API round trip: turning a raw chain plus a set of
 * knobs into rows.
 */
const FETCHED_AT = '2026-09-04T12:00:00.000Z';

const contract = (strike: number, bid: number) => ({
  strike,
  impliedVolatility: 0.3,
  bid,
  ask: bid + 0.2,
  openInterest: 100,
  volume: 10,
});

/** Spot is 100. Expirations roughly 1, 3 and 9 months out. */
function chain(): ChainResponse {
  return {
    ticker: 'TEST',
    companyName: 'Test Corp',
    currentPrice: 100,
    fetchedAt: FETCHED_AT,
    expirations: [
      {
        expiration: '2026-10-02',
        daysToExpiration: 28,
        calls: [contract(105, 1), contract(110, 0.5)],
        puts: [contract(95, 1), contract(90, 0.5)],
      },
      {
        expiration: '2026-12-04',
        daysToExpiration: 91,
        calls: [contract(105, 3), contract(120, 1)],
        puts: [contract(95, 3), contract(80, 1)],
      },
      {
        expiration: '2027-06-04',
        daysToExpiration: 273,
        calls: [contract(130, 6)],
        puts: [contract(70, 6)],
      },
    ],
  };
}

describe('the month window', () => {
  const anchor = new Date(FETCHED_AT);
  const exps = chain().expirations;

  it('keeps only the expirations inside it', () => {
    expect(expirationsWithin(exps, 0, 4, anchor).map((e) => e.expiration)).toEqual([
      '2026-10-02',
      '2026-12-04',
    ]);
  });

  it('excludes expirations before the near edge', () => {
    // Two months out from Sept 4 is Nov 4, so the October board drops away.
    expect(expirationsWithin(exps, 2, 12, anchor).map((e) => e.expiration)).toEqual([
      '2026-12-04',
      '2027-06-04',
    ]);
  });

  it('tolerates the bounds arriving the wrong way round', () => {
    // The sliders can be dragged past each other; a silently empty board would
    // read as "this ticker has no options".
    expect(expirationsWithin(exps, 4, 0, anchor)).toEqual(expirationsWithin(exps, 0, 4, anchor));
  });

  it('anchors to the fetch time, not the current clock', () => {
    // Same inputs, an anchor a year later: a different window, deterministically.
    const later = new Date('2027-09-04T12:00:00.000Z');
    expect(expirationsWithin(exps, 0, 4, later)).toEqual([]);
  });

  it('includes an expiration landing inside the window edge', () => {
    // Sept 4 plus one month is Oct 4; the Oct 2 board is inside it.
    expect(expirationsWithin(exps, 0, 1, anchor).map((e) => e.expiration)).toEqual(['2026-10-02']);
  });
});

describe('screening a loaded chain', () => {
  const params = { capital: 100_000, deltaMagnitude: 1, minMonths: 0, maxMonths: 12 };

  it('reads the side of the board the strategy trades', () => {
    const calls = screenLoadedChain(chain(), { ...params, strategy: coveredCall });
    const puts = screenLoadedChain(chain(), { ...params, strategy: cashSecuredPut });
    // Every call strike on this board is above spot, every put strike below.
    expect(calls.options.length).toBeGreaterThan(0);
    expect(puts.options.length).toBeGreaterThan(0);
    expect(calls.options.every((o) => o.strike > 100)).toBe(true);
    expect(puts.options.every((o) => o.strike < 100)).toBe(true);
  });

  it('switches strategy off one chain, which is why the fetch is per ticker', () => {
    const board = chain();
    const calls = screenLoadedChain(board, { ...params, strategy: coveredCall });
    const puts = screenLoadedChain(board, { ...params, strategy: cashSecuredPut });
    // Same object in, both sides out: no second request is possible here.
    expect(calls.strategy).toBe('covered-call');
    expect(puts.strategy).toBe('cash-secured-put');
  });

  it('narrows the rows when the month window narrows', () => {
    const wide = screenLoadedChain(chain(), { ...params, strategy: coveredCall });
    const narrow = screenLoadedChain(chain(), { ...params, strategy: coveredCall, maxMonths: 2 });
    expect(narrow.options.length).toBeLessThan(wide.options.length);
    expect(new Set(narrow.options.map((o) => o.expiration))).toEqual(new Set(['2026-10-02']));
  });

  it('changes only the affordability fields when capital changes', () => {
    const poor = screenLoadedChain(chain(), { ...params, strategy: coveredCall, capital: 1_000 });
    const rich = screenLoadedChain(chain(), { ...params, strategy: coveredCall, capital: 100_000 });
    // Per-contract returns are a property of the contract, not of the bankroll.
    expect(poor.options.map((o) => o.annualizedReturn)).toEqual(
      rich.options.map((o) => o.annualizedReturn)
    );
    expect(poor.affordableCount).toBe(0);
    expect(rich.affordableCount).toBeGreaterThan(0);
  });

  it('reports the cheapest contract so the UI can say what it would take', () => {
    const res = screenLoadedChain(chain(), { ...params, strategy: coveredCall, capital: 1 });
    // A covered call needs 100 shares at spot, the same for every strike.
    expect(res.minCapitalRequired).toBe(10_000);
  });

  it('explains an empty board rather than returning a bare empty list', () => {
    const res = screenLoadedChain(chain(), {
      ...params,
      strategy: coveredCall,
      minMonths: 20,
      maxMonths: 24,
    });
    expect(res.options).toEqual([]);
    expect(res.message).toMatch(/no expirations/i);
  });

  it('carries the ticker and spot through unchanged', () => {
    const res = screenLoadedChain(chain(), { ...params, strategy: coveredCall });
    expect(res.ticker).toBe('TEST');
    expect(res.currentPrice).toBe(100);
  });
});

describe('trimming a Yahoo contract', () => {
  it('keeps the fields the screener reads', () => {
    expect(trimQuote(contract(105, 1))).toEqual({
      strike: 105,
      impliedVolatility: 0.3,
      bid: 1,
      ask: 1.2,
      openInterest: 100,
      volume: 10,
    });
  });

  it('drops everything else, which is most of the payload', () => {
    const fat = { ...contract(105, 1), contractSymbol: 'X', currency: 'USD', change: 0.1 };
    expect(Object.keys(trimQuote(fat)).sort()).toEqual([
      'ask',
      'bid',
      'impliedVolatility',
      'openInterest',
      'strike',
      'volume',
    ]);
  });

  it('omits absent fields rather than serialising them as null', () => {
    expect(trimQuote({ strike: 105 })).toEqual({ strike: 105 });
  });
});
