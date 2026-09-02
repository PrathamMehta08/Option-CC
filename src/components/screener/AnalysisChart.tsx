'use client';

import React, { useMemo, useSyncExternalStore, memo } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  ZAxis,
} from 'recharts';
import { type LucideIcon } from 'lucide-react';
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

/** Compact axis labels: 1200 -> 1.2k, so the ticks stop colliding. */
function formatTick(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  if (abs > 0 && abs < 1) return value.toFixed(2);
  return value.toFixed(0);
}

interface TooltipPayload {
  payload: ScreenedOption;
}

/**
 * The default Recharts tooltip shows raw keys. This one reads like the table:
 * strike and expiry for identity, then the two plotted values.
 */
function ChartTooltip({
  active,
  payload,
  xAxisName,
  yAxisName,
  xAxisKey,
  yAxisKey,
  unit,
  color,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  xAxisName: string;
  yAxisName: string;
  xAxisKey: keyof ScreenedOption;
  yAxisKey: keyof ScreenedOption;
  unit?: string;
  color: string;
}) {
  if (!active || !payload?.length) return null;
  const option = payload[0].payload;
  const x = option[xAxisKey];
  const y = option[yAxisKey];

  return (
    <div className="rounded-lg border border-zinc-800 bg-black/95 px-3 py-2.5 shadow-xl backdrop-blur-sm">
      <p className="text-[11px] font-bold text-zinc-100 tracking-tight">
        ${option.strike.toFixed(2)}
        <span className="ml-2 font-mono text-[11px] font-normal text-zinc-500">
          {option.expiration}
        </span>
      </p>
      <dl className="mt-2 space-y-1">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-[11px] tracking-normal text-zinc-600">{xAxisName}</dt>
          <dd className="font-mono text-[11px] text-zinc-300">
            {typeof x === 'number' ? formatTick(x) : String(x)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-[11px] tracking-normal text-zinc-600">{yAxisName}</dt>
          <dd className="font-mono text-[11px] font-bold" style={{ color }}>
            {typeof y === 'number' ? y.toFixed(2) : String(y)}
            {unit}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export const AnalysisChart = memo(
  ({
    title,
    icon: Icon,
    data,
    xAxisKey,
    xAxisName,
    yAxisKey,
    yAxisName,
    unit,
    color,
    seriesName,
  }: AnalysisChartProps) => {
    // Recharts measures the DOM, so it cannot render on the server. This is the
    // effect-free way to ask "are we on the client yet": false through SSR and
    // hydration, true afterwards, with no extra render pass.
    const mounted = useSyncExternalStore(
      () => () => {},
      () => true,
      () => false
    );

    const gradientId = useMemo(
      () => `scatter-${String(yAxisKey)}-${String(xAxisKey)}`,
      [xAxisKey, yAxisKey]
    );

    // Dots scale with the annualized return so the good contracts read first.
    const returns = useMemo(() => data.map((d) => d.annualizedReturn), [data]);
    const maxReturn = returns.length ? Math.max(...returns) : 0;

    return (
      <div className="group relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 md:p-6 text-white font-sans transition-colors hover:border-zinc-800">
        {/* A wash of the series colour, so the two charts are distinguishable
            at a glance rather than by reading their titles. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 h-48 w-48 rounded-full opacity-[0.07] blur-3xl transition-opacity group-hover:opacity-[0.12]"
          style={{ background: color }}
        />

        <div className="relative space-y-4">
          <h4 className="flex items-center gap-2 text-xs font-bold tracking-normal text-zinc-500">
            <Icon size={13} style={{ color }} /> {title}
          </h4>

          <div className="h-[240px] md:h-[300px] w-full">
            {mounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 12, right: 12, bottom: 8, left: -12 }}>
                  <defs>
                    <radialGradient id={gradientId} cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor={color} stopOpacity={0.95} />
                      <stop offset="100%" stopColor={color} stopOpacity={0.35} />
                    </radialGradient>
                  </defs>

                  <CartesianGrid strokeDasharray="2 4" stroke="#18181b" vertical={false} />
                  <XAxis
                    type="number"
                    dataKey={xAxisKey}
                    name={xAxisName}
                    stroke="#3f3f46"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatTick}
                    tick={{ fill: '#52525b' }}
                    tickMargin={8}
                  />
                  <YAxis
                    type="number"
                    dataKey={yAxisKey}
                    name={yAxisName}
                    unit={unit}
                    stroke="#3f3f46"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatTick}
                    tick={{ fill: '#52525b' }}
                    width={52}
                  />
                  {/* Bubble size carries a third dimension: yield. */}
                  <ZAxis type="number" dataKey="annualizedReturn" range={[14, 90]} />
                  <Tooltip
                    cursor={{ stroke: color, strokeOpacity: 0.25, strokeDasharray: '3 3' }}
                    content={
                      <ChartTooltip
                        xAxisName={xAxisName}
                        yAxisName={yAxisName}
                        xAxisKey={xAxisKey}
                        yAxisKey={yAxisKey}
                        unit={unit}
                        color={color}
                      />
                    }
                  />
                  <Scatter name={seriesName} data={data}>
                    {data.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={`url(#${gradientId})`}
                        stroke={color}
                        strokeOpacity={
                          maxReturn > 0 ? 0.25 + 0.55 * (entry.annualizedReturn / maxReturn) : 0.3
                        }
                        strokeWidth={1}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            ) : (
              // Shaped like the chart it replaces, so the layout does not jump.
              <div className="flex h-full w-full items-end gap-1.5 rounded-lg px-2 pb-6">
                {Array.from({ length: 16 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex-1 animate-pulse rounded-sm bg-zinc-900"
                    style={{
                      height: `${25 + ((i * 37) % 60)}%`,
                      animationDelay: `${i * 40}ms`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
);
AnalysisChart.displayName = 'AnalysisChart';
