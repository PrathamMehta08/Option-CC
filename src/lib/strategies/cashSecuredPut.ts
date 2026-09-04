import { calculatePutDelta } from '@/lib/math';
import type { StrategyDefinition } from './types';

/**
 * Cash-secured put: you sell a put and hold enough cash to buy the shares if
 * assigned. Capital tied up is the strike times 100, so it varies by strike.
 */
export const cashSecuredPut: StrategyDefinition = {
  id: 'cash-secured-put',
  chainSide: 'puts',

  capitalRequiredPerContract: (quote) => quote.strike * 100,

  // Assignment buys stock at the strike rather than selling it, so there is no
  // gain to realise. The return if assigned is the premium alone, which is what
  // annualizedReturn already reports.
  assignmentGainPerShare: () => 0,

  otmDirection: 'below',

  delta: calculatePutDelta,

  // Out-of-the-money only: selling an ITM put means expecting assignment.
  isEligible: (quote, currentPrice) => quote.strike < currentPrice,

  // Put deltas are negative: a 0.3 magnitude means "no further than a -30 delta".
  deltaWindow: (magnitude) => [-Math.abs(magnitude), 0],

  defaults: {
    deltaMagnitude: 0.2,
    strikeRange: [0, 2000],
    minMonths: 0,
    maxMonths: 6,
  },

  copy: {
    name: 'Cash-Secured Puts',
    tableTitle: 'Best Cash-Secured Put Opportunities',
    seriesName: 'Puts',
    capitalColumnLabel: 'Total Cap',
    deltaLabel: 'Max Delta',
    emptyHint: 'cash-secured put opportunities.',
    assistantSubtitle: 'Cash-Secured Puts',
  },
};
