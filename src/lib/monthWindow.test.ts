import { describe, it, expect } from 'vitest';
import { withMonthsFrom, withMonthsTo, asMonthWindow, MAX_MONTHS } from './monthWindow';

/**
 * The month window is a range. Every route into it — the sidebar fields, the
 * mobile keypad, the assistant — goes through these, so an inverted pair is not
 * a state the app can reach.
 */
describe('setting the near edge', () => {
  it('leaves a valid window alone', () => {
    expect(withMonthsFrom([0, 6], 2)).toEqual([2, 6]);
  });

  it('pushes the far edge out rather than accepting 8 to 6', () => {
    // The end the user just typed wins; the other follows.
    expect(withMonthsFrom([0, 6], 8)).toEqual([8, 8]);
  });

  it('never goes below zero', () => {
    expect(withMonthsFrom([0, 6], -3)).toEqual([0, 6]);
  });

  it('rounds, because months are a count', () => {
    expect(withMonthsFrom([0, 6], 2.6)).toEqual([3, 6]);
  });

  it('stops at the far end of the board', () => {
    expect(withMonthsFrom([0, 6], 99)).toEqual([MAX_MONTHS, MAX_MONTHS]);
  });
});

describe('setting the far edge', () => {
  it('leaves a valid window alone', () => {
    expect(withMonthsTo([0, 6], 12)).toEqual([0, 12]);
  });

  it('pulls the near edge in rather than accepting 6 to 3', () => {
    expect(withMonthsTo([6, 12], 3)).toEqual([3, 3]);
  });

  it('allows a single-month window', () => {
    expect(withMonthsTo([3, 12], 3)).toEqual([3, 3]);
  });

  it('clamps to the board', () => {
    expect(withMonthsTo([0, 6], 99)).toEqual([0, MAX_MONTHS]);
    expect(withMonthsTo([0, 6], -1)).toEqual([0, 0]);
  });
});

describe('setting both at once', () => {
  it('orders whatever it is handed', () => {
    expect(asMonthWindow(6, 2)).toEqual([2, 6]);
    expect(asMonthWindow(2, 6)).toEqual([2, 6]);
  });

  it('survives the assistant emitting a backwards pair', () => {
    // A model that says "between 9 and 3 months" gets a screen, not an empty
    // board it cannot explain.
    expect(asMonthWindow(9, 3)).toEqual([3, 9]);
  });

  it('survives nonsense', () => {
    expect(asMonthWindow(NaN, 6)).toEqual([0, 6]);
    expect(asMonthWindow(Infinity, 3)).toEqual([3, MAX_MONTHS]);
  });
});

describe('the invariant, whatever the sequence', () => {
  it('never produces from > to', () => {
    let w: [number, number] = [0, 6];
    // A user poking at both fields in an order nobody planned for.
    const moves: [('from' | 'to'), number][] = [
      ['from', 9], ['to', 4], ['from', 0], ['to', 24],
      ['from', 24], ['to', 1], ['from', 12], ['to', 12],
    ];
    for (const [edge, v] of moves) {
      w = edge === 'from' ? withMonthsFrom(w, v) : withMonthsTo(w, v);
      expect(w[0]).toBeLessThanOrEqual(w[1]);
      expect(w[0]).toBeGreaterThanOrEqual(0);
      expect(w[1]).toBeLessThanOrEqual(MAX_MONTHS);
    }
  });
});
