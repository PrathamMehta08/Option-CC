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

/** Everything the screener API needs for one scan. */
interface ScanParams {
  strategyId: StrategyId;
  ticker: string;
  capital: string;
  minMonths: number;
  maxMonths: number;
  deltaMagnitude: number;
}


/** A label on the left, its control on the right — the sidebar's basic row. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 p-4">
      <span className="font-mono text-[11px] text-faint">{label}</span>
      {children}
    </div>
  );
}

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

  /**
   * A scan takes its parameters explicitly rather than closing over state.
   * That keeps it callable straight from an event handler with values React has
   * not committed yet — the strategy switcher needs exactly that — and means no
   * effect has to exist just to observe a "please refetch" flag.
   */
  const runScan = useCallback(async (params: ScanParams) => {
    if (!params.ticker) return;
    const tickerChanged = prevTickerRef.current !== params.ticker;
    prevTickerRef.current = params.ticker;

    setLoading(true);
    setError(null);
    setShowMobileFilters(false);
    try {
      const query = new URLSearchParams({
        strategy: params.strategyId,
        ticker: params.ticker,
        capital: params.capital,
        minMonths: params.minMonths.toString(),
        maxMonths: params.maxMonths.toString(),
        delta: params.deltaMagnitude.toString(),
      });
      const res = await fetch(`/api/options?${query}`);
      const json: ApiResponse = await res.json();
      if (json.error) {
        setError(json.error);
        return;
      }

      setData(json);
      if (json.options.length > 0) {
        // Expirations always follow the new results. Carrying the old selection
        // across a scan can leave every row filtered out by dates that are no
        // longer on the board.
        setSelectedExps(
          Array.from(new Set(json.options.map((o) => o.expiration))).sort(
            (a, b) => new Date(a).getTime() - new Date(b).getTime()
          )
        );
        // The strike range is a user setting, so only reset it when the
        // underlying changed and the old bounds are meaningless.
        if (tickerChanged) {
          const strikes = json.options.map((o) => o.strike);
          setStrikeFilter([Math.min(...strikes), Math.max(...strikes)]);
        }
      }
    } catch {
      setError('Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, []);

  // The parameters a scan would use right now, straight from render scope — no
  // ref, so nothing can go stale and nothing is written during render.
  const scanParams: ScanParams = {
    strategyId,
    ticker,
    capital,
    minMonths,
    maxMonths,
    deltaMagnitude,
  };

  // Deliberately not memoised: it closes over this render's parameters, and its
  // only consumers are the assistant and the retry action, neither of which
  // keys off its identity.
  const requestScan = () => {
    void runScan(scanParams);
  };

  /**
   * Scan whenever a parameter settles. Making the user press a button to see
   * the effect of a slider they just dragged is the kind of friction that makes
   * a tool feel like paperwork.
   *
   * Debounced so dragging a slider or typing a ticker fires one request, not
   * thirty, and keyed on a string signature so the effect does not re-run on
   * every render just because the params object is new.
   */
  const scanSignature = `${strategyId}|${ticker}|${capital}|${minMonths}|${maxMonths}|${deltaMagnitude}`;
  useEffect(() => {
    if (!ticker) return;
    const timer = setTimeout(() => {
      void runScan({ strategyId, ticker, capital, minMonths, maxMonths, deltaMagnitude });
    }, 500);
    return () => clearTimeout(timer);
    // scanSignature is the debounce key; runScan is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanSignature, runScan]);

  // Switching strategy resets the knobs to that strategy's defaults and rescans.
  const handleStrategyChange = (next: StrategyId) => {
    if (next === strategyId) return;
    const defaults = STRATEGIES[next].defaults;
    setStrategyId(next);
    setMinMonths(defaults.minMonths);
    setMaxMonths(defaults.maxMonths);
    setDeltaMagnitude(defaults.deltaMagnitude);
    setStrikeFilter(defaults.strikeRange);
    setCustomFilters([]);
    prevTickerRef.current = '';
    // No explicit scan here: the debounced effect above sees the parameters
    // change and runs one.
  };

  const allExpirations = useMemo(
    () =>
      data
        ? Array.from(new Set(data.options.map((o) => o.expiration))).sort(
            (a, b) => new Date(a).getTime() - new Date(b).getTime()
          )
        : [],
    [data]
  );

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
        tone: 'text-fg',
      },
      {
        label: 'Best ann. return',
        value: `${bestReturn.toFixed(1)}%`,
        tone: 'text-grad',
      },
      {
        label: 'Median IV',
        value: `${median(filteredOptions.map((o) => o.iv)).toFixed(1)}%`,
        tone: 'text-fg',
      },
      {
        label: 'You can afford',
        value: affordable > 0 ? `${affordable.toLocaleString()} of ${filteredOptions.length.toLocaleString()}` : 'none',
        tone: affordable > 0 ? 'text-fg' : 'text-amber-500',
      },
    ];
  }, [filteredOptions]);

  return (
    <div className="min-h-screen font-sans antialiased text-fg selection:bg-zinc-700 pb-28 md:pb-16">
      {/* Sticky Header / Mobile Controls Container */}
      <div className="sticky top-0 z-50 bg-bg/85 backdrop-blur-xl border-b border-line px-4 md:px-12 py-3 md:py-4">
        <div className="max-w-[1500px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center justify-center w-10 h-10 rounded-lg bg-bg-3 border border-line text-fg-soft">
               <TrendingUp size={20} />
            </div>
            <h1 className="text-lg md:text-2xl font-bold tracking-tighter whitespace-nowrap">
              <span className="sm:hidden">{strategy.copy.name}</span>
              <span className="hidden sm:inline">{strategy.copy.heading}</span>
            </h1>

            {/* Strategy switcher: one deployment serves every strategy. */}
            <div className="hidden sm:flex items-center gap-1 bg-bg-2 border border-line rounded-lg p-1">
              {STRATEGY_IDS.map((id) => (
                <button
                  key={id}
                  onClick={() => handleStrategyChange(id)}
                  aria-pressed={id === strategyId}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-normal transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60",
                    id === strategyId
                      ? "bg-a1/12 text-a1 ring-1 ring-inset ring-a1/25"
                      : "text-fg-soft hover:text-fg"
                  )}
                >
                  {STRATEGIES[id].copy.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-4 md:gap-8">
             {data && (
               <div className="relative flex items-center gap-4 md:gap-6 bg-bg-2 px-3 md:px-4 py-2 rounded-lg border border-line">
                 <span
                   aria-hidden
                   className="absolute left-0 top-1/2 h-6 w-px -translate-y-1/2 bg-gradient-to-b from-transparent via-zinc-600 to-transparent"
                 />
                 <div className="flex flex-col md:flex-row md:items-baseline gap-0.5 md:gap-3 leading-none text-fg">
                   <p className="text-[11px] md:text-xs text-dim font-bold tracking-normal">{data.ticker}</p>
                   <p className="text-lg md:text-2xl font-semibold text-grad tabular-nums tracking-tight">
                     ${data.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                   </p>
                 </div>
               </div>
             )}
             <button 
                onClick={() => setShowMobileFilters(!showMobileFilters)}
                className="lg:hidden p-2.5 bg-bg-3 border border-line rounded-lg text-fg-soft hover:text-fg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60"
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
                <label className="text-[11px] font-bold text-dim tracking-normal">Strategy</label>
                <div className="grid grid-cols-2 gap-1 bg-bg-2 border border-line rounded-lg p-1">
                  {STRATEGY_IDS.map((id) => (
                    <button
                      key={id}
                      onClick={() => handleStrategyChange(id)}
                      aria-pressed={id === strategyId}
                      className={cn(
                        "px-3 py-2 rounded-lg text-[11px] font-bold tracking-normal transition-colors",
                        id === strategyId ? "bg-a1/12 text-a1 ring-1 ring-inset ring-a1/25" : "text-fg-soft"
                      )}
                    >
                      {STRATEGIES[id].copy.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-dim tracking-normal">Ticker</label>
                  <input type="text" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} className="w-full bg-bg-3 border border-line rounded-lg py-3 px-3 text-base sm:text-sm focus:outline-none focus:border-a1/50 focus:ring-1 focus:ring-a1/25 transition-colors text-fg" />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-dim tracking-normal">Capital ($)</label>
                  <input type="text" value={capitalInput} onChange={handleCapitalChange} className="w-full bg-bg-3 border border-line rounded-lg py-3 px-3 text-base sm:text-sm font-mono focus:outline-none focus:border-a1/50 focus:ring-1 focus:ring-a1/25 transition-colors text-fg" />
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[11px] font-bold text-dim tracking-normal">Months to Expiry</label>
                <div className="flex items-center gap-2">
                  <button onClick={() => setActiveKeypad('minMonths')} className="flex-1 bg-bg-3 border border-line rounded-lg py-3 px-3 text-sm text-left text-fg group focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60">
                    <span>{minMonths}</span>
                  </button>
                  <span className="text-faint font-bold">→</span>
                  <button onClick={() => setActiveKeypad('maxMonths')} className="flex-1 bg-bg-3 border border-line rounded-lg py-3 px-3 text-sm text-left text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60">
                    <span>{maxMonths}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[11px] font-bold text-dim tracking-normal">{strategy.copy.deltaLabel}</label>
                <button onClick={() => setActiveKeypad('delta')} className="w-full bg-bg-3 border border-line rounded-lg py-3 px-3 text-sm text-left text-fg group hover:border-line transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60">
                  <span className="font-mono">{deltaSign}{deltaMagnitude}</span>
                </button>
              </div>

              <div className="space-y-3">
                <label className="text-[11px] font-bold text-dim tracking-normal">Expirations</label>
                <button 
                  onClick={() => setActiveKeypad('expirations')} 
                  className="w-full bg-bg-3 border border-line rounded-lg py-3 px-3 text-sm text-left text-fg flex items-center justify-between group focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60"
                >
                  <span className="truncate max-w-[200px]">
                    {selectedExps.length === 0 ? 'None selected' : 
                     selectedExps.length === Array.from(new Set((data?.options || []).map(o => o.expiration))).length ? 'All selected' :
                     selectedExps.length === 1 ? formatExpirationLabel(selectedExps[0]) :
                     `${selectedExps.length} Dates`}
                  </span>
                  <div className="w-6 h-6 rounded bg-bg-3 flex items-center justify-center text-[11px] font-semibold group-active:bg-zinc-600 group-active:text-fg">
                     {selectedExps.length}
                  </div>
                </button>
              </div>

              {data && (
                <div className="space-y-3 pt-6 border-t border-line">
                  <label className="text-[11px] font-bold text-dim tracking-normal">Strike Price Range</label>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setActiveKeypad('strikeMin')} className="flex-1 bg-bg-3 border border-line rounded-lg py-3 px-3 text-sm text-left text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60">
                      <span className="font-mono">${strikeFilter[0]}</span>
                    </button>
                    <span className="text-faint font-bold">→</span>
                    <button onClick={() => setActiveKeypad('strikeMax')} className="flex-1 bg-bg-3 border border-line rounded-lg py-3 px-3 text-sm text-left text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60">
                      <span className="font-mono">${strikeFilter[1]}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Results update as you change these — no submit step. This just
                  closes the sheet so you can see them. */}
              <button
                onClick={() => setShowMobileFilters(false)}
                className="w-full py-3.5 rounded-lg border border-line bg-bg-3 text-fg-soft text-[13px] font-medium flex items-center justify-center gap-2 transition-colors hover:text-fg active:scale-[0.99]"
              >
                {loading ? (
                  <><Loader2 className="animate-spin text-a1" size={15} /> Scanning…</>
                ) : (
                  'Show results'
                )}
              </button>
           </div>
        </div>
      </div>

      <main className="max-w-[1500px] mx-auto px-4 py-6 md:px-12 md:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 md:gap-14 items-start">
          {/* Static/Sticky Sidebar on Desktop */}
          <aside className="hidden lg:block lg:col-span-3 lg:sticky lg:top-[104px] max-h-[calc(100vh-132px)] overflow-y-auto scrollbar-thin pb-10">
            <div className="rounded-lg border border-line bg-bg-2 divide-y divide-line-soft">
              {/* Ticker: the one thing everything else hangs off, so it leads and
                  is the only control given real size. */}
              <div className="p-4 space-y-2">
                <label htmlFor="ticker" className="rule block font-mono text-[11px] text-faint">
                  Underlying
                </label>
                <input
                  id="ticker"
                  type="text"
                  value={ticker}
                  placeholder="NVDA"
                  onChange={(e) => setTicker(e.target.value.toUpperCase())}
                  className="w-full bg-transparent text-2xl font-semibold tracking-tight text-fg placeholder:text-faint/50 focus:outline-none"
                />
                <div className="flex items-center gap-2 text-[11px] font-mono">
                  {loading ? (
                    <>
                      <Loader2 className="animate-spin text-a1" size={11} />
                      <span className="text-dim">Scanning…</span>
                    </>
                  ) : data ? (
                    <>
                      <span className="h-1.5 w-1.5 rounded-full bg-a1" />
                      <span className="text-dim">
                        {data.options.length.toLocaleString()} contracts · ${data.currentPrice.toFixed(2)}
                      </span>
                    </>
                  ) : (
                    <span className="text-faint">Type a symbol to scan</span>
                  )}
                </div>
              </div>

              <Field label="Capital">
                <input
                  type="text"
                  value={capitalInput}
                  onChange={handleCapitalChange}
                  className="w-28 bg-transparent text-right font-mono text-sm text-fg focus:outline-none"
                />
              </Field>

              <div className="p-4 space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[11px] text-faint">Months to expiry</span>
                  <span className="font-mono text-sm text-fg">
                    {minMonths}–{maxMonths}
                  </span>
                </div>
                <DualRangeSlider
                  min={0}
                  max={24}
                  value={[minMonths, maxMonths]}
                  onChange={([min, max]) => { setMinMonths(min); setMaxMonths(max); }}
                  unit=""
                />
              </div>

              <div className="p-4 space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[11px] text-faint">{strategy.copy.deltaLabel}</span>
                  <span className="font-mono text-sm text-fg">{deltaSign}{deltaMagnitude.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0" max="1" step="0.01"
                  value={deltaMagnitude}
                  aria-label={strategy.copy.deltaLabel}
                  onChange={(e) => setDeltaMagnitude(Math.abs(parseFloat(e.target.value)))}
                  // Drives the filled portion of the track (see globals.css).
                  style={{ ['--fill' as string]: `${deltaMagnitude * 100}%` }}
                  className="premium-slider"
                />
              </div>

              {data && data.options.length > 0 && (
                <div className="p-4 space-y-3">
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-[11px] text-faint">Strike range</span>
                    <span className="font-mono text-sm text-fg">
                      ${strikeFilter[0]}–${strikeFilter[1]}
                    </span>
                  </div>
                  <DualRangeSlider
                    min={Math.min(...data.options.map((o) => o.strike))}
                    max={Math.max(...data.options.map((o) => o.strike))}
                    value={strikeFilter}
                    onChange={setStrikeFilter}
                  />
                </div>
              )}

              {/* Expirations as a chip grid. The old checkbox column was a
                  scroll-within-a-scroll and took more height than everything
                  else combined. */}
              {data && allExpirations.length > 0 && (
                <div className="p-4 space-y-2.5">
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-[11px] text-faint">Expirations</span>
                    <button
                      onClick={() =>
                        setSelectedExps(
                          selectedExps.length === allExpirations.length ? [] : allExpirations
                        )
                      }
                      className="font-mono text-[11px] text-dim hover:text-a1 transition-colors"
                    >
                      {selectedExps.length === allExpirations.length ? 'none' : 'all'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {allExpirations.map((exp) => {
                      const on = selectedExps.includes(exp);
                      return (
                        <button
                          key={exp}
                          aria-pressed={on}
                          onClick={() =>
                            setSelectedExps((prev) =>
                              on ? prev.filter((e) => e !== exp) : [...prev, exp]
                            )
                          }
                          className={cn(
                            'rounded px-2 py-1 font-mono text-[11px] transition-colors',
                            on
                              ? 'bg-a1/12 text-a1 ring-1 ring-inset ring-a1/30'
                              : 'bg-bg-3 text-faint hover:text-fg-soft'
                          )}
                        >
                          {formatExpirationLabel(exp)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {customFilters.length > 0 && (
                <div className="p-4 space-y-2.5">
                  <span className="font-mono text-[11px] text-faint">From the assistant</span>
                  <div className="flex flex-wrap gap-1.5">
                    {customFilters.map((f) => (
                      <span
                        key={f.id}
                        title={describeFilter(f)}
                        className="flex items-center gap-1.5 rounded bg-a2/10 px-2 py-1 text-[11px] text-a2 ring-1 ring-inset ring-a2/25"
                      >
                        {f.name}
                        <button
                          aria-label={`Remove ${f.name}`}
                          onClick={() => setCustomFilters((prev) => prev.filter((cf) => cf.id !== f.id))}
                          className="opacity-60 hover:opacity-100 transition-opacity"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>

          {/* Scrolling Content Area */}
          <section className="lg:col-span-9 space-y-8 md:space-y-10">
            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-3 text-red-500 text-xs font-bold tracking-normal text-center justify-center">
                 <Info size={14} />
                 <p>{error}</p>
              </div>
            )}

            {/* Capital covers nothing on this board: say so plainly rather than
                showing a table of zeros or an empty screen. */}
            {data && data.options.length > 0 && data.affordableCount === 0 && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-3 text-amber-500">
                <Info size={14} className="mt-0.5 shrink-0" />
                <div className="space-y-1 text-xs">
                  <p className="font-bold tracking-normal">
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
                <dl className="grid grid-cols-2 md:grid-cols-4 gap-px bg-bg-3 border border-line rounded-lg overflow-hidden">
                  {summaryStats.map((stat) => (
                    <div
                      key={stat.label}
                      className="group relative bg-bg-2 px-4 py-5 space-y-1.5 transition-colors hover:from-zinc-900/60"
                    >
                      <dt className="text-[11px] font-bold tracking-normal text-faint">
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6 text-fg font-sans">
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
                <dl className="grid grid-cols-2 md:grid-cols-4 gap-px bg-bg-3 border border-line rounded-lg overflow-hidden">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="bg-bg px-4 py-5 space-y-2.5">
                      <div className="h-2 w-20 rounded bg-bg-3 animate-pulse" />
                      <div
                        className="h-6 w-24 rounded bg-bg-3 animate-pulse"
                        style={{ animationDelay: `${i * 90}ms` }}
                      />
                    </div>
                  ))}
                </dl>

                <div className="space-y-4">
                  <div className="flex items-center gap-2 px-1">
                    <Loader2 className="animate-spin text-fg-soft" size={12} />
                    <span className="text-[11px] font-medium text-dim">
                      Scanning {ticker || 'the chain'} — pulling every expiration
                    </span>
                  </div>
                  <div className="rounded-lg border border-line bg-bg-2/60 divide-y divide-line-soft overflow-hidden">
                    {Array.from({ length: 8 }).map((_, row) => (
                      <div key={row} className="flex items-center gap-4 px-4 py-4">
                        {Array.from({ length: 7 }).map((__, col) => (
                          <div
                            key={col}
                            className="h-2.5 rounded bg-bg-3 animate-pulse"
                            style={{
                              width: `${[68, 34, 52, 46, 40, 40, 58][col]}px`,
                              animationDelay: `${(row * 7 + col) * 22}ms`,
                            }}
                          />
                        ))}
                        <div
                          className="ml-auto h-2.5 w-14 rounded bg-bg-3 animate-pulse"
                          style={{ animationDelay: `${row * 60}ms` }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-[40vh] md:h-[50vh] flex flex-col items-center justify-center space-y-6 md:space-y-10 rounded-[2rem] border border-line bg-bg/20 px-8 text-center bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-zinc-900/40 via-transparent to-transparent">
                {!loading && !error && (
                  <>
                    <div className="w-16 h-16 rounded-lg bg-bg-3 flex items-center justify-center text-faint border border-line animate-in fade-in zoom-in duration-500">
                       <LayoutGrid size={28} />
                    </div>
                    <div className="space-y-3 animate-in slide-in-from-bottom-4 duration-500">
                      <p className="text-fg text-xl font-bold tracking-tight">Analyze the Markets</p>
                      <p className="text-dim text-xs md:text-sm max-w-xs mx-auto leading-relaxed">Enter a symbol like <span className="text-fg font-mono font-medium">NVDA</span> or <span className="text-fg font-mono font-medium">TSLA</span> to find premium {strategy.copy.emptyHint}</p>
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
        triggerFetch={requestScan}
      />
    </div>
  );
}
