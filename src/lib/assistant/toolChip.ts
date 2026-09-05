/**
 * What a tool call looks like to the user.
 *
 * The chips used to print the tool's result verbatim — but that string is
 * written for the model, not for a person. readScreen's result is the whole
 * screen summary, so the panel showed a paragraph of "Underlying: NVIDIA
 * Corporation (NVDA), last price $230.36. Strategy: Covered Calls... 2026-09-09
 * (4d) $235 strike — premium $1.03..." under a tick, restating a table the user
 * was already looking at.
 *
 * A chip should say what the assistant DID. The result still goes to the model
 * unchanged; only the display is summarised.
 */

export type ChipTone = 'done' | 'warn';

export interface ToolChip {
  tone: ChipTone;
  text: string;
}

/** Rejections and failures are the one case where the result IS the message. */
const SURFACE_VERBATIM =
  /^(Filter rejected|Formula rejected|Could not|No contract|No column|Unknown tool|The app could not)/;

/**
 * Rejections the assistant is expected to notice and fix inside the same turn.
 *
 * These strings are written FOR THE MODEL — "No contract on the current screen
 * expires 2027-03-19 at a $10 strike. Read the screen again..." is a correction
 * addressed to it, and it usually obeys: it re-reads and shows the right card a
 * step later. Printing the correction under a warning triangle turned a
 * self-repair the user never needed to know about into an error they had to
 * puzzle over, immediately above the correct answer.
 */
const RECOVERABLE = /^(No contract|No column|Formula rejected|Filter rejected)/;

/** The shape of a tool invocation, as much of it as the chips care about. */
export interface ChipInvocation {
  toolName: string;
  state?: string;
  result?: unknown;
}

const resultOf = (inv: ChipInvocation) =>
  inv.state === 'result' ? String(inv.result ?? '') : '';

/**
 * The invocations worth showing.
 *
 * A recoverable rejection is dropped when a later call to the same tool in the
 * same answer succeeded — the assistant fixed it, so the user sees the fix and
 * not the stumble. One that was never recovered from stays: it is the reason
 * nothing happened, and hiding it would leave the answer unexplained.
 */
export function visibleInvocations<T extends ChipInvocation>(all: T[]): T[] {
  return all.filter((inv, i) => {
    if (!RECOVERABLE.test(resultOf(inv))) return true;
    return !all.some(
      (later, j) =>
        j > i &&
        later.toolName === inv.toolName &&
        later.state === 'result' &&
        !RECOVERABLE.test(resultOf(later))
    );
  });
}

/** Sentences that tell the MODEL what to do next, rather than saying anything. */
const MODEL_INSTRUCTION = /^(Pick|Read|Use|Try|Choose|Call|Ask|Say)\b/;

/**
 * The part of a rejection a person needs.
 *
 * These messages end with an instruction to the model — "Read the screen again
 * and use an expiration and strike exactly as it gave them" — which is noise to
 * anyone else, and reads as an error being handed to the user. What went wrong
 * is kept; what the assistant should do about it is not. Anything genuinely
 * explanatory ("Valid fields are the numeric columns") stays.
 */
function forThePerson(text: string): string {
  const sentences = text.split(/(?<=\.)\s+/);
  while (sentences.length > 1 && MODEL_INSTRUCTION.test(sentences[sentences.length - 1])) {
    sentences.pop();
  }
  return sentences.join(' ');
}

const money = (v: unknown) => `$${Number(v).toLocaleString()}`;

/** A short, human phrase for one call. */
export function describeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  result?: string
): ToolChip {
  if (result && SURFACE_VERBATIM.test(result)) {
    return { tone: 'warn', text: forThePerson(result) };
  }

  switch (toolName) {
    case 'applySettings': {
      const parts: string[] = [];
      if (args.ticker != null) parts.push(String(args.ticker).toUpperCase());
      if (args.capital != null) parts.push(money(args.capital));
      if (args.delta != null) parts.push(`${args.delta} delta`);
      if (args.minMonths != null || args.maxMonths != null) {
        parts.push(`${args.minMonths ?? 'any'}–${args.maxMonths ?? 'any'} months`);
      }
      // A percentage takes precedence in the handler, so it does here too —
      // the chip said "strikes $0–$500" for a request that asked for 115% of
      // spot, which is not what happened and not what was asked.
      const lowStrike =
        args.minStrikePctOfSpot != null
          ? `${args.minStrikePctOfSpot}% of spot`
          : args.minStrike != null
            ? money(args.minStrike)
            : null;
      const highStrike =
        args.maxStrikePctOfSpot != null
          ? `${args.maxStrikePctOfSpot}% of spot`
          : args.maxStrike != null
            ? money(args.maxStrike)
            : null;
      if (lowStrike || highStrike) {
        parts.push(`strikes ${lowStrike ?? 'any'}–${highStrike ?? 'any'}`);
      }
      if (args.strategy != null) {
        parts.push(args.strategy === 'covered-call' ? 'covered calls' : 'cash-secured puts');
      }
      if (args.clearFilters === true) parts.push('filters cleared');
      else if (args.removeFilterField != null) {
        parts.push(`${args.removeFilterField} filter removed`);
      }
      if (args.filterField != null) {
        const symbols: Record<string, string> = {
          gt: '>',
          gte: '>=',
          lt: '<',
          lte: '<=',
          eq: '=',
          between: 'between',
        };
        const op = String(args.filterOp ?? 'gt');
        const high = args.filterValueHigh != null ? `-${args.filterValueHigh}` : '';
        parts.push(`filter ${args.filterField} ${symbols[op] ?? op} ${args.filterValue}${high}`);
      }
      // Nothing set means it looked rather than changed, which is what the
      // chip should say — not "no settings changed", which reads as a failure.
      return { tone: 'done', text: parts.length ? `Set ${parts.join(', ')}` : 'Read the screen' };
    }
    case 'setTicker':
      return { tone: 'done', text: `Ticker ${String(args.ticker).toUpperCase()}` };
    case 'setCapital':
      return { tone: 'done', text: `Capital ${money(args.capital)}` };
    case 'setMonthsRange':
      return { tone: 'done', text: `Expiry ${args.minMonths}–${args.maxMonths} months` };
    case 'setDelta':
      return { tone: 'done', text: `Max delta ${args.delta}` };
    case 'setStrikeRange':
      return { tone: 'done', text: `Strikes ${money(args.minStrike)}–${money(args.maxStrike)}` };
    case 'setSort':
      return { tone: 'done', text: `Sorted by ${args.key} ${args.direction}` };
    case 'setStrategy':
      return {
        tone: 'done',
        text: args.strategy === 'covered-call' ? 'Covered calls' : 'Cash-secured puts',
      };
    case 'setResultsView':
      return { tone: 'done', text: `Showing ${args.view}` };
    case 'addCustomFilter':
      return { tone: 'done', text: `Filter added${args.name ? `: ${args.name}` : ''}` };
    case 'addComputedColumn':
      return { tone: 'done', text: `Column added${args.name ? `: ${args.name}` : ''}` };
    case 'readScreen':
      // Deliberately says nothing about the data: the table is on screen, and
      // the model is about to say whatever is worth saying about it.
      return { tone: 'done', text: 'Read the screen' };
    case 'showOptionCard':
      return { tone: 'done', text: `Card: $${args.strike} ${args.expiration}` };
    case 'showStockChart':
      return { tone: 'done', text: `Chart: ${String(args.ticker).toUpperCase()}` };
    default:
      return { tone: 'done', text: toolName };
  }
}
