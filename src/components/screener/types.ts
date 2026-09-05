import type { ScreenedOption } from '@/lib/optionChain';
import type { ComputedColumn } from '@/lib/formula';

export type SortConfig = {
  /** A ScreenedOption key, or the id of a computed column. */
  key: string | null;
  direction: 'asc' | 'desc' | null;
};

/**
 * One column, driving every layout that shows a contract: the table, the card
 * list, and the single card the assistant can put in the conversation. Keeping
 * the definition here rather than beside the table lets the card import it
 * without importing the table.
 */
export interface Column {
  label: string;
  /** A ScreenedOption key, or a computed column id. */
  key: string;
  /** The sortable value. Computed columns return NaN for rows they cannot score. */
  value: (opt: ScreenedOption) => number | string;
  /** How the value reads in the table cell and the card. */
  format: (opt: ScreenedOption) => string;
  /**
   * Classes for the cell. A function when the styling depends on the value —
   * an assignment return can be a loss, and should not read as a gain.
   */
  cellClass?: string | ((opt: ScreenedOption) => string);
  /** Right-aligned, for the figures the screen is ranked on. */
  alignRight?: boolean;
  /** Set when the column came from a user formula, so it can be removed. */
  computed?: ComputedColumn;
}
