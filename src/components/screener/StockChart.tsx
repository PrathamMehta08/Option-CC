'use client';

import React, { memo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/ui';
import { RANGE_LABEL, type HistoryResponse } from '@/lib/history';

/** A date the way a chart axis wants it: "Sep 4". */
function axisDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * A price chart inside the conversation.
 *
 * Deliberately small and self-explaining: it sits in a chat bubble, so it has
 * to say what it is without a caption. Green when the period is up, amber when
 * it is down — the same signed treatment the table's returns use.
 */
export const StockChart = memo(function StockChart({ history }: { history: HistoryResponse }) {
  const up = history.changePct >= 0;
  const colour = up ? 'var(--a1)' : 'var(--warn)';
  const gradientId = `stock-${history.ticker}-${history.range}`;

  return (
    <div className="rounded-lg border border-line bg-bg-2 p-3 space-y-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-bold text-fg">{history.companyName}</p>
          <p className="font-mono text-[11px] text-faint">
            {history.ticker} · {RANGE_LABEL[history.range]}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-sm font-bold tabular-nums text-fg">
            ${history.last.toFixed(2)}
          </p>
          <p
            className={cn(
              'font-mono text-[11px] tabular-nums',
              up ? 'text-a1' : 'text-warn'
            )}
          >
            {up ? '+' : ''}
            {history.changePct.toFixed(1)}%
          </p>
        </div>
      </div>

      <div className="h-[130px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={history.points} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colour} stopOpacity={0.35} />
                <stop offset="100%" stopColor={colour} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tickFormatter={axisDate}
              stroke="#3f3f46"
              fontSize={9}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#52525b' }}
              minTickGap={28}
            />
            <YAxis
              // The point of a price chart is the shape of the move, which a
              // zero-based axis flattens into a straight line.
              domain={['dataMin', 'dataMax']}
              stroke="#3f3f46"
              fontSize={9}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#52525b' }}
              width={44}
              tickFormatter={(v: number) => `$${v.toFixed(0)}`}
            />
            <Tooltip
              cursor={{ stroke: colour, strokeOpacity: 0.3 }}
              contentStyle={{
                background: 'rgba(0,0,0,0.95)',
                border: '1px solid var(--line)',
                borderRadius: 8,
                fontSize: 11,
              }}
              labelFormatter={(label) => axisDate(String(label))}
              formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Close']}
            />
            <Area
              type="monotone"
              dataKey="close"
              stroke={colour}
              strokeWidth={1.5}
              fill={`url(#${gradientId})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <p className="font-mono text-[11px] text-faint">
        low ${history.low.toFixed(2)} · high ${history.high.toFixed(2)} · closing prices
      </p>
    </div>
  );
});
