/**
 * Whether the screen has finished loading the ticker somebody is waiting for.
 *
 * The assistant sets a ticker and then, in the same tool call, wants the price
 * to resolve "115% of spot" against and the resulting screen to describe. The
 * state it consults is written in an effect, so in the moment just after
 * setTicker('NVDA') it still describes the PREVIOUS screen. A check of "not
 * loading, nothing pending" therefore read as settled immediately: the price
 * came back 0, the 115% floor was quietly dropped, and the model was handed an
 * empty screen — which it explained at length, confidently and wrongly, while
 * 162 contracts sat in the table behind it.
 *
 * So the ticker being waited for is named, and nothing counts as settled until
 * the state has caught up to it AND the chain for it has actually arrived.
 */
export interface ScanState {
  /** A fetch is in flight. */
  loading: boolean;
  /** The ticker the app is currently set to. */
  wanted: string;
  /** The ticker the loaded chain is for, or null when nothing is loaded. */
  loaded: string | null;
  /** The last fetch failed — waiting longer will not help. */
  failed: boolean;
}

export function scanSettled(state: ScanState, want: string): boolean {
  const target = want.trim().toUpperCase();
  // No ticker to wait for: there is nothing coming.
  if (!target) return true;
  // The state still describes the screen before the change.
  if (state.wanted.trim().toUpperCase() !== target) return false;
  if (state.loading) return false;
  // A failed fetch is settled: the answer is "it did not load", and waiting
  // out the full timeout would only delay saying so.
  return (state.loaded ?? '').trim().toUpperCase() === target || state.failed;
}

/**
 * The settings the rows on screen were actually produced from.
 *
 * Waiting for the chain to load is not enough. The assistant sets a strike
 * floor and then reads the screen in the same breath, but the filter reaches
 * the table a render later — and through useDeferredValue, sometimes later
 * still. So the screen it read was the one from before its own change: it was
 * handed 162 unfiltered rows, recommended the $10 strike at the top of them,
 * and described a contract that the filter it had just applied excludes.
 */
export interface AppliedSettings {
  ticker: string;
  capital: number;
  delta: number;
  minStrike: number;
  maxStrike: number;
  strategy: string;
  /** Id of the most recently added custom filter, or "" when there are none. */
  newestFilter: string;
}

export type WantedSettings = Partial<AppliedSettings>;

/** Whether the screen has caught up to every setting the caller asked for. */
export function settingsApplied(applied: AppliedSettings, want: WantedSettings): boolean {
  return (Object.keys(want) as (keyof AppliedSettings)[]).every((key) => {
    const wanted = want[key];
    if (wanted === undefined) return true;
    const current = applied[key];
    if (typeof wanted === 'number' && typeof current === 'number') {
      // Strikes and money are quoted to the cent; an exact compare on floats
      // would spin until the timeout over a rounding difference.
      return Math.abs(current - wanted) < 0.005;
    }
    return String(current).trim().toUpperCase() === String(wanted).trim().toUpperCase();
  });
}

/**
 * Whether the expiration checkboxes have caught up with the loaded chain.
 *
 * They start empty and are filled a render after the chain arrives — and the
 * rows read a deferred copy of them, so later still. In that window the board
 * genuinely holds zero rows while being perfectly healthy, and a read that
 * lands there is told the screen is empty. It reported exactly that for a
 * filter with 83 matches sitting behind it.
 *
 * A board offering expirations with none selected is mid-load, not empty. One
 * offering none has nothing to wait for.
 */
export function boardReady(offered: number, selected: number): boolean {
  return offered === 0 || selected > 0;
}
