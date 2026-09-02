'use client';

import React, { useState, useMemo, memo } from 'react';
import { Table as TableIcon, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/ui';
import type { ScreenedOption } from '@/lib/optionChain';
import type { SortConfig } from './types';

type OptionData = ScreenedOption;

export const ResultsTable = memo(({ 
  options, title, count, externalSortConfig, onExternalSortChange, capitalColumnLabel
}: {
  options: OptionData[], title: string, count?: number,
  externalSortConfig?: SortConfig, onExternalSortChange?: (config: SortConfig) => void,
  capitalColumnLabel: string
}) => {
  const [localSortConfig, setLocalSortConfig] = useState<SortConfig>({ key: null, direction: null });
  const sortConfig = externalSortConfig !== undefined ? externalSortConfig : localSortConfig;

  const handleSort = (key: keyof OptionData) => {
    let direction: 'asc' | 'desc' | null = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    } else if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = null;
    }
    if (onExternalSortChange) {
      onExternalSortChange({ key, direction });
    } else {
      setLocalSortConfig({ key, direction });
    }
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

  const SortIcon = ({ colKey }: { colKey: keyof OptionData }) => {
    if (sortConfig.key !== colKey) return <ArrowUpDown size={10} className="ml-1 opacity-20 group-hover:opacity-50" />;
    return sortConfig.direction === 'asc' ? <ChevronUp size={10} className="ml-1 text-emerald-500" /> : <ChevronDown size={10} className="ml-1 text-emerald-500" />;
  };

  return (
    <div className="space-y-4 text-white font-sans overflow-hidden">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2">
          <TableIcon size={12} /> {title} {count !== undefined && `(${processedOptions.length}/${count})`}
        </h3>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-900 bg-black/50 overflow-y-auto max-h-[600px] scrollbar-thin">
        <table className="w-full text-left text-[10px] md:text-[11px] whitespace-nowrap border-collapse">
          <thead className="bg-zinc-950 text-zinc-500 sticky top-0 z-10">
            <tr className="border-b border-zinc-900">
              {[
                { label: 'Expiry', key: 'expiration' },
                { label: 'DTE', key: 'daysToExpiration' },
                { label: 'Strike', key: 'strike' },
                { label: 'Premium', key: 'lastPrice' },
                { label: 'Delta', key: 'delta' },
                { label: 'IV', key: 'iv' },
                { label: 'Moneyness', key: 'moneyness' },
                { label: 'OI', key: 'openInterest' },
                { label: 'Vol', key: 'volume' },
                { label: 'Contracts', key: 'maxContracts' },
                { label: capitalColumnLabel, key: 'totalCapitalRequired' },
                { label: 'Total Prem', key: 'totalPremiumReceived' },
                { label: 'Ann. Return', key: 'annualizedReturn' },
              ].map((col) => (
                <th 
                  key={col.key} 
                  className={cn(
                    "px-4 py-4 font-semibold uppercase tracking-wider cursor-pointer group hover:text-zinc-300 transition-colors",
                    sortConfig.key === col.key && "text-emerald-500"
                  )}
                  onClick={() => handleSort(col.key as keyof OptionData)}
                >
                  <div className="flex items-center">
                    {col.label}
                    <SortIcon colKey={col.key as keyof OptionData} />
                  </div>
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
                  <span className={cn(
                    "font-mono",
                    Math.abs(opt.delta) > 0.35 ? "text-amber-500" : "text-emerald-500/80"
                  )}>
                    {opt.delta.toFixed(3)}
                  </span>
                </td>
                <td className="px-4 py-4 text-zinc-500 font-mono">{opt.iv.toFixed(1)}%</td>
                <td className="px-4 py-4 text-zinc-500 font-mono">{opt.moneyness.toFixed(1)}%</td>
                <td className="px-4 py-4 text-zinc-600 font-mono">{opt.openInterest.toLocaleString()}</td>
                <td className="px-4 py-4 text-zinc-600 font-mono">{opt.volume.toLocaleString()}</td>
                {/* A dash beats a $0 the user has to decode. */}
                <td className="px-4 py-4 text-zinc-400 font-mono">{opt.maxContracts || '—'}</td>
                <td className="px-4 py-4 text-zinc-500 font-mono">
                  {opt.maxContracts > 0 ? `$${opt.totalCapitalRequired.toLocaleString()}` : '—'}
                </td>
                <td className="px-4 py-4 text-zinc-500 font-mono">
                  {opt.maxContracts > 0
                    ? `$${opt.totalPremiumReceived.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                    : '—'}
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
