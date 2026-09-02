'use client';

import React, { useState, useEffect, memo } from 'react';

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
    <div className="space-y-4">
      {label && (
        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest leading-none block">{label}</label>
      )}
      <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
        <div className="bg-zinc-900 py-1.5 rounded-lg border border-zinc-800 text-center text-zinc-100 font-bold">{unit}{localValue[0]}</div>
        <div className="bg-zinc-900 py-1.5 rounded-lg border border-zinc-800 text-center text-zinc-100 font-bold">{unit}{localValue[1]}</div>
      </div>
      <div className="dual-range-container">
        {/* Track Background */}
        <div className="absolute w-full h-1.5 bg-zinc-900 rounded-full border border-zinc-800" />
        
        {/* Active Range Highlight */}
        <div 
          className="absolute h-1.5 bg-emerald-500 rounded-full z-0" 
          style={{
            left: `${((localValue[0] - minVal) / (maxVal - minVal || 1)) * 100}%`,
            right: `${100 - ((localValue[1] - minVal) / (maxVal - minVal || 1)) * 100}%`
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
