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
  /^(Filter rejected|Formula rejected|Could not|No contract|Unknown tool|The app could not|Nothing to change)/;

const money = (v: unknown) => `$${Number(v).toLocaleString()}`;

/** A short, human phrase for one call. */
export function describeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  result?: string
): ToolChip {
  if (result && SURFACE_VERBATIM.test(result)) {
    return { tone: 'warn', text: result };
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
      if (args.minStrike != null || args.maxStrike != null) {
        parts.push(`strikes ${money(args.minStrike ?? 0)}–${money(args.maxStrike ?? 0)}`);
      }
      if (args.strategy != null) {
        parts.push(args.strategy === 'covered-call' ? 'covered calls' : 'cash-secured puts');
      }
      return { tone: 'done', text: parts.length ? `Set ${parts.join(', ')}` : 'No settings changed' };
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
