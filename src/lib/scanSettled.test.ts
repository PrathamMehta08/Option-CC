import { describe, it, expect } from 'vitest';
import { scanSettled, settingsApplied, type ScanState } from './scanSettled';

const state = (over: Partial<ScanState> = {}): ScanState => ({
  loading: false,
  wanted: 'NVDA',
  loaded: 'NVDA',
  failed: false,
  ...over,
});

describe('waiting for the scan the assistant just asked for', () => {
  it('is settled when the chain for that ticker has arrived', () => {
    expect(scanSettled(state(), 'NVDA')).toBe(true);
  });

  it('is NOT settled in the instant before the state catches up', () => {
    // The reported bug: setTicker('NVDA') has been called, but the ref still
    // describes an empty screen with no ticker. Reading "not loading, nothing
    // wanted" as settled is what dropped the 115%-of-price floor.
    expect(scanSettled(state({ wanted: '', loaded: null }), 'NVDA')).toBe(false);
  });

  it('is NOT settled during the debounce, before the fetch even starts', () => {
    // Ticker set, request not yet in flight: loading is still false and the
    // previous chain is still loaded. Nothing about that says "ready".
    expect(scanSettled(state({ wanted: 'NVDA', loaded: 'AAPL' }), 'NVDA')).toBe(false);
  });

  it('is NOT settled while the fetch is in flight', () => {
    expect(scanSettled(state({ loading: true, loaded: null }), 'NVDA')).toBe(false);
  });

  it('is NOT settled while the previous ticker is still on screen', () => {
    expect(scanSettled(state({ loaded: 'AAPL' }), 'NVDA')).toBe(false);
  });

  it('is settled when the fetch failed, rather than waiting out the timeout', () => {
    expect(scanSettled(state({ loaded: null, failed: true }), 'NVDA')).toBe(true);
  });

  it('settles at once when there is no ticker to wait for', () => {
    expect(scanSettled(state({ wanted: '', loaded: null }), '')).toBe(true);
  });

  it('ignores case and stray spaces, since the ticker is typed by hand', () => {
    expect(scanSettled(state({ wanted: ' nvda ', loaded: 'nvda' }), 'NVDA')).toBe(true);
  });

  it('does not treat an empty screen as the loaded one', () => {
    // A screen with zero matching rows still counts as loaded; a screen with
    // no chain at all does not.
    expect(scanSettled(state({ loaded: null }), 'NVDA')).toBe(false);
  });
});

describe('waiting for a filter to reach the table', () => {
  const applied = {
    ticker: 'NVDA',
    capital: 100000,
    delta: 1,
    minStrike: 265,
    maxStrike: 10000,
    strategy: 'covered-call',
    newestFilter: '',
  };

  it('is satisfied when nothing in particular was asked for', () => {
    expect(settingsApplied(applied, {})).toBe(true);
  });

  it('waits while the strike floor is still the old one', () => {
    // The reported bug: the assistant set a 115%-of-price floor and read the
    // screen before it landed, so it recommended the $10 strike from the top
    // of the unfiltered board.
    expect(settingsApplied({ ...applied, minStrike: 0 }, { minStrike: 265 })).toBe(false);
  });

  it('is satisfied once the floor has landed', () => {
    expect(settingsApplied(applied, { minStrike: 265, maxStrike: 10000 })).toBe(true);
  });

  it('tolerates a rounding difference of less than a cent', () => {
    expect(settingsApplied({ ...applied, minStrike: 264.9999999 }, { minStrike: 265 })).toBe(true);
  });

  it('does not tolerate a difference of a cent', () => {
    expect(settingsApplied({ ...applied, minStrike: 265.01 }, { minStrike: 265 })).toBe(false);
  });

  it('compares tickers and strategies as text, ignoring case', () => {
    expect(settingsApplied(applied, { ticker: 'nvda' })).toBe(true);
    expect(settingsApplied(applied, { strategy: 'cash-secured-put' })).toBe(false);
  });

  it('checks every key it was given, not just the first', () => {
    expect(settingsApplied(applied, { minStrike: 265, delta: 0.3 })).toBe(false);
  });
});

describe('waiting for a custom filter to reach the table', () => {
  const applied = {
    ticker: 'AAPL',
    capital: 100000,
    delta: 1,
    minStrike: 367.97,
    maxStrike: 600,
    strategy: 'covered-call',
    newestFilter: '',
  };

  it('waits until the filter just added is the one in force', () => {
    // Otherwise the screen is read as it was before the filter, and the model
    // answers about rows the filter removes.
    expect(settingsApplied(applied, { newestFilter: 'f123' })).toBe(false);
    expect(settingsApplied({ ...applied, newestFilter: 'f123' }, { newestFilter: 'f123' })).toBe(true);
  });

  it('is not satisfied by some other filter having landed', () => {
    expect(settingsApplied({ ...applied, newestFilter: 'other' }, { newestFilter: 'f123' })).toBe(false);
  });
});
