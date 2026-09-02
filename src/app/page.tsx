'use client';

import React, { useState, useEffect, useMemo, useDeferredValue, memo, useRef, useCallback } from 'react';
import { 
  Search, 
  DollarSign, 
  Calendar, 
  Percent, 
  TrendingUp, 
  Info,
  ArrowUpRight,
  Filter,
  BarChart3,
  Loader2,
  ChevronDown,
  ChevronUp,
  Settings2,
  Table as TableIcon,
  Clock,
  LayoutGrid,
  ArrowUpDown,
  X,
  Delete
} from 'lucide-react';
import { 
  ScatterChart, 
  Scatter, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer,
  CartesianGrid,
  Cell
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import LLMChatbot from '../components/LLMChatbot';
import { STRATEGIES, STRATEGY_IDS, DEFAULT_STRATEGY_ID, type StrategyId } from '@/lib/strategies';
import type { ScreenedOption, ScreenerResponse } from '@/lib/optionChain';
// --- Utils ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const formatNumberWithCommas = (value: string | number) => {
  const numericString = value.toString().replace(/[^0-9.]/g, '');
  const parts = numericString.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
};

// --- Data Types ---
/** The enriched row the screener API returns. Shared with the server. */
type OptionData = ScreenedOption;

interface CustomFilter {
  id: string;
  name: string;
  code: string;
}

type ApiResponse = ScreenerResponse & { error?: string };

type SortConfig = {
  key: keyof OptionData | null;
  direction: 'asc' | 'desc' | null;
};

// --- Memoized Components ---

const AnalysisChart = memo(({ title, icon: Icon, data, xAxisKey, xAxisName, yAxisKey, yAxisName, unit, color, seriesName }: any) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  
  return (
  <div className="bg-zinc-950 border border-zinc-900 p-4 md:p-6 space-y-4 rounded-xl text-white font-sans">
    <h4 className="font-medium text-zinc-500 flex items-center gap-2 text-[10px] md:text-sm uppercase tracking-wider">
      <Icon size={14} /> {title}
    </h4>
    <div className="h-[250px] md:h-[300px] w-full">
      {mounted ? (
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#0a0a0a" vertical={false} />
            <XAxis type="number" dataKey={xAxisKey} name={xAxisName} stroke="#27272a" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis type="number" dataKey={yAxisKey} name={yAxisName} unit={unit} stroke="#27272a" fontSize={10} tickLine={false} axisLine={false} />
            <Tooltip 
              cursor={{ strokeDasharray: '3 3' }}
              contentStyle={{ background: '#000', border: '1px solid #18181b', borderRadius: '4px', fontSize: '10px' }}
              itemStyle={{ color }}
            />
            <Scatter name={seriesName} data={data}>
                {data.map((entry: any, index: number) => (
                <Cell key={`cell-${index}`} fill={color} fillOpacity={0.6} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      ) : (
        <div className="w-full h-full bg-zinc-950/50 animate-pulse rounded-lg flex items-center justify-center">
          <Loader2 className="text-zinc-800 animate-spin" size={24} />
        </div>
      )}
    </div>
  </div>
);
});
AnalysisChart.displayName = 'AnalysisChart';

const ResultsTable = memo(({ 
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
    let sorted = [...options];

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

const DualRangeSlider = memo(({ min, max, value, onChange, label, unit = "$" }: { min: number, max: number, value: [number, number], onChange: (val: [number, number]) => void, label?: string, unit?: string }) => {
  const [localValue, setLocalValue] = useState(value);

  // Sync with parent when it changes externally (e.g. data fetch)
  useEffect(() => {
    setLocalValue(value);
  }, [value[0], value[1]]);

  // Debounced update to parent to keep things snappy
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localValue[0] !== value[0] || localValue[1] !== value[1]) {
        onChange(localValue);
      }
    }, 50); // Small 50ms debounce for 'live' but efficient feel
    return () => clearTimeout(timer);
  }, [localValue, onChange, value]);

  const minVal = Math.min(min, max);
  const maxVal = Math.max(min, max);

  const handleLowChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    setLocalValue([Math.min(val, localValue[1]), localValue[1]]);
  };

  const handleHighChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    setLocalValue([localValue[0], Math.max(val, localValue[0])]);
  };

  return (
    <div className="space-y-4">
      {label && (
        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest leading-none block">{label}</label>
      )}
      <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
        <div className="bg-zinc-900 py-1.5 rounded-lg border border-zinc-800 text-center text-zinc-100 font-bold">{unit}{localValue[0]}</div>
        <div className="bg-zinc-900 py-1.5 rounded-lg border border-zinc-800 text-center text-zinc-100 font-bold">{unit}{localValue[1]}</div>
      </div>
      <div className="dual-range-container">
        {/* Track Background */}
        <div className="absolute w-full h-1.5 bg-zinc-900 rounded-full border border-zinc-800" />
        
        {/* Active Range Highlight */}
        <div 
          className="absolute h-1.5 bg-emerald-500 rounded-full z-0" 
          style={{
            left: `${((localValue[0] - minVal) / (maxVal - minVal || 1)) * 100}%`,
            right: `${100 - ((localValue[1] - minVal) / (maxVal - minVal || 1)) * 100}%`
          }}
        />

        <input 
          type="range" 
          min={minVal} 
          max={maxVal} 
          value={localValue[0]} 
          onChange={handleLowChange}
          className="dual-range-input accent-emerald z-10"
        />
        <input 
          type="range" 
          min={minVal} 
          max={maxVal} 
          value={localValue[1]} 
          onChange={handleHighChange}
          className="dual-range-input accent-emerald z-20"
        />
      </div>
    </div>
  );
});
DualRangeSlider.displayName = 'DualRangeSlider';

