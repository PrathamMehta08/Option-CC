import { TOOL_PARAMETERS, isToolName } from '@/lib/assistant/tools';
import type { ActualCall, EvalCase, ExpectedCall, Expectation, Outcome } from './types';

/** Numeric args compare with a small tolerance so 0.30000000000000004 passes. */
const NUMERIC_TOLERANCE = 1e-6;

function numbersMatch(a: number, b: number): boolean {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  const diff = Math.abs(a - b);
  if (diff <= NUMERIC_TOLERANCE) return true;
  // Relative tolerance for large values, e.g. capital in the millions.
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale > 0 && diff / scale <= NUMERIC_TOLERANCE;
}

/** Tickers are uppercased, other strings compared case-insensitively. */
function stringsMatch(expected: string, actual: string, key?: string): boolean {
  if (key === 'ticker') return expected.toUpperCase() === actual.toUpperCase();
  return expected.trim().toLowerCase() === actual.trim().toLowerCase();
}

function valuesMatch(expected: unknown, actual: unknown, key?: string): boolean {
  if (typeof expected === 'number' && typeof actual === 'number') {
    return numbersMatch(expected, actual);
  }
  if (typeof expected === 'string' && typeof actual === 'string') {
    return stringsMatch(expected, actual, key);
  }
  if (typeof expected === 'boolean' || expected === null) return expected === actual;

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) return false;
    // Positional first — right for a [low, high] value pair.
    const positional = expected.every((e, i) => valuesMatch(e, actual[i], key));
    if (positional) return true;
    // Fall back to order-independent for arrays of objects, e.g. filter
    // conditions, where the order the model lists them in is not meaningful.
    if (!expected.every((e) => e && typeof e === 'object')) return false;
    const remaining = [...actual];
    for (const e of expected) {
      const idx = remaining.findIndex((a) => valuesMatch(e, a, key));
      if (idx === -1) return false;
      remaining.splice(idx, 1);
    }
    return true;
  }

  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
    // Partial: only the keys the case names are compared.
    return Object.entries(expected as Record<string, unknown>).every(([k, v]) =>
      valuesMatch(v, (actual as Record<string, unknown>)[k], k)
    );
  }

  return expected === actual;
}

/** Does one emitted call satisfy one expected call? */
/** Whether two calls carry the same arguments, nulls and all. */
function sameArgs(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const x = a[key] ?? null;
    const y = b[key] ?? null;
    if (typeof x === 'number' && typeof y === 'number') {
      if (Math.abs(x - y) > 1e-9) return false;
    } else if (JSON.stringify(x) !== JSON.stringify(y)) {
      return false;
    }
  }
  return true;
}

/** Tools that show rather than change, and so are never unwanted extras. */
const PRESENTATIONAL = new Set(['showOptionCard', 'showStockChart', 'readScreen', 'setResultsView']);

function callMatches(expected: ExpectedCall, actual: ActualCall): boolean {
  if (expected.tool !== actual.tool) return false;
  if (!expected.args) return true;
  return Object.entries(expected.args).every(([k, v]) => valuesMatch(v, actual.args[k], k));
}

function isNoneExpectation(e: Expectation): e is { none: true } {
  return 'none' in e && e.none === true;
}

function expectedCalls(e: Expectation): ExpectedCall[] {
  if (isNoneExpectation(e)) return [];
  if ('tools' in e) return e.tools;
  return [e];
}

/**
 * Does the set of emitted calls satisfy an expectation?
 * Order-independent: each expected call must be matched by a distinct actual.
 */
