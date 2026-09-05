'use client';

import React, { useState, useEffect, useMemo, useDeferredValue, useCallback, useRef } from 'react';
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
import { ResultsTable, buildColumns, type MobileView } from '@/components/screener/ResultsTable';
import { sortOptions } from '@/components/screener/sortOptions';
import { NumericField, QuickPicks } from '@/components/screener/NumericField';
import { CustomKeypad } from '@/components/screener/CustomKeypad';
import { StrikePresets } from '@/components/screener/StrikePresets';
import type { SortConfig } from '@/components/screener/types';
import { cn, formatNumberWithCommas, formatExpirationLabel } from '@/lib/ui';
import { STRATEGIES, STRATEGY_IDS, DEFAULT_STRATEGY_ID, type StrategyId } from '@/lib/strategies';
import type { ScreenedOption } from '@/lib/optionChain';
import type { ChainResponse } from '@/lib/chain';
import { MAX_MONTHS, asMonthWindow, withMonthsFrom, withMonthsTo } from '@/lib/monthWindow';
import {
  boardReady,
  scanSettled,
  settingsApplied,
  type AppliedSettings,
  type WantedSettings,
} from '@/lib/scanSettled';
import { screenLoadedChain } from '@/lib/screen';
import { matchesFilter, describeFilter, type CustomFilter } from '@/lib/filters';
import { compileFormula, type ComputedColumn } from '@/lib/formula';
import { describeScreen } from '@/lib/assistant/screenSummary';

/** The enriched row the screener API returns. Shared with the server. */
type OptionData = ScreenedOption;

/** The chain endpoint's payload, plus the error shape it uses on failure. */
type ChainApiResponse = ChainResponse & { error?: string };


/**
 * How long readScreen will wait for an in-flight scan before reporting what it
 * has. Long enough for a cold chain fetch, short enough not to look hung.
 */
const SCAN_WAIT_MS = 9000;
/** How long a local re-render is given once the chain itself has arrived. */
const SETTLE_WAIT_MS = 1500;

/** The month windows worth a single click. */
const MONTH_PRESETS: { label: string; value: [number, number] }[] = [
  { label: '0–1', value: [0, 1] },
  { label: '0–3', value: [0, 3] },
  { label: '0–6', value: [0, 6] },
  { label: '0–12', value: [0, 12] },
  { label: 'all', value: [0, MAX_MONTHS] },
];

/** The deltas people actually screen at. */
const DELTA_PRESETS = [0.1, 0.15, 0.2, 0.3, 0.4].map((v) => ({
  label: v.toFixed(2),
  value: v,
}));

