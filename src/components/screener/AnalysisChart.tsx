'use client';

import React, { useState, useEffect, memo } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts';
import { Loader2, type LucideIcon } from 'lucide-react';
import type { ScreenedOption } from '@/lib/optionChain';

interface AnalysisChartProps {
  title: string;
  icon: LucideIcon;
  data: ScreenedOption[];
  xAxisKey: keyof ScreenedOption;
  xAxisName: string;
  yAxisKey: keyof ScreenedOption;
  yAxisName: string;
  unit?: string;
  color: string;
  seriesName: string;
}

export const AnalysisChart = memo(({ title, icon: Icon, data, xAxisKey, xAxisName, yAxisKey, yAxisName, unit, color, seriesName }: AnalysisChartProps) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  
  return (
  <div className="bg-zinc-950 border border-zinc-900 p-4 md:p-6 space-y-4 rounded-xl text-white font-sans">
    <h4 className="font-medium text-zinc-500 flex items-center gap-2 text-[10px] md:text-sm uppercase tracking-wider">
      <Icon size={14} /> {title}
    </h4>
    <div className="h-[250px] md:h-[300px] w-full">
      {mounted ? (
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#0a0a0a" vertical={false} />
            <XAxis type="number" dataKey={xAxisKey} name={xAxisName} stroke="#27272a" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis type="number" dataKey={yAxisKey} name={yAxisName} unit={unit} stroke="#27272a" fontSize={10} tickLine={false} axisLine={false} />
            <Tooltip 
              cursor={{ strokeDasharray: '3 3' }}
              contentStyle={{ background: '#000', border: '1px solid #18181b', borderRadius: '4px', fontSize: '10px' }}
              itemStyle={{ color }}
            />
            <Scatter name={seriesName} data={data}>
                {data.map((_entry, index: number) => (
                <Cell key={`cell-${index}`} fill={color} fillOpacity={0.6} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      ) : (
        <div className="w-full h-full bg-zinc-950/50 animate-pulse rounded-lg flex items-center justify-center">
          <Loader2 className="text-zinc-800 animate-spin" size={24} />
        </div>
      )}
    </div>
  </div>
);
});
AnalysisChart.displayName = 'AnalysisChart';