function satisfies(expectation: Expectation, actual: ActualCall[]): boolean {
  if (isNoneExpectation(expectation)) return actual.length === 0;

  const wanted = expectedCalls(expectation);
  const remaining = [...actual];
  const matched: ActualCall[] = [];
  for (const want of wanted) {
    const idx = remaining.findIndex((a) => callMatches(want, a));
    if (idx === -1) return false;
    matched.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  // Extra calls that CHANGE something are a failure: the assistant altered what
  // the user did not ask it to. Calls that only SHOW something are not — the
  // prompt requires a card whenever an answer names a contract, so "show me
  // AAPL" ends in applySettings + showOptionCard by design, and scoring that
  // wrong marks the model down for following its instructions.
  return remaining.every(
    (call) =>
      PRESENTATIONAL.has(call.tool) ||
      // A call that repeats one already matched changes nothing the second
      // time — the app applies the same value again and the screen is
      // identical. Sloppy, not wrong, and not the user''s settings being
      // altered behind their back.
      matched.some((m) => m.tool === call.tool && sameArgs(m.args, call.args))
  );
}

/** Run emitted args through the real Zod schema the route enforces. */
export function validateCall(tool: string, args: Record<string, unknown>): {
  validation: ActualCall['validation'];
  validationError?: string;
} {
  if (!isToolName(tool)) {
    return { validation: 'unknown-tool', validationError: `no such tool: ${tool}` };
  }
  const parsed = TOOL_PARAMETERS[tool].safeParse(args);
  if (parsed.success) return { validation: 'valid' };
  return {
    validation: 'rejected-by-schema',
    validationError: parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; '),
  };
}

export interface Grade {
  outcome: Outcome;
  pass: boolean;
  reason: string;
}

/**
 * Why the calls did not match, in terms of the argument that differed.
 *
 * "emitted applySettings, showOptionCard which does not match" sent me looking
 * for a rule about extra calls when the real difference was maxMonths 1 against
 * an expected 2. The reason line has to name the disagreement.
 */
function explainMismatch(expectation: Expectation, actual: ActualCall[]): string {
  const emitted = actual.map((c) => c.tool).join(', ');
  if (isNoneExpectation(expectation)) return `expected no tool call, emitted ${emitted}`;

  for (const want of expectedCalls(expectation)) {
    const sameTool = actual.filter((a) => a.tool === want.tool);
    if (sameTool.length === 0) {
      return `expected ${want.tool}, emitted ${emitted}`;
    }
    if (!want.args) continue;
    const differences = Object.entries(want.args)
      .filter(([key, value]) => !valuesMatch(value, sameTool[0].args[key], key))
      .map(([key, value]) => `${key} ${JSON.stringify(sameTool[0].args[key])} ≠ ${JSON.stringify(value)}`);
    if (differences.length > 0) return `${want.tool}: ${differences.join(', ')}`;
  }

  // Every expected call is present and correct, so the mismatch is something
  // extra that changes state.
  return `emitted ${emitted} — one of these changes something that was not asked for`;
}

export function grade(testCase: EvalCase, actual: ActualCall[], errored?: string): Grade {
  if (errored) {
    return { outcome: 'error', pass: false, reason: `provider error: ${errored}` };
  }

  const anyRejected = actual.some(
    (c) => c.validation === 'rejected-by-schema' || c.validation === 'unknown-tool'
  );
  const isAdversarial = testCase.category === 'adversarial';

  // Schema rejection is the schema doing its job. For an adversarial case that
  // is the point, so it passes; anywhere else it means the assistant produced
  // something the app would refuse, which is a failure.
  if (anyRejected) {
    const detail = actual
      .filter((c) => c.validation !== 'valid')
      .map((c) => `${c.tool}: ${c.validationError}`)
      .join(' | ');
    return {
      outcome: 'rejected-by-schema',
      pass: isAdversarial,
      reason: isAdversarial
        ? `schema rejected the call, which is the defence working (${detail})`
        : `schema rejected the call (${detail})`,
    };
  }

  const options: Expectation[] = [testCase.expect, ...(testCase.alternatives ?? [])];
  const matched = options.some((option) => satisfies(option, actual));

  if (matched) {
    return { outcome: 'correct', pass: true, reason: 'matched the expectation' };
  }

  // An adversarial case also passes when the model simply declined to act.
  if (isAdversarial && actual.length === 0) {
    return { outcome: 'correct', pass: true, reason: 'declined to call a tool' };
  }

  return {
    outcome: 'wrong',
    pass: false,
    reason:
      actual.length === 0
        ? 'expected a tool call, got none'
        : explainMismatch(testCase.expect, actual),
  };
}

/** A compact, readable diff between expectation and reality, for the report. */
export function describeExpectation(e: Expectation): string {
  if (isNoneExpectation(e)) return '(no tool call)';
  const calls = expectedCalls(e);
  return calls.map((c) => `${c.tool}(${JSON.stringify(c.args ?? {})})`).join(' + ');
}

export function describeActual(actual: ActualCall[]): string {
  if (actual.length === 0) return '(no tool call)';
  return actual
    .map((c) => {
      const suffix = c.validation === 'valid' ? '' : `  <-- ${c.validation}: ${c.validationError}`;
      return `${c.tool}(${JSON.stringify(c.args)})${suffix}`;
    })
    .join(' + ');
}
