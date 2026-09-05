import { NextRequest, NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';
import { CHART_RANGES, type ChartRange, type HistoryResponse } from '@/lib/history';

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey'],
});

/** How far back each range reaches, and how finely it is sampled. */
const RANGE_SPEC: Record<ChartRange, { days: number; interval: '1d' | '1wk' }> = {
  '1mo': { days: 31, interval: '1d' },
  '3mo': { days: 92, interval: '1d' },
  '6mo': { days: 183, interval: '1d' },
  '1y': { days: 366, interval: '1d' },
  '5y': { days: 1827, interval: '1wk' },
};

/**
 * Daily closes for one ticker, for a chart in the assistant panel.
 *
 * Separate from /api/chain because it answers a different question and is asked
 * far less often — folding it in would make every screener load pay for price
 * history nothing on the page draws.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get('ticker')?.toUpperCase().trim();
  const rangeParam = searchParams.get('range') ?? '6mo';

  if (!ticker) {
    return NextResponse.json({ error: 'A ticker is required' }, { status: 400 });
  }
  if (!CHART_RANGES.includes(rangeParam as ChartRange)) {
    return NextResponse.json(
      { error: `Range must be one of ${CHART_RANGES.join(', ')}` },
      { status: 400 }
    );
  }
  const range = rangeParam as ChartRange;

  try {
    const { days, interval } = RANGE_SPEC[range];
    const period1 = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [quote, chart] = await Promise.all([
      yahooFinance.quote(ticker),
      yahooFinance.chart(ticker, { period1, interval }),
    ]);

    const points = (chart?.quotes ?? [])
      .filter((q): q is typeof q & { close: number } => typeof q.close === 'number')
      .map((q) => ({
        // Date only: the chart's x-axis is days, and the time adds bytes for
        // nothing. A weekly interval still lands on a single day.
        date: new Date(q.date).toISOString().split('T')[0],
        close: Number(q.close.toFixed(4)),
      }));

    if (points.length === 0) {
      return NextResponse.json({ error: `No price history for ${ticker}` }, { status: 404 });
    }

    const closes = points.map((p) => p.close);
    const first = closes[0];
    const last = closes[closes.length - 1];

    const body: HistoryResponse = {
      ticker,
      companyName: quote?.longName || quote?.shortName || ticker,
      range,
      points,
      first,
      last,
      low: Math.min(...closes),
      high: Math.max(...closes),
      // Percent change across the window, which is what a reader takes from a
      // price chart before they read any individual point.
      changePct: first > 0 ? ((last - first) / first) * 100 : 0,
      currency: quote?.currency ?? 'USD',
    };
    return NextResponse.json(body);
  } catch (error: unknown) {
    console.error('History API error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
