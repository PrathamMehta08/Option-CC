import { NextRequest, NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';
import { calculatePutDelta, calculateCallDelta } from '@/lib/math';
import { addMonths, isWithinInterval } from 'date-fns';

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey'],
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get('ticker')?.toUpperCase() || 'AAPL';
  const capital = parseFloat(searchParams.get('capital') || '10000');
  const minMonths = parseInt(searchParams.get('minMonths') || '0');
  const maxMonths = parseInt(searchParams.get('maxMonths') || '6');
  const minDelta = parseFloat(searchParams.get('minDelta') || '0.0');
  const maxDelta = parseFloat(searchParams.get('maxDelta') || '0.5');

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

    // Filter expirations within the window
    const validExpirations = optionMetaData.expirationDates.filter((expDate: Date) => {
      return isWithinInterval(expDate, { start: minDate, end: maxDate });
    });

    if (validExpirations.length === 0) {
      return NextResponse.json({ 
        ticker, 
        currentPrice, 
        options: [], 
        message: 'No expirations found in the selected range.' 
      });
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

    const allCalls: any[] = [];
    const riskFreeRate = 0.05;

    chainsResults.forEach((res) => {
      if (!res || !res.chain || !res.chain.options || res.chain.options.length === 0) return;
      
      const { expDate, chain } = res;
      const calls = chain.options[0].calls; 
      const expirationDateStr = expDate.toISOString().split('T')[0];
      const daysToExpiration = Math.max(1, Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
      const t = daysToExpiration / 365.0;

      calls.forEach((call: any) => {
        // No longer filtering by OTM/ITM to show "everything" as requested
        // if (call.strike < currentPrice * 0.98) return;

        // For Covered Calls, capital required is the cost to buy 100 shares at market price
        const capitalRequired = currentPrice * 100;
        const maxContracts = Math.floor(capital / capitalRequired);

        // Calculate Delta for all calls
        const sigma = call.impliedVolatility || 0;
        const daysToExpiration = Math.max(1, Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
        const t = daysToExpiration / 365.0;
        const delta = calculateCallDelta(currentPrice, call.strike, t, sigma, riskFreeRate);

        // Filter by Delta (now treating maxDelta as the upper bound for Covered Call safety)
        if (delta > (maxDelta || 1.0)) return;
        if (delta < minDelta) return;

        // Use bid/ask for premium received if available, otherwise fallback to lastPrice
        const midPrice = (call.bid && call.ask) ? (call.bid + call.ask) / 2 : call.lastPrice;
        const premiumToUse = (call.bid !== undefined && call.bid > 0) ? call.bid : (midPrice || 0);

        const totalCapitalRequired = maxContracts * capitalRequired;
        const totalPremiumReceived = maxContracts * premiumToUse * 100;
        const returnPct = totalCapitalRequired > 0 ? (totalPremiumReceived / totalCapitalRequired) * 100 : 0;
        const annualizedReturnPct = daysToExpiration > 0 ? returnPct * (365 / daysToExpiration) : 0;

        allCalls.push({
          expiration: expirationDateStr,
          daysToExpiration,
          strike: call.strike,
          lastPrice: premiumToUse,
          high: call.ask, 
          delta,
          iv: sigma * 100,
          moneyness: ((call.strike - currentPrice) / currentPrice) * 100,
          openInterest: call.openInterest || 0,
          volume: call.volume || 0,
          maxContracts,
          totalCapitalRequired,
          totalPremiumReceived,
          annualizedReturn: annualizedReturnPct
        });
      });
    });

    // Sort by annualized return descending
    allCalls.sort((a, b) => b.annualizedReturn - a.annualizedReturn);

    return NextResponse.json({
      ticker,
      currentPrice,
      options: allCalls
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