/** A label on the left, its control on the right — the sidebar's basic row. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 p-4">
      <span className="min-w-0 truncate font-mono text-[11px] text-faint">{label}</span>
      {children}
    </div>
  );
}

export default function OptionAnalyzer() {
  const [strategyId, setStrategyId] = useState<StrategyId>(DEFAULT_STRATEGY_ID);
  const strategy = STRATEGIES[strategyId];

  const [ticker, setTicker] = useState('');
  /**
   * The whole option board for the loaded ticker: both sides, every expiration.
   * Fetched once per symbol and never refetched for a filter — capital, delta,
   * months, strike and strategy are all pure functions of this.
   */
  const [chain, setChain] = useState<ChainResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capitalInput, setCapitalInput] = useState('100,000');
  // The window is one value, not two numbers that happen to sit beside each
  // other: that is what let them cross.
  const [monthWindow, setMonthWindow] = useState<[number, number]>(() =>
    asMonthWindow(strategy.defaults.minMonths, strategy.defaults.maxMonths)
  );
  const [minMonths, maxMonths] = monthWindow;
  // Always a positive magnitude; the strategy applies the sign (calls positive,
  // puts negative) when it builds the delta window.
  const [deltaMagnitude, setDeltaMagnitude] = useState(strategy.defaults.deltaMagnitude);
  const [strikeFilter, setStrikeFilter] = useState<[number, number]>(strategy.defaults.strikeRange);
  const [selectedExps, setSelectedExps] = useState<string[]>([]);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [customFilters, setCustomFilters] = useState<CustomFilter[]>([]);
  const [computedColumns, setComputedColumns] = useState<ComputedColumn[]>([]);
  const [globalSortConfig, setGlobalSortConfig] = useState<SortConfig>({ key: null, direction: null });
  // One layout choice for every table on the page. Owned here for the same
  // reason the sort is: two tables that disagree about their layout is a bug,
  // not a feature.
  const [mobileView, setMobileView] = useState<MobileView>('table');
  // Assistant-only mode: the screener stops rendering entirely rather than
  // sitting behind an opaque overlay building a 264-row table nobody can see.
  const [soloMode, setSoloMode] = useState(false);

  // Custom keypad state and handlers. The state has to come first: the handlers
  // close over its setter.
  const [activeKeypad, setActiveKeypad] = useState<'minMonths' | 'maxMonths' | 'delta' | 'strikeMin' | 'strikeMax' | 'expirations' | null>(null);
  const handleCloseKeypad = useCallback(() => setActiveKeypad(null), []);
  const handleStrikeMinChange = useCallback(
    (v: number) => setStrikeFilter((prev) => [v, Math.max(prev[1], v)]),
    []
  );
  const handleStrikeMaxChange = useCallback(
    (v: number) => setStrikeFilter((prev) => [Math.min(prev[0], v), v]),
    []
  );

  /**
   * Every route into the month window goes through these, so it can never end
   * up inverted — not from the sidebar, not from a keypad, not from a model
   * that emits a backwards pair. The rules themselves live in lib/monthWindow.
   */
  const setMonthsFrom = useCallback((v: number) => {
    setMonthWindow((prev) => withMonthsFrom(prev, v));
  }, []);
  const setMonthsTo = useCallback((v: number) => {
    setMonthWindow((prev) => withMonthsTo(prev, v));
  }, []);
  const setMonthsRange = useCallback((from: number, to: number) => {
    setMonthWindow(asMonthWindow(from, to));
  }, []);

  // Defer the filters and heavy data so the sliders stay snappy
  const deferredStrikeFilter = useDeferredValue(strikeFilter);
  const deferredSelectedExps = useDeferredValue(selectedExps);

  // Delta is displayed with the sign the active strategy actually screens on.
  const deltaSign = strategy.deltaWindow(1)[0] < 0 ? '-' : '';

  const capital = useMemo(() => capitalInput.replace(/[^0-9.]/g, ''), [capitalInput]);
  const capitalNumber = parseFloat(capital) || 0;

  const handleCapitalChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/[^0-9.]/g, '');
    setCapitalInput(formatNumberWithCommas(rawValue));
  }, []);

  /**
   * Load the board for one ticker. This is the entire network layer.
   *
   * Nothing else fetches: the screener used to ask the server for a *screened*
   * board, so every knob — capital, delta, months, strategy — was a round trip
   * to Yahoo for data already in the browser.
   */
  const loadChain = useCallback(async (symbol: string) => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/chain?ticker=${encodeURIComponent(symbol)}`);
      const json: ChainApiResponse = await res.json();
      if (json.error) {
        setError(json.error);
        setChain(null);
        return;
      }
      setChain(json);
    } catch {
      setError('Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced so typing a symbol fires one request rather than one per letter.
  useEffect(() => {
    if (!ticker) return;
    const timer = setTimeout(() => void loadChain(ticker), 400);
    return () => clearTimeout(timer);
  }, [ticker, loadChain]);

  /**
   * The screened board — a memo where there used to be a network request.
   *
   * Re-runs on any knob, over a chain already in memory, so a slider drag is
   * arithmetic rather than a fetch.
   */
  const data = useMemo(
    () =>
      chain
        ? screenLoadedChain(chain, {
            strategy,
            capital: capitalNumber,
            deltaMagnitude,
            minMonths,
            maxMonths,
          })
        : null,
    [chain, strategy, capitalNumber, deltaMagnitude, minMonths, maxMonths]
  );

  // Whether the screen is actually showing something for the current ticker.
  // Everything that signals "loaded" keys off this one flag rather than each
  // deciding for itself.
  const hasResults = !!data && data.options.length > 0 && data.ticker === ticker;

  // Switching strategy resets the knobs to that strategy's defaults. It reads
  // the other side of a board already loaded, so it costs no request.
  const handleStrategyChange = (next: StrategyId) => {
    if (next === strategyId) return;
    const defaults = STRATEGIES[next].defaults;
    setStrategyId(next);
    setMonthWindow(asMonthWindow(defaults.minMonths, defaults.maxMonths));
    setDeltaMagnitude(defaults.deltaMagnitude);
    setCustomFilters([]);
  };

  /**
   * Compile a formula into a column. Returns a message for the assistant so a
   * bad formula comes back as something the model can correct, not a silent
   * no-op. Adding a column also sorts by it, which is what the request
   * ("sort by oi^2 + ann return^2") actually asked for.
   */
  const addComputedColumn = (input: { id: string; name: string; expression: string }) => {
    const compiled = compileFormula(input.expression);
    if (!compiled.ok) return { ok: false as const, error: compiled.error };

    const column: ComputedColumn = {
      id: input.id,
      name: input.name,
      source: compiled.formula.source,
      evaluate: compiled.formula.evaluate,
    };
    setComputedColumns((prev) => [...prev.filter((c) => c.id !== column.id), column]);
    setGlobalSortConfig({ key: column.id, direction: 'desc' });
    return { ok: true as const, column };
  };

  const removeComputedColumn = (id: string) => {
    setComputedColumns((prev) => prev.filter((c) => c.id !== id));
    setGlobalSortConfig((prev) => (prev.key === id ? { key: null, direction: null } : prev));
  };


  /** The formatting the assistant's card uses, so it matches the table's. */
  const cardColumns = useMemo(
    () =>
      Object.fromEntries(
        buildColumns(strategy.copy.capitalColumnLabel, computedColumns).map((c) => [c.key, c])
      ),
    [strategy.copy.capitalColumnLabel, computedColumns]
  );

  const allExpirations = useMemo(
    () =>
      data
        ? Array.from(new Set(data.options.map((o) => o.expiration))).sort(
            (a, b) => new Date(a).getTime() - new Date(b).getTime()
          )
        : [],
    [data]
  );

  /**
   * Keep the expiration selection in step with the dates actually on the board.
   *
   * Moving the months slider changes which dates exist, and the chip list has to
   * follow immediately — without closing whatever the user has open, which is
   * what a refetch-and-reset used to do. Dates already on offer keep whatever
   * the user did to them; dates that have just appeared arrive selected, so
   * widening the window widens the results instead of silently adding nothing.
   *
   * Adjusting state during render is React's documented alternative to an
   * effect for deriving state from a change: no extra pass, no cascading render.
   */
  const expSignature = allExpirations.join(',');
  const [expSync, setExpSync] = useState<{ signature: string; offered: string[] }>({
    signature: '',
    offered: [],
  });
  if (expSync.signature !== expSignature) {
    const previouslyOffered = expSync.offered;
    setExpSync({ signature: expSignature, offered: allExpirations });
    setSelectedExps((prev) =>
      allExpirations.filter((e) => (previouslyOffered.includes(e) ? prev.includes(e) : true))
    );
  }

  /**
   * Strike slider bounds, taken from the whole board rather than the rows
   * currently showing. Deriving them from the filtered set makes the track
   * shrink around whatever you just did, so the handle keeps sliding out from
   * under your finger.
   */
  const strikeBounds = useMemo((): [number, number] | null => {
    if (!chain) return null;
    const strikes = chain.expirations
      .flatMap((e) => e[strategy.chainSide])
      .filter((c) => strategy.isEligible(c, chain.currentPrice))
      .map((c) => c.strike);
    if (strikes.length === 0) return null;
    // Whole numbers, widened outwards, to match the slider's own track bounds —
    // a fractional bound leaves the thumb unable to reach its end.
    return [Math.floor(Math.min(...strikes)), Math.ceil(Math.max(...strikes))];
  }, [chain, strategy]);

  // A strike range from another underlying — or from the other side of the
  // chain — is meaningless, so reset it when the board itself changes. Not when
  // a filter merely narrows what the board shows.
  const boardKey = `${chain?.ticker ?? ''}|${strategyId}`;
  const [seenBoard, setSeenBoard] = useState('');
  if (strikeBounds && seenBoard !== boardKey) {
    setSeenBoard(boardKey);
    setStrikeFilter(strikeBounds);
  }

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

  /**
   * The rows in the order the user asked for.
   *
   * Sorted here rather than inside each table so that every consumer agrees.
   * The assistant used to be handed the unsorted list while the table showed a
   * sorted one, so "sort by X and give me the top one" named a contract from a
   * different ranking — and the top-picks table took its ten from the default
   * order before re-sorting only those ten, which is not the top ten.
   */
  const sortedOptions = useMemo(
    () => sortOptions(filteredOptions, globalSortConfig, cardColumns),
    [filteredOptions, globalSortConfig, cardColumns]
  );

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

  /**
   * What the month sheet shows while it is open. The sheet covers the filter
   * panel, so without this a tap on "6" has no visible effect until the sheet
   * is dismissed — which is exactly the round trip that made picking a range
   * feel like guessing.
   */
  const monthsHint = !chain ? (
    'Load a ticker to see expirations'
  ) : allExpirations.length === 0 ? (
    <span className="text-warn">No expirations between {minMonths} and {maxMonths} months</span>
  ) : (
    <>
      <span className="text-a1">{allExpirations.length}</span>
      {allExpirations.length === 1 ? ' expiration' : ' expirations'}
      {' · '}
      {formatExpirationLabel(allExpirations[0])}
      {allExpirations.length > 1 && ` → ${formatExpirationLabel(allExpirations[allExpirations.length - 1])}`}
    </>
  );

  /**
   * What the assistant's readScreen tool hands back. The summary itself lives
   * in src/lib/assistant/screenSummary.ts so it can be tested without a model
   * call — which matters, since the daily token budget makes prompting the
   * real assistant an expensive way to check a string.
   */
  const snapshot = () =>
    describeScreen({
      data,
      loading,
      visible: sortedOptions,
      companyName: chain?.companyName ?? null,
      strategyName: strategy.copy.name,
      resultsView: mobileView,
      capital: capitalInput,
      minMonths,
      maxMonths,
      deltaSign,
      deltaMagnitude,
      strikeFilter,
      selectedExpirations: selectedExps,
      customFilters,
      computedColumns,
      sort: globalSortConfig,
    });

  /**
   * The snapshot, kept where an async callback can reach it.
   *
   * Written in an effect rather than during render: refs are not readable or
   * writable in render under the React Compiler rules this project lints with.
   */
  const snapshotRef = useRef(snapshot);
  const scanStateRef = useRef({
    loading,
    wanted: ticker,
    loaded: data?.ticker ?? null,
    failed: !!error,
  });
  const rowsRef = useRef(sortedOptions);
  const priceRef = useRef(chain?.currentPrice ?? 0);
  // The settings the rows above were actually produced from — the DEFERRED
  // strike bounds, because those are what filteredOptions read, and a knob the
  // assistant has turned is not on screen until they catch up.
  const appliedRef = useRef<AppliedSettings>({
    ticker: '',
    capital: 0,
    delta: 0,
    minStrike: 0,
    maxStrike: 0,
    strategy: '',
    newestFilter: '',
  });
  // Bumped on every commit, so a caller can tell that at least one render has
  // happened since it changed something.
  const commitsRef = useRef(0);
  const filtersRef = useRef(customFilters);
  // Expirations are ticked a render after the chain lands, and the rows read a
  // deferred copy of the ticks, so the board is briefly empty while perfectly
  // healthy. Reading in that window reported "no contracts" over 83 matches.
  const boardReadyRef = useRef(true);
  useEffect(() => {
    commitsRef.current += 1;
    filtersRef.current = customFilters;
    boardReadyRef.current = boardReady(allExpirations.length, deferredSelectedExps.length);
    appliedRef.current = {
      ticker: data?.ticker ?? '',
      capital: capitalNumber,
      delta: deltaMagnitude,
      minStrike: deferredStrikeFilter[0],
      maxStrike: deferredStrikeFilter[1],
      strategy: strategyId,
      newestFilter: customFilters[customFilters.length - 1]?.id ?? '',
    };
    snapshotRef.current = snapshot;
    scanStateRef.current = {
      loading,
      wanted: ticker,
      loaded: data?.ticker ?? null,
      failed: !!error,
    };
    rowsRef.current = sortedOptions;
    priceRef.current = chain?.currentPrice ?? 0;
  });

  /**
   * Find one contract by expiration and strike.
   *
   * The assistant names which contract to show; the row comes from here. That
   * split is the point — a model asked to present a contract otherwise retypes
   * its figures, and a retyped figure is one that can be wrong.
   */
  /** Everything the screen is filtered to, for the assistant-only layout. */
  const filterSummary = useMemo(
    () => ({
      ticker,
      companyName: chain?.companyName ?? null,
      currentPrice: chain?.currentPrice ?? null,
      strategyName: strategy.copy.name,
      capital: capitalInput,
      minMonths,
      maxMonths,
      deltaSign,
      deltaMagnitude,
      strikeFilter,
      expirationsSelected: selectedExps.length,
      expirationsAvailable: allExpirations.length,
      matching: filteredOptions.length,
      customFilters,
      computedColumns,
    }),
    [ticker, chain, strategy.copy.name, capitalInput, minMonths, maxMonths, deltaSign,
     deltaMagnitude, strikeFilter, selectedExps.length, allExpirations.length,
     filteredOptions.length, customFilters, computedColumns]
  );

  /**
   * Drop custom filters — all of them, or only those touching one column.
   * Returns the id of the newest filter left, so a caller can wait for the
   * removal to actually reach the table before reading it back.
   */
  const clearCustomFilters = useCallback((field?: string) => {
    const remaining = field
      ? filtersRef.current.filter((f) => !f.conditions.some((c) => c.field === field))
      : [];
    setCustomFilters(remaining);
    return remaining[remaining.length - 1]?.id ?? '';
  }, []);

  /** The rows on screen, for spotting a contract the assistant named in prose. */
  const visibleOptions = useCallback(() => rowsRef.current, []);

  /** The loaded spot price, for strikes the assistant gives as a % of it. */
  const currentPrice = useCallback(() => priceRef.current, []);

  const findOption = useCallback((expiration: string, strike: number) => {
    // Strikes are quoted to two places, so compare with a tolerance rather than
    // for equality: 322.5 and 322.50 are the same contract.
    return (
      rowsRef.current.find(
        (o) => o.expiration === expiration && Math.abs(o.strike - strike) < 0.005
      ) ?? null
    );
  }, []);

  /**
   * Read the screen, waiting for a scan that is on its way.
   *
   * Setting a ticker starts a debounced fetch, so an assistant that sets one
   * and immediately reads used to be told "nothing is loaded yet" — and would
   * then waste a whole round trip re-setting the ticker it had just set. On a
   * budget of 8,000 tokens a minute that wasted step is often the one that
   * runs out. Waiting costs a second and saves a request.
   */
  const awaitScan = useCallback(async (expected?: string, want: WantedSettings = {}) => {
    // Which ticker we are waiting FOR has to be passed in. This ref is written
    // in an effect, so in the moment just after setTicker('NVDA') it still
    // describes the previous screen — no ticker, nothing loading, nothing
    // ready — which read as "settled" and returned at once. The caller then
    // saw a spot price of 0, dropped the 115%-of-price floor on the floor, and
    // handed the model an empty screen, which it dutifully explained.
    const target = expected ?? scanStateRef.current.wanted;
    // Only wait for a render if something asked for is not already true. A
    // no-op change produces no commit, and waiting for one that never comes
    // stalls the turn for the whole grace period.
    const changing = !settingsApplied(appliedRef.current, want);
    const committedAtEntry = commitsRef.current;
    const deadline = Date.now() + SCAN_WAIT_MS;
    // Once the chain is in, the rest is local arithmetic. Give it a short grace
    // period rather than the network timeout, so a value the app clamped to
    // something other than what was asked for costs a moment, not nine seconds.
    let settleBy = Infinity;
    while (Date.now() < deadline) {
      if (scanSettled(scanStateRef.current, target)) {
        if (settleBy === Infinity) settleBy = Date.now() + SETTLE_WAIT_MS;
        const rendered = !changing || commitsRef.current > committedAtEntry;
        const ready = boardReadyRef.current;
        if ((rendered && ready && settingsApplied(appliedRef.current, want)) || Date.now() > settleBy) {
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }, []);

  const readScreen = useCallback(
    async (expected?: string, want?: WantedSettings) => {
      await awaitScan(expected, want);
      return snapshotRef.current();
    },
    [awaitScan]
  );

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
              Options Analyzer
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
             {chain && data && (
               <div className="relative flex items-center gap-4 md:gap-6 bg-bg-2 px-3 md:px-4 py-2 rounded-lg border border-line min-w-0">
                 <span
                   aria-hidden
                   className="absolute left-0 top-1/2 h-6 w-px -translate-y-1/2 bg-gradient-to-b from-transparent via-zinc-600 to-transparent"
                 />
                 <div className="flex flex-col md:flex-row md:items-baseline gap-0.5 md:gap-3 leading-none text-fg min-w-0">
                   {/* The company's name, not its symbol: the symbol is already
                       in the field the user typed it into. */}
                   <p
                     title={`${chain!.companyName} (${chain!.ticker})`}
                     className="text-[11px] md:text-xs text-dim font-bold tracking-normal truncate max-w-[9rem] md:max-w-[16rem]"
                   >
                     {chain!.companyName}
                   </p>
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

      {!soloMode && (
      <main className="max-w-[1500px] mx-auto px-4 py-6 md:px-12 md:py-10">
        {/* A fixed sidebar rather than a fraction of the grid: at 25% of a
            1024px window it squeezed to 188px and clipped its own controls. */}
        <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[350px_minmax(0,1fr)] gap-8 lg:gap-10 xl:gap-14 items-start">
          {/* Static/Sticky Sidebar on Desktop */}
          <aside className="hidden lg:block lg:sticky lg:top-[104px] max-h-[calc(100vh-132px)] overflow-y-auto overflow-x-hidden pb-10">
            <div className="rounded-lg border border-line bg-bg-2 divide-y divide-line-soft">
              {/* Ticker: the one thing everything else hangs off, so it leads and
                  is the only control given real size. */}
              <div className="p-4 space-y-2">
                <label htmlFor="ticker" className="rule block font-mono text-[11px] text-faint">
                  Ticker
                </label>
                <input
                  id="ticker"
                  type="text"
                  value={ticker}
                  placeholder="NVDA"
                  onChange={(e) => setTicker(e.target.value.toUpperCase())}
                  className={cn(
                    'w-full bg-transparent text-2xl font-semibold tracking-tight placeholder:text-faint/50 focus:outline-none transition-colors',
                    // Bright white on a symbol with nothing behind it reads as
                    // "loaded" when nothing is. It stays muted until a scan
                    // actually returns rows for this ticker.
                    hasResults ? 'text-fg' : 'text-dim'
                  )}
                />
                <div className="flex items-center gap-2 text-[11px] font-mono">
                  {loading ? (
                    <>
                      <Loader2 className="animate-spin text-a1" size={11} />
                      <span className="text-dim">Scanning…</span>
                    </>
                  ) : error ? (
                    <span className="text-warn">{error}</span>
                  ) : hasResults ? (
                    <>
                      <span className="h-1.5 w-1.5 rounded-full bg-a1" />
                      <span className="text-dim">
                        {data!.options.length.toLocaleString()} contracts · ${data!.currentPrice.toFixed(2)}
                      </span>
                    </>
                  ) : ticker ? (
                    // A symbol is typed but the board came back empty — saying
                    // "type a symbol" here is just wrong.
                    <span className="text-faint">No contracts for {ticker} in this range</span>
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
                  className="w-24 max-w-[60%] min-w-0 bg-transparent text-right font-mono text-sm text-fg focus:outline-none"
                />
              </Field>

              <div className="p-4 space-y-3">
                <span className="block font-mono text-[11px] text-faint">Months to expiry</span>
                <div className="flex items-center gap-1.5">
                  <NumericField
                    value={minMonths}
                    onCommit={setMonthsFrom}
                    min={0}
                    max={MAX_MONTHS}
                    ariaLabel="Months to expiry, from"
                    width="flex-1 min-w-0"
                  />
                  <span className="text-faint text-xs shrink-0">→</span>
                  <NumericField
                    value={maxMonths}
                    onCommit={setMonthsTo}
                    min={0}
                    max={MAX_MONTHS}
                    ariaLabel="Months to expiry, to"
                    width="flex-1 min-w-0"
                  />
                </div>
                <QuickPicks
                  options={MONTH_PRESETS}
                  isActive={([from, to]) => from === minMonths && to === maxMonths}
                  onPick={([from, to]) => setMonthsRange(from, to)}
                />
              </div>

              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-mono text-[11px] text-faint">
                    {strategy.copy.deltaLabel}
                  </span>
                  <NumericField
                    value={deltaMagnitude}
                    onCommit={(v) => setDeltaMagnitude(Math.abs(v))}
                    min={0}
                    max={1}
                    decimals={2}
                    prefix={deltaSign || undefined}
                    ariaLabel={strategy.copy.deltaLabel}
                    width="w-20"
                  />
                </div>
                <QuickPicks
                  options={DELTA_PRESETS}
                  isActive={(v) => Math.abs(v - deltaMagnitude) < 0.0005}
                  onPick={setDeltaMagnitude}
                />
              </div>

              {strikeBounds && (
                <div className="p-4 space-y-3">
                  <span className="block font-mono text-[11px] text-faint">Strike range</span>
                  <div className="flex items-center gap-1.5">
                    <NumericField
                      value={strikeFilter[0]}
                      onCommit={handleStrikeMinChange}
                      min={strikeBounds[0]}
                      max={strikeBounds[1]}
                      prefix="$"
                      ariaLabel="Strike range, from"
                      width="flex-1 min-w-0"
                    />
                    <span className="text-faint text-xs shrink-0">→</span>
                    <NumericField
                      value={strikeFilter[1]}
                      onCommit={handleStrikeMaxChange}
                      min={strikeBounds[0]}
                      max={strikeBounds[1]}
                      prefix="$"
                      ariaLabel="Strike range, to"
                      width="flex-1 min-w-0"
                    />
                  </div>
                  <StrikePresets
                    spot={chain!.currentPrice}
                    bounds={strikeBounds}
                    otmDirection={strategy.otmDirection}
                    active={strikeFilter}
                    onPick={setStrikeFilter}
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

              {computedColumns.length > 0 && (
                <div className="p-4 space-y-2.5">
                  <span className="font-mono text-[11px] text-faint">Computed columns</span>
                  <div className="flex flex-wrap gap-1.5">
                    {computedColumns.map((c) => (
                      <span
                        key={c.id}
                        title={c.source}
                        className="flex items-center gap-1.5 rounded bg-a1/10 px-2 py-1 text-[11px] text-a1 ring-1 ring-inset ring-a1/25"
                      >
                        {c.name}
                        <button
                          aria-label={`Remove ${c.name}`}
                          onClick={() => removeComputedColumn(c.id)}
                          className="opacity-60 hover:opacity-100 transition-opacity"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
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
          <section className="min-w-0 space-y-8 md:space-y-10">
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
                <ResultsTable title={strategy.copy.tableTitle} options={sortedOptions.slice(0, 10)} externalSortConfig={globalSortConfig} onExternalSortChange={setGlobalSortConfig} capitalColumnLabel={strategy.copy.capitalColumnLabel} computedColumns={computedColumns} onRemoveComputedColumn={removeComputedColumn} mobileView={mobileView} onMobileViewChange={setMobileView} />

                {/* Charts */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6 text-fg font-sans">
                  <AnalysisChart title="Yield / Strike Analysis" icon={BarChart3} data={filteredOptions} xAxisKey="strike" xAxisName="Strike" yAxisKey="annualizedReturn" yAxisName="Return" unit="%" color="#10b981" seriesName={strategy.copy.seriesName} />
                  <AnalysisChart title="Yield / DTE Profile" icon={Calendar} data={filteredOptions} xAxisKey="daysToExpiration" xAxisName="DTE" yAxisKey="annualizedReturn" yAxisName="Return" unit="%" color="#3b82f6" seriesName={strategy.copy.seriesName} />
                </div>

                {/* Full Results */}
                <ResultsTable title="Full Market Scan Results" options={sortedOptions} count={filteredOptions.length} externalSortConfig={globalSortConfig} onExternalSortChange={setGlobalSortConfig} capitalColumnLabel={strategy.copy.capitalColumnLabel} computedColumns={computedColumns} onRemoveComputedColumn={removeComputedColumn} mobileView={mobileView} onMobileViewChange={setMobileView} />
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
      )}

      {/* Custom Keypad Bottom Sheets */}
      {activeKeypad === 'minMonths' && (
        <CustomKeypad
          type="months"
          value={minMonths}
          onClose={handleCloseKeypad}
          onChange={setMonthsFrom}
          hint={monthsHint}
        />
      )}
      {activeKeypad === 'maxMonths' && (
        <CustomKeypad
          type="months"
          value={maxMonths}
          onClose={handleCloseKeypad}
          onChange={setMonthsTo}
          hint={monthsHint}
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
          otmDirection={strategy.otmDirection}
        />
      )}
      {activeKeypad === 'strikeMax' && data && (
        <CustomKeypad 
          type="strike" 
          value={strikeFilter[1]} 
          onClose={handleCloseKeypad} 
          onChange={handleStrikeMaxChange} 
          tickerPrice={data.currentPrice}
          otmDirection={strategy.otmDirection}
        />
      )}
      {activeKeypad === 'expirations' && data && (
        <CustomKeypad 
          type="expirations" 
          value={selectedExps} 
          onClose={handleCloseKeypad} 
          onChange={setSelectedExps} 
          allExps={allExpirations}
        />
      )}
      <LLMChatbot 
        subtitle={strategy.copy.assistantSubtitle}
        setTicker={setTicker}
        setCapital={setCapitalInput}
        setMinMonths={setMonthsFrom}
        setMaxMonths={setMonthsTo}
        setDeltaMagnitude={setDeltaMagnitude}
        setStrikeFilter={setStrikeFilter}
        addCustomFilter={(filter) => setCustomFilters(prev => [...prev.filter(f => f.id !== filter.id), filter])}
        clearCustomFilters={clearCustomFilters}
        addComputedColumn={addComputedColumn}
        setSortConfig={setGlobalSortConfig}
        setStrategy={handleStrategyChange}
        setResultsView={setMobileView}
        findOption={findOption}
        visibleOptions={visibleOptions}
        filterSummary={filterSummary}
        onSoloModeChange={setSoloMode}
        currentPrice={currentPrice}
        awaitScan={awaitScan}
        cardColumns={cardColumns}
        computedColumns={computedColumns}
        readScreen={readScreen}
      />
    </div>
  );
}
