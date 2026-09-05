import { describe, it, expect } from 'vitest';
import { findMentionedContract } from './mentionedContract';
import type { ScreenedOption } from '@/lib/optionChain';

function row(strike: number, expiration = '2026-10-16'): ScreenedOption {
  return {
    expiration,
    daysToExpiration: 45,
    strike,
    lastPrice: 2,
    high: 2.2,
    delta: 0.3,
    iv: 40,
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
  };
}

/**
 * The assistant is told to show a card whenever it names a contract, and does
 * not reliably do it. This reads the answer and shows one anyway — but a wrong
 * card looks authoritative, so it has to abstain whenever there is doubt.
 */
describe('finding the contract an answer names', () => {
  const rows = [row(265), row(330), row(370)];

  it('finds the one strike an answer points at', () => {
    const found = findMentionedContract('The $330 strike leads on yield here.', rows);
    expect(found?.strike).toBe(330);
  });

  it('handles a strike written with decimals', () => {
    const withCents = [row(332.5), row(340)];
    expect(findMentionedContract('the $332.50 call', withCents)?.strike).toBe(332.5);
  });

  it('ignores dollar figures that are not strikes', () => {
    // "$100,000 of capital" must not be mistaken for a contract.
    expect(findMentionedContract('With $100,000 of capital you can afford three.', rows)).toBeNull();
  });

  it('says nothing when two different strikes are named', () => {
    // Naming both is a comparison, not a recommendation. Picking one would be
    // inventing an emphasis the answer did not have.
    expect(findMentionedContract('The $265 yields more than the $370.', rows)).toBeNull();
  });

  it('uses the expiration to settle a strike shared across expiries', () => {
    const shared = [row(265, '2027-03-19'), row(265, '2026-12-18')];
    const found = findMentionedContract('the March 2027 $265 strike', shared);
    expect(found?.expiration).toBe('2027-03-19');
  });

  it('matches the ISO date the screen gave', () => {
    const shared = [row(265, '2027-03-19'), row(265, '2026-12-18')];
    expect(findMentionedContract('$265 expiring 2026-12-18', shared)?.expiration).toBe('2026-12-18');
  });

  it('needs the year, since a month alone matches half the board', () => {
    const shared = [row(265, '2027-03-19'), row(265, '2026-03-20')];
    expect(findMentionedContract('the March $265 strike', shared)).toBeNull();
  });

  it('abstains when the same strike appears at several expiries and none is named', () => {
    const shared = [row(265, '2027-03-19'), row(265, '2026-12-18')];
    expect(findMentionedContract('the $265 strike', shared)).toBeNull();
  });

  it('abstains on an empty screen or an answer with no figures', () => {
    expect(findMentionedContract('the $330 strike', [])).toBeNull();
    expect(findMentionedContract('Nothing is affordable right now.', rows)).toBeNull();
    expect(findMentionedContract('', rows)).toBeNull();
  });

  it('ignores a strike that is not on the screen', () => {
    expect(findMentionedContract('the $999 strike', rows)).toBeNull();
  });

  it('reads a strike with no space after the sign, and with one', () => {
    expect(findMentionedContract('at $330 it caps upside', rows)?.strike).toBe(330);
    expect(findMentionedContract('at $ 330 it caps upside', rows)?.strike).toBe(330);
  });
});

describe('typographic punctuation in model prose', () => {
  const shared = [row(300, '2027-03-19'), row(300, '2026-12-18')];

  it('matches a date written with non-breaking hyphens', () => {
    // The reported miss, verbatim: the model wrote U+2011 between the parts,
    // so an exact match on the ISO date the screen gave it failed and no card
    // appeared for a contract the answer named outright.
    const answer = 'The leading contract is the 2027\u201103\u201119 $300 covered\u2011call.';
    expect(answer.includes('2027-03-19')).toBe(false);
    expect(findMentionedContract(answer, shared)?.expiration).toBe('2027-03-19');
  });

  it('handles en dashes, em dashes and minus signs alike', () => {
    for (const dash of ['\u2013', '\u2014', '\u2212', '\uFF0D']) {
      const answer = `the 2027${dash}03${dash}19 $300 strike`;
      expect(findMentionedContract(answer, shared)?.expiration).toBe('2027-03-19');
    }
  });

  it('handles a non-breaking space before the amount', () => {
    expect(findMentionedContract('the 2027-03-19 $\u00A0300 strike', shared)?.expiration).toBe(
      '2027-03-19'
    );
  });

  it('still abstains when the date is genuinely absent', () => {
    expect(findMentionedContract('the $300 strike', shared)).toBeNull();
  });
});
