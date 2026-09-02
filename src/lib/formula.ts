import { NUMERIC_FIELDS, type NumericField, type ScreenedOption } from './optionChain';

/**
 * A tiny arithmetic language for user-defined columns.
 *
 * The assistant can be asked for things like "sort by oi^2 + ann return^2",
 * which no fixed {field, op, value} schema can express. The obvious shortcut is
 * to let the model emit JavaScript and run it — which is exactly the
 * `new Function` hole this codebase already closed once.
 *
 * So the model emits an expression *string* and we parse it ourselves. The
 * grammar below is the entire language: numbers, known column names, five
 * operators, a handful of functions, and parentheses. Anything else is a parse
 * error, not a capability. There is no property access, no call into anything
 * we did not define, and no way to reach a global.
 *
 *   expression := term (('+' | '-') term)*
 *   term       := power (('*' | '/' | '%') power)*
 *   power      := unary ('^' power)?            right associative
 *   unary      := ('-' | '+')? primary
 *   primary    := number | identifier | call | '(' expression ')'
 *   call       := identifier '(' expression (',' expression)* ')'
 */

/** Friendly names traders actually type, mapped to real column keys. */
const ALIASES: Record<string, NumericField> = Object.assign(Object.create(null), {
  oi: 'openInterest',
  openinterest: 'openInterest',
  vol: 'volume',
  volume: 'volume',
  iv: 'iv',
  impliedvolatility: 'iv',
  delta: 'delta',
  strike: 'strike',
  premium: 'lastPrice',
  lastprice: 'lastPrice',
  price: 'lastPrice',
  moneyness: 'moneyness',
  dte: 'daysToExpiration',
  days: 'daysToExpiration',
  daystoexpiration: 'daysToExpiration',
  annreturn: 'annualizedReturn',
  annualizedreturn: 'annualizedReturn',
  annualized: 'annualizedReturn',
  return: 'annualizedReturn',
  yield: 'annualizedReturn',
  contracts: 'maxContracts',
  maxcontracts: 'maxContracts',
  capital: 'totalCapitalRequired',
  totalcapitalrequired: 'totalCapitalRequired',
  totalpremium: 'totalPremiumReceived',
  totalpremiumreceived: 'totalPremiumReceived',

}) as Record<string, NumericField>;

for (const field of NUMERIC_FIELDS) ALIASES[field.toLowerCase()] = field;

/** Every name the parser will accept, for error messages and tool docs. */
export const FORMULA_IDENTIFIERS = Object.keys(ALIASES).sort();

type Fn = (...args: number[]) => number;

const FUNCTIONS: Record<string, { arity: [number, number]; fn: Fn }> = Object.assign(Object.create(null), {
  abs: { arity: [1, 1], fn: Math.abs },
  sqrt: { arity: [1, 1], fn: Math.sqrt },
  ln: { arity: [1, 1], fn: Math.log },
  log: { arity: [1, 1], fn: Math.log10 },
  min: { arity: [2, 8], fn: Math.min },
  max: { arity: [2, 8], fn: Math.max },
  round: { arity: [1, 1], fn: Math.round },
  floor: { arity: [1, 1], fn: Math.floor },
  ceil: { arity: [1, 1], fn: Math.ceil },
}) as Record<string, { arity: [number, number]; fn: Fn }>;

export const FORMULA_FUNCTIONS = Object.keys(FUNCTIONS).sort();

// ------------------------------------------------------------------ AST

type Node =
  | { kind: 'number'; value: number }
  | { kind: 'field'; field: NumericField }
  | { kind: 'unary'; op: '-'; operand: Node }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '%' | '^'; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] };

// ------------------------------------------------------------- tokenizer

type Token =
  | { type: 'number'; value: number }
  | { type: 'name'; value: string }
  | { type: 'op'; value: string };

class FormulaError extends Error {}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (/[0-9.]/.test(ch)) {
      const start = i;
      while (i < input.length && /[0-9.]/.test(input[i])) i++;
      const raw = input.slice(start, i);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new FormulaError(`"${raw}" is not a number`);
      tokens.push({ type: 'number', value });
      continue;
    }

    // Identifiers may contain spaces and underscores ("ann return"), so letters
    // are gathered greedily and the whole run is resolved as one name later.
    if (/[a-z_]/i.test(ch)) {
      const start = i;
      while (i < input.length && /[a-z_0-9 ]/i.test(input[i])) i++;
      // Trailing spaces belong to the expression, not the name.
      const raw = input.slice(start, i).trimEnd();
      i = start + raw.length;
      tokens.push({ type: 'name', value: raw });
      continue;
    }

    if ('+-*/%^(),'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }

    throw new FormulaError(`unexpected character "${ch}"`);
  }

  return tokens;
}

/** "ann return" and "Ann_Return" both resolve to annualizedReturn. */
function resolveName(raw: string): NumericField | null {
  return ALIASES[raw.toLowerCase().replace(/[\s_]/g, '')] ?? null;
}

// ---------------------------------------------------------------- parser

