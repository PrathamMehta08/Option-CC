'use client';

import React, { useState, useMemo, memo } from 'react';
import { Table as TableIcon, ArrowUpDown, ChevronUp, ChevronDown, ArrowDown, ArrowUp, X } from 'lucide-react';
import { cn } from '@/lib/ui';
import type { ScreenedOption } from '@/lib/optionChain';
import type { SortConfig } from './types';
import type { ComputedColumn } from '@/lib/formula';

type OptionData = ScreenedOption;

/** How many cards the mobile list reveals at a time. */
const MOBILE_PAGE_SIZE = 25;

/** Stable identity so the columns memo does not rebuild every render. */
const EMPTY_COMPUTED: ComputedColumn[] = [];

export interface Column {
  label: string;
  /** A ScreenedOption key, or a computed column id. */
  key: string;
  /** The sortable value. Computed columns return NaN for rows they cannot score. */
  value: (opt: OptionData) => number | string;
  /** How the value reads in the table cell and the mobile card. */
  format: (opt: OptionData) => string;
  /** Set when the column came from a user formula, so it can be removed. */
  computed?: ComputedColumn;
}

/**
 * One column definition drives both layouts: the dense table on desktop and the
 * card list on mobile. Adding a column here adds it to both.
 */
export function buildColumns(capitalColumnLabel: string, computed: ComputedColumn[]): Column[] {
  const dashIfUnaffordable = (opt: OptionData, value: () => string) =>
    opt.maxContracts > 0 ? value() : '—';

  return [
    { label: 'Expiry', key: 'expiration', value: (o) => o.expiration, format: (o) => o.expiration },
    { label: 'DTE', key: 'daysToExpiration', value: (o) => o.daysToExpiration, format: (o) => `${o.daysToExpiration}d` },
    { label: 'Strike', key: 'strike', value: (o) => o.strike, format: (o) => `$${o.strike.toFixed(2)}` },
    { label: 'Premium', key: 'lastPrice', value: (o) => o.lastPrice, format: (o) => `$${o.lastPrice.toFixed(2)}` },
    { label: 'Delta', key: 'delta', value: (o) => o.delta, format: (o) => o.delta.toFixed(3) },
    { label: 'IV', key: 'iv', value: (o) => o.iv, format: (o) => `${o.iv.toFixed(1)}%` },
    { label: 'Moneyness', key: 'moneyness', value: (o) => o.moneyness, format: (o) => `${o.moneyness.toFixed(1)}%` },
    { label: 'OI', key: 'openInterest', value: (o) => o.openInterest, format: (o) => o.openInterest.toLocaleString() },
    { label: 'Vol', key: 'volume', value: (o) => o.volume, format: (o) => o.volume.toLocaleString() },
    // A dash beats a $0 the user has to decode.
    { label: 'Contracts', key: 'maxContracts', value: (o) => o.maxContracts, format: (o) => (o.maxContracts || '—').toString() },
    {
      label: capitalColumnLabel,
      key: 'totalCapitalRequired',
      value: (o) => o.totalCapitalRequired,
      format: (o) => dashIfUnaffordable(o, () => `$${o.totalCapitalRequired.toLocaleString()}`),
    },
    {
      label: 'Total Prem',
      key: 'totalPremiumReceived',
      value: (o) => o.totalPremiumReceived,
      format: (o) =>
        dashIfUnaffordable(
          o,
          () => `$${o.totalPremiumReceived.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
        ),
    },
    {
      label: 'Ann. Return',
      key: 'annualizedReturn',
      value: (o) => o.annualizedReturn,
      format: (o) => `${o.annualizedReturn.toFixed(2)}%`,
    },
    {
      label: 'Ann. If Assigned',
      key: 'annualizedReturnWithGain',
      value: (o) => o.annualizedReturnWithGain,
      format: (o) => `${o.annualizedReturnWithGain.toFixed(2)}%`,
    },
    // User formulas become ordinary columns: sortable, and formatted like any
    // other number. A row the formula cannot score shows a dash.
    ...computed.map((c) => ({
      label: c.name,
      key: c.id,
      value: (o: OptionData) => c.evaluate(o),
      format: (o: OptionData) => {
        const v = c.evaluate(o);
        return Number.isFinite(v) ? formatComputed(v) : '—';
      },
      computed: c,
    })),
  ];
}

/** Computed values span wildly different magnitudes, so scale the notation. */
function formatComputed(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}k`;
  if (abs >= 1) return v.toFixed(2);
  return v.toPrecision(3);
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
  'annualizedReturnWithGain',
];

export const ResultsTable = memo(({
  options, title, count, externalSortConfig, onExternalSortChange, capitalColumnLabel,
  computedColumns = EMPTY_COMPUTED, onRemoveComputedColumn
}: {
  options: OptionData[], title: string, count?: number,
  externalSortConfig?: SortConfig, onExternalSortChange?: (config: SortConfig) => void,
  capitalColumnLabel: string,
  computedColumns?: ComputedColumn[],
  onRemoveComputedColumn?: (id: string) => void,
}) => {
  // A phone should not paint 400+ cards on first render. Reveal in pages; the
  // desktop table keeps showing everything inside its own scroll container.
  const [mobilePageCount, setMobilePageCount] = useState(1);
  const [localSortConfig, setLocalSortConfig] = useState<SortConfig>({ key: null, direction: null });
  const sortConfig = externalSortConfig !== undefined ? externalSortConfig : localSortConfig;

  const columns = useMemo(
    () => buildColumns(capitalColumnLabel, computedColumns),
    [capitalColumnLabel, computedColumns]
  );
  const byKey = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.key, c])) as Record<string, Column>,
    [columns]
  );

  const applySort = (next: SortConfig) => {
    if (onExternalSortChange) onExternalSortChange(next);
    else setLocalSortConfig(next);
  };

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' | null = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig.key === key && sortConfig.direction === 'asc') direction = null;
    applySort({ key, direction });
  };

  const processedOptions = useMemo(() => {
    const sorted = [...options];

    if (sortConfig.key && sortConfig.direction) {
      const col = byKey[sortConfig.key];
      const read = col ? col.value : () => 0;
      sorted.sort((a, b) => {
        const aVal = read(a);
        const bVal = read(b);
        // NaN (a formula that could not score a row) always sinks.
        if (typeof aVal === 'number' && Number.isNaN(aVal)) return 1;
        if (typeof bVal === 'number' && Number.isNaN(bVal)) return -1;
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return sorted;
  }, [options, sortConfig, byKey]);

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

  const SortIcon = ({ colKey }: { colKey: string }) => {
    if (sortConfig.key !== colKey) return <ArrowUpDown size={10} className="ml-1 opacity-20 group-hover:opacity-50" />;
    return sortConfig.direction === 'asc' ? <ChevronUp size={10} className="ml-1 text-fg-soft" /> : <ChevronDown size={10} className="ml-1 text-fg-soft" />;
  };

  const deltaTone = (delta: number) =>
    Math.abs(delta) > 0.35 ? 'text-warn' : 'text-fg-soft';

  return (
    <div className="space-y-4 text-fg font-sans">
      <div className="flex items-center justify-between gap-3 px-1">
        <h3 className="min-w-0 text-[11px] font-bold tracking-normal text-dim flex items-center gap-2">
          <TableIcon size={12} className="shrink-0" />
          <span className="truncate">{title}</span>
          {count !== undefined && (
            <span className="shrink-0 font-mono tracking-normal text-faint">
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
            className="bg-bg-3 border border-line rounded-lg py-2 pl-2.5 pr-7 text-[11px] text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60 appearance-none"
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
            className="h-[34px] w-[34px] flex items-center justify-center bg-bg-3 border border-line rounded-lg text-fg-soft disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60"
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
            className="rounded-lg border border-line bg-bg-2/60 p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <p className="text-base font-bold tracking-tight text-fg">
                  ${opt.strike.toFixed(2)}
                </p>
                <p className="text-[11px] text-dim flex items-center gap-2">
                  {opt.expiration}
                  <span className="px-1.5 py-0.5 bg-bg-3 border border-line rounded text-fg-soft font-medium font-mono text-[11px]">
                    {opt.daysToExpiration}d
                  </span>
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-bold tabular-nums text-a1 leading-none">
                  {opt.annualizedReturn.toFixed(2)}%
                </p>
                <p className="text-[11px] tracking-normal text-faint mt-1">
                  Ann. return
                </p>
              </div>
            </div>

            <dl className="grid grid-cols-3 gap-x-3 gap-y-2 pt-3 border-t border-line">
              {CARD_DETAIL_KEYS.map((key) => {
                const col = byKey[key as string];
                if (!col) return null;
                return (
                  <div key={key as string} className="min-w-0">
                    <dt className="text-[11px] tracking-normal text-faint truncate">
                      {col.label}
                    </dt>
                    <dd
                      className={cn(
                        'font-mono text-[11px] text-fg-soft truncate',
                        key === 'delta' && deltaTone(opt.delta)
                      )}
                    >
                      {col.format(opt)}
                    </dd>
                  </div>
                );
              })}
              {/* Computed columns join the card grid, tinted so they read as
                  the user's own rather than part of the chain data. */}
              {computedColumns.map((c) => (
                <div key={c.id} className="min-w-0">
                  <dt className="text-[11px] text-faint truncate" title={c.source}>
                    {c.name}
                  </dt>
                  <dd className="font-mono text-[11px] text-a1 truncate">
                    {byKey[c.id] ? byKey[c.id].format(opt) : '—'}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      {hiddenOnMobile > 0 && (
        <button
          type="button"
          onClick={() => setMobilePageCount((n) => n + 1)}
          className="md:hidden w-full py-3.5 rounded-lg border border-line bg-bg-2 text-[11px] font-bold tracking-normal text-fg-soft hover:bg-bg-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60"
        >
          Show {Math.min(MOBILE_PAGE_SIZE, hiddenOnMobile)} more
          <span className="text-faint font-mono normal-case tracking-normal ml-2">
            {hiddenOnMobile.toLocaleString()} left
          </span>
        </button>
      )}

      {/* -------------------------------------------------- desktop: table */}
      <div className="hidden md:block overflow-x-auto rounded-lg border border-line bg-bg-2/60 overflow-y-auto max-h-[600px] scrollbar-thin">
        <table className="w-full text-left text-[11px] whitespace-nowrap border-collapse">
          <thead className="bg-bg text-dim sticky top-0 z-10">
            <tr className="border-b border-line">
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
                    'px-4 py-4 font-semibold tracking-normal transition-colors',
                    sortConfig.key === col.key ? 'text-fg' : 'text-dim'
                  )}
                >
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleSort(col.key)}
                      title={col.computed ? `${col.computed.source} — click to sort` : `Sort by ${col.label}`}
                      className="flex items-center group cursor-pointer hover:text-fg-soft transition-colors rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                    >
                      {col.label}
                      <SortIcon colKey={col.key} />
                    </button>
                    {/* Computed columns are the user's, so they can drop them
                        from the header they appear in. */}
                    {col.computed && onRemoveComputedColumn && (
                      <button
                        type="button"
                        aria-label={`Remove the ${col.label} column`}
                        title={`Remove the ${col.label} column`}
                        onClick={() => onRemoveComputedColumn(col.computed!.id)}
                        className="text-faint hover:text-fg transition-colors rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60"
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft border-none">
            {processedOptions.map((opt, i) => (
              <tr key={i} className="group hover:bg-bg-3/30 transition-colors">
                <td className="px-4 py-4 text-fg-soft font-medium">{opt.expiration}</td>
                <td className="px-4 py-4">
                   <span className="px-2 py-1 bg-bg-3 border border-line rounded text-fg-soft font-medium font-mono text-[11px]">
                     {opt.daysToExpiration}d
                   </span>
                </td>
                <td className="px-4 py-4 font-bold text-fg tracking-tight">${opt.strike.toFixed(2)}</td>
                <td className="px-4 py-4 text-fg-soft font-mono">${opt.lastPrice.toFixed(2)}</td>
                <td className="px-4 py-4">
                  <span className={cn('font-mono', deltaTone(opt.delta))}>
                    {opt.delta.toFixed(3)}
                  </span>
                </td>
                <td className="px-4 py-4 text-dim font-mono">{opt.iv.toFixed(1)}%</td>
                <td className="px-4 py-4 text-dim font-mono">{opt.moneyness.toFixed(1)}%</td>
                <td className="px-4 py-4 text-faint font-mono">{opt.openInterest.toLocaleString()}</td>
                <td className="px-4 py-4 text-faint font-mono">{opt.volume.toLocaleString()}</td>
                <td className="px-4 py-4 text-fg-soft font-mono">{opt.maxContracts || '—'}</td>
                <td className="px-4 py-4 text-dim font-mono">
                  {byKey.totalCapitalRequired.format(opt)}
                </td>
                <td className="px-4 py-4 text-dim font-mono">
                  {byKey.totalPremiumReceived.format(opt)}
                </td>
                <td className="px-4 py-4 text-right">
                  <span className="text-a1 font-bold tabular-nums text-sm">
                    {opt.annualizedReturn.toFixed(2)}%
                  </span>
                </td>
                <td className="px-4 py-4 text-right">
                  {/* Assignment can be a loss on an ITM call, so this one is
                      signed rather than always reading as a gain. */}
                  <span
                    className={cn(
                      'font-bold tabular-nums text-sm',
                      opt.annualizedReturnWithGain < 0 ? 'text-warn' : 'text-a1'
                    )}
                  >
                    {opt.annualizedReturnWithGain.toFixed(2)}%
                  </span>
                </td>
                {/* Computed columns follow the fixed ones, in the same order as
                    the header, so a formula lands in its own cell. */}
                {computedColumns.map((c) => (
                  <td key={c.id} className="px-4 py-4 font-mono text-a1">
                    {byKey[c.id] ? byKey[c.id].format(opt) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});
ResultsTable.displayName = 'ResultsTable';
