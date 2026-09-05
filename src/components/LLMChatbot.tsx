'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useChat } from '@ai-sdk/react';
import type { Message, ToolInvocation } from 'ai';
import { MessageSquare, X, Send, Bot, User, Loader2, AlertTriangle, Maximize2, Minimize2, Sparkles, ChevronDown, Expand, Shrink } from 'lucide-react';
import { cn } from '@/lib/ui';
import { parseCustomFilter, describeFilter, splitFilter, type CustomFilter } from '@/lib/filters';
import { normalizeDelta } from '@/lib/assistant/normalize';
import { describeHistory, type ChartRange, type HistoryResponse } from '@/lib/history';
import { StockChart } from '@/components/screener/StockChart';
import { OptionCard } from '@/components/screener/OptionCard';
import { ActiveFilters, type ActiveFilterSummary } from '@/components/screener/ActiveFilters';
import type { Column } from '@/components/screener/types';
import type { ComputedColumn } from '@/lib/formula';
import type { StrategyId } from '@/lib/strategies';
import type { MobileView } from '@/components/screener/ResultsTable';
import type { ScreenedOption } from '@/lib/optionChain';
import { STARTERS } from '@/lib/assistant/starters';
import { describeToolCall, visibleInvocations } from '@/lib/assistant/toolChip';
import type { WantedSettings } from '@/lib/scanSettled';
import { findMentionedContract } from '@/lib/assistant/mentionedContract';
import { Markdown } from '@/components/Markdown';

interface LLMChatbotProps {
  /** Strategy name shown under the assistant title. */
  subtitle: string;
  setTicker: (ticker: string) => void;
  setCapital: (capital: string) => void;
  setMinMonths: (months: number) => void;
  setMaxMonths: (months: number) => void;
  setDeltaMagnitude: (delta: number) => void;
  /** Takes an updater too, so applySettings can move one end and keep the other. */
  /**
   * Set strike bounds, keeping any given as a percentage of the price as a
   * standing rule: "115% of spot" has to follow the next stock, not leave the
   * previous one''s dollars behind.
   */
  setStrikeBounds: (change: {
    min: number | null;
    max: number | null;
    minPct: number | null;
    maxPct: number | null;
  }) => void;
  addCustomFilter: (filter: CustomFilter) => void;
  /** Drops filters and returns the id of the newest one left, or "". */
  clearCustomFilters: (field?: string) => string;
  addComputedColumn: (input: { id: string; name: string; expression: string }) =>
    { ok: true; column: { name: string; source: string } } | { ok: false; error: string };
  setSortConfig: (config: {
    key: keyof ScreenedOption | null;
    direction: 'asc' | 'desc' | null;
  }) => void;
  setStrategy: (id: StrategyId) => void;
  setResultsView: (view: MobileView) => void;
  /** Resolves a contract the assistant named to the app's own row. */
  findOption: (expiration: string, strike: number) => ScreenedOption | null;
  /** The rows currently on screen, for spotting a contract named in prose. */
  visibleOptions: () => ScreenedOption[];
  /** Everything the screen is filtered to, for the assistant-only layout. */
  filterSummary: ActiveFilterSummary;
  /** Told when assistant-only mode turns on, so the screener can stop rendering. */
  onSoloModeChange: (solo: boolean) => void;
  /** The loaded underlying's price, for strikes given as a % of it. */
  currentPrice: () => number;
  /** Resolves once the scan for a given ticker has settled. */
  awaitScan: (expected?: string, want?: WantedSettings) => Promise<void>;
  /** Column formatting, so a card in the chat matches the table. */
  cardColumns: Record<string, Column>;
  computedColumns: ComputedColumn[];
  /**
   * A description of the loaded scan, for the readScreen tool. Async because it
   * waits for a scan already on its way rather than reporting "nothing loaded".
   */
  readScreen: (expected?: string, want?: WantedSettings) => Promise<string>;
}

/**
 * One line saying what the assistant did.
 *
 * Deliberately terse: the tool's own result string is written for the model —
 * readScreen's is the entire screen summary — and printing it here restated a
 * table the user was already looking at. Rejections are the exception, since
 * there the message IS the point.
 */
function ToolChip({ invocation }: { invocation: ToolInvocation }) {
  if (invocation.state !== 'result') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-line bg-bg-3 p-2 text-xs text-fg-soft">
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        <span>Working…</span>
      </div>
    );
  }
  const chip = describeToolCall(
    invocation.toolName,
    invocation.args as Record<string, unknown>,
    String(invocation.result ?? '')
  );
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border p-2 text-xs',
        chip.tone === 'warn'
          ? 'border-warn/30 bg-warn/10 text-warn'
          : 'border-line bg-bg-3 text-fg-soft'
      )}
    >
      {chip.tone === 'warn' ? (
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      ) : (
        <span className="text-a1">✓</span>
      )}
      <span className="leading-relaxed">{chip.text}</span>
    </div>
  );
}

