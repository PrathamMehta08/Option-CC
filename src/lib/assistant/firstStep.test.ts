import { describe, it, expect } from 'vitest';
import { isFirstStepOfTurn } from './firstStep';

describe('telling the first step of a turn from a continuation', () => {
  it('is the first step when the user just spoke', () => {
    expect(isFirstStepOfTurn([{ role: 'user', content: 'NVDA 100k' }])).toBe(true);
  });

  it('is not the first step once the assistant has called a tool', () => {
    // Requiring a tool here would leave the turn no way to write its answer.
    expect(
      isFirstStepOfTurn([
        { role: 'user', content: 'NVDA 100k' },
        { role: 'assistant', content: '', toolInvocations: [{ toolName: 'applySettings' }] },
      ])
    ).toBe(false);
  });

  it('is the first step of a SECOND turn, not just the first turn', () => {
    expect(
      isFirstStepOfTurn([
        { role: 'user', content: 'NVDA' },
        { role: 'assistant', content: 'Loaded.' },
        { role: 'user', content: 'now sort by yield' },
      ])
    ).toBe(true);
  });

  it('does not throw on a body that is not a message list', () => {
    for (const bad of [null, undefined, {}, 'messages', [], [null]]) {
      expect(isFirstStepOfTurn(bad)).toBe(false);
    }
  });
});
