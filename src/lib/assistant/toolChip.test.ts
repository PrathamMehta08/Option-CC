import { describe, it, expect } from 'vitest';
import { describeToolCall, visibleInvocations } from './toolChip';

/**
 * A chip says what the assistant DID. The tool's own result string is written
 * for the model — readScreen's is the whole screen summary — so printing it
 * verbatim put a paragraph restating the results table under a tick.
 */
describe('what a tool call looks like to the user', () => {
  it('never repeats the screen summary back at them', () => {
    const summary =
      'Underlying: NVIDIA Corporation (NVDA), last price $230.36. Strategy: Covered Calls. ' +
      'Scan returned 220 contracts... 2026-09-09 (4d) $235 strike — premium $1.03';
    const chip = describeToolCall('readScreen', {}, summary);
    expect(chip.text).toBe('Read the screen');
    expect(chip.text).not.toContain('NVIDIA');
    expect(chip.text.length).toBeLessThan(30);
  });

  it('lists only the settings that were actually given', () => {
    const chip = describeToolCall('applySettings', {
      ticker: 'nvda',
      capital: 20000,
      delta: 0.3,
      minMonths: 0,
      maxMonths: 3,
      minStrike: null,
      maxStrike: null,
      strategy: null,
    });
    expect(chip.text).toBe('Set NVDA, $20,000, 0.3 delta, 0–3 months');
    // Nulls mean "left alone", so they must not appear as changes.
    expect(chip.text).not.toMatch(/strike|covered|puts/i);
  });

  it('says so plainly when a call changed nothing', () => {
    const allNull = {
      ticker: null, capital: null, delta: null, minMonths: null,
      maxMonths: null, minStrike: null, maxStrike: null, strategy: null,
    };
    expect(describeToolCall('applySettings', allNull).text).toBe('No settings changed');
  });

  it('surfaces a rejection verbatim, because there the message is the point', () => {
    const rejection = 'Filter rejected: unknown field "rsi". Valid fields are the numeric columns.';
    const chip = describeToolCall('addCustomFilter', { name: 'RSI' }, rejection);
    expect(chip.tone).toBe('warn');
    expect(chip.text).toBe(rejection);
  });

  it('warns when a chart could not be loaded', () => {
    const chip = describeToolCall('showStockChart', { ticker: 'ZZZZ' }, 'Could not load a chart: not found');
    expect(chip.tone).toBe('warn');
  });

  it('stays short for every tool, so a chain of calls stays scannable', () => {
    const calls: [string, Record<string, unknown>][] = [
      ['setTicker', { ticker: 'aapl' }],
      ['setCapital', { capital: 25000 }],
      ['setMonthsRange', { minMonths: 0, maxMonths: 3 }],
      ['setDelta', { delta: 0.3 }],
      ['setStrikeRange', { minStrike: 100, maxStrike: 200 }],
      ['setSort', { key: 'annualizedReturn', direction: 'desc' }],
      ['setStrategy', { strategy: 'cash-secured-put' }],
      ['setResultsView', { view: 'cards' }],
      ['addComputedColumn', { name: 'Score' }],
      ['showStockChart', { ticker: 'nvda', range: '6mo' }],
    ];
    for (const [name, args] of calls) {
      const chip = describeToolCall(name, args, 'Done');
      expect(chip.tone).toBe('done');
      expect(chip.text.length).toBeGreaterThan(0);
      expect(chip.text.length).toBeLessThan(60);
      expect(chip.text).not.toContain('\n');
    }
  });

  it('upper-cases the ticker, however the model typed it', () => {
    expect(describeToolCall('setTicker', { ticker: 'nvda' }).text).toBe('Ticker NVDA');
  });
});

describe('the contract card', () => {
  it('names the contract, not its figures', () => {
    // The card carries the numbers; the chip only has to identify it.
    const chip = describeToolCall('showOptionCard', { expiration: '2026-10-16', strike: 510 });
    expect(chip.text).toBe('Card: $510 2026-10-16');
    expect(chip.tone).toBe('done');
  });

  it('warns when the contract is not on the current screen', () => {
    const chip = describeToolCall(
      'showOptionCard',
      { expiration: '2099-01-01', strike: 1 },
      'No contract on the current screen expires 2099-01-01 at a $1 strike.'
    );
    expect(chip.tone).toBe('warn');
  });
});

