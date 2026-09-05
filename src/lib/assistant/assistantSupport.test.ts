import { describe, it, expect } from 'vitest';
import { normalizeDelta } from './normalize';
import { describeAssistantError } from './errors';
import { describeHistory, type HistoryResponse } from '@/lib/history';

describe('reading a delta the way a trader says it', () => {
  it('takes 30 to mean a 30 delta', () => {
    expect(normalizeDelta(30)).toBeCloseTo(0.3, 10);
    expect(normalizeDelta(15)).toBeCloseTo(0.15, 10);
  });

  it('leaves a value already below 1 alone', () => {
    expect(normalizeDelta(0.3)).toBeCloseTo(0.3, 10);
    expect(normalizeDelta(0.05)).toBeCloseTo(0.05, 10);
  });

  it('takes 1 at face value rather than reading it as 0.01', () => {
    // A 1.00 delta is a real thing. Dividing it would be a stranger guess than
    // believing the number.
    expect(normalizeDelta(1)).toBe(1);
  });

  it('drops the sign, since the strategy supplies it', () => {
    expect(normalizeDelta(-0.3)).toBeCloseTo(0.3, 10);
    expect(normalizeDelta(-30)).toBeCloseTo(0.3, 10);
  });

  it('clamps nonsense rather than screening on an impossible window', () => {
    expect(normalizeDelta(300)).toBe(1);
    expect(normalizeDelta(NaN)).toBe(0);
    expect(normalizeDelta(Infinity)).toBe(1);
  });

  it('is idempotent, so a normalised value survives a second pass', () => {
    for (const v of [30, 0.3, 1, 15, 0.05]) {
      expect(normalizeDelta(normalizeDelta(v))).toBeCloseTo(normalizeDelta(v), 10);
    }
  });
});

describe('explaining a provider failure', () => {
  // The SDK replaces every streaming error with "An error occurred." before it
  // reaches the browser. The overwhelmingly common one is a rate limit, which
  // the user can act on — if they are told.
  it('names the rate limit and how long to wait', () => {
    const msg = describeAssistantError({
      statusCode: 429,
      message: 'Rate limit reached. Please try again in 8.06s.',
    });
    expect(msg).toMatch(/rate limit/i);
    expect(msg).toContain('9s');
  });

  it('reads the wait from a retry-after header when there is one', () => {
    const msg = describeAssistantError({
      statusCode: 429,
      message: 'Too Many Requests',
      responseHeaders: { 'retry-after': '12' },
    });
    expect(msg).toContain('12s');
  });

  it('separates the daily cap from the per-minute one', () => {
    // One is a pause; the other is the end of the day, and telling someone to
    // wait ten seconds for it would be wrong.
    const msg = describeAssistantError({
      statusCode: 429,
      message: 'Limit reached: tokens per day (TPD)',
    });
    expect(msg).toMatch(/daily/i);
    expect(msg).not.toMatch(/try again in \d+s/i);
  });

  it('points at the key when the key is the problem', () => {
    expect(describeAssistantError({ statusCode: 401, message: 'Invalid API Key' })).toMatch(
      /GROQ_API_KEY/
    );
  });

  it('points at the model config when the model is gone', () => {
    // The failure that once presented as "function calling stopped working".
    expect(
      describeAssistantError({ statusCode: 404, message: 'model_not_found' })
    ).toMatch(/model/i);
  });

  it('blames the provider for a 5xx rather than the user', () => {
    expect(describeAssistantError({ statusCode: 503, message: 'Service Unavailable' })).toMatch(
      /their end/i
    );
  });

  it('never returns the SDK placeholder, whatever it is handed', () => {
    for (const input of [null, undefined, 'boom', {}, new Error('kaboom'), 42]) {
      expect(describeAssistantError(input)).not.toBe('An error occurred.');
      expect(describeAssistantError(input).length).toBeGreaterThan(0);
    }
  });
});

describe('telling the model what its chart shows', () => {
  const history: HistoryResponse = {
    ticker: 'NVDA',
    companyName: 'NVIDIA Corporation',
    range: '6mo',
    points: [
      { date: '2026-03-04', close: 100 },
      { date: '2026-09-04', close: 125 },
    ],
    first: 100,
    last: 125,
    low: 95,
    high: 130,
    changePct: 25,
    currency: 'USD',
  };

  it('gives the shape of the move, not just that a chart exists', () => {
    // The model cannot see the picture. Without this it would say "here is a
    // chart" and invent everything else — the same gap readScreen closed.
    const text = describeHistory(history);
    expect(text).toContain('NVIDIA Corporation');
    expect(text).toContain('past 6 months');
    expect(text).toContain('100.00');
    expect(text).toContain('125.00');
    expect(text).toContain('+25.0%');
    expect(text).toContain('low 95.00');
    expect(text).toContain('high 130.00');
  });

  it('signs a fall', () => {
    expect(describeHistory({ ...history, last: 80, changePct: -20 })).toContain('-20.0%');
  });

  it('says these are closes, so the model does not quote them as live', () => {
    expect(describeHistory(history)).toMatch(/not live/i);
  });
});
