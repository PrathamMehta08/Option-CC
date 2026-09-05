import { z } from 'zod';
import { NUMERIC_FIELDS, type NumericField, type ScreenedOption } from './optionChain';

/**
 * Structured filters for the assistant.
 *
 * The assistant used to return a JavaScript expression string that the page ran
 * through `new Function('opt', 'return ' + code)`. That is arbitrary code
 * execution in the user's browser, driven by model output — a prompt-injected
 * or simply confused model could read globals, exfiltrate, or loop forever.
 *
 * The model now emits data, not code. Every field is an enum of real columns
 * and every operator is an enum, so there is nothing to escape from. Anything
 * that fails validation is rejected and reported, never silently dropped.
 */

export const FILTER_FIELDS = NUMERIC_FIELDS;

export const FilterFieldSchema = z.enum(NUMERIC_FIELDS);

export const FILTER_OPS = ['gt', 'gte', 'lt', 'lte', 'eq', 'between'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

/**
 * One comparison: a column, an operator, and one or two numbers.
 *
 * `value` is always an array — one element for the scalar operators, two for
 * `between`. A discriminated union on `op` would read better, but Groq's tool
 * schema validator rejects an `anyOf` whose branches share candidate
 * discriminator properties ("anyOf disambiguation failed"). A single uniform
 * object is what the provider will actually accept, and the arity rule is
 * enforced by `FilterConditionSchema` below.
 */
export const FilterConditionToolSchema = z.object({
  field: FilterFieldSchema,
  op: z.enum(FILTER_OPS),
  value: z
    .array(z.number().finite())
    .min(1)
    .max(2)
    .describe('One number for gt/gte/lt/lte/eq; exactly two ([low, high]) for between'),
});

/** The same shape, plus the arity rule the JSON schema cannot express. */
export const FilterConditionSchema = FilterConditionToolSchema.superRefine((condition, ctx) => {
  const needed = condition.op === 'between' ? 2 : 1;
  if (condition.value.length !== needed) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message:
        condition.op === 'between'
          ? 'between requires exactly two values, [low, high]'
          : `${condition.op} requires exactly one value`,
    });
  }
});

export type FilterCondition = z.infer<typeof FilterConditionSchema>;

export const CustomFilterSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
  /** How to combine conditions. Defaults to `and`. */
  mode: z.enum(['and', 'or']).default('and'),
  conditions: z.array(FilterConditionSchema).min(1).max(10),
});

export type CustomFilter = z.infer<typeof CustomFilterSchema>;

/** Human-readable operator, for filter chips and tool results. */
const OP_LABEL: Record<FilterOp, string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  eq: '=',
  between: 'between',
};

export function describeCondition(condition: FilterCondition): string {
  if (condition.op === 'between') {
    return `${condition.field} between ${condition.value[0]} and ${condition.value[1]}`;
  }
  return `${condition.field} ${OP_LABEL[condition.op]} ${condition.value[0]}`;
}

export function describeFilter(filter: CustomFilter): string {
  return filter.conditions.map(describeCondition).join(filter.mode === 'or' ? ' or ' : ' and ');
}

/** Evaluate one condition against one row. No code is executed. */
export function evaluateCondition(option: ScreenedOption, condition: FilterCondition): boolean {
  const actual = option[condition.field as NumericField];
  if (typeof actual !== 'number' || Number.isNaN(actual)) return false;

  const [first, second] = condition.value;

  switch (condition.op) {
    case 'gt':
      return actual > first;
    case 'gte':
      return actual >= first;
    case 'lt':
      return actual < first;
    case 'lte':
      return actual <= first;
    case 'eq':
      return actual === first;
    case 'between': {
      // Accept the pair in either order rather than silently matching nothing.
      const low = Math.min(first, second);
      const high = Math.max(first, second);
      return actual >= low && actual <= high;
    }
  }
}

/** Does a row satisfy a whole filter? */
export function matchesFilter(option: ScreenedOption, filter: CustomFilter): boolean {
  if (filter.conditions.length === 0) return true;
  return filter.mode === 'or'
    ? filter.conditions.some((c) => evaluateCondition(option, c))
    : filter.conditions.every((c) => evaluateCondition(option, c));
}

/** Apply every active filter (always AND across separate filters). */
export function applyFilters(options: ScreenedOption[], filters: CustomFilter[]): ScreenedOption[] {
  if (filters.length === 0) return options;
  return options.filter((option) => filters.every((filter) => matchesFilter(option, filter)));
}

export type FilterParseResult =
  | { ok: true; filter: CustomFilter }
  | { ok: false; error: string };

/**
 * Validate untrusted tool arguments into a filter. Callers surface the error
 * rather than dropping the filter, so a rejected filter is visible to both the
 * user and the model instead of silently narrowing nothing.
 */
export function parseCustomFilter(input: unknown): FilterParseResult {
  const parsed = CustomFilterSchema.safeParse(input);
  if (parsed.success) return { ok: true, filter: parsed.data };

  const detail = parsed.error.issues
    .map((issue) => {
      const path = issue.path.join('.') || 'filter';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
  return { ok: false, error: detail || 'Filter did not match the expected shape.' };
}

/**
 * The columns a filter constrains, sorted and joined.
 *
 * Filters were only ever replaced by id, and every call mints a fresh one — so
 * asking twice for the same thing stacked four identical "premiumSharePct ≥ 15"
 * chips on the screen. Worse, a second thought ("IV above 40" then "make that
 * 30") ANDed the two and left the stricter one silently in charge.
 *
 * A filter over the same columns replaces the one that was there.
 */
export function filterFields(filter: CustomFilter): string {
  return [...new Set(filter.conditions.map((c) => c.field))].sort().join(',');
}
