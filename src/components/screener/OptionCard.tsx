'use client';

import React, { memo } from 'react';
import { cn } from '@/lib/ui';
import type { ScreenedOption } from '@/lib/optionChain';
import type { Column } from './types';
import type { ComputedColumn } from '@/lib/formula';

/** Fields the card shows in its detail grid, in order. */
export const CARD_DETAIL_KEYS: (keyof ScreenedOption)[] = [
  'lastPrice',
  'delta',
  'iv',
  'moneyness',
  'openInterest',
  'volume',
  'maxContracts',
  'totalCapitalRequired',
  'totalPremiumReceived',
  'annualizedReturnWithGain',
  'premiumSharePct',
  'totalProfitIfAssigned',
];

/** Above a 0.35 delta the assignment risk is worth noticing. */
const deltaTone = (delta: number) => (Math.abs(delta) > 0.35 ? 'text-warn' : 'text-fg-soft');

/**
 * One contract, laid out to be read rather than compared.
 *
 * Shared by the phone's card list and the assistant, so a contract the
 * assistant singles out looks like the same object the app shows — and, more
 * importantly, is rendered from the app's own row rather than from numbers the
 * model retyped into a sentence.
 */
export const OptionCard = memo(function OptionCard({
  option,
  columns,
  computedColumns,
  className,
}: {
  option: ScreenedOption;
  /** The active column set, so formatting matches the table exactly. */
  columns: Record<string, Column>;
  computedColumns: ComputedColumn[];
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-line bg-bg-2/60 p-4 space-y-3', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <p className="text-base font-bold tracking-tight text-fg">
            ${option.strike.toFixed(2)}
          </p>
          <p className="text-[11px] text-dim flex items-center gap-2">
            {option.expiration}
            <span className="px-1.5 py-0.5 bg-bg-3 border border-line rounded text-fg-soft font-medium font-mono text-[11px]">
              {option.daysToExpiration}d
            </span>
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-bold tabular-nums text-a1 leading-none">
            {option.annualizedReturn.toFixed(2)}%
          </p>
          <p className="text-[11px] tracking-normal text-faint mt-1">Ann. return</p>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-x-3 gap-y-2 pt-3 border-t border-line">
        {CARD_DETAIL_KEYS.map((key) => {
          const col = columns[key as string];
          if (!col) return null;
          return (
            <div key={key as string} className="min-w-0">
              <dt className="text-[11px] tracking-normal text-faint truncate">{col.label}</dt>
              <dd
                className={cn(
                  'font-mono text-[11px] text-fg-soft truncate',
                  key === 'delta' && deltaTone(option.delta)
                )}
              >
                {col.format(option)}
              </dd>
            </div>
          );
        })}
        {/* Computed columns join the grid, tinted so they read as the user's
            own rather than part of the chain data. */}
        {computedColumns.map((c) => (
          <div key={c.id} className="min-w-0">
            <dt className="text-[11px] text-faint truncate" title={c.source}>
              {c.name}
            </dt>
            <dd className="font-mono text-[11px] text-a1 truncate">
              {columns[c.id] ? columns[c.id].format(option) : '—'}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
});
