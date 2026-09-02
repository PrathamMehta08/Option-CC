'use client';

import React, { useState, useMemo, memo } from 'react';
import { Table as TableIcon, ArrowUpDown, ChevronUp, ChevronDown, ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/ui';
import type { ScreenedOption } from '@/lib/optionChain';
import type { SortConfig } from './types';

type OptionData = ScreenedOption;

/** How many cards the mobile list reveals at a time. */
const MOBILE_PAGE_SIZE = 25;

interface Column {
  label: string;
  key: keyof OptionData;
  /** How the value reads in both the table cell and the mobile card. */
  format: (opt: OptionData) => string;
}

/**
 * One column definition drives both layouts: the dense table on desktop and the
 * card list on mobile. Adding a column here adds it to both.
 */
function buildColumns(capitalColumnLabel: string): Column[] {
  const dashIfUnaffordable = (opt: OptionData, value: () => string) =>
    opt.maxContracts > 0 ? value() : '—';

  return [
    { label: 'Expiry', key: 'expiration', format: (o) => o.expiration },
    { label: 'DTE', key: 'daysToExpiration', format: (o) => `${o.daysToExpiration}d` },
    { label: 'Strike', key: 'strike', format: (o) => `$${o.strike.toFixed(2)}` },
    { label: 'Premium', key: 'lastPrice', format: (o) => `$${o.lastPrice.toFixed(2)}` },
    { label: 'Delta', key: 'delta', format: (o) => o.delta.toFixed(3) },
    { label: 'IV', key: 'iv', format: (o) => `${o.iv.toFixed(1)}%` },
    { label: 'Moneyness', key: 'moneyness', format: (o) => `${o.moneyness.toFixed(1)}%` },
    { label: 'OI', key: 'openInterest', format: (o) => o.openInterest.toLocaleString() },
    { label: 'Vol', key: 'volume', format: (o) => o.volume.toLocaleString() },
    // A dash beats a $0 the user has to decode.
    { label: 'Contracts', key: 'maxContracts', format: (o) => (o.maxContracts || '—').toString() },
    {
      label: capitalColumnLabel,
      key: 'totalCapitalRequired',
      format: (o) => dashIfUnaffordable(o, () => `$${o.totalCapitalRequired.toLocaleString()}`),
    },
    {
      label: 'Total Prem',
      key: 'totalPremiumReceived',
      format: (o) =>
        dashIfUnaffordable(
          o,
          () => `$${o.totalPremiumReceived.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
        ),
    },
    {
      label: 'Ann. Return',
      key: 'annualizedReturn',
      format: (o) => `${o.annualizedReturn.toFixed(2)}%`,
    },
  ];
}

/** Fields the mobile card shows in its detail grid, in order. */
const CARD_DETAIL_KEYS: (keyof OptionData)[] = [
  'lastPrice',
  'delta',
  'iv',
  'moneyness',
  'openInterest',
  'volume',
  'maxContracts',
  'totalCapitalRequired',
  'totalPremiumReceived',
];

export const ResultsTable = memo(({
  options, title, count, externalSortConfig, onExternalSortChange, capitalColumnLabel
}: {
  options: OptionData[], title: string, count?: number,
  externalSortConfig?: SortConfig, onExternalSortChange?: (config: SortConfig) => void,
  capitalColumnLabel: string
}) => {
  // A phone should not paint 400+ cards on first render. Reveal in pages; the
  // desktop table keeps showing everything inside its own scroll container.
  const [mobilePageCount, setMobilePageCount] = useState(1);
  const [localSortConfig, setLocalSortConfig] = useState<SortConfig>({ key: null, direction: null });
  const sortConfig = externalSortConfig !== undefined ? externalSortConfig : localSortConfig;

  const columns = useMemo(() => buildColumns(capitalColumnLabel), [capitalColumnLabel]);
  const byKey = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.key, c])) as Record<string, Column>,
    [columns]
  );

  const applySort = (next: SortConfig) => {
    if (onExternalSortChange) onExternalSortChange(next);
    else setLocalSortConfig(next);
  };

  const handleSort = (key: keyof OptionData) => {
    let direction: 'asc' | 'desc' | null = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig.key === key && sortConfig.direction === 'asc') direction = null;
    applySort({ key, direction });
  };

  const processedOptions = useMemo(() => {
    const sorted = [...options];

    if (sortConfig.key && sortConfig.direction) {
      sorted.sort((a, b) => {
        const aVal = a[sortConfig.key!];
        const bVal = b[sortConfig.key!];
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return sorted;
  }, [options, sortConfig]);

  // Collapse back to the first page whenever the list or its order changes.
  // Adjusting state during render is React's documented alternative to an
  // effect here: no extra pass, and no cascading-render lint warning.
  const listSignature = `${options.length}:${sortConfig.key ?? ''}:${sortConfig.direction ?? ''}`;
  const [seenSignature, setSeenSignature] = useState(listSignature);
  if (seenSignature !== listSignature) {
    setSeenSignature(listSignature);
    setMobilePageCount(1);
  }

  const visibleOnMobile = useMemo(
    () => processedOptions.slice(0, mobilePageCount * MOBILE_PAGE_SIZE),
    [processedOptions, mobilePageCount]
  );
  const hiddenOnMobile = processedOptions.length - visibleOnMobile.length;

  const SortIcon = ({ colKey }: { colKey: keyof OptionData }) => {
    if (sortConfig.key !== colKey) return <ArrowUpDown size={10} className="ml-1 opacity-20 group-hover:opacity-50" />;
    return sortConfig.direction === 'asc' ? <ChevronUp size={10} className="ml-1 text-emerald-500" /> : <ChevronDown size={10} className="ml-1 text-emerald-500" />;
  };

  const deltaTone = (delta: number) =>
    Math.abs(delta) > 0.35 ? 'text-amber-500' : 'text-emerald-500/80';

  return (
    <div className="space-y-4 text-white font-sans">
      <div className="flex items-center justify-between gap-3 px-1">
        <h3 className="min-w-0 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2">
          <TableIcon size={12} className="shrink-0" />
          <span className="truncate">{title}</span>
          {count !== undefined && (
            <span className="shrink-0 font-mono tracking-normal text-zinc-600">
              {processedOptions.length}/{count}
            </span>
          )}
        </h3>

        {/* Sorting on a phone: the table headers are off-screen behind a
            horizontal scroll, so mobile gets its own native control. */}
        <div className="flex md:hidden items-center gap-1.5 shrink-0">
          <label className="sr-only" htmlFor={`sort-${title}`}>Sort by</label>
          <select
            id={`sort-${title}`}
            value={(sortConfig.key ?? '') as string}
            onChange={(e) =>
              applySort({
                key: (e.target.value || null) as SortConfig['key'],
                direction: e.target.value ? (sortConfig.direction ?? 'desc') : null,
              })
            }
            className="bg-zinc-900 border border-zinc-800 rounded-lg py-2 pl-2.5 pr-7 text-[11px] text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 appearance-none"
          >
            <option value="">Default order</option>
            {columns.map((col) => (
              <option key={col.key} value={col.key}>{col.label}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={!sortConfig.key}
            onClick={() =>
              applySort({
                key: sortConfig.key,
                direction: sortConfig.direction === 'asc' ? 'desc' : 'asc',
              })
            }
            aria-label={sortConfig.direction === 'asc' ? 'Sort descending' : 'Sort ascending'}
            className="h-[34px] w-[34px] flex items-center justify-center bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-300 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            {sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------- mobile: cards */}
      <ul className="md:hidden space-y-2">
        {visibleOnMobile.map((opt, i) => (
          <li
            key={i}
            className="rounded-xl border border-zinc-900 bg-zinc-950/60 p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <p className="text-base font-bold tracking-tight text-zinc-100">
                  ${opt.strike.toFixed(2)}
                </p>
                <p className="text-[11px] text-zinc-500 flex items-center gap-2">
                  {opt.expiration}
                  <span className="px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded text-emerald-500 font-bold font-mono text-[10px]">
                    {opt.daysToExpiration}d
                  </span>
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-bold tabular-nums text-emerald-400 leading-none">
                  {opt.annualizedReturn.toFixed(2)}%
                </p>
                <p className="text-[9px] uppercase tracking-[0.15em] text-zinc-600 mt-1">
                  Ann. return
                </p>
              </div>
            </div>

            <dl className="grid grid-cols-3 gap-x-3 gap-y-2 pt-3 border-t border-zinc-900">
              {CARD_DETAIL_KEYS.map((key) => {
                const col = byKey[key as string];
                if (!col) return null;
                return (
                  <div key={key as string} className="min-w-0">
                    <dt className="text-[9px] uppercase tracking-[0.12em] text-zinc-600 truncate">
                      {col.label}
                    </dt>
                    <dd
                      className={cn(
                        'font-mono text-[11px] text-zinc-300 truncate',
                        key === 'delta' && deltaTone(opt.delta)
                      )}
                    >
                      {col.format(opt)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </li>
        ))}
      </ul>

      {hiddenOnMobile > 0 && (
        <button
          type="button"
          onClick={() => setMobilePageCount((n) => n + 1)}
          className="md:hidden w-full py-3.5 rounded-xl border border-zinc-800 bg-zinc-900/60 text-[11px] font-bold uppercase tracking-widest text-zinc-300 hover:bg-zinc-900 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          Show {Math.min(MOBILE_PAGE_SIZE, hiddenOnMobile)} more
          <span className="text-zinc-600 font-mono normal-case tracking-normal ml-2">
            {hiddenOnMobile.toLocaleString()} left
          </span>
        </button>
      )}

      {/* -------------------------------------------------- desktop: table */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-zinc-900 bg-black/50 overflow-y-auto max-h-[600px] scrollbar-thin">
        <table className="w-full text-left text-[11px] whitespace-nowrap border-collapse">
          <thead className="bg-zinc-950 text-zinc-500 sticky top-0 z-10">
            <tr className="border-b border-zinc-900">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  // aria-sort tells a screen reader what the current order is;
                  // the button makes the header reachable by keyboard at all.
                  aria-sort={
                    sortConfig.key === col.key
                      ? sortConfig.direction === 'asc'
                        ? 'ascending'
                        : sortConfig.direction === 'desc'
                          ? 'descending'
                          : 'none'
                      : 'none'
                  }
                  className={cn(
                    'px-4 py-4 font-semibold uppercase tracking-wider transition-colors',
                    sortConfig.key === col.key ? 'text-emerald-500' : 'text-zinc-500'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleSort(col.key)}
                    title={`Sort by ${col.label}`}
                    className="flex items-center group cursor-pointer hover:text-zinc-300 transition-colors rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                  >
                    {col.label}
                    <SortIcon colKey={col.key} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900 border-none">
            {processedOptions.map((opt, i) => (
              <tr key={i} className="group hover:bg-zinc-900/30 transition-colors">
                <td className="px-4 py-4 text-zinc-400 font-medium">{opt.expiration}</td>
                <td className="px-4 py-4">
                   <span className="px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded text-emerald-500 font-bold font-mono text-[10px]">
                     {opt.daysToExpiration}d
                   </span>
                </td>
                <td className="px-4 py-4 font-bold text-zinc-100 tracking-tight">${opt.strike.toFixed(2)}</td>
                <td className="px-4 py-4 text-zinc-300 font-mono">${opt.lastPrice.toFixed(2)}</td>
                <td className="px-4 py-4">
                  <span className={cn('font-mono', deltaTone(opt.delta))}>
                    {opt.delta.toFixed(3)}
                  </span>
                </td>
                <td className="px-4 py-4 text-zinc-500 font-mono">{opt.iv.toFixed(1)}%</td>
                <td className="px-4 py-4 text-zinc-500 font-mono">{opt.moneyness.toFixed(1)}%</td>
                <td className="px-4 py-4 text-zinc-600 font-mono">{opt.openInterest.toLocaleString()}</td>
                <td className="px-4 py-4 text-zinc-600 font-mono">{opt.volume.toLocaleString()}</td>
                <td className="px-4 py-4 text-zinc-400 font-mono">{opt.maxContracts || '—'}</td>
                <td className="px-4 py-4 text-zinc-500 font-mono">
                  {byKey.totalCapitalRequired.format(opt)}
                </td>
                <td className="px-4 py-4 text-zinc-500 font-mono">
                  {byKey.totalPremiumReceived.format(opt)}
                </td>
                <td className="px-4 py-4 text-right">
                  <span className="text-emerald-400 font-bold tabular-nums text-sm">
                    {opt.annualizedReturn.toFixed(2)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});
ResultsTable.displayName = 'ResultsTable';
