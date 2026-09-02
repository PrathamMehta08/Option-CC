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
