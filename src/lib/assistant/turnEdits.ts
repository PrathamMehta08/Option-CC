/**
 * What this turn has already changed.
 *
 * The prompt asks the assistant not to tune a guess, and it does anyway: given
 * "make it safer" it set delta 0.2, read the result, set 0.1 with a 110% strike
 * floor, then 0.05 with 120% — three changes nobody asked for, ending on an
 * empty screen it then explained. Each step looks locally reasonable; together
 * they walk the screen somewhere the user never asked to go.
 *
 * So the app holds the line the prompt only requests: a setting may be changed
 * once per turn. A second, DIFFERENT value for the same setting is refused and
 * the assistant is told to ask instead. Repeating the same value is allowed —
 * that is a model restating itself, not moving the goalposts.
 */
export interface TurnEdits {
  /** Setting name to the value this turn already gave it. */
  applied: Map<string, unknown>;
}

export function newTurn(): TurnEdits {
  return { applied: new Map() };
}

export interface RetuneCheck {
  /** Settings being changed a second time, to a different value. */
  retuned: string[];
  /** Every setting given is already in force: the call changes nothing. */
  noChange: boolean;
  /** The message for the model, when there is something to say. */
  message?: string;
}

const same = (a: unknown, b: unknown) =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b;

/**
 * Which of these settings this turn has already set to something else.
 * Records the rest, so the first change of each always goes through.
 */
export function checkRetune(turn: TurnEdits, changes: Record<string, unknown>): RetuneCheck {
  const retuned: string[] = [];

  for (const [field, value] of Object.entries(changes)) {
    if (value == null) continue;
    if (turn.applied.has(field) && !same(turn.applied.get(field), value)) {
      retuned.push(field);
    }
  }

  // Nothing is recorded when the call is refused: the refusal means none of it
  // was applied, so the turn's record must not claim otherwise.
  if (retuned.length > 0) {
    return {
      retuned,
      noChange: false,
      message:
        `Already set ${retuned
          .map((f) => `${f} to ${String(turn.applied.get(f))}`)
          .join(', ')} in this turn, and nothing has changed since. ` +
        `Changing it again is tuning your own guess. Say what the screen shows, ` +
        `or call askUser to ask what they meant — do not try another value.`,
    };
  }

  // Every value given is the one already in force. Applying it again produces
  // an identical screen and spends a step: asked for "nothing above a 15
  // delta", the model set delta 0.15 three times over.
  const given = Object.entries(changes).filter(([, value]) => value != null);
  const noChange =
    given.length > 0 && given.every(([field, value]) => same(turn.applied.get(field), value));

  for (const [field, value] of given) turn.applied.set(field, value);

  if (noChange) {
    return {
      retuned: [],
      noChange: true,
      message:
        'Those settings are already in force from earlier in this turn, so nothing changed. ' +
        'Answer from the screen you were given rather than applying them again.',
    };
  }
  return { retuned: [], noChange: false };
}
