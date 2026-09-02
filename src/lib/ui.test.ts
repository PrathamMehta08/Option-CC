import { describe, it, expect } from 'vitest';
import { cn, formatNumberWithCommas, formatExpirationLabel } from './ui';

describe('cn', () => {
  it('joins class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('drops falsy values', () => {
    expect(cn('a', false && 'b', undefined, null, 'c')).toBe('a c');
  });

  it('lets the later Tailwind class win on a conflict', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-zinc-500', 'text-emerald-500')).toBe('text-emerald-500');
  });
});

describe('formatNumberWithCommas', () => {
  it('groups thousands', () => {
    expect(formatNumberWithCommas('1000')).toBe('1,000');
    expect(formatNumberWithCommas('1234567')).toBe('1,234,567');
    expect(formatNumberWithCommas(100000)).toBe('100,000');
  });

  it('leaves short numbers alone', () => {
    expect(formatNumberWithCommas('999')).toBe('999');
    expect(formatNumberWithCommas('')).toBe('');
  });

  it('groups only the integer part', () => {
    expect(formatNumberWithCommas('1234567.89')).toBe('1,234,567.89');
  });

  it('strips anything that is not a digit or a dot', () => {
    // This is what makes the capital field tolerate re-typing over its own output.
    expect(formatNumberWithCommas('$10,000')).toBe('10,000');
    expect(formatNumberWithCommas('abc123')).toBe('123');
  });
});

describe('formatExpirationLabel', () => {
  it('renders an ISO date as a short month and day', () => {
    expect(formatExpirationLabel('2026-09-04')).toBe('Sep 4');
    expect(formatExpirationLabel('2026-12-18')).toBe('Dec 18');
  });

  it('uses midday so the label does not slip a day by timezone', () => {
    // A naive `new Date('2026-01-01')` is UTC midnight, which is Dec 31 in any
    // negative-offset timezone. The helper appends T12:00:00 to avoid that.
    expect(formatExpirationLabel('2026-01-01')).toBe('Jan 1');
  });

  it('returns the input unchanged when it will not parse', () => {
    expect(formatExpirationLabel('not-a-date')).toBe('not-a-date');
  });
});
