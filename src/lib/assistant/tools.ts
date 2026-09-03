import { tool } from 'ai';
import { z } from 'zod';
import { FilterConditionToolSchema } from '@/lib/filters';
import { NUMERIC_FIELDS } from '@/lib/optionChain';
import { FORMULA_FUNCTIONS } from '@/lib/formula';

/**
 * The assistant's tool definitions — the single source of truth.
 *
 * Both the API route and the eval harness import these. A harness with its own
 * copy of the tools measures a fiction: the numbers would keep passing while
 * the shipped route drifted underneath them.
 */

// Free-form strings let the model answer "descending" where the UI expects
// "desc", silently producing a no-op sort. Enums make the provider conform.
export const SORT_KEY = z.enum([...NUMERIC_FIELDS, 'expiration', 'returnPct']);

export const SORT_DIRECTION = z.enum(['asc', 'desc']);

/**
 * Parameter schemas by tool name, exposed separately so the grader can run
 * every emitted tool call through the exact schema the route enforces.
 */
export const TOOL_PARAMETERS = {
  setTicker: z.object({
    ticker: z.string().describe('The stock ticker symbol'),
  }),

  setCapital: z.object({
    capital: z.number().describe('The capital amount in dollars'),
  }),

  setMonthsRange: z.object({
    // Whole months only. The model was emitting 0.8 to 1.2 for "about a month
    // out"; the UI slider is integer months, so a fraction is unusable. An
    // integer JSON schema makes the provider's constrained decoding enforce it.
    minMonths: z.number().int().min(0).max(24).describe('Minimum months to expiration, a whole number'),
    maxMonths: z.number().int().min(0).max(24).describe('Maximum months to expiration, a whole number'),
  }),

  setDelta: z.object({
    delta: z.number().min(0).max(1).describe('The delta magnitude, between 0 and 1'),
  }),

  setStrikeRange: z.object({
    minStrike: z.number().describe('Minimum strike price'),
    maxStrike: z.number().describe('Maximum strike price'),
  }),

  setSort: z.object({
    key: SORT_KEY.describe('The column to sort by'),
    direction: SORT_DIRECTION.describe('Sort direction'),
  }),

  readScreen: z.object({}),

  addComputedColumn: z.object({
    id: z.string().describe('A unique identifier for this column'),
    name: z.string().max(24).describe('A short column header, e.g. "OI x Yield"'),
    expression: z
      .string()
      .max(200)
      .describe(
        'An arithmetic formula over the numeric columns, e.g. "openInterest^2 + annualizedReturn^2". Operators + - * / % ^ and parentheses; functions ' +
          FORMULA_FUNCTIONS.join(', ') +
          '. Use column names, not values. This is arithmetic only — it is not JavaScript.'
      ),
  }),

  addCustomFilter: z.object({
    id: z.string().describe('A unique identifier for this filter'),
    name: z.string().describe('A short, human-readable name for the filter chip, e.g. "High IV"'),
    mode: z.enum(['and', 'or']).describe('Whether every condition must hold ("and") or any one ("or")'),
    conditions: z
      .array(FilterConditionToolSchema)
      .min(1)
      .max(10)
      .describe(
        'The conditions. Each is a column, an operator, and a value. "between" takes a [low, high] pair; every other operator takes a single number. IV is a percentage (50 means 50%), delta is signed, moneyness is a percentage.'
      ),
  }),
} as const;

export type ToolName = keyof typeof TOOL_PARAMETERS;

export const TOOL_NAMES = Object.keys(TOOL_PARAMETERS) as ToolName[];

export function isToolName(value: string): value is ToolName {
  return value in TOOL_PARAMETERS;
}

