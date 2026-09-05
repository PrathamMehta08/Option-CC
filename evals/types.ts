/** Shapes for the eval cases and results. Cases are data; this describes them. */

export type Category =
  | 'direct'
  | 'unit-implicit'
  | 'compound'
  | 'filter'
  | 'sort'
  | 'ambiguous'
  | 'out-of-scope'
  | 'adversarial';

export interface ExpectedCall {
  tool: string;
  /** Partial: only the keys named here are compared. Extra args are ignored. */
  args?: Record<string, unknown>;
}

export type Expectation =
  | ExpectedCall
  | { tools: ExpectedCall[] }
  | { none: true };

export interface EvalCase {
  id: string;
  category: Category;
  prompt: string;
  expect: Expectation;
  /** Other acceptable answers, for genuinely ambiguous requests. */
  alternatives?: Expectation[];
  notes?: string;
}

/** What the model actually emitted for one tool call. */
export interface ActualCall {
  tool: string;
  args: Record<string, unknown>;
  /** Outcome of running these args through the real Zod schema. */
  validation: 'valid' | 'rejected-by-schema' | 'unknown-tool';
  validationError?: string;
}

export type Outcome =
  /** Right tool, right args. */
  | 'correct'
  /** Well-formed but not what was asked for. */
  | 'wrong'
  /** Failed the Zod schema. A pass only for adversarial cases. */
  | 'rejected-by-schema'
  /** The request errored against the provider. */
  | 'error';

export interface CaseResult {
  id: string;
  category: Category;
  prompt: string;
  expect: Expectation;
  actual: ActualCall[];
  /** Any prose the model returned alongside (or instead of) tool calls. */
  text: string;
  outcome: Outcome;
  pass: boolean;
  reason: string;
  error?: string;
  latencyMs: number;
  /** What this case cost, summed over every step it took. */
  usage: { prompt: number; completion: number; total: number };
}

export interface CategorySummary {
  category: Category;
  total: number;
  passed: number;
  passRate: number;
  correct: number;
  wrong: number;
  rejectedBySchema: number;
  errors: number;
}

export interface RunReport {
  startedAt: string;
  finishedAt: string;
  model: string;
  systemPromptHash: string;
  toolsHash: string;
  filter?: { category?: string; case?: string };
  total: number;
  passed: number;
  passRate: number;
  byCategory: CategorySummary[];
  results: CaseResult[];
}
