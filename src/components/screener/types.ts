import type { ScreenedOption } from '@/lib/optionChain';

export type SortConfig = {
  key: keyof ScreenedOption | null;
  direction: 'asc' | 'desc' | null;
};
