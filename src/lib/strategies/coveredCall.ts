import { calculateCallDelta } from '@/lib/math';
import type { StrategyDefinition } from './types';

/**
 * Covered call: you already own 100 shares and sell a call against them.
 * Capital tied up is the cost of the shares at the current market price, so it
 * is the same for every strike on the board.
 */
export const coveredCall: StrategyDefinition = {
  id: 'covered-call',
  chainSide: 'calls',

  capitalRequiredPerContract: (_quote, currentPrice) => currentPrice * 100,

  // Assigned means the shares are called away at the strike.
  assignmentGainPerShare: (quote, currentPrice) => quote.strike - currentPrice,

  delta: calculateCallDelta,

  // The whole chain is shown; ITM calls are a legitimate (if aggressive) covered
  // call, so nothing is screened out here.
  isEligible: () => true,

  // Call deltas are positive: a 0.3 magnitude means "no more than a 30 delta".
  deltaWindow: (magnitude) => [0, Math.abs(magnitude)],

  defaults: {
    deltaMagnitude: 0.3,
    strikeRange: [0, 5000],
    minMonths: 0,
    maxMonths: 6,
  },

  copy: {
    name: 'Covered Calls',
    heading: 'Covered Call Analyzer',
    tableTitle: 'Best Covered Call Opportunities',
    seriesName: 'Calls',
    capitalColumnLabel: 'Stock Cost',
    deltaLabel: 'Max Delta',
    emptyHint: 'covered call opportunities.',
    assistantSubtitle: 'Covered Calls',
  },
};
