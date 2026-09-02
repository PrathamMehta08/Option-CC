import { NextRequest, NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';
import { addMonths, isWithinInterval } from 'date-fns';
import { getStrategy } from '@/lib/strategies';
import { screenChain, type ExpirationInput } from '@/lib/screen';
import type { ScreenerResponse, YahooOptionChain, YahooOptionQuote } from '@/lib/optionChain';

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey'],
});

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const strategy = getStrategy(searchParams.get('strategy'));
  const ticker = searchParams.get('ticker')?.toUpperCase() || 'AAPL';
  const capital = parseFloat(searchParams.get('capital') || '10000');
  const minMonths = parseInt(searchParams.get('minMonths') || String(strategy.defaults.minMonths));
  const maxMonths = parseInt(searchParams.get('maxMonths') || String(strategy.defaults.maxMonths));

  // The UI and the assistant both speak in delta magnitude; the strategy turns
  // that into the signed window (calls positive, puts negative).
  const deltaMagnitude = Math.abs(
    parseFloat(searchParams.get('delta') || String(strategy.defaults.deltaMagnitude))
  );

  try {
    // 1. Get current price
    const quote = await yahooFinance.quote(ticker);
    if (!quote || !quote.regularMarketPrice) {
      return NextResponse.json({ error: `Ticker ${ticker} not found` }, { status: 404 });
    }
    const currentPrice = quote.regularMarketPrice;

    // 2. Get available expirations
    const optionMetaData = await yahooFinance.options(ticker);
    if (!optionMetaData || !optionMetaData.expirationDates) {
      return NextResponse.json({ error: 'No options data found' }, { status: 404 });
    }

    const today = new Date();
    const minDate = addMonths(today, minMonths);
    const maxDate = addMonths(today, maxMonths);

    const validExpirations = optionMetaData.expirationDates.filter((expDate: Date) =>
      isWithinInterval(expDate, { start: minDate, end: maxDate })
    );

    if (validExpirations.length === 0) {
      const empty: ScreenerResponse = {
        ticker,
        strategy: strategy.id,
        currentPrice,
        options: [],
        affordableCount: 0,
        minCapitalRequired: 0,
        message: 'No expirations found in the selected range.',
      };
      return NextResponse.json(empty);
    }

    // 3. Fetch chains in parallel
    const chainsResults = await Promise.all(
      validExpirations.map(async (expDate: Date) => {
        try {
          const chain = await yahooFinance.options(ticker, { date: expDate });
          return { expDate, chain };
        } catch (err) {
          console.error(`Error fetching chain for ${expDate}:`, err);
          return null;
        }
      })
    );

    // 4. Screen. All strategy-specific behaviour lives behind the strategy.
    const expirations: ExpirationInput[] = [];
    for (const res of chainsResults) {
      if (!res?.chain?.options?.length) continue;

      const { expDate, chain } = res;
      const board = chain.options[0] as unknown as YahooOptionChain;
      const contracts: YahooOptionQuote[] = board[strategy.chainSide] ?? [];

      expirations.push({
        expiration: expDate.toISOString().split('T')[0],
        daysToExpiration: Math.max(1, Math.ceil((expDate.getTime() - today.getTime()) / MS_PER_DAY)),
        contracts,
      });
    }

    const rows = screenChain(expirations, {
      strategy,
      currentPrice,
      capital,
      deltaMagnitude,
    });

    const body: ScreenerResponse = {
      ticker,
      strategy: strategy.id,
      currentPrice,
      options: rows,
      affordableCount: rows.filter((r) => r.maxContracts > 0).length,
      minCapitalRequired: rows.length
        ? Math.min(...rows.map((r) => r.capitalRequiredPerContract))
        : 0,
    };
    return NextResponse.json(body);
  } catch (error: unknown) {
    console.error('API Error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
