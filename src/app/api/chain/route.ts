import { NextRequest, NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';
import { trimQuote, type ChainResponse, type RawExpiration } from '@/lib/chain';
import type { YahooOptionChain } from '@/lib/optionChain';

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey'],
});

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * The whole option board for one ticker: both sides, every expiration.
 *
 * Deliberately takes no filter parameters. Capital, delta, months, strike and
 * strategy are all pure functions of this payload, so they belong on the client
 * where they cost nothing. Yahoo gets hit once per ticker instead of once per
 * keystroke.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get('ticker')?.toUpperCase().trim();

  if (!ticker) {
    return NextResponse.json({ error: 'A ticker is required' }, { status: 400 });
  }

  try {
    const quote = await yahooFinance.quote(ticker);
    if (!quote || !quote.regularMarketPrice) {
      return NextResponse.json({ error: `Ticker ${ticker} not found` }, { status: 404 });
    }

    const meta = await yahooFinance.options(ticker);
    if (!meta || !meta.expirationDates?.length) {
      return NextResponse.json({ error: `No options listed for ${ticker}` }, { status: 404 });
    }

    const fetchedAt = new Date();

    // Every expiration, not a window. The client narrows it, and re-narrowing
    // is what used to cost a round trip.
    const boards = await Promise.all(
      meta.expirationDates.map(async (expDate: Date) => {
        try {
          const chain = await yahooFinance.options(ticker, { date: expDate });
          const board = chain?.options?.[0] as unknown as YahooOptionChain | undefined;
          if (!board) return null;

          const expiration: RawExpiration = {
            expiration: expDate.toISOString().split('T')[0],
            daysToExpiration: Math.max(
              1,
              Math.ceil((expDate.getTime() - fetchedAt.getTime()) / MS_PER_DAY)
            ),
            calls: (board.calls ?? []).map(trimQuote),
            puts: (board.puts ?? []).map(trimQuote),
          };
          return expiration;
        } catch (err) {
          // One bad expiration should not lose the other twenty.
          console.error(`Chain fetch failed for ${ticker} @ ${expDate.toISOString()}:`, err);
          return null;
        }
      })
    );

    const expirations = boards
      .filter((b): b is RawExpiration => b !== null && (b.calls.length > 0 || b.puts.length > 0))
      .sort((a, b) => a.daysToExpiration - b.daysToExpiration);

    const body: ChainResponse = {
      ticker,
      companyName: quote.longName || quote.shortName || quote.displayName || ticker,
      currentPrice: quote.regularMarketPrice,
      fetchedAt: fetchedAt.toISOString(),
      expirations,
    };
    return NextResponse.json(body);
  } catch (error: unknown) {
    console.error('Chain API error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
