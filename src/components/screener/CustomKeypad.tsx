'use client';

import React, { useState, useEffect, useCallback, memo } from 'react';
import { X, Delete } from 'lucide-react';
import { cn, formatExpirationLabel } from '@/lib/ui';

/**
 * The keypad edits either a single number (months, delta, strike) or a set of
 * expiration dates. Modelling that as a union keeps the call sites honest:
 * a 'months' keypad can only be handed a number setter.
 */
type NumericKeypadType = 'months' | 'delta' | 'strike';

/** A quick-pick button: a bare delta, or a labelled offset from spot. */
type KeypadPreset = number | { label: string; val: number };

type CustomKeypadProps =
  | {
      type: NumericKeypadType;
      value: number;
      onClose: () => void;
      onChange: (val: number) => void;
      tickerPrice?: number;
      allExps?: string[];
      otmDirection?: 'above' | 'below';
      hint?: React.ReactNode;
    }
  | {
      type: 'expirations';
      value: string[];
      onClose: () => void;
      onChange: (val: string[]) => void;
      tickerPrice?: number;
      allExps?: string[];
      otmDirection?: 'above' | 'below';
      hint?: React.ReactNode;
    };

export const CustomKeypad = memo(({
  type,
  value,
  onClose,
  onChange,
  tickerPrice,
  allExps,
  otmDirection = 'below',
  hint
}: CustomKeypadProps) => {
  // Use local state for the active editing value to prevent immediate parent re-renders
  const [localValue, setLocalValue] = useState<string | string[]>(() => {
    if (type === 'delta') return Math.abs(value as number).toString();
    if (type === 'expirations') return Array.isArray(value) ? [...value] : [];
    return value.toString();
  });

  const [isFirstKey, setIsFirstKey] = useState(true);

  // The props union guarantees this matches `type`; narrow once here so the
  // handlers below stay readable. Numbers go out through the debounced effect
  // rather than a second narrowing, so only the date setter is needed.
  const emitDates = onChange as (val: string[]) => void;

  // Sync back to the parent, debounced, for every numeric sheet.
  // `onChange` is used directly rather than the narrowed `emitNumber`, which is
  // a fresh cast every render and so cannot be an honest dependency.
  useEffect(() => {
    if (type === 'expirations') return;
    const timer = setTimeout(() => {
      const numeric = parseFloat(localValue as string);
      if (!isNaN(numeric)) {
        // Months are a count, not a measurement: "1." on the way to nothing
        // should still read as 1.
        (onChange as (val: number) => void)(type === 'months' ? Math.round(numeric) : numeric);
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [localValue, onChange, type]);

  const handleKey = useCallback((key: string) => {
    setLocalValue((prev) => {
      const str = prev.toString();
      if (key === 'BACK') {
        return str.length > 1 ? str.slice(0, -1) : '0';
      }
      if (key === '.') {
        if (type === 'months') return str;
        if (!str.includes('.')) return str + '.';
        return str;
      }
      // Numeric key
      if (isFirstKey) {
        setIsFirstKey(false);
        return key;
      }
      return str === '0' ? key : str + key;
    });
  }, [isFirstKey, type]);

  const formatDateLabel = formatExpirationLabel;

  const ExpirationsGrid = () => (
    <div className="flex-1 overflow-y-auto p-0.5 bg-zinc-950/50 scrollbar-none">
       <div className="grid grid-cols-3 gap-0.5 rounded-lg overflow-hidden">
        {allExps?.map((exp: string) => {
          const isSelected = Array.isArray(localValue) && localValue.includes(exp);
          return (
            <button
              key={exp}
              onClick={() => {
                const current = Array.isArray(localValue) ? localValue : [];
                const newVal = isSelected
                  ? current.filter((e: string) => e !== exp)
                  : [...current, exp];
                setLocalValue(newVal);
                emitDates(newVal);
              }}
              className={cn(
                "py-6 flex flex-col items-center justify-center transition-all",
                isSelected
                  ? "bg-zinc-100 text-zinc-900"
                  : "bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900/60"
              )}
            >
              <span className="text-[11px] font-semibold tracking-tighter opacity-60 mb-1">
                {isSelected ? 'Included' : 'Hidden'}
              </span>
              <span className="text-sm font-bold tracking-tight">
                {formatDateLabel(exp)}
              </span>
            </button>
          );
        })}
       </div>
    </div>
  );

  const NumericKeypad = () => {
    const presets: KeypadPreset[] = type === 'delta'
      ? [0.10, 0.15, 0.20, 0.30, 0.40]
      : type === 'months'
      ? [0, 1, 3, 6, 12, 18, 24].map((m) => ({ label: `${m}`, val: m }))
      : tickerPrice
        ? // Offsets run towards the money the strategy actually sells into:
          // above spot for a covered call, below it for a cash-secured put.
          [0, 5, 10, 15, 20, 25].map((pct) => {
            const sign = otmDirection === 'above' ? 1 : -1;
            return {
              label: `${pct === 0 ? '' : sign > 0 ? '+' : '-'}${pct}%`,
              val: tickerPrice * (1 + (sign * pct) / 100),
            };
          })
        : [];

    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between p-3 border-b border-zinc-800">
          <span className="text-[11px] font-semibold tracking-normal text-zinc-500">Edit {type}</span>
          <button onClick={onClose} className="p-2 bg-zinc-900 rounded-full text-zinc-400"><X size={24} /></button>
        </div>

        {/* What the current value actually selects. The sheet covers the panel
            it is changing, so without this a tap has no visible effect. */}
        {hint && (
          <div className="px-4 py-2.5 border-b border-zinc-800 bg-zinc-950/40 text-[11px] font-mono text-zinc-400">
            {hint}
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-1.5 p-3 bg-zinc-950/30">
          {presets.map((p: KeypadPreset) => (
             <button
               key={typeof p === 'number' ? p : p.label}
               onClick={() => {
                 const val = typeof p === 'number' ? p : p.val;
                 setLocalValue(
                   type === 'months' ? String(Math.round(val)) : Math.abs(val).toFixed(2)
                 );
                 setIsFirstKey(false);
               }}
               className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-full text-[11px] font-bold text-zinc-300 active:bg-zinc-700 active:text-zinc-100 transition-colors"
             >
               {typeof p === 'number'
                 ? p
                 : type === 'months'
                   ? p.label
                   : `${p.label} ($${p.val.toFixed(2)})`}
             </button>
          ))}
        </div>

        <div className="px-6 py-2 flex flex-col items-center justify-center bg-zinc-950">
           <div className={cn(
             "text-3xl font-mono font-bold tracking-tighter transition-opacity",
             isFirstKey ? "text-zinc-600 opacity-60" : "text-white"
           )}>
             {type === 'strike' && <span className={cn(isFirstKey ? "text-zinc-800" : "text-zinc-700", "mr-2")}>$</span>}
             {localValue.toString()}
             {type === 'months' && (
               <span className={cn(isFirstKey ? "text-zinc-800" : "text-zinc-700", "ml-2 text-lg")}>
                 {localValue.toString() === '1' ? 'month' : 'months'}
               </span>
             )}
           </div>
        </div>

        <div className="flex-1 grid grid-cols-3 gap-0.5 p-0.5 bg-zinc-950/50">
          {(type === 'months'
            ? ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'BACK']
            : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'BACK']
          ).map((k, i) => (
            <button
              key={`${k}-${i}`}
              disabled={k === ''}
              onClick={() => handleKey(k)}
              className={cn(
                'py-3.5 text-xl font-medium rounded flex items-center justify-center transition-colors',
                k === ''
                  ? 'invisible'
                  : 'bg-zinc-900/40 hover:bg-zinc-800/60 active:bg-zinc-700/80'
              )}
            >
              {k === 'BACK' ? <Delete size={20} /> : k}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col justify-end bg-zinc-950/60 backdrop-blur-sm">
      <div className="bg-zinc-950 border-t border-zinc-800 rounded-t-[2rem] overflow-hidden h-fit max-h-[85vh] min-h-[50vh] flex flex-col animate-in slide-in-from-bottom duration-300">
        {type === 'expirations' ? (
          <div className="flex flex-col flex-1">
             <div className="flex items-center justify-between p-3 border-b border-zinc-800">
                <span className="text-[11px] font-semibold tracking-normal text-zinc-500">Filter Strike Dates</span>
                <div className="flex items-center gap-2">
                   <button
                     onClick={() => {
                       setLocalValue(allExps || []);
                       emitDates(allExps || []);
                     }}
                     className="px-3 py-1.5 bg-zinc-900 rounded-lg text-[11px] font-bold text-zinc-400 tracking-normal hover:text-white"
                   >All</button>
                   <button onClick={onClose} className="p-2 bg-zinc-900 rounded-full text-zinc-400"><X size={24} /></button>
                </div>
             </div>
             <ExpirationsGrid />
          </div>
        ) : <NumericKeypad />}
      </div>
    </div>
  );
});
CustomKeypad.displayName = 'CustomKeypad';
