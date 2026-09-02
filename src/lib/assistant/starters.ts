/**
 * Example prompts, grouped by capability.
 *
 * Shared by the assistant's empty state and the sidebar's Examples section, so
 * the two cannot drift. Every prompt maps onto a tool the model actually has —
 * an example that does not work is worse than no example.
 */
export interface StarterGroup {
  title: string;
  /** Short note on what this group of prompts is for. */
  hint: string;
  prompts: string[];
}

export const STARTERS: StarterGroup[] = [
  {
    title: 'Set up a scan',
    hint: 'Pick the underlying and how much you are working with.',
    prompts: ['Show me NVDA', 'Set my capital to $25k', 'Nothing past 3 months'],
  },
  {
    title: 'Narrow it down',
    hint: 'Filter on any numeric column.',
    prompts: ['Only IV above 50', 'Open interest over 1000', 'Around a 20 delta'],
  },
  {
    title: 'Rank it',
    hint: 'Sort by any column, including superlatives.',
    prompts: ['Sort by annualized return', 'Cheapest premium first'],
  },
  {
    title: 'Score it with your own formula',
    hint: 'Arithmetic over the columns becomes a new sortable column.',
    prompts: [
      'Sort by oi^2 + ann return^2',
      'Add a column for yield per day',
      'Score by premium times open interest',
    ],
  },
  {
    title: 'Chain several at once',
    hint: 'One message can drive the whole screen.',
    prompts: [
      'NVDA, 20k capital, 30 delta, within 3 months',
      'AAPL with IV over 40, then sort by yield',
    ],
  },
];
