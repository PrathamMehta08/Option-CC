/**
 * What the harness hands back when the model calls a tool.
 *
 * It used to hand back the literal string "Done". That is not what the app
 * says, and the difference changed the answers: applySettings really returns
 * the whole screen — its own description tells the model "do NOT call
 * readScreen after it" — so a model told only "Done" concludes it has no data
 * and reads the screen next.
 *
 * The results are built from the SAME describeScreen the app uses, and the
 * refusals from the SAME checkRetune, because a harness that reimplements the
 * app measures the reimplementation. Both divergences have already cost a run:
 * the app refuses a setting changed twice in a turn, the harness let it
 * through, and cases failed for behaviour the shipped code blocks.
 */
import { describeScreen } from '@/lib/assistant/screenSummary';
import { checkRetune, newTurn, type TurnEdits } from '@/lib/assistant/turnEdits';
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

/** The settings applySettings guards against being re-tuned, as the client does. */
const GUARDED = [
  'ticker',
  'capital',
  'minMonths',
  'maxMonths',
  'delta',
  'minStrike',
  'maxStrike',
  'minStrikePctOfSpot',
  'maxStrikePctOfSpot',
  'strategy',
] as const;

export interface ToolRuntime {
  result(toolName: string, args: Record<string, unknown>): string;
}

/** One turn's worth of tool results, with the turn's own memory. */
export function createToolRuntime(): ToolRuntime {
  const turn: TurnEdits = newTurn();

  return {
    result(toolName, args) {
      const ticker =
        typeof args.ticker === 'string' && args.ticker ? args.ticker.toUpperCase() : 'NVDA';

      switch (toolName) {
        case 'applySettings': {
          const changes = Object.fromEntries(GUARDED.map((field) => [field, args[field]]));
          const retune = checkRetune(turn, changes);
          if (retune.message) return retune.message;
          // The whole screen, which is why the app tells the model not to read
          // it again afterwards.
          return `Settings applied.\n\n${screen(ticker)}`;
        }
        case 'readScreen':
          return screen(ticker);
        case 'askUser':
          return 'Asked. Wait for their answer — change nothing until they say.';
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
    },
  };
}
