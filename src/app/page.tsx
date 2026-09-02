'use client';

import React, { useState, useEffect, useMemo, useDeferredValue, useRef, useCallback } from 'react';
import {
  Calendar,
  TrendingUp,
  Info,
  BarChart3,
  Loader2,
  Settings2,
  LayoutGrid,
  X,
} from 'lucide-react';
import LLMChatbot from '@/components/LLMChatbot';
import { AnalysisChart } from '@/components/screener/AnalysisChart';
import { ResultsTable } from '@/components/screener/ResultsTable';
import { DualRangeSlider } from '@/components/screener/DualRangeSlider';
import { CustomKeypad } from '@/components/screener/CustomKeypad';
import type { SortConfig } from '@/components/screener/types';
import { cn, formatNumberWithCommas, formatExpirationLabel } from '@/lib/ui';
import { STRATEGIES, STRATEGY_IDS, DEFAULT_STRATEGY_ID, type StrategyId } from '@/lib/strategies';
import type { ScreenedOption, ScreenerResponse } from '@/lib/optionChain';
import { matchesFilter, describeFilter, type CustomFilter } from '@/lib/filters';

/** The enriched row the screener API returns. Shared with the server. */
type OptionData = ScreenedOption;

type ApiResponse = ScreenerResponse & { error?: string };


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

  // Custom keypad state and handlers. The state has to come first: the handlers
  // close over its setter.
  const [activeKeypad, setActiveKeypad] = useState<'minMonths' | 'maxMonths' | 'delta' | 'strikeMin' | 'strikeMax' | 'expirations' | null>(null);
  const handleCloseKeypad = useCallback(() => setActiveKeypad(null), []);
  const handleStrikeMinChange = useCallback((v: number) => setStrikeFilter(prev => [v, prev[1]]), []);
  const handleStrikeMaxChange = useCallback((v: number) => setStrikeFilter(prev => [prev[0], v]), []);

  // Defer the filters and heavy data so the sliders stay snappy
  const deferredStrikeFilter = useDeferredValue(strikeFilter);
  const deferredSelectedExps = useDeferredValue(selectedExps);

  // Delta is displayed with the sign the active strategy actually screens on.
  const deltaSign = strategy.deltaWindow(1)[0] < 0 ? '-' : '';

  const prevTickerRef = useRef('');
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

      // Assistant filters are validated data evaluated by us — no eval.
      const customMatch = customFilters.every((f) => matchesFilter(opt, f));

      return strikeMatch && expMatch && customMatch;
    });
  }, [data, deferredStrikeFilter, deferredSelectedExps, customFilters]);

  /** Headline figures for the strip above the results. */
  const summaryStats = useMemo(() => {
    if (filteredOptions.length === 0) return [];

    const median = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    const bestReturn = Math.max(...filteredOptions.map((o) => o.annualizedReturn));
    const affordable = filteredOptions.filter((o) => o.maxContracts > 0).length;

    return [
      {
        label: 'Contracts shown',
        value: filteredOptions.length.toLocaleString(),
        tone: 'text-zinc-100',
      },
      {
        label: 'Best ann. return',
        value: `${bestReturn.toFixed(1)}%`,
        tone: 'text-emerald-400',
      },
      {
        label: 'Median IV',
        value: `${median(filteredOptions.map((o) => o.iv)).toFixed(1)}%`,
        tone: 'text-zinc-100',
      },
      {
        label: 'You can afford',
        value: affordable > 0 ? `${affordable.toLocaleString()} of ${filteredOptions.length.toLocaleString()}` : 'none',
        tone: affordable > 0 ? 'text-zinc-100' : 'text-amber-500',
      },
    ];
  }, [filteredOptions]);

  return (
    <div className="min-h-screen font-sans antialiased text-white selection:bg-emerald-500/30 pb-28 md:pb-16">
      {/* Sticky Header / Mobile Controls Container */}
      <div className="sticky top-0 z-50 bg-black/90 backdrop-blur-xl border-b border-zinc-900 px-4 md:px-12 py-3 md:py-4">
        <div className="max-w-[1500px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-500">
               <TrendingUp size={20} />
            </div>
            <h1 className="text-lg md:text-2xl font-bold tracking-tighter whitespace-nowrap">
              <span className="sm:hidden">{strategy.copy.name}</span>
              <span className="hidden sm:inline">{strategy.copy.heading}</span>
            </h1>

            {/* Strategy switcher: one deployment serves every strategy. */}
            <div className="hidden sm:flex items-center gap-1 bg-zinc-900/50 border border-zinc-800 rounded-xl p-1">
              {STRATEGY_IDS.map((id) => (
                <button
                  key={id}
                  onClick={() => handleStrategyChange(id)}
                  aria-pressed={id === strategyId}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
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
               <div className="relative flex items-center gap-4 md:gap-6 bg-gradient-to-b from-zinc-900/70 to-zinc-950/70 px-3 md:px-4 py-2 rounded-xl border border-zinc-800 shadow-lg shadow-black/40">
                 <span
                   aria-hidden
                   className="absolute left-0 top-1/2 h-6 w-px -translate-y-1/2 bg-gradient-to-b from-transparent via-emerald-500/60 to-transparent"
                 />
                 <div className="flex flex-col md:flex-row md:items-baseline gap-0.5 md:gap-3 leading-none text-white">
                   <p className="text-[10px] md:text-xs text-zinc-500 uppercase font-bold tracking-[0.2em]">{data.ticker}</p>
                   <p className="text-lg md:text-2xl font-black text-emerald-400 tabular-nums tracking-tight">
                     ${data.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                   </p>
                 </div>
               </div>
             )}
             <button 
                onClick={() => setShowMobileFilters(!showMobileFilters)}
                className="lg:hidden p-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
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
              {/* The desktop switcher is hidden below sm, so mobile needs its own
                  way to change strategy. */}
              <div className="space-y-2 sm:hidden">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Strategy</label>
                <div className="grid grid-cols-2 gap-1 bg-zinc-900/50 border border-zinc-800 rounded-xl p-1">
                  {STRATEGY_IDS.map((id) => (
                    <button
                      key={id}
                      onClick={() => handleStrategyChange(id)}
                      aria-pressed={id === strategyId}
                      className={cn(
                        "px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors",
                        id === strategyId ? "bg-emerald-500 text-black" : "text-zinc-400"
                      )}
                    >
                      {STRATEGIES[id].copy.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Ticker</label>
                  <input type="text" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} className="w-full bg-zinc-900 border border-zinc-800 rounded-lg py-3 px-3 text-base sm:text-sm focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30 transition-colors text-white" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Capital ($)</label>
                  <input type="text" value={capitalInput} onChange={handleCapitalChange} className="w-full bg-zinc-900 border border-zinc-800 rounded-lg py-3 px-3 text-base sm:text-sm font-mono focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30 transition-colors text-white" />
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Months to Expiry</label>
                <div className="flex items-center gap-2">
                  <button onClick={() => setActiveKeypad('minMonths')} className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg py-3 px-3 text-sm text-left text-white group focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
                    <span>{minMonths}</span>
                  </button>
                  <span className="text-zinc-700 font-bold">→</span>
                  <button onClick={() => setActiveKeypad('maxMonths')} className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg py-3 px-3 text-sm text-left text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
                    <span>{maxMonths}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{strategy.copy.deltaLabel}</label>
                <button onClick={() => setActiveKeypad('delta')} className="w-full bg-zinc-900 border border-zinc-800 rounded-lg py-3 px-3 text-sm text-left text-white group hover:border-zinc-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
                  <span className="font-mono">{deltaSign}{deltaMagnitude}</span>
                </button>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Expirations</label>
                <button 
                  onClick={() => setActiveKeypad('expirations')} 
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg py-3 px-3 text-sm text-left text-white flex items-center justify-between group focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  <span className="truncate max-w-[200px]">
                    {selectedExps.length === 0 ? 'None selected' : 
                     selectedExps.length === Array.from(new Set((data?.options || []).map(o => o.expiration))).length ? 'All selected' :
                     selectedExps.length === 1 ? formatExpirationLabel(selectedExps[0]) :
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
                    <button onClick={() => setActiveKeypad('strikeMin')} className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg py-3 px-3 text-sm text-left text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
                      <span className="font-mono">${strikeFilter[0]}</span>
                    </button>
                    <span className="text-zinc-700 font-bold">→</span>
                    <button onClick={() => setActiveKeypad('strikeMax')} className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg py-3 px-3 text-sm text-left text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
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

      <main className="max-w-[1500px] mx-auto px-4 py-6 md:px-12 md:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 md:gap-14 items-start">
          {/* Static/Sticky Sidebar on Desktop */}
          <aside className="hidden lg:block lg:col-span-3 lg:sticky lg:top-[120px] max-h-[calc(100vh-160px)] overflow-y-auto pr-8 scrollbar-thin pb-20">
            <div className="space-y-5">
              <section className="space-y-6 rounded-2xl border border-zinc-900 bg-gradient-to-b from-zinc-950 to-black p-5">
                <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 border-b border-zinc-900 pb-2.5">Analysis Parameters</h2>
                
                {customFilters.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {customFilters.map(f => (
                      <span key={f.id} title={describeFilter(f)} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[10px] font-bold uppercase tracking-widest rounded-lg">
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
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg py-2.5 px-3 text-sm focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30 transition-colors text-white"
                    />
                  </div>

                  <div className="space-y-3">
                    <label className="text-xs font-semibold text-zinc-400">Capital Available ($)</label>
                    <input 
                      type="text" 
                      value={capitalInput}
                      onChange={handleCapitalChange}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg py-2.5 px-3 text-sm focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30 transition-colors font-mono text-white"
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
                    className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-900 disabled:text-zinc-600 text-black text-xs font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  >
                    {loading ? <Loader2 className="animate-spin" size={18} /> : <span>Update Analysis</span>}
                  </button>
                </div>
              </section>

              {data && (
                <section className="space-y-6 rounded-2xl border border-zinc-900 bg-gradient-to-b from-zinc-950 to-black p-5 text-white font-sans">
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 border-b border-zinc-900 pb-2.5">Refine Results</h2>
                  
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
                              {formatExpirationLabel(exp)}
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
          <section className="lg:col-span-9 space-y-8 md:space-y-10">
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
              <div className="space-y-10 md:space-y-14">
                {/* At-a-glance shape of what is on screen, so the numbers in the
                    table have something to be read against. */}
                <dl className="grid grid-cols-2 md:grid-cols-4 gap-px bg-zinc-900 border border-zinc-900 rounded-xl overflow-hidden">
                  {summaryStats.map((stat) => (
                    <div
                      key={stat.label}
                      className="group relative bg-gradient-to-b from-zinc-950 to-black px-4 py-5 space-y-1.5 transition-colors hover:from-zinc-900/60"
                    >
                      <dt className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-600">
                        {stat.label}
                      </dt>
                      <dd
                        className={cn(
                          'font-mono font-bold tabular-nums text-xl md:text-2xl tracking-tight',
                          stat.tone
                        )}
                      >
                        {stat.value}
                      </dd>
                    </div>
                  ))}
                </dl>

                {/* Top Picks */}
                <ResultsTable title={strategy.copy.tableTitle} options={filteredOptions.slice(0, 10)} externalSortConfig={globalSortConfig} onExternalSortChange={setGlobalSortConfig} capitalColumnLabel={strategy.copy.capitalColumnLabel} />

                {/* Charts */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6 text-white font-sans">
                  <AnalysisChart title="Yield / Strike Analysis" icon={BarChart3} data={filteredOptions} xAxisKey="strike" xAxisName="Strike" yAxisKey="annualizedReturn" yAxisName="Return" unit="%" color="#10b981" seriesName={strategy.copy.seriesName} />
                  <AnalysisChart title="Yield / DTE Profile" icon={Calendar} data={filteredOptions} xAxisKey="daysToExpiration" xAxisName="DTE" yAxisKey="annualizedReturn" yAxisName="Return" unit="%" color="#3b82f6" seriesName={strategy.copy.seriesName} />
                </div>

                {/* Full Results */}
                <ResultsTable title="Full Market Scan Results" options={filteredOptions} count={filteredOptions.length} externalSortConfig={globalSortConfig} onExternalSortChange={setGlobalSortConfig} capitalColumnLabel={strategy.copy.capitalColumnLabel} />
              </div>
            ) : loading ? (
              // A skeleton in the shape of the real results reads as progress,
              // where a centred spinner reads as a stall.
              <div className="space-y-10 animate-in fade-in duration-300">
                <dl className="grid grid-cols-2 md:grid-cols-4 gap-px bg-zinc-900 border border-zinc-900 rounded-xl overflow-hidden">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="bg-black px-4 py-5 space-y-2.5">
                      <div className="h-2 w-20 rounded bg-zinc-900 animate-pulse" />
                      <div
                        className="h-6 w-24 rounded bg-zinc-900 animate-pulse"
                        style={{ animationDelay: `${i * 90}ms` }}
                      />
                    </div>
                  ))}
                </dl>

                <div className="space-y-4">
                  <div className="flex items-center gap-2 px-1">
                    <Loader2 className="animate-spin text-emerald-500" size={12} />
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                      Scanning {ticker || 'the chain'} — pulling every expiration
                    </span>
                  </div>
                  <div className="rounded-xl border border-zinc-900 bg-black/50 divide-y divide-zinc-900 overflow-hidden">
                    {Array.from({ length: 8 }).map((_, row) => (
                      <div key={row} className="flex items-center gap-4 px-4 py-4">
                        {Array.from({ length: 7 }).map((__, col) => (
                          <div
                            key={col}
                            className="h-2.5 rounded bg-zinc-900 animate-pulse"
                            style={{
                              width: `${[68, 34, 52, 46, 40, 40, 58][col]}px`,
                              animationDelay: `${(row * 7 + col) * 22}ms`,
                            }}
                          />
                        ))}
                        <div
                          className="ml-auto h-2.5 w-14 rounded bg-emerald-500/20 animate-pulse"
                          style={{ animationDelay: `${row * 60}ms` }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
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
