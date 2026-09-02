import { describe, it, expect } from 'vitest';
import { trackBounds, clampToTrack } from './DualRangeSlider';

describe('trackBounds', () => {
  it('widens fractional bounds outwards to whole numbers', () => {
    // A real NVDA board: the lowest strike is 2.50, the highest 460.
    expect(trackBounds(2.5, 460)).toEqual([2, 460]);
    expect(trackBounds(217.5, 222.5)).toEqual([217, 223]);
  });

  it('never narrows the range, so no contract falls outside it', () => {
    for (const [lo, hi] of [
      [2.5, 460],
      [217.5, 222.5],
      [99.99, 100.01],
    ]) {
      const [a, b] = trackBounds(lo, hi);
      expect(a).toBeLessThanOrEqual(lo);
      expect(b).toBeGreaterThanOrEqual(hi);
    }
  });

  it('leaves whole numbers alone', () => {
    expect(trackBounds(0, 24)).toEqual([0, 24]);
  });

  it('tolerates the arguments arriving the wrong way round', () => {
    expect(trackBounds(460, 2.5)).toEqual([2, 460]);
  });

  it('survives a single-strike board, where min equals max', () => {
    expect(trackBounds(230, 230)).toEqual([230, 230]);
  });
});

describe('clampToTrack', () => {
  const [low, high] = trackBounds(230, 460);

  it('leaves an in-range value untouched', () => {
    expect(clampToTrack(300, low, high)).toBe(300);
    expect(clampToTrack(230, low, high)).toBe(230);
    expect(clampToTrack(460, low, high)).toBe(460);
  });

  /**
   * The case from the bug report: "strike less than 400" makes the assistant
   * emit minStrike 0. That is a fine way to say "no lower bound" and filters
   * correctly, but 0 is not a position on a track that starts at 230 — left
   * alone the thumb renders off the end. The slider pins it to the low end
   * while the filter keeps the 0 it actually screens by.
   */
  it('pins a value below the track to its low end', () => {
    expect(clampToTrack(0, low, high)).toBe(230);
    expect(clampToTrack(-50, low, high)).toBe(230);
  });

  it('pins a value above the track to its high end', () => {
    expect(clampToTrack(9999, low, high)).toBe(460);
  });

  it('keeps the derived position within 0-100% for any input', () => {
    const pct = (v: number) => ((clampToTrack(v, low, high) - low) / (high - low)) * 100;
    for (const v of [-1000, 0, 229, 230, 345, 460, 461, 100000]) {
      expect(pct(v)).toBeGreaterThanOrEqual(0);
      expect(pct(v)).toBeLessThanOrEqual(100);
    }
  });
});
