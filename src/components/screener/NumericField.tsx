'use client';

import React, { useState, memo } from 'react';
import { cn } from '@/lib/ui';

/**
 * A number you type rather than drag.
 *
 * Sliders are quick to sweep and hopeless to land on: every value behind these
 * controls is an exact number — a strike, a month count, a delta — and dragging
 * a 22px thumb across a $600 track to reach $335 is not how anyone wants to say
 * "335". The quick-picks beside each field keep the sweep; this keeps the aim.
 *
 * The input holds a draft string while it is being edited, so a half-typed "1"
 * on the way to "12" is not committed as 1 and clamped, and an emptied field is
 * not committed as 0. The draft commits on blur or Enter, and Escape abandons it.
 */
export const NumericField = memo(function NumericField({
  value,
  onCommit,
  min,
  max,
  prefix,
  suffix,
  ariaLabel,
  /** Decimals to show when the value comes from outside (a preset, the assistant). */
  decimals = 0,
  width = 'w-20',
}: {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  prefix?: string;
  suffix?: string;
  ariaLabel: string;
  decimals?: number;
  width?: string;
}) {
  const show = (n: number) => (decimals > 0 ? n.toFixed(decimals) : String(n));

  const [draft, setDraft] = useState(() => show(value));
  // Resync when the value changes from anywhere else — a quick-pick, the
  // assistant, a strategy switch, or this field's own commit being clamped by
  // the parent. Adjusting state during render is React's documented alternative
  // to an effect for exactly this.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(show(value));
  }

  const commit = () => {
    const parsed = Number(draft.trim());
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      // Nonsense reverts rather than committing NaN or silently becoming zero.
      setDraft(show(value));
      return;
    }
    const clamped = Math.min(Math.max(parsed, min ?? -Infinity), max ?? Infinity);
    setDraft(show(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <div
      className={cn(
        'flex items-center gap-0.5 rounded-md border border-line bg-bg-3 px-2 py-1.5',
        'transition-colors focus-within:border-a1/50 focus-within:ring-1 focus-within:ring-a1/25',
        width
      )}
    >
      {prefix && <span className="font-mono text-[11px] text-faint shrink-0">{prefix}</span>}
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(show(value));
            e.currentTarget.blur();
          }
        }}
        className="w-full min-w-0 bg-transparent text-right font-mono text-sm text-fg tabular-nums focus:outline-none"
      />
      {suffix && <span className="font-mono text-[11px] text-faint shrink-0">{suffix}</span>}
    </div>
  );
});

/** A row of one-tap values, so the common cases stay one click away. */
export const QuickPicks = memo(function QuickPicks<T>({
  options,
  isActive,
  onPick,
}: {
  options: { label: string; value: T }[];
  isActive: (value: T) => boolean;
  onPick: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = isActive(o.value);
        return (
          <button
            key={o.label}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(o.value)}
            className={cn(
              'rounded px-2 py-1 font-mono text-[11px] transition-colors',
              on
                ? 'bg-a1/12 text-a1 ring-1 ring-inset ring-a1/30'
                : 'bg-bg-3 text-faint hover:text-fg-soft'
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}) as <T>(props: {
  options: { label: string; value: T }[];
  isActive: (value: T) => boolean;
  onPick: (value: T) => void;
}) => React.ReactElement;
