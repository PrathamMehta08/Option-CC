import type { ScreenedOption } from '@/lib/optionChain';
import type { Column, SortConfig } from './types';

/**
 * Put rows in the order the user asked for.
 *
 * This exists as one shared function because it used to exist as none: the
 * table sorted its own copy, while the page handed the assistant the list
 * straight from the screener, still in its default annualized-return order. So
 * "sort by ann. if assigned and give me the top one" reordered the table and
 * left the assistant reading a different ranking — it would confidently name a
 * contract that was nowhere near the top of what the user was looking at, and
 * sometimes near the bottom. The summary even stated the sort it was not using.
 *
 * Pure and total: unknown keys leave the order alone rather than scrambling it.
 */
export function sortOptions(
  options: ScreenedOption[],
  sortConfig: SortConfig,
  byKey: Record<string, Column>
): ScreenedOption[] {
  if (!sortConfig.key || !sortConfig.direction) return options;

  const column = byKey[sortConfig.key];
  if (!column) return options;

  const read = column.value;
  const ascending = sortConfig.direction === 'asc';

  return [...options].sort((a, b) => {
    const aVal = read(a);
    const bVal = read(b);
    // A row a formula could not score sinks to the bottom either way: it is an
    // absence of a value, not a small one.
    const aNaN = typeof aVal === 'number' && Number.isNaN(aVal);
    const bNaN = typeof bVal === 'number' && Number.isNaN(bVal);
    if (aNaN && bNaN) return 0;
    if (aNaN) return 1;
    if (bNaN) return -1;
    if (aVal < bVal) return ascending ? -1 : 1;
    if (aVal > bVal) return ascending ? 1 : -1;
    return 0;
  });
}
