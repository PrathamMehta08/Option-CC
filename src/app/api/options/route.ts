import { NextRequest, NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';
import { addMonths, isWithinInterval } from 'date-fns';
import { getStrategy } from '@/lib/strategies';
import {
  annualizeReturn,
  contractReturnPct,
  effectivePremium,
  maxContractsFor,
  premiumPerContract,
} from '@/lib/returns';
import type {
  ScreenedOption,
  ScreenerResponse,
  YahooOptionChain,
  YahooOptionQuote,
} from '@/lib/optionChain';

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey'],
});

const RISK_FREE_RATE = 0.05;

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
  const [minDelta, maxDelta] = strategy.deltaWindow(deltaMagnitude);

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

    const rows: ScreenedOption[] = [];

    chainsResults.forEach((res) => {
      if (!res || !res.chain || !res.chain.options || res.chain.options.length === 0) return;

      const { expDate, chain } = res;
      const board = chain.options[0] as unknown as YahooOptionChain;
      const contracts: YahooOptionQuote[] = board[strategy.chainSide] ?? [];

      const expirationDateStr = expDate.toISOString().split('T')[0];
      const daysToExpiration = Math.max(
        1,
        Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      );
      const t = daysToExpiration / 365.0;

      contracts.forEach((contract) => {
        if (!strategy.isEligible(contract, currentPrice)) return;

        const sigma = contract.impliedVolatility || 0;
        const delta = strategy.delta(currentPrice, contract.strike, t, sigma, RISK_FREE_RATE);
        if (delta < minDelta || delta > maxDelta) return;

        const capitalRequired = strategy.capitalRequiredPerContract(contract, currentPrice);
        const premiumPerShare = effectivePremium(contract);

        // Per-contract economics. These are properties of the contract and must
        // not depend on how many the user can afford — that dependency is what
        // made every row read 0.00% whenever capital covered zero contracts.
        const premium = premiumPerContract(premiumPerShare);
        const returnPct = contractReturnPct(premium, capitalRequired);
        const annualizedReturnPct = annualizeReturn(returnPct, daysToExpiration);

        // Affordability is reported alongside, never folded into the returns.
        const maxContracts = maxContractsFor(capital, capitalRequired);
        const totalCapitalRequired = maxContracts * capitalRequired;
        const totalPremiumReceived = maxContracts * premium;

        rows.push({
          expiration: expirationDateStr,
          daysToExpiration,
          strike: contract.strike,
          lastPrice: premiumPerShare,
          high: contract.ask ?? premiumPerShare,
          delta,
          iv: sigma * 100,
          moneyness: ((contract.strike - currentPrice) / currentPrice) * 100,
          openInterest: contract.openInterest || 0,
          volume: contract.volume || 0,
          capitalRequiredPerContract: capitalRequired,
          premiumPerContract: premium,
          returnPct,
          annualizedReturn: annualizedReturnPct,
          maxContracts,
          totalCapitalRequired,
          totalPremiumReceived,
        });
      });
    });

    rows.sort((a, b) => b.annualizedReturn - a.annualizedReturn);

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
