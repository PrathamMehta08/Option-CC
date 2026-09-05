import { describe, it, expect } from 'vitest';
import {
  NO_STRIKE_PCT,
  nextStrikePct,
  strikeFromPct,
  strikeRangeForBoard,
  type StrikePct,
} from './strikeIntent';

describe('a strike bound given as a percentage of the price', () => {
  it('follows the stock it is applied to', () => {
    // The point of the whole file: 115% of NVDA at $230.36 is $264.91, and
    // 115% of GOOGL at $335.31 is $385.61. Carrying the dollars across would
    // have put a $265 floor under a $335 stock — 79% of spot, not 115%.
    expect(strikeFromPct(115, 230.36)).toBe(264.91);
    expect(strikeFromPct(115, 335.31)).toBe(385.61);
  });

  it('resolves to nothing without a price, rather than to zero', () => {
    expect(strikeFromPct(115, 0)).toBeNull();
    expect(strikeFromPct(115, NaN)).toBeNull();
    expect(strikeFromPct(null, 230)).toBeNull();
  });
});

describe('the range a newly loaded board opens with', () => {
  const bounds: [number, number] = [5, 590];

  it('uses the board edges when no percentage is standing', () => {
    expect(strikeRangeForBoard(bounds, NO_STRIKE_PCT, 335.31)).toEqual([5, 590]);
  });

  it('applies a standing floor to the new stock price', () => {
    expect(strikeRangeForBoard(bounds, { min: 115, max: null }, 335.31)).toEqual([385.61, 590]);
  });

  it('applies both edges when both are standing', () => {
    expect(strikeRangeForBoard(bounds, { min: 90, max: 120 }, 335.31)).toEqual([301.78, 402.37]);
  });

  it('keeps a percentage inside the strikes the board actually lists', () => {
    // 300% of spot is past the end of the track, and a bound the slider cannot
    // reach is one the user cannot undo.
    expect(strikeRangeForBoard(bounds, { min: 300, max: null }, 335.31)).toEqual([590, 590]);
  });

  it('does not let a floor above the ceiling read as no filter at all', () => {
    const crossed = strikeRangeForBoard(bounds, { min: 150, max: 110 }, 335.31);
    expect(crossed[0]).toBeLessThanOrEqual(crossed[1]);
  });

  it('falls back to the board when there is no price yet', () => {
    expect(strikeRangeForBoard(bounds, { min: 115, max: null }, 0)).toEqual([5, 590]);
  });
});

describe('what sets and clears the standing rule', () => {
  const standing: StrikePct = { min: 115, max: null };

  it('is set by a percentage', () => {
    expect(nextStrikePct(NO_STRIKE_PCT, { min: 264.91, max: null, minPct: 115, maxPct: null })).toEqual({
      min: 115,
      max: null,
    });
  });

  it('is cleared on an edge given as an actual number', () => {
    // "strikes from $300" is a person naming a price, not a rule.
    expect(nextStrikePct(standing, { min: 300, max: null, minPct: null, maxPct: null })).toEqual({
      min: null,
      max: null,
    });
  });

  it('survives a change to the other edge', () => {
    expect(nextStrikePct(standing, { min: null, max: 500, minPct: null, maxPct: null })).toEqual({
      min: 115,
      max: null,
    });
  });

  it('is replaced by a new percentage on the same edge', () => {
    expect(nextStrikePct(standing, { min: null, max: null, minPct: 120, maxPct: null }).min).toBe(120);
  });

  it('holds both edges independently', () => {
    expect(
      nextStrikePct({ min: 115, max: 130 }, { min: 300, max: null, minPct: null, maxPct: null })
    ).toEqual({ min: null, max: 130 });
  });
});