/** The provider''s complaint when a required tool call was refused. */
const TOOL_REFUSAL = /tool choice is required/i;

export default function LLMChatbot({
  subtitle,
  setTicker,
  setCapital,
  setMinMonths,
  setMaxMonths,
  setDeltaMagnitude,
  setStrikeBounds,
  addCustomFilter,
  clearCustomFilters,
  addComputedColumn,
  setSortConfig,
  setStrategy,
  setResultsView,
  findOption,
  visibleOptions,
  filterSummary,
  onSoloModeChange,
  currentPrice,
  awaitScan,
  cardColumns,
  computedColumns,
  readScreen,
}: LLMChatbotProps) {
  const [isOpen, setIsOpen] = useState(false);
  // One automatic retry per turn, and only for a refused tool call.
  const proseRetryRef = useRef(false);
  const reloadRef = useRef<((options?: { body?: Record<string, unknown> }) => void) | null>(null);
  // Expanded is a display preference, so it stays local.
  const [expanded, setExpanded] = useState(false);
  /**
   * Assistant-only: the panel takes the whole screen and the app behind it is
   * hidden. The settings still have to be visible or the user is driving a
   * screen they cannot see, so they ride above the conversation as chips.
   */
  const [soloMode, setSoloMode] = useState(false);
  // The examples rail; open on first use, dismissable once you know the ropes.
  const [showExamples, setShowExamples] = useState(true);
  const [openGroup, setOpenGroup] = useState<string | null>(STARTERS[0].title);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  /**
   * Charts the assistant has drawn, by tool call id.
   *
   * The model gets a sentence describing the move (see describeHistory) and the
   * user gets the picture; keeping the data here rather than in the message
   * means the chart is not re-serialised into every later request.
   */
  const [charts, setCharts] = useState<Record<string, HistoryResponse>>({});
  /** Contracts the assistant has put on screen, by tool call id. */
  const [cards, setCards] = useState<Record<string, ScreenedOption>>({});
  /**
   * The last screen summary handed to the model.
   *
   * applySettings returns the resulting screen so a question can be answered in
   * two requests instead of three. The model does not always take that hint and
   * calls readScreen straight afterwards — and without this it would be billed
   * for the same paragraph twice. Comparing against what it was already given
   * makes the redundant call nearly free, while keeping the whole saving on the
   * turns where it does obey.
   */
  const lastSummary = useRef<string | null>(null);

  /**
   * Run one client-side tool call and say what happened.
   *
   * These tools have no `execute` on the server — the model emits the call and
   * the browser performs it against state the server never sees. The returned
   * string is what the model is told, so a rejection has to read as a
   * correction it can act on rather than a silent no-op.
   *
   * Lives in useChat's onToolCall rather than an effect over `messages`. The
   * effect had to re-scan every message on every render to find the calls it
   * had not run yet, and setting state from inside it is what the React
   * Compiler rightly objects to.
   */
  const runTool = async (
    toolCallId: string,
    toolName: string,
    args: Record<string, never>
  ): Promise<string> => {
    const a = args as Record<string, string & number & { [k: string]: unknown }>;
    switch (toolName) {
      case 'applySettings': {
        // One call instead of four round trips. gpt-oss emits a single tool
        // call per reply, so four setters meant four requests, each re-sending
        // the prompt and every schema — about 12,000 tokens against a limit of
        // 8,000 a minute, which is the whole of the "it errors at the end" bug.
        //
        // Every field is optional and an omitted one is left alone, so this
        // cannot clear a setting the user never mentioned.
        const done: string[] = [];
        // The ticker this call is switching to, so everything downstream waits
        // for THAT scan rather than for whatever was on screen before.
        let pending: string | undefined;
        // What the screen has to look like before it is worth reading back.
        // Without this the model was handed the board from BEFORE its own
        // filter landed, and recommended a contract that filter excludes.
        const want: WantedSettings = {};

        // STRATEGY FIRST, and this order is load-bearing. Switching strategy
        // resets months, delta and custom filters to that strategy's defaults,
        // and changes the board key, which resets the strike range to the whole
        // board. Applied last — as it was — it wiped every other setting in the
        // same call: the chip read "1 delta, 6-12 months, strikes 115% of spot"
        // over a screen showing 0.3 delta, 0-6 months and $0-$2500.
        let strategyLabel: string | null = null;
        if (a.strategy != null) {
          const wanted = String(a.strategy);
          if (wanted !== 'covered-call' && wanted !== 'cash-secured-put') {
            return `Unknown strategy "${wanted}". Use "covered-call" or "cash-secured-put".`;
          }
          setStrategy(wanted);
          want.strategy = wanted;
          strategyLabel = wanted === 'covered-call' ? 'covered calls' : 'cash-secured puts';
        }

        if (a.ticker != null) {
          const symbol = String(a.ticker).toUpperCase();
          setTicker(symbol);
          pending = symbol;
          want.ticker = symbol;
          done.push(`ticker ${symbol}`);
        }
        // Let the strategy switch, and the resets it triggers, actually land
        // before anything is set on top of it.
        if (strategyLabel) await awaitScan(pending, { strategy: want.strategy });

        if (a.capital != null) {
          setCapital(String(a.capital));
          want.capital = Number(a.capital);
          done.push(`capital $${a.capital}`);
        }
        if (a.minMonths != null) setMinMonths(Number(a.minMonths));
        if (a.maxMonths != null) setMaxMonths(Number(a.maxMonths));
        if (a.minMonths != null || a.maxMonths != null) {
          done.push(`months ${a.minMonths ?? 'any'}-${a.maxMonths ?? 'any'}`);
        }
        if (a.delta != null) {
          const magnitude = normalizeDelta(Number(a.delta));
          setDeltaMagnitude(magnitude);
          want.delta = magnitude;
          done.push(`delta ${magnitude}`);
        }
        // A percentage has to resolve against the price of the ticker being
        // SET, not the one that happened to be loaded — "AAPL, strikes from
        // 115% of its price" arrives in the same call as the ticker change, so
        // reading the price now would use the previous stock's. Wait for the
        // scan first, and only when a percentage was actually given.
        const wantsPct = a.minStrikePctOfSpot != null || a.maxStrikePctOfSpot != null;
        if (wantsPct) await awaitScan(pending);
        const spot = currentPrice();
        const fromPct = (pct: unknown) =>
          pct != null && spot > 0 ? Number(((Number(pct) / 100) * spot).toFixed(2)) : null;
        const minFromPct = fromPct(a.minStrikePctOfSpot);
        const maxFromPct = fromPct(a.maxStrikePctOfSpot);
        // A percentage wins over a plain number on the same edge: it is the more
        // specific request, and the model tends to send a throwaway 0 alongside
        // it, which silently replaced the bound the user actually asked for.
        const minStrike = minFromPct ?? (a.minStrike != null ? Number(a.minStrike) : null);
        const maxStrike = maxFromPct ?? (a.maxStrike != null ? Number(a.maxStrike) : null);

        // A percentage that could not be resolved must not pass silently: the
        // request was a floor at 115% of the price, and applying no floor at
        // all is a different screen presented as the one that was asked for.
        const unresolved = wantsPct && spot <= 0;
        if (minStrike != null || maxStrike != null) {
          // Only one end may be given, so the other keeps whatever it has
          // rather than being reset to an arbitrary bound.
          setStrikeBounds({
            min: minStrike,
            max: maxStrike,
            // The percentages, not just what they came to today.
            minPct: a.minStrikePctOfSpot != null ? Number(a.minStrikePctOfSpot) : null,
            maxPct: a.maxStrikePctOfSpot != null ? Number(a.maxStrikePctOfSpot) : null,
          });
          if (minStrike != null) want.minStrike = minStrike;
          if (maxStrike != null) want.maxStrike = maxStrike;
          done.push(`strikes $${minStrike ?? 'any'}-$${maxStrike ?? 'any'}`);
        }
        // Taking filters off, which had no tool at all until a request to
        // remove one was answered by adding another.
        if (a.clearFilters === true) {
          want.newestFilter = clearCustomFilters();
          done.push('cleared filters');
        } else if (a.removeFilterField != null) {
          const field = String(a.removeFilterField);
          want.newestFilter = clearCustomFilters(field);
          done.push(`removed ${field} filter`);
        }

        // A filter asked for in the same breath as the settings. Applied here
        // rather than left to a second call the model does not always make.
        if (a.filterField != null) {
          const op = String(a.filterOp ?? 'gt');
          const value =
            op === 'between'
              ? [Number(a.filterValue), Number(a.filterValueHigh)]
              : [Number(a.filterValue)];
          const parsed = parseCustomFilter({
            id: `f${Date.now().toString(36)}`,
            // Named for the column it constrains. Naming it after its own
            // condition printed the chip twice over: "premiumSharePct gte 15"
            // beside "premiumSharePct >= 15".
            name: cardColumns[String(a.filterField)]?.label ?? String(a.filterField),
            mode: 'and',
            conditions: [{ field: String(a.filterField), op, value }],
          });
          if (!parsed.ok) {
            return `Filter rejected: ${parsed.error}. Valid fields are the numeric columns; valid operators are gt, gte, lt, lte, eq, between.`;
          }
          addCustomFilter(parsed.filter);
          want.newestFilter = parsed.filter.id;
          done.push(describeFilter(parsed.filter));
        }

        // Reported last, though it was applied first: the chip reads better
        // starting from the ticker.
        if (strategyLabel) done.push(strategyLabel);
        if (done.length === 0) {
          // Not a failure. The model calls this with everything null when it
          // wants to look rather than change, and answering with a rejection
          // taught it to try again — three warning triangles in a row saying
          // nothing happened, which is true and useless. Hand back the screen.
          const current = await readScreen();
          lastSummary.current = current;
          return `No settings changed. The current screen:\n\n${current}`;
        }
        // Hand back the resulting screen rather than making the model ask
        // for it. A question used to cost three requests — apply, read,
        // answer — and each one re-sends the whole prompt and toolset. Waiting
        // here for the scan is a local second; the round trip it saves is
        // ~2,900 tokens against a budget of 8,000 a minute.
        const summary = await readScreen(pending, want);
        lastSummary.current = summary;
        const note = unresolved
          ? ' The strike given as a % of the price could not be resolved: no price is loaded, so no such limit was applied. Say so rather than describing the screen as if it had been.'
          : '';
        return `Set ${done.join(', ')}.${note}\n\n${summary}`;
      }
      // The single setters below are no longer in the tool schema —
      // applySettings covers them all, and carrying both cost ~500 tokens of
      // schema on every step. They stay as a landing pad for a conversation
      // that was already in flight when the surface changed.
      case 'setTicker': {
        const symbol = String(a.ticker).toUpperCase();
        setTicker(symbol);
        // No fetch is kicked off here: the ticker is the only thing the app
        // fetches on, and its own debounced effect owns that.
        const summary = await readScreen(symbol);
        lastSummary.current = summary;
        return `Ticker set to ${symbol}.\n\n${summary}`;
      }
      case 'setCapital':
        setCapital(String(a.capital));
        return `Capital set to $${a.capital}`;
      case 'setMonthsRange':
        setMinMonths(Number(a.minMonths));
        setMaxMonths(Number(a.maxMonths));
        return `Months range set to ${a.minMonths}–${a.maxMonths}`;
      case 'setDelta': {
        // "30 delta" and "0.30 delta" are the same request; see normalizeDelta
        // for why 1 is left alone.
        const magnitude = normalizeDelta(Number(a.delta));
        setDeltaMagnitude(magnitude);
        return `Delta limit set to ${magnitude}`;
      }
      case 'setStrikeRange':
        setStrikeBounds({
          min: Number(a.minStrike),
          max: Number(a.maxStrike),
          minPct: null,
          maxPct: null,
        });
        return `Strike range set to $${a.minStrike}–$${a.maxStrike}`;
      case 'setSort': {
        // The key is a free string in the schema, because a computed column's
        // id cannot be in a build-time enum. So it is checked here, against the
        // columns that actually exist right now.
        const key = String(a.key);
        if (!(key in cardColumns)) {
          return `No column "${key}". Sortable columns: ${Object.keys(cardColumns).join(', ')}.`;
        }
        setSortConfig({ key, direction: a.direction === 'asc' ? 'asc' : 'desc' } as never);
        return `Sorted by ${key} ${a.direction}`;
      }
      case 'setStrategy':
        setStrategy(String(a.strategy) as StrategyId);
        return String(a.strategy) === 'covered-call'
          ? 'Switched to covered calls'
          : 'Switched to cash-secured puts';
      case 'setResultsView':
        setResultsView(String(a.view) as MobileView);
        return `Results shown as ${a.view}`;
      case 'addCustomFilter': {
        // Model output is untrusted data. Validate it against the schema and
        // report a rejection rather than dropping it silently, so the model can
        // correct itself and the user can see what happened.
        const parsed = parseCustomFilter(args);
        if (!parsed.ok) {
          return `Filter rejected: ${parsed.error}. Valid fields are the numeric columns; valid operators are gt, gte, lt, lte, eq, between.`;
        }
        // One chip per column. The model bundles conditions into a single
        // filter — Prem20_OI100_Vol100 — which is correct and unusable: all or
        // nothing, with no way to loosen one rule without restating the rest.
        const parts = splitFilter(
          parsed.filter,
          (field) => cardColumns[field]?.label ?? field
        );
        for (const part of parts) addCustomFilter(part);
        // Wait for them to reach the table: a readScreen straight afterwards
        // was otherwise answered from the rows as they were before.
        await awaitScan(undefined, { newestFilter: parts[parts.length - 1].id });
        return parts.length === 1
          ? `Filter applied — ${describeFilter(parsed.filter)}`
          : `Applied as ${parts.length} separate filters, each removable on its own — ${parts
              .map(describeFilter)
              .join('; ')}`;
      }
      case 'addComputedColumn': {
        // The formula is parsed by our own grammar, never executed. A rejection
        // is reported so the model can fix the expression.
        const added = addComputedColumn(args as unknown as { id: string; name: string; expression: string });
        return added.ok
          ? `Added column "${added.column.name}" = ${added.column.source}, sorted by it`
          : `Formula rejected: ${added.error}`;
      }
      case 'readScreen': {
        // The one tool that hands data back rather than changing state.
        const summary = await readScreen();
        if (summary === lastSummary.current) {
          return 'Unchanged since the screen you were given a moment ago — answer from that.';
        }
        lastSummary.current = summary;
        return summary;
      }
      case 'showOptionCard': {
        const found = findOption(String(a.expiration), Number(a.strike));
        if (!found) {
          // Naming the rows it can pick from saves the readScreen round trip it
          // would otherwise need — two steps of a five-step budget, which is
          // how a turn ran out of room before it wrote its closing sentence.
          const choices = visibleOptions()
            .slice(0, 8)
            .map((o) => `${o.expiration} $${o.strike}`)
            .join('; ');
          return `No contract on the current screen expires ${a.expiration} at a $${a.strike} strike. Pick one of these instead, exactly as written: ${choices || 'the screen is empty'}.`;
        }
        setCards((prev) => ({ ...prev, [toolCallId]: found }));
        // The card carries the figures; the model only needs to know it landed,
        // so it says why rather than restating what is already visible.
        return `Card shown for the $${found.strike} strike expiring ${found.expiration}. Its figures are on screen — say only why this contract, not what its numbers are.`;
      }
      case 'showStockChart': {
        const symbol = String(a.ticker).toUpperCase();
        const range = String(a.range) as ChartRange;
        try {
          const res = await fetch(
            `/api/history?ticker=${encodeURIComponent(symbol)}&range=${range}`
          );
          const json: HistoryResponse & { error?: string } = await res.json();
          if (json.error) return `Could not load a chart: ${json.error}`;
          // The user gets the picture; the model gets the shape of the move, so
          // it can talk about what is on screen instead of inventing it.
          setCharts((prev) => ({ ...prev, [toolCallId]: json }));
          return describeHistory(json);
        } catch {
          return `Could not load price history for ${symbol}.`;
        }
      }
      default:
        return `Unknown tool: ${toolName}`;
    }
  };

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    status,
    error,
    append,
    reload,
  } = useChat({
    api: '/api/chat',
    // Six, not five: a turn that stumbles once still needs a step left over
    // to write its closing sentence, and running out mid-turn is what made
    // the assistant answer with tool chips and nothing else.
    maxSteps: 6,
    // Returning a value here registers it as the tool result and lets the SDK
    // continue the turn, so nothing has to watch the message list for work.
    onToolCall: async ({ toolCall }) => {
      try {
        return await runTool(
          toolCall.toolCallId,
          toolCall.toolName,
          toolCall.args as Record<string, never>
        );
      } catch (err) {
        return `The app could not apply ${toolCall.toolName}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`;
      }
    },
    onError: (err) => {
      // The first step of a turn is told it must call a tool, and the model
      // sometimes refuses — which the provider reports as a hard failure. The
      // turn is not lost; it just needs to be allowed to answer in words. The
      // user had already found this by hand: press Try again and it works. Do
      // it for them, once, so a refusal costs a second instead of a dead end.
      if (!TOOL_REFUSAL.test(err.message) || proseRetryRef.current) return;
      proseRetryRef.current = true;
      setTimeout(() => reloadRef.current?.({ body: { allowProse: true } }), 0);
    },
  });

  // reload is defined by the hook above, so the retry reaches it through a ref
  // rather than being declared before it exists. Written in an effect: refs are
  // not writable during render under the rules this project lints with.
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  const isLoading = status === 'submitted' || status === 'streaming';

  /**
   * A contract the assistant named in prose but did not show a card for.
   *
   * Skipped when it already showed one on that message — two cards for the same
   * answer is worse than none.
   */
  const mentionedCard = (message: Message): ScreenedOption | null => {
    if (!message.content) return null;
    // Only a card that actually appeared counts. A showOptionCard that was
    // rejected left the answer with no card at all, because this saw the
    // attempt and stood down.
    const already = (message.toolInvocations ?? []).some(
      (i) => i.toolName === 'showOptionCard' && !String(i.state === 'result' ? i.result ?? '' : '').startsWith('No contract')
    );
    if (already) return null;
    return findMentionedContract(message.content, visibleOptions());
  };
  /** Whether there is a turn to retry — reload() re-runs the last user message. */
  const lastUserMessage = messages.some((m) => m.role === 'user');

  /**
   * A handful of starters for the places the examples rail cannot reach: a
   * phone, and solo mode. One from each group, so the row spans the
   * capabilities rather than five variations on the same idea.
   */
  const suggestions = useMemo(
    () => (messages.length === 0 ? STARTERS.map((g) => g.prompts[0]) : []),
    [messages.length]
  );

  /** Send a starter prompt as though the user had typed and submitted it. */
  const send = (text: string) => {
    if (isLoading) return;
    proseRetryRef.current = false;
    append({ role: 'user', content: text });
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={() => setIsOpen(true)}
        aria-label="Open the AI assistant"
        className={`fixed bottom-5 right-5 md:bottom-6 md:right-6 flex items-center justify-center w-14 h-14 bg-zinc-100 text-zinc-900 rounded-full shadow-lg hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg z-50`}
        style={{
          transition: 'transform 0.2s ease, opacity 0.2s ease',
          transform: isOpen ? 'scale(0)' : 'scale(1)',
          opacity: isOpen ? 0 : 1,
          pointerEvents: isOpen ? 'none' : 'auto',
        }}
      >
        <MessageSquare size={24} />
      </button>

      {/* Chat Window */}
      <div
        role="dialog"
        aria-label="AI assistant"
        aria-hidden={!isOpen}
        className={cn(
          'fixed bg-bg border border-line shadow-xl overflow-hidden z-50 transition-[width,height] duration-200',
          // Both axes are clamped to the viewport: a fixed height runs off the
          // top of the screen on any laptop shorter than the panel.
          soloMode
            ? 'inset-0 rounded-none sm:inset-0 sm:w-auto sm:h-auto'
            : cn(
                'inset-x-3 bottom-3 top-16 rounded-lg sm:inset-x-auto sm:top-auto sm:bottom-6 sm:right-6',
                expanded
                  ? 'sm:w-[min(1000px,calc(100vw-3rem))] sm:h-[min(880px,calc(100vh-3rem))]'
                  : 'sm:w-[min(720px,calc(100vw-3rem))] sm:h-[min(720px,calc(100vh-3rem))]'
              )
        )}
        style={{
          display: 'flex',
          flexDirection: 'row',
          transition: 'opacity 0.3s ease, transform 0.3s ease',
          opacity: isOpen ? 1 : 0,
          transform: isOpen ? 'translateY(0)' : 'translateY(32px)',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      >
        {/* Examples rail, attached to the panel rather than living in the
            screener's filter sidebar — it belongs to the assistant. Hidden
            below sm, where the panel is already the whole screen and the empty
            state carries the same prompts inline. */}
        {showExamples && !soloMode && (
          <aside className="hidden sm:flex w-[228px] shrink-0 flex-col border-r border-line bg-bg-2">
            <div className="flex items-center justify-between gap-2 px-3 py-3 border-b border-line shrink-0">
              <span className="flex items-center gap-2 font-mono text-[11px] text-faint">
                <Sparkles size={12} className="text-a1" /> Examples
              </span>
              <button
                type="button"
                onClick={() => setShowExamples(false)}
                aria-label="Hide the examples"
                title="Hide examples"
                className="p-1 text-faint hover:text-fg rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60"
              >
                <X size={13} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {STARTERS.map((group) => {
                const open = openGroup === group.title;
                return (
                  <div key={group.title} className="rounded border border-line-soft">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenGroup(open ? null : group.title)}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left text-[11px] text-fg-soft hover:text-fg transition-colors rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60"
                    >
                      {group.title}
                      <ChevronDown
                        size={12}
                        className={cn('shrink-0 transition-transform', open && 'rotate-180')}
                      />
                    </button>
                    {open && (
                      <div className="px-2.5 pb-2.5 space-y-1.5">
                        <p className="text-[11px] text-faint leading-relaxed">{group.hint}</p>
                        {group.prompts.map((prompt) => (
                          <button
                            key={prompt}
                            type="button"
                            onClick={() => send(prompt)}
                            disabled={isLoading}
                            className="w-full text-left rounded bg-bg-3 px-2 py-1.5 font-mono text-[11px] text-fg-soft transition-colors hover:text-a1 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60"
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>
        )}

        {/* Chat column */}
        <div className="flex flex-1 min-w-0 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-line bg-bg-2 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-bg-3 text-fg-soft flex items-center justify-center">
              <Bot size={18} />
            </div>
            <div>
              <h3 className="font-bold text-fg text-sm">AI Assistant</h3>
              <p className="text-[11px] text-fg-soft tracking-normal">{subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
          {!showExamples && (
            <button
              onClick={() => setShowExamples(true)}
              aria-label="Show the examples"
              title="Examples"
              className="hidden sm:block p-2 text-fg-soft hover:text-fg hover:bg-bg-3 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60"
            >
              <Sparkles size={16} />
            </button>
          )}
          <button
            onClick={() => { const next = !soloMode; setSoloMode(next); onSoloModeChange(next); }}
            aria-label={soloMode ? 'Leave assistant-only mode' : 'Assistant-only mode'}
            title={soloMode ? 'Back to the screener' : 'Assistant only'}
            aria-pressed={soloMode}
            className={cn(
              'p-2 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60',
              soloMode ? 'bg-a1/12 text-a1' : 'text-fg-soft hover:text-fg hover:bg-bg-3'
            )}
          >
            {soloMode ? <Shrink size={16} /> : <Expand size={16} />}
          </button>
          {!soloMode && (
          <button
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? 'Shrink the assistant' : 'Expand the assistant'}
            title={expanded ? 'Shrink' : 'Expand'}
            className="hidden sm:block p-2 text-fg-soft hover:text-fg hover:bg-bg-3 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60"
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          )}
          <button
            onClick={() => { setIsOpen(false); setSoloMode(false); onSoloModeChange(false); }}
            aria-label="Close the assistant"
            className="p-2 text-fg-soft hover:text-fg hover:bg-bg-3 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60"
          >
            <X size={20} />
          </button>
          </div>
        </div>

        {/* What the assistant is working against. Always shown in solo mode,
            where the table it would otherwise be read from is gone. */}
        {soloMode && (
          <div className="shrink-0 border-b border-line bg-bg-2/60 px-4 py-3">
            <ActiveFilters summary={filterSummary} />
          </div>
        )}

        {/* Messages */}
        <div
          className={cn(
            'flex-1 overflow-y-auto p-4 space-y-4',
            // A conversation the width of a desktop screen is unreadable, so
            // the column is capped and centred rather than stretched.
            soloMode && 'mx-auto w-full max-w-3xl'
          )}
        >
          {messages.length === 0 && (
            /* Showing what to type beats describing it. Each group names a
               capability and gives one prompt that exercises it; tapping one
               sends it, so the first message is never a blank-page problem. */
            <div className="space-y-5">
              <p className="text-[13px] text-fg-soft leading-relaxed">
                I drive the screener for you.{' '}
                <span className={cn(showExamples && 'hidden sm:inline')}>
                  Pick an example from the left, or describe what you want.
                </span>
                <span className={cn(showExamples && 'sm:hidden')}>
                  Tap an example, or describe what you want in your own words.
                </span>
              </p>

              <div className={cn('grid gap-5', expanded && 'sm:grid-cols-2', showExamples && 'sm:hidden')}>
              {STARTERS.map((group) => (
                <div key={group.title} className="space-y-2">
                  <p className="font-mono text-[11px] text-faint">{group.title}</p>
                  <p className="text-[11px] text-faint/80 -mt-1">{group.hint}</p>
                  <div className="flex flex-col gap-1.5">
                    {group.prompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => send(prompt)}
                        className="text-left rounded-md border border-line bg-bg-2 px-3 py-2 text-[12px] text-fg-soft transition-colors hover:border-a1/40 hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              </div>

              <p className="text-[11px] text-faint leading-relaxed">
                You can chain these: &ldquo;NVDA, 20k, 30 delta, within 3
                months, then sort by yield&rdquo; works in one message.
              </p>
            </div>
          )}
          {messages.map((m) => {
            const invocations: ToolInvocation[] | undefined = (m as Message).toolInvocations;
            return (
              <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${m.role === 'user' ? 'bg-bg-3 text-fg' : 'bg-bg-3 text-fg-soft'}`}>
                  {m.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                </div>
                <div className={cn(
                  'flex flex-col gap-1',
                  m.role === 'user' ? 'items-end max-w-[75%]' : 'items-start max-w-[90%] w-full'
                )}>
                  {m.role === 'assistant' && mentionedCard(m) && (
                    // The assistant is told to call showOptionCard whenever it
                    // names a contract, and does not reliably do it. Reading
                    // the answer and showing the card anyway turns an
                    // instruction into a guarantee.
                    <div className="w-full min-w-[260px]">
                      <OptionCard
                        option={mentionedCard(m)!}
                        columns={cardColumns}
                        computedColumns={computedColumns}
                      />
                    </div>
                  )}
                  {m.content && (
                    <div
                      className={cn(
                        'rounded-lg p-3 text-sm leading-relaxed',
                        m.role === 'user'
                          ? 'bg-bg-3 text-fg rounded-tr-sm'
                          : 'min-w-0 max-w-full bg-bg-3 border border-line text-fg rounded-tl-sm'
                      )}
                    >
                      {m.role === 'user' ? m.content : <Markdown>{m.content}</Markdown>}
                    </div>
                  )}
                  {visibleInvocations(invocations ?? []).map((inv) =>
                    cards[inv.toolCallId] ? (
                      // The card is the result; a chip beside it would say less.
                      <div key={inv.toolCallId} className="w-full min-w-[260px]">
                        <OptionCard
                          option={cards[inv.toolCallId]}
                          columns={cardColumns}
                          computedColumns={computedColumns}
                        />
                      </div>
                    ) : charts[inv.toolCallId] ? (
                      // The chart is the result; a "✓ chart shown" chip beside
                      // it would say less than the picture does.
                      <div key={inv.toolCallId} className="w-full min-w-[260px]">
                        <StockChart history={charts[inv.toolCallId]} />
                      </div>
                    ) : (
                    <ToolChip key={inv.toolCallId} invocation={inv} />
                    )
                  )}
                  {m.role === 'assistant' &&
                    !m.content &&
                    !isLoading &&
                    !error &&
                    m.id === messages[messages.length - 1]?.id &&
                    ((invocations?.length ?? 0) > 0 ? (
                      // A turn that spends its whole step budget on tools ends
                      // with no text at all, and an answer that is only tick
                      // marks reads as the assistant having ignored you. Say
                      // that it finished rather than leaving the space blank.
                      <p className="px-1 text-[11px] text-faint">Done — nothing further to add.</p>
                    ) : (
                      // Nothing at all: no text, no tool call, no error. The
                      // model can finish a turn having emitted nothing, and an
                      // empty bubble tells the user only that they were
                      // ignored. Say what happened and offer the retry.
                      <div className="flex items-center gap-2">
                        <p className="px-1 text-[11px] text-faint">
                          The assistant returned nothing that time.
                        </p>
                        <button
                          type="button"
                          onClick={() => { if (!isLoading) reload(); }}
                          className="rounded-md border border-line bg-bg-3 px-2 py-1 text-[11px] font-bold text-fg-soft transition-colors hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60"
                        >
                          Try again
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            );
          })}
          {isLoading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-bg-3 text-fg-soft flex items-center justify-center shrink-0">
                <Bot size={16} />
              </div>
              <div className="p-3 rounded-lg bg-bg-3 border border-line rounded-tl-sm flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-warn/30 bg-warn/10 p-3 space-y-2">
              <div className="flex items-start gap-2 text-xs text-warn">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="leading-relaxed">{error.message}</span>
              </div>
              {lastUserMessage && (
                <button
                  type="button"
                  onClick={() => { if (!isLoading) reload(); }}
                  disabled={isLoading}
                  className="rounded-md border border-line bg-bg-3 px-2.5 py-1.5 text-[11px] font-bold text-fg-soft transition-colors hover:text-fg disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60"
                >
                  Try again
                </button>
              )}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Suggestions where the rail cannot go: a phone, and solo mode.
            Same STARTERS, so they cannot drift from the desktop list. */}
        {suggestions.length > 0 && (
          <div
            className={cn(
              'shrink-0 border-t border-line bg-bg-2 px-3 pt-2.5',
              // On desktop the rail already covers this, except in solo mode.
              soloMode ? 'block' : 'sm:hidden'
            )}
          >
            <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-2.5">
              {suggestions.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => send(prompt)}
                  disabled={isLoading}
                  className="shrink-0 rounded-full border border-line bg-bg-3 px-3 py-1.5 text-[11px] text-fg-soft transition-colors hover:text-fg disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input area */}
        <div className={cn('p-4 bg-bg-2 border-t border-line shrink-0', soloMode && 'mx-auto w-full max-w-3xl')}>
          <form
            onSubmit={(e) => {
              // A new turn gets its own retry.
              proseRetryRef.current = false;
              handleSubmit(e);
            }}
            className="relative flex items-center"
          >
            <input
              value={input}
              onChange={handleInputChange}
              placeholder="Filter, sort, or write a formula…"
              className="w-full bg-bg border border-line text-fg text-sm rounded-md py-3 pl-4 pr-12 focus:outline-none focus:border-zinc-500 transition-colors"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              aria-label="Send message"
              className="absolute right-2 p-2 bg-zinc-100 text-zinc-900 rounded-md hover:bg-white disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
        </div>
      </div>
    </>
  );
}
