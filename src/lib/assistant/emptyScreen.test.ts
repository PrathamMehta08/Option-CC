import { describe, it, expect } from 'vitest';
import { explainEmptyScreen } from './emptyScreen';
import type { CustomFilter } from '@/lib/filters';
import type { ScreenedOption } from '@/lib/optionChain';

function row(over: Partial<ScreenedOption> = {}): ScreenedOption {
  return {
    expiration: '2027-03-19',
    daysToExpiration: 195,
    strike: 400,
    lastPrice: 2,
    high: 2.2,
    delta: 0.3,
    iv: 30,
    moneyness: 5,
    openInterest: 1000,
    volume: 500,
    capitalRequiredPerContract: 20000,
    premiumPerContract: 200,
    returnPct: 1,
    annualizedReturn: 10,
    returnWithGainPct: 2,
    annualizedReturnWithGain: 20,
    premiumSharePct: 50,
    totalProfitIfAssigned: 400,
    maxContracts: 2,
    totalCapitalRequired: 40000,
    totalPremiumReceived: 400,
    ...over,
  };
}

const ivOver = (value: number): CustomFilter => ({
  id: 'iv',
  name: `IV > ${value}`,
  mode: 'and',
  conditions: [{ field: 'iv', op: 'gt', value: [value] }],
});

const wideStrikes: [number, number] = [0, 10000];

describe('explaining an empty screen', () => {
  it('names the filter holding the door shut, and what was available', () => {
    // The reported argument: the model blamed IV, expiry and delta together,
    // and the user did not believe it. Only one of them was responsible, and
    // the number that settles it — the highest IV actually on offer — was
    // never mentioned.
    const rows = [row({ iv: 27.8 }), row({ iv: 33.5, strike: 401 }), row({ iv: 30, strike: 402 })];
    const message = explainEmptyScreen({
      options: rows,
      strikeFilter: wideStrikes,
      selectedExpirations: ['2027-03-19'],
      customFilters: [ivOver(40)],
    });
    expect(message).toContain('iv > 40');
    expect(message).toContain('3 contracts pass every other filter');
    expect(message).toContain('iv runs from 27.80 to 33.50');
  });

  it('says nothing when rows are showing', () => {
    expect(
      explainEmptyScreen({
        options: [row({ iv: 45 })],
        strikeFilter: wideStrikes,
        selectedExpirations: ['2027-03-19'],
        customFilters: [ivOver(40)],
      })
    ).toBeNull();
  });

  it('says nothing when the scan itself returned nothing', () => {
    // A different problem with a different answer — the months or the delta
    // limit, not anything applied afterwards.
    expect(
      explainEmptyScreen({
        options: [],
        strikeFilter: wideStrikes,
        selectedExpirations: [],
        customFilters: [],
      })
    ).toBeNull();
  });

  it('blames the strike range when that is what excludes everything', () => {
    const message = explainEmptyScreen({
      options: [row({ strike: 100 }), row({ strike: 120 })],
      strikeFilter: [300, 500],
      selectedExpirations: ['2027-03-19'],
      customFilters: [],
    });
    expect(message).toContain('the strike range $300-$500');
    expect(message).toContain('2 contracts');
  });

  it('blames the expiration selection when nothing is ticked', () => {
    const message = explainEmptyScreen({
      options: [row()],
      strikeFilter: wideStrikes,
      selectedExpirations: [],
      customFilters: [],
    });
    expect(message).toContain('the expiration selection');
  });

  it('reports both when either one alone would open the door', () => {
    // Two filters, each excluding a different half: dropping either shows
    // rows, so naming only one would be misleading.
    const rows = [row({ iv: 50, strike: 100 }), row({ iv: 20, strike: 400 })];
    const message = explainEmptyScreen({
      options: rows,
      strikeFilter: [300, 500],
      selectedExpirations: ['2027-03-19'],
      customFilters: [ivOver(40)],
    });
    expect(message).toContain('the strike range');
    expect(message).toContain('iv > 40');
  });

  it('admits when no single filter is responsible', () => {
    // Every row is excluded twice over, so dropping any one changes nothing.
    const rows = [row({ iv: 20, strike: 100 }), row({ iv: 20, strike: 120 })];
    const message = explainEmptyScreen({
      options: rows,
      strikeFilter: [300, 500],
      selectedExpirations: ['2027-03-19'],
      customFilters: [ivOver(40)],
    });
    expect(message).toContain('no single filter is responsible');
  });

  it('says a value is fixed rather than printing a range of one', () => {
    const rows = [row({ iv: 30 }), row({ iv: 30, strike: 401 })];
    const message = explainEmptyScreen({
      options: rows,
      strikeFilter: wideStrikes,
      selectedExpirations: ['2027-03-19'],
      customFilters: [ivOver(40)],
    });
    expect(message).toContain('iv is 30 for all of them');
  });
});
