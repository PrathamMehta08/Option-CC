import { describe, it, expect } from 'vitest';
import { describeScreen, type ScreenState } from './screenSummary';
import { compileFormula } from '@/lib/formula';
import type { ScreenedOption, ScreenerResponse } from '@/lib/optionChain';

function row(overrides: Partial<ScreenedOption> = {}): ScreenedOption {
  return {
    expiration: '2026-10-16',
    daysToExpiration: 45,
    strike: 330,
    lastPrice: 2.5,
    high: 2.7,
    delta: 0.28,
    iv: 31.4,
    moneyness: 1.5,
    openInterest: 1200,
    volume: 400,
    capitalRequiredPerContract: 32496,
    premiumPerContract: 250,
    returnPct: 0.77,
    annualizedReturn: 6.24,
    returnWithGainPct: 0,
    annualizedReturnWithGain: 0,
    premiumSharePct: 100,
    totalProfitIfAssigned: 0,
    maxContracts: 3,
    totalCapitalRequired: 97488,
    totalPremiumReceived: 750,
    ...overrides,
  };
}

function response(overrides: Partial<ScreenerResponse> = {}): ScreenerResponse {
  return {
    ticker: 'AAPL',
    strategy: 'covered-call',
    currentPrice: 324.96,
    options: [row(), row({ strike: 335 })],
    affordableCount: 2,
    minCapitalRequired: 32496,
    ...overrides,
  };
}

function state(overrides: Partial<ScreenState> = {}): ScreenState {
  return {
    data: response(),
    loading: false,
    visible: [row()],
    companyName: 'Apple Inc.',
    strategyName: 'Covered Calls',
    resultsView: 'table',
    capital: '100,000',
    selectedExpirations: ['2026-10-16', '2026-11-20', '2027-03-19'],
    strikePct: { min: null, max: null },
    minMonths: 0,
    maxMonths: 6,
    deltaSign: '',
    deltaMagnitude: 0.3,
    strikeFilter: [330, 460],
    customFilters: [],
    computedColumns: [],
    sort: { key: null, direction: null },
    ...overrides,
  };
}

describe('describeScreen', () => {
  // The question that exposed the gap: "what is the last AAPL price".
  it('reports the underlying and its last price', () => {
    expect(describeScreen(state())).toContain('Underlying: Apple Inc. (AAPL), last price $324.96.');
  });

  it('says plainly when nothing has been scanned', () => {
    const text = describeScreen(state({ data: null }));
    expect(text).toMatch(/Nothing is loaded/);
    expect(text).toMatch(/setTicker/);
    // No invented numbers when there is no data.
    expect(text).not.toMatch(/\$\d/);
  });

  it('flags that a scan is in flight, so stale figures are not passed off as current', () => {
    expect(describeScreen(state({ loading: true }))).toMatch(/A scan is running/);
  });

  it('gives both the scanned count and the count after filters', () => {
    expect(describeScreen(state())).toContain('Scan returned 2 contracts; 1 shown after filters.');
  });

  it('reports the current settings', () => {
    expect(describeScreen(state())).toContain(
      'Settings: 0-6 months to expiry, delta limit 0.3, strikes $330-$460.'
    );
  });

  it('uses the strategy sign on delta, so a put reads as negative', () => {
    expect(describeScreen(state({ deltaSign: '-', deltaMagnitude: 0.2 }))).toContain(
      'delta limit -0.2'
    );
  });

  it('warns when the capital covers nothing, without implying an empty screen', () => {
    const text = describeScreen(
      state({ data: response({ affordableCount: 0, minCapitalRequired: 32496 }) })
    );
    expect(text).toContain('affords none of them');
    expect(text).toContain('$32,496');
    // "covers 0 contracts" on its own was read back to the user as "the screen
    // shows no rows", which is a different and wrong statement: the rows are
    // there and their returns are real.
    expect(text).toMatch(/rows are still listed/);
  });

  it('lists active filters and computed columns', () => {
    const compiled = compileFormula('oi * annualizedReturn');
    if (!compiled.ok) throw new Error(compiled.error);
    const text = describeScreen(
      state({
        customFilters: [
          { id: 'f', name: 'High IV', mode: 'and', conditions: [{ field: 'iv', op: 'gt', value: [50] }] },
        ],
        computedColumns: [
          { id: 'c', name: 'Score', source: compiled.formula.source, evaluate: compiled.formula.evaluate },
        ],
      })
    );
    expect(text).toContain('Active filters: iv > 50.');
    expect(text).toContain('Computed columns: Score = oi * annualizedReturn.');
  });

  it('names the sort, or says it is the default', () => {
    expect(describeScreen(state())).toMatch(/default/);
    expect(describeScreen(state({ sort: { key: 'iv', direction: 'desc' } }))).toContain(
      'Sorted by iv desc.'
    );
  });

  it('quotes the top rows with the figures needed to compare them', () => {
    const text = describeScreen(state());
    expect(text).toMatch(/best rows of all .*the first IS the top one/);
    expect(text).toContain('2026-10-16 (45d) $330 strike');
    expect(text).toContain('premium $2.50');
    expect(text).toContain('annualized 6.24%');
    expect(text).toContain('3 affordable');
  });

  it('marks a row the capital cannot cover', () => {
    expect(describeScreen(state({ visible: [row({ maxContracts: 0 })] }))).toContain(
      'not affordable'
    );
  });

  it('caps the quoted rows so the reply cannot swamp the context', () => {
    const many = Array.from({ length: 400 }, (_, i) => row({ strike: 300 + i }));
    const text = describeScreen(state({ visible: many }));
    expect(text.split('\n').filter((l) => l.startsWith('  ')).length).toBe(5);
  });

  it('says so when the filters exclude everything', () => {
    expect(describeScreen(state({ visible: [] }))).toContain('No rows match');
  });
});
