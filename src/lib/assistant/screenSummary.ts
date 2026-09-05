import type { ScreenedOption, ScreenerResponse } from '@/lib/optionChain';
import { describeFilter, type CustomFilter } from '@/lib/filters';
import { explainEmptyScreen } from './emptyScreen';
import type { ComputedColumn } from '@/lib/formula';

/**
 * What the assistant can see.
 *
 * Every other tool only changes a setting and replies with a confirmation, so
 * without this the model has never been shown a single number — it cannot say
 * what the underlying last traded at except by inventing it, which the prompt
 * rightly forbids. This is the one tool that hands data back.
 *
 * Deliberately a summary rather than the chain: 400+ rows would swamp the
 * context and cost more per call than the rest of the conversation together.
 */
export interface ScreenState {
  data: ScreenerResponse | null;
  loading: boolean;
  visible: ScreenedOption[];
  /** "Apple Inc.", not "AAPL" — the model is asked for the company by name. */
  companyName: string | null;
  strategyName: string;
  /** Table or cards, so the assistant knows what it is describing. */
  resultsView: 'table' | 'cards';
  capital: string;
  minMonths: number;
  maxMonths: number;
  deltaSign: string;
  deltaMagnitude: number;
  strikeFilter: [number, number];
  /** Which expirations are ticked, so an empty screen can be explained exactly. */
  selectedExpirations: string[];
  customFilters: CustomFilter[];
  computedColumns: ComputedColumn[];
  sort: { key: string | null; direction: 'asc' | 'desc' | null };
}

/** How many rows to quote. Enough to answer "which is best", not a data dump. */
const TOP_ROWS = 5;

export function describeScreen(s: ScreenState): string {
  if (!s.data) {
    return 'Nothing is loaded yet — no ticker has been scanned. Use setTicker first, then read again.';
  }

  const lines: string[] = [];
  if (s.loading) {
    lines.push('A scan is running; these figures are from the previous one.');
  }

  lines.push(
    `Underlying: ${s.companyName ?? s.data.ticker} (${s.data.ticker}), last price $${s.data.currentPrice.toFixed(2)}.`,
    `Strategy: ${s.strategyName}. Capital: $${s.capital}. Results shown as ${s.resultsView}.`,
    `Scan returned ${s.data.options.length} contracts; ${s.visible.length} shown after filters.`,
    `Settings: ${s.minMonths}-${s.maxMonths} months to expiry, delta limit ${s.deltaSign}${s.deltaMagnitude}, strikes $${s.strikeFilter[0]}-$${s.strikeFilter[1]}.`
  );

  if (s.data.affordableCount === 0 && s.data.options.length > 0) {
    // Spelled out against the row count, because "covers 0 contracts" on its
    // own reads as "the screen is empty" — and was reported that way. The rows
    // are there; they are just out of reach.
    lines.push(
      `All ${s.visible.length} rows are still listed and their returns are real, ` +
        `but the capital affords none of them: the cheapest needs $${Math.round(
          s.data.minCapitalRequired
        ).toLocaleString()}.`
    );
  }

  if (s.customFilters.length > 0) {
    lines.push(`Active filters: ${s.customFilters.map(describeFilter).join('; ')}.`);
  }
  if (s.computedColumns.length > 0) {
    lines.push(
      `Computed columns: ${s.computedColumns.map((c) => `${c.name} = ${c.source}`).join('; ')}.`
    );
  }

  lines.push(
    s.sort.key && s.sort.direction
      ? `Sorted by ${s.sort.key} ${s.sort.direction}.`
      : 'Sorted by annualized return, highest first (the default).'
  );

  const top = s.visible.slice(0, TOP_ROWS);
  if (top.length === 0) {
    lines.push('No rows match the current filters.');
    // Which filter, specifically, and what was on offer behind it. Without
    // this the model guesses a list of three and is disbelieved.
    const why = explainEmptyScreen({
      options: s.data.options,
      strikeFilter: s.strikeFilter,
      selectedExpirations: s.selectedExpirations,
      customFilters: s.customFilters,
    });
    if (why) lines.push(why, 'Say which filter is responsible and what range is actually available. Do not guess at a list of possible causes.');
  } else {
    // Said explicitly because the model was hedging about whether these were
    // really the leaders — and for a while it was right to, since the list it
    // got was ordered differently from the table. It is the same order now.
    lines.push(
      `The ${top.length} best rows of all ${s.visible.length}, in that exact order — the first IS the top one:`
    );
    for (const o of top) {
      lines.push(
        `  ${o.expiration} (${o.daysToExpiration}d) $${o.strike} strike — ` +
          `premium $${o.lastPrice.toFixed(2)} ($${o.premiumPerContract.toFixed(0)}/contract), ` +
          `delta ${o.delta.toFixed(3)}, IV ${o.iv.toFixed(1)}%, ` +
          `moneyness ${o.moneyness.toFixed(1)}%, OI ${o.openInterest}, ` +
          `annualized ${o.annualizedReturn.toFixed(2)}%, ` +
          `if assigned ${o.annualizedReturnWithGain.toFixed(2)}%` +
          (o.maxContracts > 0
            ? `, ${o.maxContracts} affordable for $${Math.round(o.totalCapitalRequired).toLocaleString()} collecting $${o.totalPremiumReceived.toFixed(0)}`
            : ', not affordable')
      );
    }
  }

  return lines.join('\n');
}
