import { describe, it, expect } from 'vitest';
import { buildColumns } from './ResultsTable';
import { compileFormula, type ComputedColumn } from '@/lib/formula';
import type { ScreenedOption } from '@/lib/optionChain';

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
    premiumSharePct: 100,
    totalProfitIfAssigned: 0,
    maxContracts: 4,
    totalCapitalRequired: 88000,
    totalPremiumReceived: 800,
    ...overrides,
  };
}

/** The path a user request actually takes: text -> formula -> column. */
function columnFor(expression: string, name = 'Score'): ComputedColumn {
  const compiled = compileFormula(expression);
  if (!compiled.ok) throw new Error(compiled.error);
  return { id: 'score', name, source: compiled.formula.source, evaluate: compiled.formula.evaluate };
}

describe('buildColumns', () => {
  it('appends computed columns after the fixed ones', () => {
    const base = buildColumns('Stock Cost', []);
    const withComputed = buildColumns('Stock Cost', [columnFor('oi^2 + ann return^2')]);

    expect(withComputed).toHaveLength(base.length + 1);
    expect(withComputed[withComputed.length - 1].label).toBe('Score');
    // The fixed columns are untouched.
    expect(withComputed.slice(0, base.length).map((c) => c.key)).toEqual(base.map((c) => c.key));
  });

  it('takes the capital column label from the active strategy', () => {
    expect(buildColumns('Total Cap', []).find((c) => c.key === 'totalCapitalRequired')?.label).toBe(
      'Total Cap'
    );
  });

  it('marks a computed column so the UI can offer to remove it', () => {
    const col = buildColumns('Stock Cost', [columnFor('iv * 2')]).at(-1)!;
    expect(col.computed?.id).toBe('score');
    expect(col.computed?.source).toBe('iv * 2');
  });
});

describe('a computed column behaves like any other', () => {
  const col = () => buildColumns('Stock Cost', [columnFor('oi^2 + ann return^2')]).at(-1)!;

  it('evaluates the formula for a row', () => {
    // 1000^2 + 20^2
    expect(col().value(row())).toBe(1_000_400);
  });

  it('is sortable through the same accessor the fixed columns use', () => {
    const rows = [
      row({ openInterest: 10, annualizedReturn: 1 }),
      row({ openInterest: 1000, annualizedReturn: 20 }),
      row({ openInterest: 100, annualizedReturn: 5 }),
    ];
    const read = col().value;
    const sorted = [...rows].sort((a, b) => (read(b) as number) - (read(a) as number));
    expect(sorted.map((r) => r.openInterest)).toEqual([1000, 100, 10]);
  });

  it('scales the notation so a big score stays readable', () => {
    expect(col().format(row())).toBe('1.00M');
    expect(col().format(row({ openInterest: 30, annualizedReturn: 10 }))).toBe('1.00k');
    expect(col().format(row({ openInterest: 2, annualizedReturn: 1 }))).toBe('5.00');
  });

  it('shows a dash for a row the formula cannot score', () => {
    // Division by zero yields NaN rather than Infinity.
    const divide = buildColumns('Stock Cost', [columnFor('annualizedReturn / openInterest')]).at(-1)!;
    expect(divide.format(row({ openInterest: 0 }))).toBe('—');
    expect(divide.value(row({ openInterest: 0 }))).toBeNaN();
  });
});

describe('the new assignment columns format for readers, not for maths', () => {
  const col = (key: string) => buildColumns('Capital', []).find((c) => c.key === key)!;

  it('shows premium share as a percentage', () => {
    expect(col('premiumSharePct').format(row({ premiumSharePct: 16.6667 }))).toBe('16.7%');
  });

  it('dashes premium share when it does not apply', () => {
    // NaN is how screen.ts says "the assignment return is not positive, so
    // there is no share to take".
    expect(col('premiumSharePct').format(row({ premiumSharePct: NaN }))).toBe('—');
  });

  it('shows total profit if assigned in dollars', () => {
    expect(
      col('totalProfitIfAssigned').format(row({ maxContracts: 2, totalProfitIfAssigned: 2400 }))
    ).toBe('$2,400.00');
  });

  it('dashes total profit when the capital covers no contracts', () => {
    expect(
      col('totalProfitIfAssigned').format(row({ maxContracts: 0, totalProfitIfAssigned: 0 }))
    ).toBe('—');
  });
});

describe('the table body stays aligned with the header', () => {
  // The body used to be sixteen hand-written <td>s parallel to the header list,
  // and twice a new column shifted every cell after it. The cells are mapped
  // from this list now, so the alignment is structural rather than maintained —
  // what is left to check is that the list itself is coherent.
  it('gives every column something to render with', () => {
    for (const col of buildColumns('Capital', [], 'all')) {
      expect(typeof col.format(row())).toBe('string');
      expect(col.key).toBeTruthy();
      expect(col.label).toBeTruthy();
    }
  });

  it('has no duplicate keys, which React would render as one cell', () => {
    const keys = buildColumns('Capital', [], 'all').map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('column density', () => {
  // Sixteen columns come to about 1550px, which never fits beside the sidebar,
  // so the table always scrolled sideways. The compact set is the default.
  it('shows fewer columns than the full set', () => {
    const all = buildColumns('Capital', [], 'all');
    const essential = buildColumns('Capital', [], 'essential');
    expect(essential.length).toBeLessThan(all.length);
    expect(essential.length).toBeGreaterThan(0);
  });

  it('keeps the columns a decision actually turns on', () => {
    const keys = buildColumns('Capital', [], 'essential').map((c) => c.key);
    // Identity, cost, and the two figures the screen is ranked on.
    expect(keys).toContain('expiration');
    expect(keys).toContain('strike');
    expect(keys).toContain('lastPrice');
    expect(keys).toContain('annualizedReturn');
    expect(keys).toContain('annualizedReturnWithGain');
  });

  it('keeps the compact set a subset, in the same order', () => {
    const all = buildColumns('Capital', [], 'all').map((c) => c.key);
    const essential = buildColumns('Capital', [], 'essential').map((c) => c.key);
    expect(all.filter((k) => essential.includes(k))).toEqual(essential);
  });

  it('never drops a computed column, which the user asked for by name', () => {
    const c = columnFor('oi * 2');
    for (const density of ['essential', 'all'] as const) {
      const keys = buildColumns('Capital', [c], density).map((k) => k.key);
      expect(keys).toContain(c.id);
    }
  });

  it('defaults to the full set, so a caller that does not care loses nothing', () => {
    // Compared by key: every column carries fresh closures, so the objects
    // themselves are never equal across two calls.
    expect(buildColumns('Capital', []).map((c) => c.key)).toEqual(
      buildColumns('Capital', [], 'all').map((c) => c.key)
    );
  });

  it('shortens the date only when asked, for the pinned phone column', () => {
    const long = buildColumns('Capital', [], 'all', false)[0];
    const short = buildColumns('Capital', [], 'all', true)[0];
    expect(long.format(row({ expiration: '2026-09-11' }))).toBe('2026-09-11');
    expect(short.format(row({ expiration: '2026-09-11' }))).toBe('Sep 11');
    // The sortable value stays the full date either way — 'Sep 11' does not sort.
    expect(short.value(row({ expiration: '2026-09-11' }))).toBe('2026-09-11');
  });
});
