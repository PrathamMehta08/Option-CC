/**
 * What the harness hands back when the model calls a tool.
 *
 * It used to hand back the literal string "Done". That is not what the app
 * says, and the difference changed the answers: applySettings really returns
 * the whole screen — its own description tells the model "do NOT call
 * readScreen after it" — so a model told only "Done" concludes it has no data
 * and reads the screen next. The grader counts that second call as a change the
 * user did not ask for, and marks "show me AAPL" wrong for a model that did
 * exactly the right thing.
 *
 * So the results are built from the SAME describeScreen the app uses. A summary
 * written out by hand here would drift from the real one, which is how the
 * harness came to be measuring something the app does not do.
 */
import { describeScreen } from '@/lib/assistant/screenSummary';
import type { ScreenedOption, ScreenerResponse } from '@/lib/optionChain';

function row(strike: number, expiration: string, over: Partial<ScreenedOption> = {}): ScreenedOption {
  return {
    expiration,
    daysToExpiration: 45,
    strike,
    lastPrice: 3.4,
    high: 3.6,
    delta: 0.28,
    iv: 34.2,
    moneyness: 6.1,
    openInterest: 2400,
    volume: 310,
    capitalRequiredPerContract: 23036,
    premiumPerContract: 340,
    returnPct: 1.48,
    annualizedReturn: 12.0,
    returnWithGainPct: 4.9,
    annualizedReturnWithGain: 39.7,
    premiumSharePct: 30.2,
    totalProfitIfAssigned: 19876,
    maxContracts: 4,
    totalCapitalRequired: 92144,
    totalPremiumReceived: 1360,
    ...over,
  };
}

const ROWS = [
  row(265, '2027-03-19'),
  row(270, '2027-03-19', { annualizedReturn: 11.4, delta: 0.26 }),
  row(280, '2026-12-18', { annualizedReturn: 10.8, delta: 0.22 }),
  row(290, '2026-12-18', { annualizedReturn: 9.6, delta: 0.19 }),
  row(300, '2026-09-18', { annualizedReturn: 8.1, delta: 0.14 }),
];

function screen(ticker: string): string {
  const data: ScreenerResponse = {
    ticker,
    strategy: 'covered-call',
    currentPrice: 230.36,
    options: ROWS,
    affordableCount: ROWS.length,
    minCapitalRequired: 23036,
  };
  return describeScreen({
    data,
    loading: false,
    visible: ROWS,
    companyName: 'NVIDIA Corporation',
    strategyName: 'Covered Calls',
    resultsView: 'table',
    capital: '100,000',
    minMonths: 0,
    maxMonths: 12,
    deltaSign: '',
    deltaMagnitude: 0.3,
    strikeFilter: [5, 590],
    strikePct: { min: null, max: null },
    selectedExpirations: ['2026-09-18', '2026-12-18', '2027-03-19'],
    customFilters: [],
    computedColumns: [],
    sort: { key: null, direction: null },
  });
}

/** The result string for one tool call, shaped like the app's own. */
export function toolResult(toolName: string, args: Record<string, unknown>): string {
  const ticker = typeof args.ticker === 'string' && args.ticker ? args.ticker.toUpperCase() : 'NVDA';
  switch (toolName) {
    case 'applySettings':
      // The whole screen, which is why the app tells the model not to read it
      // again afterwards.
      return `Settings applied.\n\n${screen(ticker)}`;
    case 'readScreen':
      return screen(ticker);
    case 'addCustomFilter':
      return 'Filter applied.';
    case 'addComputedColumn':
      return 'Added the column, sorted by it.';
    case 'showOptionCard':
      return `Card shown for the $${args.strike} strike expiring ${args.expiration}. Its figures are on screen — say only why this contract.`;
    case 'showStockChart':
      return `${ticker} rose 8.4% over the range, from $212.50 to $230.36.`;
    default:
      return 'Done.';
  }
}