describe('strikes given as a percentage of spot', () => {
  it('says what was asked for, not a stray zero beside it', () => {
    // Reported: "Set AAPL, strikes $0–$500" for a request that asked for 115%
    // of the price. The model sent a throwaway minStrike of 0 next to the
    // percentage, and the chip reported the zero.
    const chip = describeToolCall('applySettings', {
      ticker: 'AAPL',
      minStrike: 0,
      maxStrike: 500,
      minStrikePctOfSpot: 115,
      maxStrikePctOfSpot: null,
    });
    expect(chip.text).toBe('Set AAPL, strikes 115% of spot–$500');
    expect(chip.text).not.toContain('$0');
  });

  it('still reports plain dollar bounds when no percentage is given', () => {
    const chip = describeToolCall('applySettings', { minStrike: 100, maxStrike: 200 });
    expect(chip.text).toBe('Set strikes $100–$200');
  });

  it('says "any" for an edge that was left alone', () => {
    expect(describeToolCall('applySettings', { maxStrike: 500 }).text).toBe(
      'Set strikes any–$500'
    );
  });
});

/**
 * The reported confusion, verbatim: a warning triangle reading "No contract on
 * the current screen expires 2027-03-19 at a $10 strike. Read the screen again
 * and use an expiration and strike exactly as it gave them." sat directly above
 * the correct card. The assistant had corrected itself; the correction was
 * addressed to the model, and the user was left reading an error about a repair
 * that had already happened.
 */
describe('rejections the assistant recovered from', () => {
  const rejected = {
    toolName: 'showOptionCard',
    state: 'result',
    result: 'No contract on the current screen expires 2027-03-19 at a $10 strike. Pick one of these instead.',
  };
  const succeeded = {
    toolName: 'showOptionCard',
    state: 'result',
    result: 'Card shown for the $265 strike expiring 2027-03-19.',
  };
  const read = { toolName: 'readScreen', state: 'result', result: 'Underlying: AAPL…' };

  it('hides a rejection the same tool went on to satisfy', () => {
    expect(visibleInvocations([rejected, read, succeeded])).toEqual([read, succeeded]);
  });

  it('keeps a rejection nothing recovered from', () => {
    // Here it IS the explanation for why no card appeared.
    expect(visibleInvocations([rejected, read])).toEqual([rejected, read]);
  });

  it('does not let a different tool succeeding cover for it', () => {
    const chart = { toolName: 'showStockChart', state: 'result', result: 'Up 4%.' };
    expect(visibleInvocations([rejected, chart])).toEqual([rejected, chart]);
  });

  it('keeps a rejection that a later attempt also failed', () => {
    const again = { ...rejected, result: 'No contract on the current screen expires 2027-06-18 at a $9 strike.' };
    expect(visibleInvocations([rejected, again])).toHaveLength(2);
  });

  it('leaves ordinary calls alone, in order', () => {
    const calls = [
      { toolName: 'applySettings', state: 'result', result: 'Underlying: AAPL…' },
      { toolName: 'setSort', state: 'result', result: 'Sorted by annualizedReturn desc' },
    ];
    expect(visibleInvocations(calls)).toEqual(calls);
  });

  it('keeps a call still running', () => {
    const pending = { toolName: 'showOptionCard', state: 'call' };
    expect(visibleInvocations([pending])).toEqual([pending]);
  });
});

describe('what a surviving warning says', () => {
  it('drops the half addressed to the model', () => {
    const chip = describeToolCall(
      'showOptionCard',
      { expiration: '2027-03-19', strike: 10 },
      'No contract on the current screen expires 2027-03-19 at a $10 strike. Pick one of these instead, exactly as written: 2027-03-19 $265; 2027-03-19 $270.'
    );
    expect(chip.tone).toBe('warn');
    expect(chip.text).toBe('No contract on the current screen expires 2027-03-19 at a $10 strike.');
  });

  it('leaves a one-sentence rejection whole', () => {
    expect(describeToolCall('addComputedColumn', { name: 'HM' }, 'Formula rejected: no such column').text).toBe(
      'Formula rejected: no such column'
    );
  });
});