function parse(tokens: Token[]): Node {
  let pos = 0;

  const peek = () => tokens[pos];
  const eat = (value: string) => {
    const t = peek();
    if (t && t.type === 'op' && t.value === value) {
      pos++;
      return true;
    }
    return false;
  };
  const expect = (value: string) => {
    if (!eat(value)) throw new FormulaError(`expected "${value}"`);
  };

  function expression(): Node {
    let left = term();
    for (;;) {
      if (eat('+')) left = { kind: 'binary', op: '+', left, right: term() };
      else if (eat('-')) left = { kind: 'binary', op: '-', left, right: term() };
      else return left;
    }
  }

  function term(): Node {
    let left = unary();
    for (;;) {
      if (eat('*')) left = { kind: 'binary', op: '*', left, right: unary() };
      else if (eat('/')) left = { kind: 'binary', op: '/', left, right: unary() };
      else if (eat('%')) left = { kind: 'binary', op: '%', left, right: unary() };
      else return left;
    }
  }

  /**
   * Unary minus sits BELOW '^', so -delta^2 is -(delta^2), the mathematical
   * convention and what every language except Excel does. Putting it above
   * would silently turn a negative put delta positive when squared.
   */
  function unary(): Node {
    if (eat('-')) return { kind: 'unary', op: '-', operand: unary() };
    if (eat('+')) return unary();
    return power();
  }

  /**
   * Right associative (2^3^2 is 2^9), and the exponent is a unary so that
   * 2^-3 parses.
   */
  function power(): Node {
    const base = primary();
    if (eat('^')) return { kind: 'binary', op: '^', left: base, right: unary() };
    return base;
  }

  function primary(): Node {
    const t = peek();
    if (!t) throw new FormulaError('the formula ends early');

    if (t.type === 'number') {
      pos++;
      return { kind: 'number', value: t.value };
    }

    if (t.type === 'name') {
      pos++;
      const lower = t.value.toLowerCase();

      // A name followed by "(" is a function call.
      if (peek() && peek().type === 'op' && (peek() as { value: string }).value === '(') {
        const spec = FUNCTIONS[lower];
        if (!spec) {
          throw new FormulaError(
            `unknown function "${t.value}" — available: ${FORMULA_FUNCTIONS.join(', ')}`
          );
        }
        expect('(');
        const args: Node[] = [expression()];
        while (eat(',')) args.push(expression());
        expect(')');
        const [minArgs, maxArgs] = spec.arity;
        if (args.length < minArgs || args.length > maxArgs) {
          throw new FormulaError(
            `${lower} takes ${minArgs === maxArgs ? minArgs : `${minArgs}-${maxArgs}`} argument(s), got ${args.length}`
          );
        }
        return { kind: 'call', name: lower, args };
      }

      const field = resolveName(t.value);
      if (!field) {
        throw new FormulaError(
          `unknown column "${t.value}" — available: ${NUMERIC_FIELDS.join(', ')}`
        );
      }
      return { kind: 'field', field };
    }

    if (eat('(')) {
      const inner = expression();
      expect(')');
      return inner;
    }

    throw new FormulaError(`unexpected "${t.value}"`);
  }

  const ast = expression();
  if (pos < tokens.length) {
    const t = tokens[pos];
    throw new FormulaError(`unexpected "${t.value}" after the end of the formula`);
  }
  return ast;
}

// ------------------------------------------------------------- evaluator

function evaluate(node: Node, option: ScreenedOption): number {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'field': {
      const value = option[node.field];
      return typeof value === 'number' ? value : NaN;
    }
    case 'unary':
      return -evaluate(node.operand, option);
    case 'call':
      return FUNCTIONS[node.name].fn(...node.args.map((a) => evaluate(a, option)));
    case 'binary': {
      const l = evaluate(node.left, option);
      const r = evaluate(node.right, option);
      switch (node.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        // Division by zero yields NaN rather than Infinity so a bad row sorts
        // to the bottom instead of to the top.
        case '/': return r === 0 ? NaN : l / r;
        case '%': return r === 0 ? NaN : l % r;
        case '^': return Math.pow(l, r);
      }
    }
  }
}

// ------------------------------------------------------------ public API

/** A user formula promoted to a table column. */
export interface ComputedColumn {
  id: string;
  name: string;
  source: string;
  evaluate: (option: ScreenedOption) => number;
}

export interface CompiledFormula {
  /** The expression as written, for display. */
  source: string;
  /** Columns the expression reads, for the chip tooltip. */
  fields: NumericField[];
  evaluate: (option: ScreenedOption) => number;
}

export type FormulaResult =
  | { ok: true; formula: CompiledFormula }
  | { ok: false; error: string };

function collectFields(node: Node, into: Set<NumericField>) {
  switch (node.kind) {
    case 'field': into.add(node.field); break;
    case 'unary': collectFields(node.operand, into); break;
    case 'binary': collectFields(node.left, into); collectFields(node.right, into); break;
    case 'call': node.args.forEach((a) => collectFields(a, into)); break;
  }
}

/**
 * Compile an expression. Never throws: a bad formula comes back as an error to
 * show the user and hand back to the model.
 */
export function compileFormula(source: string): FormulaResult {
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, error: 'the formula is empty' };
  if (trimmed.length > 200) return { ok: false, error: 'the formula is too long' };

  try {
    const ast = parse(tokenize(trimmed));
    const fields = new Set<NumericField>();
    collectFields(ast, fields);
    if (fields.size === 0) {
      return { ok: false, error: 'the formula does not reference any column' };
    }
    return {
      ok: true,
      formula: {
        source: trimmed,
        fields: [...fields],
        evaluate: (option) => {
          const value = evaluate(ast, option);
          return Number.isFinite(value) ? value : NaN;
        },
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof FormulaError ? err.message : 'the formula could not be parsed',
    };
  }
}
