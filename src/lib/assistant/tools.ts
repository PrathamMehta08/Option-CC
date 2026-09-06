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

/** The columns that always exist, for the sort tool's description. */
export const FIXED_SORT_KEYS = [...NUMERIC_FIELDS, 'expiration', 'returnPct'] as const;

export const SORT_DIRECTION = z.enum(['asc', 'desc']);

/**
 * Parameter schemas by tool name, exposed separately so the grader can run
 * every emitted tool call through the exact schema the route enforces.
 */
export const TOOL_PARAMETERS = {
  setSort: z.object({
    // A plain string, NOT an enum. addComputedColumn creates columns with
    // ids the model chooses, and an enum fixed at build time can never contain
    // them — so sorting by a column the assistant had just added was rejected
    // outright by the provider. The app validates the key instead and says
    // which ones exist when it does not recognise one.
    key: z
      .string()
      .describe(
        'The column to sort by: one of ' +
          FIXED_SORT_KEYS.join(', ') +
          ', or the id of a computed column you added'
      ),
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
    // Nullish: nullable AND optional. This started as nullable-and-required,
    // on the belief that the provider demanded every property in "required".
    // That belief cost a real failure — the model sent {ticker, capital, delta,
    // months} without the two strike keys and the provider rejected its own
    // model's call: "parameters for tool applySettings did not match schema:
    // missing properties: minStrike, maxStrike". A ten-field tool where every
    // field must appear every time will be omitted from eventually.
    //
    // Measured against Groq on 2026-09-05: a schema whose "required" is empty
    // is accepted (HTTP 200) and the model then sends only the keys it means.
    // Whatever produced that earlier rejection, this is what the provider does
    // now, and the tests below assert it.
    // NOTHING here carries a min/max/enum alongside .nullish().
    //
    // zod-to-json-schema cannot express a CONSTRAINED nullable as a simple type
    // union, so it emits `anyOf: [{type:number,minimum:0}, {type:null}]` — and
    // this provider rejects anyOf in tool parameters, the same "anyOf
    // disambiguation failed" that forced the filter schema flat earlier. An
    // unconstrained nullable serialises as {"type":["number","null"]}, which it
    // accepts. The bounds are enforced in the app instead, by withMonthsFrom,
    // normalizeDelta and the strategy lookup, which have to be defensive about
    // model output anyway.
    ticker: z.string().nullish().describe('Stock ticker, or null to leave it'),
    capital: z.number().nullish().describe('Capital in dollars, or null to leave it'),
    minMonths: z.number().nullish().describe('Min whole months to expiry, 0-24, or null'),
    maxMonths: z.number().nullish().describe('Max whole months to expiry, 0-24, or null'),
    delta: z
      .number()
      .nullish()
      .describe('Max delta 0-1. Above 1 is hundredths (30 = 0.30); 1 or less is used as given, so 1 means 1.00'),
    minStrike: z.number().nullish().describe('Min strike in dollars, or null'),
    maxStrike: z.number().nullish().describe('Max strike in dollars, or null'),
    // Percentages of spot, so "strikes from 115% of the current price" does not
    // require knowing the price first. The model was stopping to ask for it,
    // which is a whole round trip to learn something the app already knows.
    minStrikePctOfSpot: z
      .number()
      .nullish()
      .describe('Min strike as a % of the current price (115 = 15% above), or null'),
    maxStrikePctOfSpot: z
      .number()
      .nullish()
      .describe('Max strike as a % of the current price, or null'),
    strategy: z
      .string()
      .nullish()
      .describe('"covered-call" or "cash-secured-put", only when the user says which they want; otherwise null'),
    // A filter in the same call as the settings, because a second call is a
    // step the model sometimes never takes: asked to set a screen "and then
    // filter IV above 40", it set the screen, worked the answer out from the
    // rows it could see, and said what the filter WOULD do without ever
    // applying it. The user was left with a claim they could not check.
    //
    // Flat scalars, not a nested object, and this is not a style choice. A
    // nullable object serialises as anyOf, which the provider rejects; an
    // optional object gets sent as `"filter": null` by a model filling in
    // every key it knows about, and the provider rejects that too — "expected
    // object, but got null". Nullable scalars are the one shape that survives
    // both. Several conditions at once still go through addCustomFilter.
    filterField: z
      .string()
      .nullish()
      .describe('Column to filter on, e.g. "iv" or "openInterest", or null for no filter'),
    filterOp: z
      .string()
      .nullish()
      .describe('gt, gte, lt, lte, eq or between — required when filterField is given'),
    filterValue: z
      .number()
      .nullish()
      .describe(
        'The number to compare against, in the column\u2019s own units: lastPrice and strike are dollars ($2 is 2), iv, moneyness and the return columns are percentages (40 is 40%), delta is 0-1. The low end when filterOp is between'
      ),
    filterValueHigh: z
      .number()
      .nullish()
      .describe('The high end, for filterOp between only; otherwise null'),
    // Filters could be added and never taken away. Asked to "remove iv
    // filter", the model reached for the only filter tool it had and added
    // `iv >= 0`, which of course removes nothing — the IV > 40 filter was
    // still there, the screen was still empty, and it spent three steps
    // proving it.
    clearFilters: z
      .boolean()
      .nullish()
      .describe('true removes every custom filter. Use this to undo filtering; never add a permissive filter to cancel one'),
    removeFilterField: z
      .string()
      .nullish()
      .describe('Removes only the filters on this column, e.g. "iv"'),
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

  // The way out of a request the model cannot honestly act on. Without it, a
  // first step that must call a tool has no legal way to say "which did you
  // mean" — and "make it safer" became delta 0.2, then 0.1 at a 110% strike
  // floor, then 0.05 at 120%: three changes nobody asked for, ending on an
  // empty screen the model then explained.
  askUser: z.object({
    question: z
      .string()
      .describe('The one thing you need to know, in a sentence, in their own terms'),
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
    'Sort the table by a column. Superlatives are sorts: "cheapest" is lastPrice asc, "highest yield" is annualizedReturn desc. addComputedColumn already sorts by the column it creates, so it needs no setSort afterwards.',

  readScreen:
    'Read what is on screen: company name and last price, the active strategy, how many contracts the scan returned and how many are showing, every filter and the sort, and the top rows. The ONLY tool that returns data — call it before answering anything about actual numbers. It reports the scan already loaded, so after setTicker a fresh scan takes a moment and may need a second read.',

  addComputedColumn:
    'Add a column computed from the numeric columns and sort by it. Use whenever the user ranks by something that is not a column — "oi^2 + ann return^2", "yield per day". Sorts by it descending on its own, so no setSort afterwards.',

  askUser:
    'Ask the user what they mean, or tell them a request is outside this app. Nothing on the screen changes. Use it when a request could reasonably mean several different changes ("make it safer", "better returns"), when it names something the app does not have, or when it is not about options or this screener at all. Guessing at an ambiguous request and then tuning the guess is always wrong — ask once instead.',

  addCustomFilter:
    'Filter on numeric columns, for conditions the dedicated tools do not cover ("IV above 50", "open interest over 500"). Conditions are data, not code. Only the listed columns and operators exist; if the user asks for one outside them, do not call this tool.',

  applySettings:
    'Set any screener setting — ticker, capital, expiry window, delta, strike range, strategy — and get the resulting screen back. Set everything a request asks for in ONE call; a second call is another round trip that can exhaust the rate limit. Pass null for every field not mentioned; those are left alone. Months are whole numbers 0-24 ("within 3 months" is 0-3). Delta 0.3 and 30 both mean a 30 delta. Use minStrike/maxStrike to bound the strike, not addCustomFilter — or minStrikePctOfSpot/maxStrikePctOfSpot to express it relative to the current price (115 means 15% above), which needs no knowledge of that price. Its result already contains everything readScreen would return, so do NOT call readScreen after it. If the request also asks to filter on a column ("IV above 40", "open interest over 500"), pass filterField/filterOp/filterValue in this same call rather than describing what such a filter would do. To take a filter off, pass removeFilterField (that column) or clearFilters: true (all of them) — adding a permissive filter does not cancel an existing one.',

  showOptionCard:
    'Show ONE contract as a card. REQUIRED whenever your answer names a specific contract — the best, the cheapest, the one you are explaining. Take the expiration and strike exactly as the screen gave them. The card carries every figure, so do NOT also list them in prose: say only why this one.',

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
  askUser: tool({ description: DESCRIPTIONS.askUser, parameters: TOOL_PARAMETERS.askUser }),
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
