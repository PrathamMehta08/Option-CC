'use client';

import React, { memo } from 'react';
import { cn } from '@/lib/ui';

/** The offsets from spot the quick-picks offer, as percentages. */
export const STRIKE_PRESET_STEPS = [5, 10, 15, 20, 25] as const;

export interface StrikePreset {
  label: string;
  /** The strike range this preset selects. */
  range: [number, number];
}

/**
 * Build the quick-pick ranges for a board.
 *
 * Each preset means "at least this far out of the money", so it moves the near
 * edge of the range and leaves the far edge at the board's own limit. Which
 * edge is the near one depends on the strategy: a covered call is sold above
 * spot, a cash-secured put below it.
 *
 * Bounds are whole numbers, matching the slider track — a fractional bound
 * leaves the thumb unable to reach its own end.
 */
export function buildStrikePresets(
  spot: number,
  bounds: [number, number],
  otmDirection: 'above' | 'below'
): StrikePreset[] {
  const [low, high] = bounds;
  return STRIKE_PRESET_STEPS.map((pct) => {
    // Round to cents before rounding to whole dollars. 100 * 1.1 is
    // 110.00000000000001 in binary floating point, and ceiling that gives 111 —
    // which quietly excludes the $110 strike from "+10%".
    const target = Number((spot * (1 + (otmDirection === 'above' ? pct : -pct) / 100)).toFixed(2));
    if (otmDirection === 'above') {
      const from = Math.min(Math.ceil(target), high);
      return { label: `+${pct}%`, range: [from, high] as [number, number] };
    }
    const to = Math.max(Math.floor(target), low);
    return { label: `-${pct}%`, range: [low, to] as [number, number] };
  });
}

/**
 * Desktop counterpart to the keypad's offset buttons: one tap for "show me
 * strikes at least 10% out of the money", instead of dragging a slider handle
 * to a number you have to work out first.
 */
export const StrikePresets = memo(function StrikePresets({
  spot,
  bounds,
  otmDirection,
  active,
  onPick,
}: {
  spot: number;
  bounds: [number, number];
  otmDirection: 'above' | 'below';
  /** The range currently applied, so the matching chip can show as selected. */
  active: [number, number];
  onPick: (range: [number, number]) => void;
}) {
  const presets = buildStrikePresets(spot, bounds, otmDirection);
  const isFullRange = active[0] === bounds[0] && active[1] === bounds[1];

  return (
    <div className="flex flex-wrap gap-1 pt-0.5">
      <button
        type="button"
        aria-pressed={isFullRange}
        onClick={() => onPick(bounds)}
        className={cn(
          'rounded px-2 py-1 font-mono text-[11px] transition-colors',
          isFullRange
            ? 'bg-a1/12 text-a1 ring-1 ring-inset ring-a1/30'
            : 'bg-bg-3 text-faint hover:text-fg-soft'
        )}
      >
        all
      </button>
      {presets.map((p) => {
        const on = !isFullRange && active[0] === p.range[0] && active[1] === p.range[1];
        return (
          <button
            key={p.label}
            type="button"
            aria-pressed={on}
            // The dollar figure is the point: the percentage is the intent, the
            // strike is what the table will actually be filtered by.
            title={`Strikes ${otmDirection === 'above' ? 'from' : 'up to'} $${
              otmDirection === 'above' ? p.range[0] : p.range[1]
            }`}
            onClick={() => onPick(p.range)}
            className={cn(
              'rounded px-2 py-1 font-mono text-[11px] transition-colors',
              on
                ? 'bg-a1/12 text-a1 ring-1 ring-inset ring-a1/30'
                : 'bg-bg-3 text-faint hover:text-fg-soft'
            )}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
});