const CustomKeypad = memo(({ 
  type, 
  value, 
  onClose, 
  onChange,
  tickerPrice,
  allExps
}: { 
  type: 'months' | 'delta' | 'strike' | 'expirations', 
  value: any, 
  onClose: () => void, 
  onChange: (val: any) => void,
  tickerPrice?: number,
  allExps?: string[]
}) => {
  // Use local state for the active editing value to prevent immediate parent re-renders
  const [localValue, setLocalValue] = useState<any>(() => {
    if (type === 'delta') return Math.abs(value).toString();
    if (type === 'expirations') return Array.isArray(value) ? [...value] : [];
    return value.toString();
  });
  
  const [isFirstKey, setIsFirstKey] = useState(true);

  // Sync back to parent for non-immediate types (delta, strike) with a debounce
  useEffect(() => {
    if (type === 'delta' || type === 'strike') {
      const timer = setTimeout(() => {
        const numeric = parseFloat(localValue);
        if (!isNaN(numeric)) {
          onChange(numeric);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [localValue, onChange, type]);

  const handleKey = useCallback((key: string) => {
    setLocalValue((prev: any) => {
      const str = prev.toString();
      if (key === 'BACK') {
        return str.length > 1 ? str.slice(0, -1) : '0';
      }
      if (key === '.') {
        if (!str.includes('.')) return str + '.';
        return str;
      }
      // Numeric key
      if (isFirstKey) {
        setIsFirstKey(false);
        return key;
      }
      return str === '0' ? key : str + key;
    });
  }, [isFirstKey]);

  const formatDateLabel = useCallback((dateStr: string) => {
    try {
      const d = new Date(dateStr + 'T12:00:00');
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  }, []);

  // Sub-components as local renders to avoid re-mounting logic issues
  const MonthsGrid = () => (
    <div className="flex-1 grid grid-cols-4 grid-rows-4 gap-0.5 p-0.5 bg-zinc-950/50 rounded-xl overflow-hidden min-h-0">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0].map(m => (
        <button 
          key={m}
          onClick={() => { onChange(m); onClose(); }}
          className={cn(
            "text-xl font-medium transition-colors flex items-center justify-center",
            value === m ? "bg-emerald-500 text-black hover:bg-emerald-400" : "bg-zinc-900/40 hover:bg-zinc-800/60 text-white",
            m === 0 && "col-start-2 col-span-2"
          )}
        >
          {m}
        </button>
      ))}
    </div>
  );

  const ExpirationsGrid = () => (
    <div className="flex-1 overflow-y-auto p-0.5 bg-zinc-950/50 scrollbar-none">
       <div className="grid grid-cols-3 gap-0.5 rounded-xl overflow-hidden">
        {allExps?.map((exp: string) => {
          const isSelected = Array.isArray(localValue) && localValue.includes(exp);
          return (
            <button 
              key={exp}
              onClick={() => {
                const current = Array.isArray(localValue) ? localValue : [];
                const newVal = isSelected 
                  ? current.filter((e: string) => e !== exp)
                  : [...current, exp];
                setLocalValue(newVal);
                onChange(newVal);
              }}
              className={cn(
                "py-6 flex flex-col items-center justify-center transition-all",
                isSelected 
                  ? "bg-emerald-500 text-black shadow-[inset_0_0_20px_rgba(0,0,0,0.1)]" 
                  : "bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900/60"
              )}
            >
              <span className="text-[10px] font-black uppercase tracking-tighter opacity-60 mb-1">
                {isSelected ? 'Included' : 'Hidden'}
              </span>
              <span className="text-sm font-bold tracking-tight">
                {formatDateLabel(exp)}
              </span>
            </button>
          );
        })}
       </div>
    </div>
  );

  const NumericKeypad = () => {
    const presets = type === 'delta' 
      ? [0.10, 0.15, 0.20, 0.30, 0.40] 
      : tickerPrice ? [
          { label: '-0%', val: tickerPrice },
          { label: '-5%', val: tickerPrice * 0.95 },
          { label: '-10%', val: tickerPrice * 0.90 },
          { label: '-15%', val: tickerPrice * 0.85 },
          { label: '-20%', val: tickerPrice * 0.80 },
          { label: '-25%', val: tickerPrice * 0.75 },
        ] : [];

    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between p-3 border-b border-zinc-900">
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Edit {type}</span>
          <button onClick={onClose} className="p-2 bg-zinc-900 rounded-full text-zinc-400"><X size={24} /></button>
        </div>

        <div className="flex flex-wrap justify-center gap-1.5 p-3 bg-zinc-950/30">
          {presets.map((p: any) => (
             <button 
               key={typeof p === 'number' ? p : p.label}
               onClick={() => {
                 const val = typeof p === 'number' ? p : p.val;
                 setLocalValue(Math.abs(val).toFixed(2));
                 setIsFirstKey(false);
               }}
               className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-full text-[10px] font-bold text-zinc-300 active:bg-emerald-500 active:text-black transition-colors"
             >
               {typeof p === 'number' ? p : `${p.label} ($${p.val.toFixed(2)})`}
             </button>
          ))}
        </div>

        <div className="px-6 py-2 flex flex-col items-center justify-center bg-zinc-950">
           <div className={cn(
             "text-3xl font-mono font-bold tracking-tighter transition-opacity",
             isFirstKey ? "text-zinc-600 opacity-60" : "text-white"
           )}>
             {type === 'strike' && <span className={cn(isFirstKey ? "text-zinc-800" : "text-zinc-700", "mr-2")}>$</span>}
             {type === 'delta' && <span className={cn(isFirstKey ? "text-zinc-800" : "text-zinc-700", "mr-0.5")}></span>}
             {localValue.toString()}
           </div>
        </div>

        <div className="flex-1 grid grid-cols-3 gap-0.5 p-0.5 bg-zinc-950/50">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'BACK'].map(k => (
            <button 
              key={k} 
              onClick={() => handleKey(k)}
              className="py-3.5 text-xl font-medium bg-zinc-900/40 hover:bg-zinc-800/60 active:bg-zinc-700/80 rounded flex items-center justify-center transition-colors"
            >
              {k === 'BACK' ? <Delete size={20} /> : k}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col justify-end bg-black/60 backdrop-blur-sm">
      <div className="bg-black border-t border-zinc-800 rounded-t-[2rem] overflow-hidden h-fit max-h-[85vh] min-h-[50vh] flex flex-col animate-in slide-in-from-bottom duration-300">
        {type === 'months' ? (
          <div className="flex flex-col flex-1">
             <div className="flex items-center justify-between p-3 border-b border-zinc-900">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Expiry Selection</span>
                <button onClick={onClose} className="p-2 bg-zinc-900 rounded-full text-zinc-400"><X size={24} /></button>
             </div>
             <MonthsGrid />
          </div>
        ) : type === 'expirations' ? (
          <div className="flex flex-col flex-1">
             <div className="flex items-center justify-between p-3 border-b border-zinc-900">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Filter Strike Dates</span>
                <div className="flex items-center gap-2">
                   <button 
                     onClick={() => { 
                       setLocalValue(allExps || []); 
                       onChange(allExps || []); 
                     }}
                     className="px-3 py-1.5 bg-zinc-900 rounded-lg text-[10px] font-bold text-zinc-400 uppercase tracking-widest hover:text-white"
                   >All</button>
                   <button onClick={onClose} className="p-2 bg-zinc-900 rounded-full text-zinc-400"><X size={24} /></button>
                </div>
             </div>
             <ExpirationsGrid />
          </div>
        ) : <NumericKeypad />}
      </div>
    </div>
  );
});

// --- Main Page ---

export default function OptionAnalyzer() {
  const [strategyId, setStrategyId] = useState<StrategyId>(DEFAULT_STRATEGY_ID);
  const strategy = STRATEGIES[strategyId];

  const [ticker, setTicker] = useState('');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capitalInput, setCapitalInput] = useState('100,000');
  const [minMonths, setMinMonths] = useState(strategy.defaults.minMonths);
  const [maxMonths, setMaxMonths] = useState(strategy.defaults.maxMonths);
  // Always a positive magnitude; the strategy applies the sign (calls positive,
  // puts negative) when it builds the delta window.
  const [deltaMagnitude, setDeltaMagnitude] = useState(strategy.defaults.deltaMagnitude);
  const [strikeFilter, setStrikeFilter] = useState<[number, number]>(strategy.defaults.strikeRange);
  const [selectedExps, setSelectedExps] = useState<string[]>([]);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [customFilters, setCustomFilters] = useState<CustomFilter[]>([]);
  const [needsFetch, setNeedsFetch] = useState(false);
  const [globalSortConfig, setGlobalSortConfig] = useState<SortConfig>({ key: null, direction: null });

  // Custom Keyboard State
  // Custom Keyboard Handlers
  const handleCloseKeypad = React.useCallback(() => setActiveKeypad(null), []);
  const handleStrikeMinChange = React.useCallback((v: number) => setStrikeFilter(prev => [v, prev[1]]), []);
  const handleStrikeMaxChange = React.useCallback((v: number) => setStrikeFilter(prev => [prev[0], v]), []);
  const [activeKeypad, setActiveKeypad] = useState<'minMonths' | 'maxMonths' | 'delta' | 'strikeMin' | 'strikeMax' | 'expirations' | null>(null);

  // Defer the filters and heavy data so the sliders stay snappy
  const deferredStrikeFilter = useDeferredValue(strikeFilter);
  const deferredSelectedExps = useDeferredValue(selectedExps);

  // Delta is displayed with the sign the active strategy actually screens on.
  const deltaSign = strategy.deltaWindow(1)[0] < 0 ? '-' : '';

  const prevTickerRef = useRef('');
  const prevMteRef = useRef({ min: 0, max: 6 });
  const capital = useMemo(() => capitalInput.replace(/[^0-9.]/g, ''), [capitalInput]);

  const handleCapitalChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/[^0-9.]/g, '');
    setCapitalInput(formatNumberWithCommas(rawValue));
  }, []);

  const fetchOptions = useCallback(async () => {
    if (!ticker) return;
    const currentTicker = ticker;
    const tickerChanged = prevTickerRef.current !== currentTicker;
    prevTickerRef.current = currentTicker;

    setLoading(true);
    setError(null);
    setShowMobileFilters(false);
    try {
      const params = new URLSearchParams({
        strategy: strategyId,
        ticker: currentTicker,
        capital,
        minMonths: minMonths.toString(),
        maxMonths: maxMonths.toString(),
        delta: deltaMagnitude.toString(),
      });
      const res = await fetch(`/api/options?${params}`);
      const json = await res.json();
      if (json.error) {
        setError(json.error);
      } else {
        setData(json);
        if (json.options.length > 0) {
          if (tickerChanged) {
            const strikes = json.options.map((o: OptionData) => o.strike);
            setStrikeFilter([Math.min(...strikes), Math.max(...strikes)]);
            const exps = Array.from(new Set(json.options.map((o: OptionData) => o.expiration)))
              .sort((a, b) => new Date(a as string).getTime() - new Date(b as string).getTime()) as string[];
            setSelectedExps(exps);
          }
        }
      }
    } catch {
      setError('Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [strategyId, ticker, capital, minMonths, maxMonths, deltaMagnitude]);

  useEffect(() => {
    fetchOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching strategy resets the knobs to that strategy's defaults and rescans.
  const handleStrategyChange = useCallback((next: StrategyId) => {
    if (next === strategyId) return;
    const defaults = STRATEGIES[next].defaults;
    setStrategyId(next);
    setMinMonths(defaults.minMonths);
    setMaxMonths(defaults.maxMonths);
    setDeltaMagnitude(defaults.deltaMagnitude);
    setStrikeFilter(defaults.strikeRange);
    setCustomFilters([]);
    prevTickerRef.current = '';
    setNeedsFetch(true);
  }, [strategyId]);

  useEffect(() => {
    if (needsFetch) {
      fetchOptions();
      setNeedsFetch(false);
    }
  }, [needsFetch, fetchOptions]);

  // Reset expirations when MTE filters change
  useEffect(() => {
    if (data?.options) {
      const allExps = Array.from(new Set(data.options.map(o => o.expiration)));
      setSelectedExps(allExps);
    }
  }, [minMonths, maxMonths]);

  const filteredOptions = useMemo(() => {
    if (!data) return [];
    return data.options.filter((opt: OptionData) => {
      const strikeMatch = opt.strike >= deferredStrikeFilter[0] && opt.strike <= deferredStrikeFilter[1];
      const expMatch = deferredSelectedExps.includes(opt.expiration);
      // Affordability is NOT a filter. A contract's return is a property of the
      // contract; hiding unaffordable rows left the user with a blank screen and
      // no explanation. The banner below says what capital would be needed.

      let customMatch = true;
      if (customFilters.length > 0) {
        for (const f of customFilters) {
          try {
            const fn = new Function('opt', `return ${f.code}`);
            if (!fn(opt)) { customMatch = false; break; }
          } catch (e) {
            console.error('Filter eval error:', e);
            customMatch = false; break;
          }
        }
      }

      return strikeMatch && expMatch && customMatch;
    });
  }, [data, deferredStrikeFilter, deferredSelectedExps, customFilters]);

  return (
    <div className="min-h-screen font-sans antialiased text-white selection:bg-emerald-500/30 pb-16">
      {/* Sticky Header / Mobile Controls Container */}
      <div className="sticky top-0 z-50 bg-black/90 backdrop-blur-xl border-b border-zinc-900 px-4 md:px-12 py-3 md:py-4">
        <div className="max-w-[1500px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-500">
               <TrendingUp size={20} />
            </div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tighter">{strategy.copy.heading}</h1>

            {/* Strategy switcher: one deployment serves every strategy. */}
            <div className="hidden sm:flex items-center gap-1 bg-zinc-900/50 border border-zinc-800 rounded-xl p-1">
              {STRATEGY_IDS.map((id) => (
                <button
                  key={id}
                  onClick={() => handleStrategyChange(id)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors",
                    id === strategyId
                      ? "bg-emerald-500 text-black"
                      : "text-zinc-400 hover:text-white"
                  )}
                >
                  {STRATEGIES[id].copy.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-4 md:gap-8">
             {data && (
               <div className="flex items-center gap-4 md:gap-6 bg-zinc-900/50 px-3 md:px-4 py-2 rounded-xl border border-zinc-800">
                 <div className="flex flex-col md:flex-row md:items-center gap-0.5 md:gap-3 leading-none text-white">
                   <p className="text-[10px] md:text-xs text-zinc-500 uppercase font-bold tracking-[0.2em]">{data.ticker}</p>
                   <p className="text-lg md:text-2xl font-black text-emerald-500 tabular-nums">
                     ${data.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                   </p>
                 </div>
               </div>
             )}
             <button 
                onClick={() => setShowMobileFilters(!showMobileFilters)}
                className="lg:hidden p-2 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"
                aria-label="Toggle parameters"
              >
                <Settings2 size={24} />
              </button>
          </div>
        </div>
        
        {/* Mobile Parameters Dropdown (Sticky within header) */}
        <div className={cn(
          "lg:hidden overflow-y-auto transition-all duration-300 ease-in-out scrollbar-none",
          showMobileFilters ? "max-h-[85vh] opacity-100 py-6" : "max-h-0 opacity-0 py-0"
        )}>
            <div className="space-y-8 px-1">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Ticker</label>
                  <input type="text" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} className="w-full bg-zinc-900 border border-zinc-800 rounded-md py-2 px-3 text-sm focus:border-zinc-500 outline-none text-white" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Capital ($)</label>
                  <input type="text" value={capitalInput} onChange={handleCapitalChange} className="w-full bg-zinc-900 border border-zinc-800 rounded-md py-2 px-3 text-sm font-mono focus:border-zinc-500 outline-none text-white" />
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Months to Expiry</label>
                <div className="flex items-center gap-2">
                  <button onClick={() => setActiveKeypad('minMonths')} className="flex-1 bg-zinc-900 border border-zinc-800 rounded-md py-2 px-3 text-sm text-left text-white group">
                    <span>{minMonths}</span>
                  </button>
                  <span className="text-zinc-700 font-bold">→</span>
                  <button onClick={() => setActiveKeypad('maxMonths')} className="flex-1 bg-zinc-900 border border-zinc-800 rounded-md py-2 px-3 text-sm text-left text-white">
                    <span>{maxMonths}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{strategy.copy.deltaLabel}</label>
                <button onClick={() => setActiveKeypad('delta')} className="w-full bg-zinc-900 border border-zinc-800 rounded-md py-2 px-3 text-sm text-left text-white group hover:border-zinc-700 transition-colors">
                  <span className="font-mono">{deltaSign}{deltaMagnitude}</span>
                </button>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Expirations</label>
                <button 
                  onClick={() => setActiveKeypad('expirations')} 
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-md py-2 px-3 text-sm text-left text-white flex items-center justify-between group"
                >
                  <span className="truncate max-w-[200px]">
                    {selectedExps.length === 0 ? 'None selected' : 
                     selectedExps.length === Array.from(new Set((data?.options || []).map(o => o.expiration))).length ? 'All selected' :
                     selectedExps.length === 1 ? (function(dateStr: string) {
                        try {
                          const d = new Date(dateStr + 'T12:00:00');
                          return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        } catch { return dateStr; }
                     })(selectedExps[0]) :
                     `${selectedExps.length} Dates`}
                  </span>
                  <div className="w-6 h-6 rounded bg-zinc-800 flex items-center justify-center text-[10px] font-black group-active:bg-emerald-500 group-active:text-black">
                     {selectedExps.length}
                  </div>
                </button>
              </div>

              {data && (
                <div className="space-y-3 pt-6 border-t border-zinc-900">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Strike Price Range</label>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setActiveKeypad('strikeMin')} className="flex-1 bg-zinc-900 border border-zinc-800 rounded-md py-2 px-3 text-sm text-left text-white">
                      <span className="font-mono">${strikeFilter[0]}</span>
                    </button>
                    <span className="text-zinc-700 font-bold">→</span>
                    <button onClick={() => setActiveKeypad('strikeMax')} className="flex-1 bg-zinc-900 border border-zinc-800 rounded-md py-2 px-3 text-sm text-left text-white">
                      <span className="font-mono">${strikeFilter[1]}</span>
                    </button>
                  </div>
                </div>
              )}

              <button 
                onClick={fetchOptions}
                disabled={loading}
                className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-black text-[13px] font-black uppercase tracking-widest rounded-xl flex items-center justify-center gap-2 transition-transform active:scale-[0.98]"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <span>Scan Markets</span>}
              </button>
           </div>
        </div>
      </div>

      <main className="max-w-[1500px] mx-auto p-4 md:p-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 md:gap-20 items-start">
          {/* Static/Sticky Sidebar on Desktop */}
          <aside className="hidden lg:block lg:col-span-3 lg:sticky lg:top-[120px] max-h-[calc(100vh-160px)] overflow-y-auto pr-8 scrollbar-thin pb-20">
            <div className="space-y-10">
              <section className="space-y-6">
                <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 border-b border-zinc-900 pb-2">Analysis Parameters</h2>
                
                {customFilters.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {customFilters.map(f => (
                      <span key={f.id} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[10px] font-bold uppercase tracking-widest rounded-lg">
                        {f.name}
                        <button onClick={() => setCustomFilters(prev => prev.filter(cf => cf.id !== f.id))} className="hover:text-white transition-colors">
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                
                <div className="space-y-8">
                  <div className="space-y-3">
                    <label className="text-xs font-semibold text-zinc-400">Ticker Symbol</label>
                    <input 
                      type="text" 
                      value={ticker}
                      onChange={(e) => setTicker(e.target.value.toUpperCase())}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg py-2.5 px-3 text-sm focus:outline-none focus:border-zinc-500 transition-colors text-white"
                    />
                  </div>

                  <div className="space-y-3">
                    <label className="text-xs font-semibold text-zinc-400">Capital Available ($)</label>
                    <input 
                      type="text" 
                      value={capitalInput}
                      onChange={handleCapitalChange}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg py-2.5 px-3 text-sm focus:outline-none focus:border-zinc-500 transition-colors font-mono text-white"
                    />
                  </div>

                  <DualRangeSlider 
                    min={0}
                    max={12}
                    value={[minMonths, maxMonths]}
                    onChange={([min, max]) => { setMinMonths(min); setMaxMonths(max); }}
                    label="Months Range"
                    unit=""
                  />

                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{strategy.copy.deltaLabel}</label>
                      <span className="text-xs text-emerald-500 font-mono font-bold leading-none">{deltaSign}{deltaMagnitude}</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" max="1" step="0.01"
                      value={deltaMagnitude}
                      onChange={(e) => setDeltaMagnitude(Math.abs(parseFloat(e.target.value)))}
                      className="premium-slider"
                    />
                  </div>

                  <button 
                    onClick={fetchOptions}
                    disabled={loading}
                    className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-900 disabled:text-zinc-600 text-black text-xs font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 active:scale-[0.97]"
                  >
                    {loading ? <Loader2 className="animate-spin" size={18} /> : <span>Update Analysis</span>}
                  </button>
                </div>
              </section>

              {data && (
                <section className="space-y-6 pt-6 border-t border-zinc-900 text-white font-sans">
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 border-b border-zinc-900 pb-2">Refine Results</h2>
                  
                  <div className="space-y-8 font-sans">
                    <DualRangeSlider 
                      min={Math.min(...data.options.map(o => o.strike))}
                      max={Math.max(...data.options.map(o => o.strike))}
                      value={strikeFilter}
                      onChange={setStrikeFilter}
                      label="Strike Price Filter"
                    />

                    <div className="space-y-3">
                      <label className="text-xs font-semibold text-zinc-400">Specific Expirations</label>
                      <div className="max-h-60 overflow-y-auto space-y-1 pr-2 scrollbar-thin font-mono">
                        {Array.from(new Set(data.options.map(o => o.expiration)))
                          .sort((a, b) => new Date(a as string).getTime() - new Date(b as string).getTime())
                          .map(exp => (
                            <label key={exp} className="flex items-center gap-3 text-[11px] text-zinc-500 hover:text-white cursor-pointer transition-colors py-2 border-b border-zinc-900 last:border-none group">
                              <input 
                                type="checkbox" 
                                checked={selectedExps.includes(exp)}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setSelectedExps(prev => checked ? [...prev, exp] : prev.filter(s => s !== exp));
                                }}
                                className="w-4 h-4 accent-emerald-500 bg-zinc-900 border-zinc-800 rounded-sm group-hover:border-zinc-700"
                              />
                              {(function(dateStr: string) {
                                try {
                                  const d = new Date(dateStr + 'T12:00:00');
                                  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                                } catch { return dateStr; }
                              })(exp)}
                            </label>
                          ))}
                      </div>
                    </div>
                  </div>
                </section>
              )}
            </div>
          </aside>

          {/* Scrolling Content Area */}
          <section className="lg:col-span-9 space-y-12 md:space-y-20">
            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-500 text-xs font-bold uppercase tracking-widest text-center justify-center">
                 <Info size={14} />
                 <p>{error}</p>
              </div>
            )}

            {/* Capital covers nothing on this board: say so plainly rather than
                showing a table of zeros or an empty screen. */}
            {data && data.options.length > 0 && data.affordableCount === 0 && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-3 text-amber-500">
                <Info size={14} className="mt-0.5 shrink-0" />
                <div className="space-y-1 text-xs">
                  <p className="font-bold uppercase tracking-widest">
                    Your capital covers 0 contracts
                  </p>
                  <p className="text-amber-500/80 leading-relaxed normal-case tracking-normal">
                    The cheapest contract here needs{' '}
                    <span className="font-mono font-bold">
                      ${data.minCapitalRequired.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>{' '}
                    against your{' '}
                    <span className="font-mono font-bold">${capitalInput}</span>. Returns below are
                    per contract and are still accurate — the contract and total columns show a dash.
                  </p>
                </div>
              </div>
            )}

            {data && filteredOptions.length > 0 ? (
              <div className="space-y-16 md:space-y-24">
                {/* Top Picks */}
                <ResultsTable title={strategy.copy.tableTitle} options={filteredOptions.slice(0, 10)} externalSortConfig={globalSortConfig} onExternalSortChange={setGlobalSortConfig} capitalColumnLabel={strategy.copy.capitalColumnLabel} />

                {/* Charts */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-10 text-white font-sans">
                  <AnalysisChart title="Yield / Strike Analysis" icon={BarChart3} data={filteredOptions} xAxisKey="strike" xAxisName="Strike" yAxisKey="annualizedReturn" yAxisName="Return" unit="%" color="#10b981" />
                  <AnalysisChart title="Yield / DTE Profile" icon={Calendar} data={filteredOptions} xAxisKey="daysToExpiration" xAxisName="DTE" yAxisKey="annualizedReturn" yAxisName="Return" unit="%" color="#3b82f6" />
                </div>

                {/* Full Results */}
                <ResultsTable title="Full Market Scan Results" options={filteredOptions} count={filteredOptions.length} externalSortConfig={globalSortConfig} onExternalSortChange={setGlobalSortConfig} capitalColumnLabel={strategy.copy.capitalColumnLabel} />
              </div>
            ) : (
              <div className="h-[40vh] md:h-[50vh] flex flex-col items-center justify-center space-y-6 md:space-y-10 rounded-[2rem] border border-zinc-900 bg-zinc-950/20 px-8 text-center bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-zinc-900/40 via-transparent to-transparent">
                {!loading && !error && (
                  <>
                    <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center text-zinc-600 border border-zinc-800 animate-in fade-in zoom-in duration-500">
                       <LayoutGrid size={28} />
                    </div>
                    <div className="space-y-3 animate-in slide-in-from-bottom-4 duration-500">
                      <p className="text-zinc-200 text-xl font-bold tracking-tight uppercase">Analyze the Markets</p>
                      <p className="text-zinc-500 text-xs md:text-sm max-w-xs mx-auto leading-relaxed">Enter a symbol like <span className="text-emerald-500 font-mono font-bold">NVDA</span> or <span className="text-emerald-500 font-mono font-bold">TSLA</span> to find premium {strategy.copy.emptyHint}</p>
                    </div>
                  </>
                )}
                {loading && (
                  <div className="flex flex-col items-center gap-8">
                    <div className="relative">
                      <div className="absolute inset-0 bg-emerald-500/30 blur-[40px] rounded-full animate-pulse" />
                      <Loader2 className="animate-spin text-emerald-500" size={56} strokeWidth={1} />
                    </div>
                    <div className="space-y-2">
                       <p className="text-zinc-500 text-[10px] uppercase tracking-[0.4em] font-black animate-pulse">Deep Scanning Chains</p>
                       <p className="text-zinc-700 text-[9px] uppercase tracking-widest">Real-time Data Stream Active</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Custom Keypad Bottom Sheets */}
      {activeKeypad === 'minMonths' && (
        <CustomKeypad 
          type="months" 
          value={minMonths} 
          onClose={handleCloseKeypad} 
          onChange={setMinMonths} 
        />
      )}
      {activeKeypad === 'maxMonths' && (
        <CustomKeypad 
          type="months" 
          value={maxMonths} 
          onClose={handleCloseKeypad} 
          onChange={setMaxMonths} 
        />
      )}
      {activeKeypad === 'delta' && (
        <CustomKeypad 
          type="delta" 
          value={deltaMagnitude} 
          onClose={handleCloseKeypad} 
          onChange={setDeltaMagnitude} 
        />
      )}
      {activeKeypad === 'strikeMin' && data && (
        <CustomKeypad 
          type="strike" 
          value={strikeFilter[0]} 
          onClose={handleCloseKeypad} 
          onChange={handleStrikeMinChange} 
          tickerPrice={data.currentPrice}
        />
      )}
      {activeKeypad === 'strikeMax' && data && (
        <CustomKeypad 
          type="strike" 
          value={strikeFilter[1]} 
          onClose={handleCloseKeypad} 
          onChange={handleStrikeMaxChange} 
          tickerPrice={data.currentPrice}
        />
      )}
      {activeKeypad === 'expirations' && data && (
        <CustomKeypad 
          type="expirations" 
          value={selectedExps} 
          onClose={handleCloseKeypad} 
          onChange={setSelectedExps} 
          allExps={Array.from(new Set(data.options.map(o => o.expiration)))
            .sort((a, b) => new Date(a as string).getTime() - new Date(b as string).getTime()) as string[]}
        />
      )}
      <LLMChatbot 
        subtitle={strategy.copy.assistantSubtitle}
        setTicker={setTicker}
        setCapital={setCapitalInput}
        setMinMonths={setMinMonths}
        setMaxMonths={setMaxMonths}
        setDeltaMagnitude={setDeltaMagnitude}
        setStrikeFilter={setStrikeFilter}
        addCustomFilter={(filter) => setCustomFilters(prev => [...prev.filter(f => f.id !== filter.id), filter])}
        setSortConfig={setGlobalSortConfig}
        triggerFetch={() => setNeedsFetch(true)}
      />
    </div>
  );
}
