import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey'],
});

async function test() {
  const ticker = 'NVDA';
  try {
    const quote = await yahooFinance.quote(ticker);
    console.log('Current Price:', quote.regularMarketPrice);

    const optionMetaData = await yahooFinance.options(ticker);
    const expDate = optionMetaData.expirationDates[0];
    console.log('First Expiration:', expDate);

    const chain = await yahooFinance.options(ticker, { date: expDate });
    console.log('Chain Options Count:', chain.options.length);
    const calls = chain.options[0].calls;
    console.log('Calls found:', calls.length);
    console.log('First Call:', JSON.stringify(calls[0], null, 2));
    
    // Check for some strikes near current price
    const nearby = calls.filter(c => Math.abs(c.strike - quote.regularMarketPrice) < 20);
    console.log('Nearby Calls:', JSON.stringify(nearby.slice(0, 3), null, 2));

  } catch (err) {
    console.error(err);
  }
}

test();
