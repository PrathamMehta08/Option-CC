'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useChat } from '@ai-sdk/react';
import type { Message, ToolInvocation } from 'ai';
import { MessageSquare, X, Send, Bot, User, Loader2, AlertTriangle, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '@/lib/ui';
import { parseCustomFilter, describeFilter, type CustomFilter } from '@/lib/filters';
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
  setStrikeFilter: (range: [number, number]) => void;
  addCustomFilter: (filter: CustomFilter) => void;
  addComputedColumn: (input: { id: string; name: string; expression: string }) =>
    { ok: true; column: { name: string; source: string } } | { ok: false; error: string };
  setSortConfig: (config: {
    key: keyof ScreenedOption | null;
    direction: 'asc' | 'desc' | null;
  }) => void;
  triggerFetch: () => void;
  /** Controlled so the sidebar's Examples can open the panel. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A prompt to send. The counter makes repeat sends of the same text fire. */
  request?: { text: string; n: number };
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
  triggerFetch,
  open: isOpen,
  onOpenChange,
  request,
}: LLMChatbotProps) {
  // Expanded is a display preference, so it stays local.
  const [expanded, setExpanded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, input, handleInputChange, handleSubmit, status, error, addToolResult, append } = useChat({
    api: '/api/chat',
    maxSteps: 5,
  });

  const isLoading = status === 'submitted' || status === 'streaming';

  /** Send a starter prompt as though the user had typed and submitted it. */
  const send = (text: string) => {
    if (isLoading) return;
    append({ role: 'user', content: text });
  };

  // A prompt pushed in from the sidebar. Keyed on the counter so asking for the
  // same example twice sends it twice.
  const lastRequest = useRef(0);
  useEffect(() => {
    if (!request || request.n === lastRequest.current) return;
    lastRequest.current = request.n;
    append({ role: 'user', content: request.text });
    // append is stable for a given chat; re-running on it would resend.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // Execute client-side tool calls when they arrive
  useEffect(() => {
    let changed = false;
    for (const message of messages) {
      if (message.role !== 'assistant') continue;
      const invocations: ToolInvocation[] | undefined = message.toolInvocations;
      if (!invocations) continue;
      for (const inv of invocations) {
        if (inv.state === 'call') {
          let result = 'Done';
          try {
            if (inv.toolName === 'setTicker') {
              setTicker(inv.args.ticker.toUpperCase());
              result = `Ticker set to ${inv.args.ticker.toUpperCase()}`;
              changed = true;
            } else if (inv.toolName === 'setCapital') {
              setCapital(inv.args.capital.toString());
              result = `Capital set to $${inv.args.capital}`;
              changed = true;
            } else if (inv.toolName === 'setMonthsRange') {
              setMinMonths(inv.args.minMonths);
              setMaxMonths(inv.args.maxMonths);
              result = `Months range set to ${inv.args.minMonths}–${inv.args.maxMonths}`;
              changed = true;
            } else if (inv.toolName === 'setDelta') {
              const magnitude = Math.abs(inv.args.delta);
              setDeltaMagnitude(magnitude);
              result = `Delta limit set to ${magnitude}`;
              changed = true;
            } else if (inv.toolName === 'setStrikeRange') {
              setStrikeFilter([inv.args.minStrike, inv.args.maxStrike]);
              result = `Strike range set to $${inv.args.minStrike}–$${inv.args.maxStrike}`;
              changed = true;
            } else if (inv.toolName === 'addCustomFilter') {
              // Model output is untrusted data. Validate it against the schema
              // and report a rejection rather than dropping it silently, so the
              // model can correct itself and the user can see what happened.
              const parsed = parseCustomFilter(inv.args);
              if (parsed.ok) {
                addCustomFilter(parsed.filter);
                result = `Filter applied — ${describeFilter(parsed.filter)}`;
              } else {
                result = `Filter rejected: ${parsed.error}. Valid fields are the numeric columns; valid operators are gt, gte, lt, lte, eq, between.`;
              }
            } else if (inv.toolName === 'addComputedColumn') {
              // The formula is parsed by our own grammar, never executed. A
              // rejection is reported so the model can fix the expression.
              const added = addComputedColumn(inv.args);
              result = added.ok
                ? `Added column "${added.column.name}" = ${added.column.source}, sorted by it`
                : `Formula rejected: ${added.error}`;
            } else if (inv.toolName === 'setSort') {
              setSortConfig(inv.args);
              result = `Sorted by ${inv.args.key} ${inv.args.direction}`;
            }
          } catch {
            result = 'Error applying tool';
          }
          addToolResult({ toolCallId: inv.toolCallId, result });
        }
      }
    }
    if (changed) {
      triggerFetch();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={() => onOpenChange(true)}
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
          'fixed inset-x-3 bottom-3 top-16 sm:inset-x-auto sm:top-auto sm:bottom-6 sm:right-6 bg-bg border border-line rounded-lg shadow-xl flex-col overflow-hidden z-50 transition-[width,height] duration-200',
          expanded
            ? 'sm:w-[min(760px,calc(100vw-3rem))] sm:h-[min(860px,calc(100vh-3rem))]'
            : 'sm:w-[460px] sm:h-[720px]'
        )}
        style={{
          display: 'flex',
          transition: 'opacity 0.3s ease, transform 0.3s ease',
          opacity: isOpen ? 1 : 0,
          transform: isOpen ? 'translateY(0)' : 'translateY(32px)',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      >
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
          <button
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? 'Shrink the assistant' : 'Expand the assistant'}
            title={expanded ? 'Shrink' : 'Expand'}
            className="hidden sm:block p-2 text-fg-soft hover:text-fg hover:bg-bg-3 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-a1/60"
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            onClick={() => onOpenChange(false)}
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
                I drive the screener for you. Tap an example, or describe what
                you want in your own words.
              </p>

              <div className={cn('grid gap-5', expanded && 'sm:grid-cols-2')}>
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
                <div className={`flex flex-col gap-1 max-w-[75%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  {m.content && (
                    <div className={`p-3 rounded-lg text-sm leading-relaxed ${m.role === 'user' ? 'bg-bg-3 text-fg rounded-tr-sm' : 'bg-bg-3 border border-line text-fg rounded-tl-sm'}`}>
                      {m.content}
                    </div>
                  )}
                  {invocations?.map((inv) => (
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
            <div className="p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-400 text-xs">
              Error: {error.message}
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
    </>
  );
}
