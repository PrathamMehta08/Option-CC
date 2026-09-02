'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useChat } from '@ai-sdk/react';
import type { Message, ToolInvocation } from 'ai';
import { MessageSquare, X, Send, Bot, User, Loader2, AlertTriangle } from 'lucide-react';
import { parseCustomFilter, describeFilter, type CustomFilter } from '@/lib/filters';
import type { ScreenedOption } from '@/lib/optionChain';

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
  setSortConfig: (config: {
    key: keyof ScreenedOption | null;
    direction: 'asc' | 'desc' | null;
  }) => void;
  triggerFetch: () => void;
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
  setSortConfig,
  triggerFetch,
}: LLMChatbotProps) {
  const [isOpen, setIsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, input, handleInputChange, handleSubmit, status, error, addToolResult } = useChat({
    api: '/api/chat',
    maxSteps: 5,
  });

  const isLoading = status === 'submitted' || status === 'streaming';

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
        onClick={() => setIsOpen(true)}
        aria-label="Open the AI assistant"
        className={`fixed bottom-5 right-5 md:bottom-6 md:right-6 flex items-center justify-center w-14 h-14 bg-zinc-100 text-zinc-900 rounded-full shadow-lg hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 z-50`}
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
        className={`fixed inset-x-3 bottom-3 top-16 sm:inset-x-auto sm:top-auto sm:bottom-6 sm:right-6 sm:w-[400px] sm:h-[600px] bg-zinc-950 border border-zinc-800 rounded-lg shadow-xl flex-col overflow-hidden z-50`}
        style={{
          display: 'flex',
          transition: 'opacity 0.3s ease, transform 0.3s ease',
          opacity: isOpen ? 1 : 0,
          transform: isOpen ? 'translateY(0)' : 'translateY(32px)',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-zinc-800 text-zinc-300 flex items-center justify-center">
              <Bot size={18} />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">AI Assistant</h3>
              <p className="text-[11px] text-zinc-400 tracking-normal">{subtitle}</p>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            aria-label="Close the assistant"
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
          >
            <X size={20} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50">
              <MessageSquare size={48} className="text-zinc-600" />
              <p className="text-sm text-zinc-400 max-w-[250px]">
                Ask me to filter options by ticker, expiry, delta, or strike. I can also give recommendations!
              </p>
            </div>
          )}
          {messages.map((m) => {
            const invocations: ToolInvocation[] | undefined = (m as Message).toolInvocations;
            return (
              <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${m.role === 'user' ? 'bg-zinc-800 text-white' : 'bg-zinc-800 text-zinc-300'}`}>
                  {m.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                </div>
                <div className={`flex flex-col gap-1 max-w-[75%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  {m.content && (
                    <div className={`p-3 rounded-lg text-sm leading-relaxed ${m.role === 'user' ? 'bg-zinc-800 text-white rounded-tr-sm' : 'bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-tl-sm'}`}>
                      {m.content}
                    </div>
                  )}
                  {invocations?.map((inv) => (
                    <div key={inv.toolCallId} className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-400 flex items-center gap-2">
                      {inv.state === 'result' ? (
                        String(inv.result).startsWith('Filter rejected:') ? (
                          <>
                            <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                            <span className="text-amber-500/90">{inv.result}</span>
                          </>
                        ) : (
                          <>
                            <span className="text-zinc-400">✓</span>
                            <span>{inv.result}</span>
                          </>
                        )
                      ) : (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin text-zinc-400" />
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
              <div className="w-8 h-8 rounded-full bg-zinc-800 text-zinc-300 flex items-center justify-center shrink-0">
                <Bot size={16} />
              </div>
              <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 rounded-tl-sm flex items-center gap-1.5">
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
        <div className="p-4 bg-zinc-900/50 border-t border-zinc-800 shrink-0">
          <form onSubmit={handleSubmit} className="relative flex items-center">
            <input
              value={input}
              onChange={handleInputChange}
              placeholder="Ask me to filter the options..."
              className="w-full bg-zinc-950 border border-zinc-800 text-white text-sm rounded-md py-3 pl-4 pr-12 focus:outline-none focus:border-zinc-500 transition-colors"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              aria-label="Send message"
              className="absolute right-2 p-2 bg-zinc-100 text-zinc-900 rounded-md hover:bg-white disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
