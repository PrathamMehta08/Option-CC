import type { ScreenedOption } from '@/lib/optionChain';
import { describeFilter, matchesFilter, type CustomFilter } from '@/lib/filters';

/**
 * Why an empty screen is empty.
 *
 * "No covered-call contracts for AAPL satisfy the IV > 40 filter, so there's
 * nothing to rank. Lower the IV threshold, broaden the expiry range, or relax
 * the delta limit" — three guesses, one of them right, and the user reasonably
 * did not believe any of them, because AAPL does have 684 calls above 40% IV.
 * None of them were in a 6-12 month window at 115% of spot, where the highest
 * IV is 33.5%. That single number ends the argument; the guess-list starts one.
 *
 * So the app works it out rather than asking the model to speculate: drop each
 * filter in turn, and see which one was holding the door shut.
 */

interface Blocker {
  label: string;
  /** Rows that would show if this filter alone were dropped. */
  remaining: number;
  /** The range actually available for a single-condition numeric filter. */
  detail: string | null;
}

export interface EmptyScreenInput {
  /** Rows before the strike, expiration and custom filters — data.options. */
  options: ScreenedOption[];
  strikeFilter: [number, number];
  selectedExpirations: string[];
  customFilters: CustomFilter[];
}

export function explainEmptyScreen(input: EmptyScreenInput): string | null {
  const { options, strikeFilter, selectedExpirations, customFilters } = input;
  // Nothing to explain: the scan itself came back empty, which is a different
  // problem with a different answer.
  if (options.length === 0) return null;

  const tests: { label: string; test: (o: ScreenedOption) => boolean; filter?: CustomFilter }[] = [
    {
      label: `the strike range $${strikeFilter[0]}-$${strikeFilter[1]}`,
      test: (o) => o.strike >= strikeFilter[0] && o.strike <= strikeFilter[1],
    },
    {
      label: 'the expiration selection',
      test: (o) => selectedExpirations.includes(o.expiration),
    },
    ...customFilters.map((filter) => ({
      label: describeFilter(filter),
      test: (o: ScreenedOption) => matchesFilter(o, filter),
      filter,
    })),
  ];

  // If something is visible, there is nothing to explain.
  if (options.some((o) => tests.every((t) => t.test(o)))) return null;

  const blockers: Blocker[] = [];
  for (const held of tests) {
    const others = tests.filter((t) => t !== held);
    const passing = options.filter((o) => others.every((t) => t.test(o)));
    if (passing.length > 0) {
      blockers.push({
        label: held.label,
        remaining: passing.length,
        detail: held.filter ? availableRange(passing, held.filter) : null,
      });
    }
  }

  if (blockers.length === 0) {
    return (
      `Nothing matches, and no single filter is responsible — it is the combination. ` +
      `${options.length} contracts were scanned; every one of them is excluded by two or more filters at once.`
    );
  }

  // One culprit is the common case and the useful one: name it and say what
  // was actually available, so the next request can be a real number.
  return blockers
    .map(
      (b) =>
        `Nothing matches because of ${b.label}: ${b.remaining} contract${
          b.remaining === 1 ? ' passes' : 's pass'
        } every other filter, and dropping this one would show ${
          b.remaining === 1 ? 'it' : 'them'
        }` +
        (b.detail
          ? b.remaining === 1
            ? `, but ${b.detail}`
            : `. Among those ${b.remaining}, ${b.detail}`
          : '') +
        '.'
    )
    .join(' ');
}

/**
 * What the blocked column actually ranges over, for a filter that is one
 * comparison on one column. "the highest IV among them is 33.5%" is the whole
 * answer; "try lowering it" is not.
 */
function availableRange(rows: ScreenedOption[], filter: CustomFilter): string | null {
  if (filter.conditions.length !== 1) return null;
  const { field } = filter.conditions[0];
  const values = rows
    .map((row) => row[field])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (values.length === 0) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const round = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
  if (values.length === 1) return `its ${field} is ${round(low)}`;
  return low === high
    ? `${field} is ${round(low)} for all of them`
    : `${field} runs from ${round(low)} to ${round(high)}`;
}
