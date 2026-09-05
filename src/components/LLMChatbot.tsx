'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useChat } from '@ai-sdk/react';
import type { Message, ToolInvocation } from 'ai';
import { MessageSquare, X, Send, Bot, User, Loader2, AlertTriangle, Maximize2, Minimize2, Sparkles, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/ui';
import { parseCustomFilter, describeFilter, type CustomFilter } from '@/lib/filters';
import { normalizeDelta } from '@/lib/assistant/normalize';
import { describeHistory, type ChartRange, type HistoryResponse } from '@/lib/history';
import { StockChart } from '@/components/screener/StockChart';
import type { StrategyId } from '@/lib/strategies';
import type { MobileView } from '@/components/screener/ResultsTable';
import type { ScreenedOption } from '@/lib/optionChain';
import { STARTERS } from '@/lib/assistant/starters';

interface LLMChatbotProps {
  /** Strategy name shown under the assistant title. */
  subtitle: string;
  setTicker: (ticker: string) => void;
  setCapital: (capital: string) => void;
  setMinMonths: (months: number) => void;
  setMaxMonths: (months: number) => void;
  setDeltaMagnitude: (delta: number) => void;
  /** Takes an updater too, so applySettings can move one end and keep the other. */
  setStrikeFilter: React.Dispatch<React.SetStateAction<[number, number]>>;
  addCustomFilter: (filter: CustomFilter) => void;
  addComputedColumn: (input: { id: string; name: string; expression: string }) =>
    { ok: true; column: { name: string; source: string } } | { ok: false; error: string };
  setSortConfig: (config: {
    key: keyof ScreenedOption | null;
    direction: 'asc' | 'desc' | null;
  }) => void;
  setStrategy: (id: StrategyId) => void;
  setResultsView: (view: MobileView) => void;
  /**
   * A description of the loaded scan, for the readScreen tool. Async because it
   * waits for a scan already on its way rather than reporting "nothing loaded".
   */
  readScreen: () => Promise<string>;
}

export default function LLMChatbot({
  subtitle,
  setTicker,
  setCapital,
  setMinMonths,
  setMaxMonths,
  setDeltaMagnitude,
  setStrikeFilter,
  addCustomFilter,
  addComputedColumn,
  setSortConfig,
  setStrategy,
  setResultsView,
  readScreen,
}: LLMChatbotProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Expanded is a display preference, so it stays local.
  const [expanded, setExpanded] = useState(false);
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
        if (a.ticker != null) {
          const symbol = String(a.ticker).toUpperCase();
          setTicker(symbol);
          done.push(`ticker ${symbol}`);
        }
        if (a.capital != null) {
          setCapital(String(a.capital));
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
          done.push(`delta ${magnitude}`);
        }
        if (a.minStrike != null || a.maxStrike != null) {
          // Only one end may be given, so the other keeps whatever it has
          // rather than being reset to an arbitrary bound.
          setStrikeFilter(([low, high]) => [
            a.minStrike != null ? Number(a.minStrike) : low,
            a.maxStrike != null ? Number(a.maxStrike) : high,
          ]);
          done.push(`strikes $${a.minStrike ?? 'any'}-$${a.maxStrike ?? 'any'}`);
        }
        if (a.strategy != null) {
          setStrategy(String(a.strategy) as StrategyId);
          done.push(String(a.strategy) === 'covered-call' ? 'covered calls' : 'cash-secured puts');
        }
        if (done.length === 0) return 'Nothing to change — no settings were given.';
        return `Set ${done.join(', ')}. A fresh scan takes a moment — read the screen again before quoting its numbers.`;
      }
      case 'setTicker': {
        const symbol = String(a.ticker).toUpperCase();
        setTicker(symbol);
        // No fetch is kicked off here: the ticker is the only thing the app
        // fetches on, and its own debounced effect owns that.
        return `Ticker set to ${symbol}. A fresh scan takes a moment — read the screen again before quoting its numbers.`;
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
        setStrikeFilter([Number(a.minStrike), Number(a.maxStrike)]);
        return `Strike range set to $${a.minStrike}–$${a.maxStrike}`;
      case 'setSort':
        setSortConfig(args as never);
        return `Sorted by ${a.key} ${a.direction}`;
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
        addCustomFilter(parsed.filter);
        return `Filter applied — ${describeFilter(parsed.filter)}`;
      }
      case 'addComputedColumn': {
        // The formula is parsed by our own grammar, never executed. A rejection
        // is reported so the model can fix the expression.
        const added = addComputedColumn(args as unknown as { id: string; name: string; expression: string });
        return added.ok
          ? `Added column "${added.column.name}" = ${added.column.source}, sorted by it`
          : `Formula rejected: ${added.error}`;
      }
      case 'readScreen':
        // The one tool that hands data back rather than changing state.
        return await readScreen();
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

  const { messages, input, handleInputChange, handleSubmit, status, error, append, reload } = useChat({
    api: '/api/chat',
    maxSteps: 5,
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
  });

  const isLoading = status === 'submitted' || status === 'streaming';
  /** Whether there is a turn to retry — reload() re-runs the last user message. */
  const lastUserMessage = messages.some((m) => m.role === 'user');

  /** Send a starter prompt as though the user had typed and submitted it. */
  const send = (text: string) => {
    if (isLoading) return;
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
          'fixed inset-x-3 bottom-3 top-16 sm:inset-x-auto sm:top-auto sm:bottom-6 sm:right-6 bg-bg border border-line rounded-lg shadow-xl overflow-hidden z-50 transition-[width,height] duration-200',
          // Both axes are clamped to the viewport: a fixed height runs off the
          // top of the screen on any laptop shorter than the panel.
          expanded
            ? 'sm:w-[min(1000px,calc(100vw-3rem))] sm:h-[min(880px,calc(100vh-3rem))]'
            : 'sm:w-[min(720px,calc(100vw-3rem))] sm:h-[min(720px,calc(100vh-3rem))]'
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
        {showExamples && (
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
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? 'Shrink the assistant' : 'Expand the assistant'}
            title={expanded ? 'Shrink' : 'Expand'}
            className="hidden sm:block p-2 text-fg-soft hover:text-fg hover:bg-bg-3 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60"
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            onClick={() => setIsOpen(false)}
            aria-label="Close the assistant"
            className="p-2 text-fg-soft hover:text-fg hover:bg-bg-3 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60"
          >
            <X size={20} />
          </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
                  {m.content && (
                    <div className={`p-3 rounded-lg text-sm leading-relaxed ${m.role === 'user' ? 'bg-bg-3 text-fg rounded-tr-sm' : 'bg-bg-3 border border-line text-fg rounded-tl-sm'}`}>
                      {m.content}
                    </div>
                  )}
                  {invocations?.map((inv) =>
                    charts[inv.toolCallId] ? (
                      // The chart is the result; a "✓ chart shown" chip beside
                      // it would say less than the picture does.
                      <div key={inv.toolCallId} className="w-full min-w-[260px]">
                        <StockChart history={charts[inv.toolCallId]} />
                      </div>
                    ) : (
                    <div key={inv.toolCallId} className="bg-bg-3 border border-line rounded-lg p-2 text-xs text-fg-soft flex items-center gap-2">
                      {inv.state === 'result' ? (
                        /^(Filter|Formula) rejected:/.test(String(inv.result)) ? (
                          <>
                            <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                            <span className="text-amber-500/90">{inv.result}</span>
                          </>
                        ) : (
                          <>
                            <span className="text-fg-soft">✓</span>
                            <span>{inv.result}</span>
                          </>
                        )
                      ) : (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin text-fg-soft" />
                          <span>Running: {inv.toolName}…</span>
                        </>
                      )}
                    </div>
                    )
                  )}
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

        {/* Input area */}
        <div className="p-4 bg-bg-2 border-t border-line shrink-0">
          <form onSubmit={handleSubmit} className="relative flex items-center">
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