/** Human-facing descriptions, kept beside the schemas they document. */
const DESCRIPTIONS: Record<ToolName, string> = {
  setTicker: 'Set the stock ticker symbol to analyze (e.g. AAPL, TSLA)',

  setCapital: 'Set the total capital available for the user to trade with, in dollars.',

  setMonthsRange:
    'Set the months-to-expiration window. Whole months from 0 to 24. "Within 3 months" is 0 to 3; "about a month out" is 0 to 2; "nothing under a year" (LEAPS) is 12 to 24. Never use fractional months.',

  setDelta:
    'Set the delta limit for the options. Give the magnitude as a positive number between 0 and 1 (e.g. 0.3 for a 30 delta); the app applies the correct sign for the active strategy. This is an independent screener setting — set it whenever the user names a delta, without needing a ticker first.',

  setStrikeRange:
    'Set the minimum and maximum strike price, in dollars. This is the right tool for ANY request that bounds the strike ("strikes between 100 and 200", "nothing above 250") — prefer it over addCustomFilter for strike bounds.',

  setSort:
    'Sort the option data table by a column. Column meanings: lastPrice is the per-share premium (the table\'s "Premium" column, and what "sort by premium" means); totalPremiumReceived is that premium times the number of contracts the user can afford; annualizedReturn is the yield. Use this for superlatives too: "cheapest" is lastPrice asc, "highest yield" is annualizedReturn desc.',

  readScreen:
    "Read what is currently on screen: the underlying and its last price, how many contracts the scan returned and how many are showing, the active filters and sort, and the top rows. EVERY other tool only changes settings and tells you nothing about the data, so this is the only way to answer a question about actual numbers — a price, a count, which contract is best. Call it before answering any such question rather than guessing. It reports the scan that has already loaded; if the user asks about a different underlying, call setTicker first, and note that a fresh scan takes a moment, so a follow-up read may be needed.",

  addComputedColumn:
    'Add a new column computed from the existing numeric columns, and sort by it. Use this whenever the user asks to rank or score by something that is not already a column — "sort by oi^2 + ann return^2", "score by yield per day", "premium times open interest". Give the formula as arithmetic over column names; the table sorts by the new column descending as soon as it is added, so you do not need to call setSort afterwards.',

  addCustomFilter:
    'Filter the option table on numeric columns. Use this for conditions the dedicated tools do not cover, e.g. "IV above 50" or "open interest over 500 and annualized return above 20". Emit conditions as data; do not write code. Column units: iv is a percentage (50 means 50%); moneyness is the SIGNED percentage distance of the strike from the current price, where 0 is at the money, +5 is 5% above spot and -5 is 5% below, so "5% out of the money" is an absolute moneyness of 5, never 95; annualizedReturn is a percentage. Only the listed columns and operators exist — if the user asks for a column or an expression outside them, do not call this tool.',
};

/**
 * The tool set handed to the model. Note there are no `execute` functions:
 * these are client-side tools, run in the browser against the already-fetched
 * chain, so the model emits the call and the UI performs it.
 */
export const assistantTools = {
  setTicker: tool({ description: DESCRIPTIONS.setTicker, parameters: TOOL_PARAMETERS.setTicker }),
  setCapital: tool({ description: DESCRIPTIONS.setCapital, parameters: TOOL_PARAMETERS.setCapital }),
  setMonthsRange: tool({
    description: DESCRIPTIONS.setMonthsRange,
    parameters: TOOL_PARAMETERS.setMonthsRange,
  }),
  setDelta: tool({ description: DESCRIPTIONS.setDelta, parameters: TOOL_PARAMETERS.setDelta }),
  setStrikeRange: tool({
    description: DESCRIPTIONS.setStrikeRange,
    parameters: TOOL_PARAMETERS.setStrikeRange,
  }),
  setSort: tool({ description: DESCRIPTIONS.setSort, parameters: TOOL_PARAMETERS.setSort }),
  readScreen: tool({ description: DESCRIPTIONS.readScreen, parameters: TOOL_PARAMETERS.readScreen }),
  addComputedColumn: tool({
    description: DESCRIPTIONS.addComputedColumn,
    parameters: TOOL_PARAMETERS.addComputedColumn,
  }),
  addCustomFilter: tool({
    description: DESCRIPTIONS.addCustomFilter,
    parameters: TOOL_PARAMETERS.addCustomFilter,
  }),
};
