'use client';

import React, { memo } from 'react';
import { cn } from '@/lib/ui';
import { describeFilter, type CustomFilter } from '@/lib/filters';
import type { ComputedColumn } from '@/lib/formula';

export interface ActiveFilterSummary {
  ticker: string;
  companyName: string | null;
  currentPrice: number | null;
  strategyName: string;
  capital: string;
  minMonths: number;
  maxMonths: number;
  deltaSign: string;
  deltaMagnitude: number;
  strikeFilter: [number, number];
  expirationsSelected: number;
  expirationsAvailable: number;
  matching: number;
  customFilters: CustomFilter[];
  computedColumns: ComputedColumn[];
}

interface Chip {
  label: string;
  value: string;
  /** The user's own additions, tinted so they read as theirs. */
  tone?: 'accent';
}

/** The chips, in the order someone would read them out. */
export function summaryChips(s: ActiveFilterSummary): Chip[] {
  const chips: Chip[] = [
    { label: 'Strategy', value: s.strategyName },
    { label: 'Capital', value: `$${s.capital}` },
    {
      label: 'Expiry',
      value:
        s.minMonths === s.maxMonths
          ? `${s.minMonths} months`
          : `${s.minMonths}–${s.maxMonths} months`,
    },
    { label: 'Max delta', value: `${s.deltaSign}${s.deltaMagnitude}` },
    { label: 'Strikes', value: `$${s.strikeFilter[0]}–$${s.strikeFilter[1]}` },
  ];

  // Only worth a chip when it is actually narrowing something.
  if (s.expirationsAvailable > 0 && s.expirationsSelected < s.expirationsAvailable) {
    chips.push({
      label: 'Expirations',
      value: `${s.expirationsSelected} of ${s.expirationsAvailable}`,
    });
  }
  for (const f of s.customFilters) {
    chips.push({ label: f.name, value: describeFilter(f), tone: 'accent' });
  }
  for (const c of s.computedColumns) {
    chips.push({ label: c.name, value: c.source, tone: 'accent' });
  }
  return chips;
}

/**
 * Everything the screen is currently filtered to, as a compact strip.
 *
 * Assistant-only mode hides the table, so without this the user would be
 * driving a screen they cannot see. It is the settings, not the results: what
 * the assistant is working against, in one line per fact.
 */
export const ActiveFilters = memo(function ActiveFilters({
  summary,
  className,
}: {
  summary: ActiveFilterSummary;
  className?: string;
}) {
  const chips = summaryChips(summary);

  return (
    <div className={cn('space-y-2.5', className)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-bold tracking-tight text-fg">
          {summary.companyName ?? summary.ticker ?? 'No ticker'}
        </span>
        {summary.currentPrice !== null && (
          <span className="font-mono text-sm text-grad tabular-nums">
            ${summary.currentPrice.toFixed(2)}
          </span>
        )}
        <span className="font-mono text-[11px] text-faint">
          {summary.matching.toLocaleString()} contracts match
        </span>
      </div>

      <dl className="flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <div
            key={`${chip.label}:${chip.value}`}
            title={`${chip.label}: ${chip.value}`}
            className={cn(
              'flex items-baseline gap-1.5 rounded px-2 py-1 text-[11px] ring-1 ring-inset',
              chip.tone === 'accent'
                ? 'bg-a2/10 text-a2 ring-a2/25'
                : 'bg-bg-3 text-fg-soft ring-line'
            )}
          >
            <dt className="text-faint">{chip.label}</dt>
            <dd className="font-mono">{chip.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
});
