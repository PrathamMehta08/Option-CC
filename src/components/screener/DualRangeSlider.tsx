'use client';

import React, { useState, useEffect, memo } from 'react';

/** Must match .dual-range-input::-webkit-slider-thumb width in globals.css. */
const THUMB = 24;

export const DualRangeSlider = memo(({ min, max, value, onChange, label, unit = "$" }: { min: number, max: number, value: [number, number], onChange: (val: [number, number]) => void, label?: string, unit?: string }) => {
  const [localValue, setLocalValue] = useState(value);

  // Sync with the parent when it changes externally (e.g. a fresh scan reset the
  // strike bounds). Adjusting state during render rather than in an effect: no
  // second pass, and the dependency is a plain comparison instead of two
  // subscript expressions the linter cannot check.
  const [syncedValue, setSyncedValue] = useState(value);
  if (syncedValue[0] !== value[0] || syncedValue[1] !== value[1]) {
    setSyncedValue(value);
    setLocalValue(value);
  }

  // Debounced update to parent to keep things snappy
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localValue[0] !== value[0] || localValue[1] !== value[1]) {
        onChange(localValue);
      }
    }, 50); // Small 50ms debounce for 'live' but efficient feel
    return () => clearTimeout(timer);
  }, [localValue, onChange, value]);

  const pct = (v: number) => ((v - Math.min(min, max)) / (Math.max(min, max) - Math.min(min, max) || 1)) * 100;
  const lowPct = pct(localValue[0]);
  const highPct = pct(localValue[1]);

  const minVal = Math.min(min, max);
  const maxVal = Math.max(min, max);

  const handleLowChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    setLocalValue([Math.min(val, localValue[1]), localValue[1]]);
  };

  const handleHighChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    setLocalValue([localValue[0], Math.max(val, localValue[0])]);
  };

  return (
    <div className="space-y-1">
      {/* The label and the current range are rendered by the caller now — the
          value boxes this used to draw duplicated them. */}
      {label && (
        <label className="block font-mono text-[11px] text-faint leading-none">
          {label}
          <span className="ml-2 text-fg-soft">
            {unit}{localValue[0]}–{unit}{localValue[1]}
          </span>
        </label>
      )}
      <div className="dual-range-container">
        {/* Track */}
        <div className="absolute w-full h-1 bg-bg-3 rounded-full border border-line-soft" />

        {/* Selected span, in the accent gradient.
            A browser insets a range thumb by half its width, so a thumb at 0%
            sits 12px in and one at 100% sits 12px short of the end. Positioning
            the fill at a bare percentage therefore overshoots the handles at
            both ends. Offsetting by (half a thumb - pct * thumb) puts the fill
            edge exactly under the thumb centre at every position. */}
        <div
          className="absolute h-1 rounded-full z-0"
          style={{
            background: 'var(--grad)',
            left: `calc(${lowPct}% + ${THUMB / 2 - (THUMB * lowPct) / 100}px)`,
            right: `calc(${100 - highPct}% + ${THUMB / 2 - (THUMB * (100 - highPct)) / 100}px)`,
          }}
        />

        <input 
          type="range" 
          min={minVal} 
          max={maxVal} 
          value={localValue[0]} 
          onChange={handleLowChange}
          className="dual-range-input accent-emerald z-10"
        />
        <input 
          type="range" 
          min={minVal} 
          max={maxVal} 
          value={localValue[1]} 
          onChange={handleHighChange}
          className="dual-range-input accent-emerald z-20"
        />
      </div>
    </div>
  );
});
DualRangeSlider.displayName = 'DualRangeSlider';
