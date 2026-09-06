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
import { FIXED_SORT_KEYS } from '@/lib/assistant/tools';
import { describeFilter, parseCustomFilter, splitFilter } from '@/lib/filters';
import { compileFormula } from '@/lib/formula';
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

/** Company names for the tickers the cases use, so the screen is not always NVIDIA. */
const NAMES: Record<string, string> = {
  NVDA: 'NVIDIA Corporation',
  AAPL: 'Apple Inc.',
  TSLA: 'Tesla, Inc.',
  MSFT: 'Microsoft Corporation',
  AMD: 'Advanced Micro Devices, Inc.',
  SPY: 'SPDR S&P 500 ETF Trust',
  GOOGL: 'Alphabet Inc.',
};

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
    companyName: NAMES[ticker] ?? ticker,
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
  // The client dedupes a repeated screen, and rejects a card for a contract
  // that is not on it. Both change what the model does next, so both belong
  // here rather than being smoothed over with a cheerful "Done".
  let lastSummary: string | null = null;

  return {
    result(toolName, args) {
      const ticker =
        typeof args.ticker === 'string' && args.ticker ? args.ticker.toUpperCase() : 'NVDA';

      switch (toolName) {
        case 'applySettings': {
          const changes = Object.fromEntries(GUARDED.map((field) => [field, args[field]]));
          const retune = checkRetune(turn, changes);
          if (retune.message) return retune.message;
          const changed = Object.entries(changes)
            .filter(([, value]) => value != null)
            .map(([field, value]) => `${field} ${String(value)}`);
          if (changed.length === 0) {
            const current = screen(ticker);
            lastSummary = current;
            return `No settings changed. The current screen:\n\n${current}`;
          }
          // The whole screen, which is why the app tells the model not to read
          // it again afterwards.
          const summary = screen(ticker);
          lastSummary = summary;
          return `Set ${changed.join(', ')}.\n\n${summary}`;
        }
        case 'readScreen': {
          const summary = screen(ticker);
          if (summary === lastSummary) {
            return 'Unchanged since the screen you were given a moment ago — answer from that.';
          }
          lastSummary = summary;
          return summary;
        }
        case 'setSort': {
          // The client validates the key against the columns that exist and
          // says which those are. A harness that accepts any string never
          // measures the model inventing one.
          const key = String(args.key);
          if (!(FIXED_SORT_KEYS as readonly string[]).includes(key)) {
            return `No column "${key}". Sortable columns: ${FIXED_SORT_KEYS.join(', ')}.`;
          }
          return `Sorted by ${key} ${args.direction}`;
        }
        case 'setResultsView':
          return `Showing ${args.view}`;
        case 'askUser':
          return 'Asked. Wait for their answer — change nothing until they say.';
        case 'addCustomFilter': {
          // Validated by the app's own parser, and split per column the way
          // the app splits it. A harness that accepts everything never sees
          // the model write a filter the app would refuse.
          const parsed = parseCustomFilter(args);
          if (!parsed.ok) {
            return `Filter rejected: ${parsed.error}. Valid fields are the numeric columns; valid operators are gt, gte, lt, lte, eq, between.`;
          }
          const parts = splitFilter(parsed.filter);
          return parts.length === 1
            ? `Filter applied — ${describeFilter(parsed.filter)}`
            : `Applied as ${parts.length} separate filters, each removable on its own — ${parts
                .map(describeFilter)
                .join('; ')}`;
        }
        case 'addComputedColumn': {
          const compiled = compileFormula(String(args.expression ?? ''));
          if (!compiled.ok) return `Formula rejected: ${compiled.error}`;
          return `Added column "${String(args.name)}" = ${compiled.formula.source}, sorted by it`;
        }
        case 'showOptionCard': {
          const strike = Number(args.strike);
          const expiration = String(args.expiration);
          const found = ROWS.find(
            (r) => r.expiration === expiration && Math.abs(r.strike - strike) < 0.005
          );
          if (!found) {
            const choices = ROWS.slice(0, 8).map((o) => `${o.expiration} $${o.strike}`).join('; ');
            return `No contract on the current screen expires ${expiration} at a $${strike} strike. Pick one of these instead, exactly as written: ${choices}.`;
          }
          return `Card shown for the $${found.strike} strike expiring ${found.expiration}. Its figures are on screen — say only why this contract, not what its numbers are.`;
        }
        case 'showStockChart':
          return `${ticker} rose 8.4% over the range, from $212.50 to $230.36.`;
        default:
          return 'Done.';
      }
    },
  };
}
