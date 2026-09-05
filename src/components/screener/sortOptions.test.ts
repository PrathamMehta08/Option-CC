import { describe, it, expect } from 'vitest';
import { sortOptions } from './sortOptions';
import { buildColumns } from './ResultsTable';
import type { Column } from './types';
import type { ScreenedOption } from '@/lib/optionChain';

function row(overrides: Partial<ScreenedOption> = {}): ScreenedOption {
  return {
    expiration: '2026-10-16',
    daysToExpiration: 45,
    strike: 200,
    lastPrice: 2,
    high: 2.2,
    delta: 0.3,
    iv: 40,
    moneyness: 5,
    openInterest: 1000,
    volume: 500,
    capitalRequiredPerContract: 20000,
    premiumPerContract: 200,
    returnPct: 1,
    annualizedReturn: 10,
    returnWithGainPct: 2,
    annualizedReturnWithGain: 20,
    premiumSharePct: 50,
    totalProfitIfAssigned: 400,
    maxContracts: 2,
    totalCapitalRequired: 40000,
    totalPremiumReceived: 400,
    ...overrides,
  };
}

const columns = (): Record<string, Column> =>
  Object.fromEntries(buildColumns('Capital', []).map((c) => [c.key, c]));

/**
 * The bug this covers: the table sorted its own copy while the page handed the
 * assistant the list in the screener's default order. "Sort by ann. if assigned
 * and give me the top one" then named a contract from a different ranking —
 * sometimes one near the BOTTOM of what the user was looking at.
 */
describe('one ordering for the table and the assistant', () => {
  // Deliberately ranked differently by the two return columns, which is exactly
  // the case that exposed the bug.
  const rows = [
    row({ strike: 100, annualizedReturn: 30, annualizedReturnWithGain: 5 }),
    row({ strike: 200, annualizedReturn: 20, annualizedReturnWithGain: 90 }),
    row({ strike: 300, annualizedReturn: 10, annualizedReturnWithGain: 50 }),
  ];

  it('ranks by the column asked for, not by the default one', () => {
    const sorted = sortOptions(rows, { key: 'annualizedReturnWithGain', direction: 'desc' }, columns());
    expect(sorted.map((r) => r.strike)).toEqual([200, 300, 100]);
    // The row that leads the default order is LAST here. Handing the assistant
    // the unsorted list is what made it name the $100 strike.
    expect(sorted[0].annualizedReturnWithGain).toBe(90);
  });

  it('sorts ascending when asked', () => {
    const sorted = sortOptions(rows, { key: 'annualizedReturn', direction: 'asc' }, columns());
    expect(sorted.map((r) => r.strike)).toEqual([300, 200, 100]);
  });

  it('leaves the order alone when nothing is sorted', () => {
    expect(sortOptions(rows, { key: null, direction: null }, columns())).toBe(rows);
    expect(sortOptions(rows, { key: 'annualizedReturn', direction: null }, columns())).toBe(rows);
  });

  it('leaves the order alone for a column that does not exist', () => {
    // An unknown key must not scramble the ranking into something arbitrary.
    expect(sortOptions(rows, { key: 'nope', direction: 'desc' }, columns())).toBe(rows);
  });

  it('does not mutate the list it was given', () => {
    const before = rows.map((r) => r.strike);
    sortOptions(rows, { key: 'annualizedReturnWithGain', direction: 'desc' }, columns());
    expect(rows.map((r) => r.strike)).toEqual(before);
  });

  it('sinks unscoreable rows to the bottom in both directions', () => {
    // NaN is an absence of a value, not a small one, so it belongs last either
    // way — otherwise "cheapest first" would recommend a row with no value.
    const withNaN = [
      row({ strike: 1, premiumSharePct: NaN }),
      row({ strike: 2, premiumSharePct: 10 }),
      row({ strike: 3, premiumSharePct: 90 }),
    ];
    const desc = sortOptions(withNaN, { key: 'premiumSharePct', direction: 'desc' }, columns());
    const asc = sortOptions(withNaN, { key: 'premiumSharePct', direction: 'asc' }, columns());
    expect(desc.map((r) => r.strike)).toEqual([3, 2, 1]);
    expect(asc.map((r) => r.strike)).toEqual([2, 3, 1]);
  });

  it('sorts a text column too', () => {
    const dated = [
      row({ strike: 1, expiration: '2027-01-15' }),
      row({ strike: 2, expiration: '2026-03-20' }),
      row({ strike: 3, expiration: '2026-09-11' }),
    ];
    const sorted = sortOptions(dated, { key: 'expiration', direction: 'asc' }, columns());
    expect(sorted.map((r) => r.expiration)).toEqual(['2026-03-20', '2026-09-11', '2027-01-15']);
  });

  it('is stable enough that the top row is the true extreme of the whole list', () => {
    // The other half of the report: the top-picks table took its ten from the
    // default order and re-sorted only those ten, so the true best could be
    // eleventh and never considered.
    const many = Array.from({ length: 50 }, (_, i) =>
      row({ strike: i, annualizedReturn: 100 - i, annualizedReturnWithGain: i })
    );
    const sorted = sortOptions(many, { key: 'annualizedReturnWithGain', direction: 'desc' }, columns());
    expect(sorted[0].strike).toBe(49);
    // Taking ten from the DEFAULT order would have offered strikes 0-9 only.
    expect(sorted.slice(0, 10).map((r) => r.strike)).toEqual([49, 48, 47, 46, 45, 44, 43, 42, 41, 40]);
  });
});
