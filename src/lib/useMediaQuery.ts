'use client';

import { useSyncExternalStore } from 'react';

/**
 * Subscribe to a CSS media query.
 *
 * Tailwind's `hidden md:block` is free when both branches are cheap, but the
 * results table is not: rendering a 400-row, 16-column table into the DOM just
 * to hide it costs a phone thousands of nodes it will never paint. This lets a
 * component pick one branch and build only that.
 *
 * The server snapshot is `false`, so SSR renders the wide layout and a narrow
 * client corrects on mount. Nothing here renders before a fetch resolves, so
 * that correction is never on screen.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** Below Tailwind's `md` breakpoint — the phone layout. */
export const useIsMobile = () => useMediaQuery('(max-width: 767px)');
