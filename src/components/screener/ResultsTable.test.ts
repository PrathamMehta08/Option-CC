import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
  // The desktop body cells are written out by hand rather than mapped from the
  // column list, so a new header with no matching <td> silently shifts every
  // column after it. This is the guard for that.
  it('has one hardcoded cell per fixed column', () => {
    const src = readFileSync(new URL('./ResultsTable.tsx', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('<tbody'), src.indexOf('</tbody>'));
    // The computed columns are mapped, so exclude their keyed cell.
    const hardcoded = (body.match(/<td(?! key=)[ \n>]/g) ?? []).length;
    expect(hardcoded).toBe(buildColumns('Capital', []).length);
  });
});
