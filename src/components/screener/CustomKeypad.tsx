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
    }
  | {
      type: 'expirations';
      value: string[];
      onClose: () => void;
      onChange: (val: string[]) => void;
      tickerPrice?: number;
      allExps?: string[];
      otmDirection?: 'above' | 'below';
    };

export const CustomKeypad = memo(({ 
  type, 
  value, 
  onClose, 
  onChange,
  tickerPrice,
  allExps,
  otmDirection = 'below'
}: CustomKeypadProps) => {
  // Use local state for the active editing value to prevent immediate parent re-renders
  const [localValue, setLocalValue] = useState<string | string[]>(() => {
    if (type === 'delta') return Math.abs(value as number).toString();
    if (type === 'expirations') return Array.isArray(value) ? [...value] : [];
    return value.toString();
  });
  
  const [isFirstKey, setIsFirstKey] = useState(true);

  // The props union guarantees these match `type`; narrow once here so the
  // handlers below stay readable.
  const emitNumber = onChange as (val: number) => void;
  const emitDates = onChange as (val: string[]) => void;

  // Sync back to parent for non-immediate types (delta, strike) with a debounce.
  // `onChange` is used directly rather than the narrowed `emitNumber`, which is
  // a fresh cast every render and so cannot be an honest dependency.
  useEffect(() => {
    if (type !== 'delta' && type !== 'strike') return;
    const timer = setTimeout(() => {
      const numeric = parseFloat(localValue as string);
      if (!isNaN(numeric)) {
        (onChange as (val: number) => void)(numeric);
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
  }, [isFirstKey]);

  const formatDateLabel = formatExpirationLabel;

  // Sub-components as local renders to avoid re-mounting logic issues
  const MonthsGrid = () => (
    <div className="flex-1 grid grid-cols-4 grid-rows-4 gap-0.5 p-0.5 bg-zinc-950/50 rounded-lg overflow-hidden min-h-0">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0].map(m => (
        <button 
          key={m}
          onClick={() => { emitNumber(m); onClose(); }}
          className={cn(
            "text-xl font-medium transition-colors flex items-center justify-center",
            value === m ? "bg-zinc-100 text-zinc-900 hover:bg-white" : "bg-zinc-900/40 hover:bg-zinc-800/60 text-white",
            m === 0 && "col-start-2 col-span-2"
          )}
        >
          {m}
        </button>
      ))}
    </div>
  );

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
    const presets = type === 'delta' 
      ? [0.10, 0.15, 0.20, 0.30, 0.40] 
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

        <div className="flex flex-wrap justify-center gap-1.5 p-3 bg-zinc-950/30">
          {presets.map((p: KeypadPreset) => (
             <button 
               key={typeof p === 'number' ? p : p.label}
               onClick={() => {
                 const val = typeof p === 'number' ? p : p.val;
                 setLocalValue(Math.abs(val).toFixed(2));
                 setIsFirstKey(false);
               }}
               className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-full text-[11px] font-bold text-zinc-300 active:bg-zinc-700 active:text-zinc-100 transition-colors"
             >
               {typeof p === 'number' ? p : `${p.label} ($${p.val.toFixed(2)})`}
             </button>
          ))}
        </div>

        <div className="px-6 py-2 flex flex-col items-center justify-center bg-zinc-950">
           <div className={cn(
             "text-3xl font-mono font-bold tracking-tighter transition-opacity",
             isFirstKey ? "text-zinc-600 opacity-60" : "text-white"
           )}>
             {type === 'strike' && <span className={cn(isFirstKey ? "text-zinc-800" : "text-zinc-700", "mr-2")}>$</span>}
             {type === 'delta' && <span className={cn(isFirstKey ? "text-zinc-800" : "text-zinc-700", "mr-0.5")}></span>}
             {localValue.toString()}
           </div>
        </div>

        <div className="flex-1 grid grid-cols-3 gap-0.5 p-0.5 bg-zinc-950/50">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'BACK'].map(k => (
            <button 
              key={k} 
              onClick={() => handleKey(k)}
              className="py-3.5 text-xl font-medium bg-zinc-900/40 hover:bg-zinc-800/60 active:bg-zinc-700/80 rounded flex items-center justify-center transition-colors"
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
        {type === 'months' ? (
          <div className="flex flex-col flex-1">
             <div className="flex items-center justify-between p-3 border-b border-zinc-800">
                <span className="text-[11px] font-semibold tracking-normal text-zinc-500">Expiry Selection</span>
                <button onClick={onClose} className="p-2 bg-zinc-900 rounded-full text-zinc-400"><X size={24} /></button>
             </div>
             <MonthsGrid />
          </div>
        ) : type === 'expirations' ? (
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
