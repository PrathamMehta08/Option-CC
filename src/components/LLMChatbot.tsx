'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useChat } from '@ai-sdk/react';
import { MessageSquare, X, Send, Bot, User, Loader2 } from 'lucide-react';

interface LLMChatbotProps {
  setTicker: (ticker: string) => void;
  setCapital: (capital: string) => void;
  setMinMonths: (months: number) => void;
  setMaxMonths: (months: number) => void;
  setMaxDelta: (delta: number) => void;
  setStrikeFilter: (range: [number, number]) => void;
  addCustomFilter: (filter: { id: string; name: string; code: string }) => void;
  setSortConfig: (config: { key: any; direction: 'asc' | 'desc' | null }) => void;
  triggerFetch: () => void;
}

export default function LLMChatbot({
  setTicker,
  setCapital,
  setMinMonths,
  setMaxMonths,
  setMaxDelta,
  setStrikeFilter,
  addCustomFilter,
  setSortConfig,
  triggerFetch,
}: LLMChatbotProps) {
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
      const invocations = (message as any).toolInvocations;
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
            } else if (inv.toolName === 'setMaxDelta') {
              setMaxDelta(inv.args.maxDelta);
              result = `Max delta set to ${inv.args.maxDelta}`;
              changed = true;
            } else if (inv.toolName === 'setStrikeRange') {
              setStrikeFilter([inv.args.minStrike, inv.args.maxStrike]);
              result = `Strike range set to $${inv.args.minStrike}–$${inv.args.maxStrike}`;
              changed = true;
            } else if (inv.toolName === 'addCustomFilter') {
              addCustomFilter(inv.args);
              result = `Added custom filter: ${inv.args.name}`;
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
    <div className="w-full h-full min-h-[500px] max-h-[calc(100vh-160px)] bg-zinc-950/50 border border-zinc-800 rounded-2xl flex flex-col overflow-hidden shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center">
              <Bot size={18} />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">AI Assistant</h3>
              <p className="text-[10px] text-zinc-400 uppercase tracking-wider">Covered Calls</p>
            </div>
          </div>
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
            const invocations = (m as any).toolInvocations as any[] | undefined;
            return (
              <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${m.role === 'user' ? 'bg-zinc-800 text-white' : 'bg-emerald-500/20 text-emerald-500'}`}>
                  {m.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                </div>
                <div className={`flex flex-col gap-1 max-w-[75%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  {m.content && (
                    <div className={`p-3 rounded-2xl text-sm leading-relaxed ${m.role === 'user' ? 'bg-zinc-800 text-white rounded-tr-sm' : 'bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-tl-sm'}`}>
                      {m.content}
                    </div>
                  )}
                  {invocations?.map((inv: any) => (
                    <div key={inv.toolCallId} className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-400 flex items-center gap-2">
                      {inv.state === 'result' ? (
                        <>
                          <span className="text-emerald-400">✓</span>
                          <span>{inv.result}</span>
                        </>
                      ) : (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin text-emerald-500" />
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
              <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center shrink-0">
                <Bot size={16} />
              </div>
              <div className="p-3 rounded-2xl bg-zinc-900 border border-zinc-800 rounded-tl-sm flex items-center gap-1.5">
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
              className="w-full bg-zinc-950 border border-zinc-800 text-white text-sm rounded-full py-3 pl-4 pr-12 focus:outline-none focus:border-emerald-500 transition-colors"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="absolute right-2 p-2 bg-emerald-500 text-black rounded-full hover:bg-emerald-400 disabled:opacity-50 transition-colors"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
    </div>
  );
}
