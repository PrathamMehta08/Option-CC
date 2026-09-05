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
  setSort: z.object({
    key: SORT_KEY.describe('The column to sort by'),
    direction: SORT_DIRECTION.describe('Sort direction'),
  }),

  /**
   * Every screener setting in one call.
   *
   * The model emits one tool call per reply — that is how gpt-oss behaves, and
   * no prompt or provider flag changes it. So "NVDA, 20k, 30 delta, within 3
   * months" was four round trips, each re-sending the system prompt and all
   * twelve tool schemas, and a turn that should cost about 5,000 tokens cost
   * 12,000 against a limit of 8,000 a minute. That is the whole of the "the
   * last message always errors" bug. Setting them together makes it one trip.
   */
  applySettings: z.object({
    // Nullable rather than optional, and every key required. Groq validates
    // tool schemas strictly: the schema's "required" list must name every
    // property, so an .optional() field is rejected outright with "invalid
    // JSON schema for tool applySettings". null is how a field says "leave
    // this one alone".
    ticker: z.string().nullable().describe('Stock ticker, or null to leave it'),
    capital: z.number().nullable().describe('Capital in dollars, or null to leave it'),
    minMonths: z.number().int().min(0).max(24).nullable().describe('Min months to expiry, or null'),
    maxMonths: z.number().int().min(0).max(24).nullable().describe('Max months to expiry, or null'),
    delta: z.number().min(0).max(100).nullable().describe('Max delta (0.3 and 30 both mean a 30 delta), or null'),
    minStrike: z.number().nullable().describe('Min strike in dollars, or null'),
    maxStrike: z.number().nullable().describe('Max strike in dollars, or null'),
    strategy: z
      .enum(['covered-call', 'cash-secured-put'])
      .nullable()
      .describe('Only when the user says which they want; otherwise null'),
  }),

  readScreen: z.object({}),

  /**
   * Put one contract on screen as a card.
   *
   * The model names WHICH contract; the app renders it from its own row. That
   * split matters: a model asked to present a contract otherwise retypes its
   * figures into prose, and a retyped figure is one that can be wrong.
   */
  showOptionCard: z.object({
    expiration: z.string().describe('The contract expiration, exactly as readScreen gave it'),
    strike: z.number().describe('The strike price'),
  }),

  setResultsView: z.object({
    view: z.enum(['table', 'cards']).describe('How results are laid out on a phone'),
  }),

  showStockChart: z.object({
    ticker: z.string().describe('The stock ticker symbol'),
    range: z
      .enum(['1mo', '3mo', '6mo', '1y', '5y'])
      .describe('How far back the chart goes'),
  }),

  addComputedColumn: z.object({
    id: z.string().describe('Unique id'),
    name: z.string().max(24).describe('Short header, e.g. "OI x Yield"'),
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
    id: z.string().describe('Unique id'),
    name: z.string().describe('Short chip label, e.g. "High IV"'),
    mode: z.enum(['and', 'or']).describe('All conditions (and) or any (or)'),
    conditions: z
      .array(FilterConditionToolSchema)
      .min(1)
      .max(10)
      .describe(
        'Column, operator, value. "between" takes [low, high]; every other operator takes one number.'
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
  setSort:
    'Sort the table by a column. Superlatives are sorts: "cheapest" is lastPrice asc, "highest yield" is annualizedReturn desc.',

  readScreen:
    'Read what is on screen: company name and last price, the active strategy, how many contracts the scan returned and how many are showing, every filter and the sort, and the top rows. The ONLY tool that returns data — call it before answering anything about actual numbers. It reports the scan already loaded, so after setTicker a fresh scan takes a moment and may need a second read.',

  addComputedColumn:
    'Add a column computed from the numeric columns and sort by it. Use whenever the user ranks by something that is not a column — "oi^2 + ann return^2", "yield per day". Sorts by it descending on its own, so no setSort afterwards.',

  addCustomFilter:
    'Filter on numeric columns, for conditions the dedicated tools do not cover ("IV above 50", "open interest over 500"). Conditions are data, not code. Only the listed columns and operators exist; if the user asks for one outside them, do not call this tool.',

  applySettings:
    'Set any screener setting — ticker, capital, expiry window, delta, strike range, strategy. Set everything a request asks for in ONE call: you can only emit one call per reply, so a second is another round trip that re-sends this whole toolset and can exhaust the rate limit mid-answer. Pass null for every field the user did not mention; those are left alone. Months are whole numbers 0-24 ("within 3 months" is 0-3, LEAPS is 12-24). Delta 0.3 and 30 both mean a 30 delta. Use minStrike/maxStrike for any request that bounds the strike, in preference to addCustomFilter.',

  showOptionCard:
    'Show ONE contract as a card in the conversation. Use it whenever you single a contract out — the best, the cheapest, the one you are explaining. Take the expiration and strike straight from readScreen. The card carries every figure, so do NOT also list them in prose: say only why this one.',

  setResultsView:
    'Lay results out as a table or as cards on a phone. Use cards when presenting one contract to read rather than many to compare.',

  showStockChart:
    'Show a price chart for a stock in the conversation. Use when the user asks to see a chart, or how a stock has moved. It returns the price move over the range, which you may then describe.',
};

/**
 * The tool set handed to the model. Note there are no `execute` functions:
 * these are client-side tools, run in the browser against the already-fetched
 * chain, so the model emits the call and the UI performs it.
 */
export const assistantTools = {
  setSort: tool({ description: DESCRIPTIONS.setSort, parameters: TOOL_PARAMETERS.setSort }),
  applySettings: tool({
    description: DESCRIPTIONS.applySettings,
    parameters: TOOL_PARAMETERS.applySettings,
  }),
  readScreen: tool({ description: DESCRIPTIONS.readScreen, parameters: TOOL_PARAMETERS.readScreen }),
  showOptionCard: tool({
    description: DESCRIPTIONS.showOptionCard,
    parameters: TOOL_PARAMETERS.showOptionCard,
  }),
  setResultsView: tool({
    description: DESCRIPTIONS.setResultsView,
    parameters: TOOL_PARAMETERS.setResultsView,
  }),
  showStockChart: tool({
    description: DESCRIPTIONS.showStockChart,
    parameters: TOOL_PARAMETERS.showStockChart,
  }),
  addComputedColumn: tool({
    description: DESCRIPTIONS.addComputedColumn,
    parameters: TOOL_PARAMETERS.addComputedColumn,
  }),
  addCustomFilter: tool({
    description: DESCRIPTIONS.addCustomFilter,
    parameters: TOOL_PARAMETERS.addCustomFilter,
  }),
};
