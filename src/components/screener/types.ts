export type SortConfig = {
  /** A ScreenedOption key, or the id of a computed column. */
  key: string | null;
  direction: 'asc' | 'desc' | null;
};
