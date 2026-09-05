import { describe, it, expect } from 'vitest';
import { checkRetune, newTurn } from './turnEdits';

describe('changing a setting twice in one turn', () => {
  it('allows the first change of each setting', () => {
    const turn = newTurn();
    expect(checkRetune(turn, { delta: 0.2, ticker: 'NVDA' }).retuned).toEqual([]);
    expect(checkRetune(turn, { capital: 100000 }).retuned).toEqual([]);
  });

  it('refuses a second, different value for the same setting', () => {
    // The reported walk: "make it safer" became delta 0.2, then 0.1, then 0.05.
    const turn = newTurn();
    checkRetune(turn, { delta: 0.2 });
    const second = checkRetune(turn, { delta: 0.1 });
    expect(second.retuned).toEqual(['delta']);
    expect(second.message).toContain('delta to 0.2');
    expect(second.message).toContain('askUser');
  });

  it('allows the same value again, which is only the model restating itself', () => {
    const turn = newTurn();
    checkRetune(turn, { delta: 0.2 });
    expect(checkRetune(turn, { delta: 0.2 }).retuned).toEqual([]);
  });

  it('records nothing from a refused call', () => {
    // The refusal means the change was not applied, so the record must not
    // claim it was — otherwise the next call is judged against a fiction.
    const turn = newTurn();
    checkRetune(turn, { delta: 0.2 });
    checkRetune(turn, { delta: 0.1, capital: 50000 });
    // capital never landed, so setting it now is still a first change.
    expect(checkRetune(turn, { capital: 50000 }).retuned).toEqual([]);
  });

  it('ignores nulls, which mean "leave this alone"', () => {
    const turn = newTurn();
    checkRetune(turn, { delta: 0.2, ticker: null });
    expect(checkRetune(turn, { ticker: 'NVDA' }).retuned).toEqual([]);
  });

  it('names every setting being re-tuned, not just the first', () => {
    const turn = newTurn();
    checkRetune(turn, { delta: 0.2, minMonths: 6 });
    expect(checkRetune(turn, { delta: 0.1, minMonths: 3 }).retuned).toEqual(['delta', 'minMonths']);
  });

  it('lets a fresh turn set the same setting again', () => {
    // The rule is per turn: the user asking for something else next message is
    // exactly when a setting SHOULD change again.
    const first = newTurn();
    checkRetune(first, { delta: 0.2 });
    expect(checkRetune(newTurn(), { delta: 0.1 }).retuned).toEqual([]);
  });

  it('treats 0.30 and 0.3 as the same value', () => {
    const turn = newTurn();
    checkRetune(turn, { delta: 0.3 });
    expect(checkRetune(turn, { delta: 0.30 }).retuned).toEqual([]);
  });
});
