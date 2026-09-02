/**
 * Eval harness for the chat assistant.
 *
 * Measures how often the assistant emits the correct tool call for a
 * natural-language request. Run with `npm run eval`.
 *
 * It imports the SAME tools and system prompt the API route uses
 * (src/lib/assistant/), so a change to either moves this number. It never
 * touches Yahoo or any other market-data API — no chain data is needed to ask
 * the model what tool it would call.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateText, type CoreMessage } from 'ai';
import { createGroq, GROQ_MODEL } from '@/lib/assistant/model';
import { SYSTEM_PROMPT } from '@/lib/assistant/prompt';
import { assistantTools } from '@/lib/assistant/tools';
import { grade, validateCall, describeExpectation, describeActual } from './grade';
import type {
  ActualCall,
  CaseResult,
  Category,
  CategorySummary,
  EvalCase,
  RunReport,
} from './types';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// Groq's free tier caps tokens per minute, not just requests, and the tool
// schemas make every request ~1.4k prompt tokens. Four in flight blows the TPM
// budget instantly and the run fills with 429s that look like model failures.
// Two in flight with patient, Retry-After-aware backoff is what actually
// completes. Override with --concurrency if you are on a paid tier.
const DEFAULT_CONCURRENCY = 2;

// Groq free tier: 8,000 tokens/minute. Requests/day is not the binding limit.
const DEFAULT_TPM = 8000;
// Groq free tier also caps tokens per day, which is what actually stops a full
// suite run: the whole thing costs more than a day's allowance.
const DEFAULT_TPD = 200_000;
// Leave headroom so a burst of longer replies cannot overshoot the window.
const TPM_SAFETY = 0.85;
const MAX_RETRIES = 8;

// Matches LLMChatbot's useChat({ maxSteps: 5 }).
const MAX_STEPS = 5;

// ---------------------------------------------------------------- environment

/** Load .env.local the way Next does, so the harness needs no extra setup. */
function loadEnvLocal() {
  for (const file of ['.env.local', '.env']) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, '');
    }
  }
}

// ------------------------------------------------------------------- cli args

interface Args {
  category?: string;
  case?: string;
  out?: string;
  label?: string;
  concurrency?: number;
  tpm?: number;
  sample?: number;
  tpd?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    if (argv[i] === '--filter') args.category = next();
    else if (argv[i] === '--case') args.case = next();
    else if (argv[i] === '--out') args.out = next();
    else if (argv[i] === '--label') args.label = next();
    else if (argv[i] === '--concurrency') args.concurrency = Number(next());
    else if (argv[i] === '--tpm') args.tpm = Number(next());
    else if (argv[i] === '--sample') args.sample = Number(next());
    else if (argv[i] === '--tpd') args.tpd = Number(next());
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`
Usage: npm run eval [-- options]

  --filter <category>   run one category only
                        (direct, unit-implicit, compound, filter, sort,
                         ambiguous, out-of-scope, adversarial)
  --case <id>           run a single case by id
  --label <name>        label this run in the saved results
  --out <path>          write the JSON report here instead of evals/results/
  --concurrency <n>     requests in flight (default 2; raise on a paid tier)
  --tpm <n>             tokens-per-minute budget (default 8000, Groq free tier)
  --sample <n>          run only the first n cases of each category. The full
                        suite costs more tokens than a Groq free-tier day
                        allows, so this is the routine run; keep the full one
                        for a paid tier or a release check.
  --tpd <n>             tokens-per-day budget used for the upfront estimate
                        (default 200000, Groq free tier)
`);
      process.exit(0);
    }
  }
  return args;
}

// --------------------------------------------------------------- concurrency

async function pool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A rolling tokens-per-minute budget.
 *
 * Groq's free tier caps TOKENS per minute (8,000), not requests, and every call
 * here carries the whole tool schema — roughly 1.8k prompt tokens. Reacting to
 * 429s after the fact does not work: two workers collide, each backs off
 * exponentially, and the retries stack into minutes per case. Reserving budget
 * up front means we simply run at the sustainable rate and never see a 429.
 */
class TokenBudget {
  private spend: { at: number; tokens: number }[] = [];
  /** Seeded, then corrected from real usage as the run proceeds. */
  private estimate = 2150;
  private samples = 0;

  constructor(private readonly perMinute: number) {}

  private usedIn(window: number, now: number): number {
    this.spend = this.spend.filter((s) => now - s.at < window);
    return this.spend.reduce((total, s) => total + s.tokens, 0);
  }

  get perRequestEstimate(): number {
    return this.estimate;
  }

  /** Block until this request fits in the budget, then reserve it. */
  async reserve(): Promise<{ at: number; tokens: number }> {
    for (;;) {
      const now = Date.now();
      if (this.usedIn(60_000, now) + this.estimate <= this.perMinute) {
        const entry = { at: now, tokens: this.estimate };
        this.spend.push(entry);
        return entry;
      }
      // Wait for the oldest spend to age out of the window.
      const oldest = this.spend[0];
      await sleep(Math.max(200, 60_000 - (now - oldest.at) + 150));
    }
  }

  /** Replace the reservation with what the call actually cost. */
  settle(entry: { at: number; tokens: number }, actualTokens?: number) {
    if (!actualTokens || actualTokens <= 0) return;
    entry.tokens = actualTokens;
    // Converge the estimate on observed usage so pacing stays accurate.
    this.samples += 1;
    this.estimate = Math.round(
      this.estimate + (actualTokens - this.estimate) / Math.min(this.samples, 20)
    );
  }
}

/**
 * A daily-cap 429 is not a "wait a moment" 429.
 *
 * The per-minute limit clears in under a minute, so retrying is right. The
 * per-day limit refills at roughly 140 tokens a minute, so a call needing ~2k
 * waits ~15 minutes — and the runner would sit through eight of those before
 * giving up, which reads as a hang. Nothing useful happens after this, so the
 * run stops and says why.
 */
class DailyQuotaExhausted extends Error {}

function isDailyQuota(err: unknown): boolean {
  const message = (err as { message?: string })?.message ?? '';
  return /tokens per day|\bTPD\b/i.test(message);
}

function isRateLimit(err: unknown): boolean {
  const e = err as { statusCode?: number; status?: number; message?: string };
  if (e?.statusCode === 429 || e?.status === 429) return true;
  return typeof e?.message === 'string' && /429|rate.?limit|too many requests/i.test(e.message);
}

/**
 * How long to wait before retrying. Groq reports the wait in two places: a
 * Retry-After header, and prose in the error body ("Please try again in 9.9s").
 * Prefer whichever we can read, then fall back to exponential backoff, and
 * always wait at least a second so a retry storm cannot re-trigger the limit.
 */
function retryDelayMs(err: unknown, attempt: number): number {
  const headers = (err as { responseHeaders?: Record<string, string> })?.responseHeaders;
  const retryAfter = headers?.['retry-after'];
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(1000, Math.ceil(seconds * 1000) + 500);
  }

  const message = (err as { message?: string })?.message ?? '';
  const stated = message.match(/try again in ([0-9.]+)(ms|s)/i);
  if (stated) {
    const value = Number(stated[1]);
    const ms = stated[2].toLowerCase() === 'ms' ? value : value * 1000;
    if (Number.isFinite(ms)) return Math.max(1000, Math.ceil(ms) + 750);
  }

  return Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 400);
}

// ------------------------------------------------------------------- running

/** One model call, paced by the token budget, with retry as a safety net. */
async function callModel(messages: CoreMessage[], budget: TokenBudget) {
  const groq = createGroq();
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const reservation = await budget.reserve();
    try {
      const result = await generateText({
        model: groq(GROQ_MODEL),
        system: SYSTEM_PROMPT,
        messages,
        tools: assistantTools,
        // Determinism: temperature 0, and a fixed seed since Groq exposes one.
        temperature: 0,
        seed: 7,
        maxRetries: 0, // we do our own, so 429s are visible and paced
      });
      budget.settle(reservation, result.usage?.totalTokens);
      return { result };
    } catch (err) {
      lastError = err;
      if (isDailyQuota(err)) {
        throw new DailyQuotaExhausted(
          (err as { message?: string })?.message ?? 'daily token quota exhausted'
        );
      }
      if (isRateLimit(err) && attempt < MAX_RETRIES) {
        // The budget should prevent this; if it happens the estimate was low.
        await sleep(retryDelayMs(err, attempt));
        continue;
      }
      break;
    }
  }
  if (lastError instanceof DailyQuotaExhausted) throw lastError;
  return { error: lastError };
}

async function runCase(testCase: EvalCase, budget: TokenBudget): Promise<CaseResult> {
  const started = Date.now();

  const actual: ActualCall[] = [];
  const said: string[] = [];
  let errored: string | undefined;

  // Mirror the app: LLMChatbot runs useChat with maxSteps 5 and hands each tool
  // call a result before the model continues. The tools have no `execute`, so a
  // single generateText stops after the first call — measuring that would say
  // the assistant cannot handle a compound request when the shipped UI can.
  const messages: CoreMessage[] = [{ role: 'user', content: testCase.prompt }];

  for (let step = 0; step < MAX_STEPS; step++) {
    const { result, error } = await callModel(messages, budget);

    if (error instanceof DailyQuotaExhausted) throw error;
    if (error) {
      // The SDK throws rather than returning a call when the model produces
      // args the schema refuses. That is a schema rejection, not a crash.
      const name = (error as { name?: string })?.name ?? '';
      if (/InvalidToolArguments|NoSuchTool|ToolCallRepair/i.test(name)) {
        const e = error as { toolName?: string; toolArgs?: unknown; message?: string };
        actual.push({
          tool: e.toolName ?? 'unknown',
          args: (e.toolArgs ?? {}) as Record<string, unknown>,
          validation: /NoSuchTool/i.test(name) ? 'unknown-tool' : 'rejected-by-schema',
          validationError: e.message ?? name,
        });
      } else {
        errored = (error as Error)?.message ?? String(error);
      }
      break;
    }
    if (!result) break;

    if (result.text?.trim()) said.push(result.text.trim());

    for (const call of result.toolCalls) {
      const args = (call.args ?? {}) as Record<string, unknown>;
      actual.push({ tool: call.toolName, args, ...validateCall(call.toolName, args) });
    }

    if (result.toolCalls.length === 0) break;

    // Feed results back exactly as the browser does, so the model can continue.
    messages.push(...result.response.messages);
    messages.push({
      role: 'tool',
      content: result.toolCalls.map((call) => ({
        type: 'tool-result' as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        result: 'Done',
      })),
    });
  }

  const text = said.join('\n');
  const verdict = grade(testCase, actual, errored);

  return {
    id: testCase.id,
    category: testCase.category,
    prompt: testCase.prompt,
    expect: testCase.expect,
    actual,
    text,
    outcome: verdict.outcome,
    pass: verdict.pass,
    reason: verdict.reason,
    error: errored,
    latencyMs: Date.now() - started,
  };
}

// -------------------------------------------------------------------- report

const BOLD = '[1m';
const DIM = '[2m';
const RED = '[31m';
const GREEN = '[32m';
const YELLOW = '[33m';
const RESET = '[0m';

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function summarise(results: CaseResult[]): CategorySummary[] {
  const categories = [...new Set(results.map((r) => r.category))] as Category[];
  return categories.map((category) => {
    const rows = results.filter((r) => r.category === category);
    const passed = rows.filter((r) => r.pass).length;
    return {
      category,
      total: rows.length,
      passed,
      passRate: rows.length ? passed / rows.length : 0,
      correct: rows.filter((r) => r.outcome === 'correct').length,
      wrong: rows.filter((r) => r.outcome === 'wrong').length,
      rejectedBySchema: rows.filter((r) => r.outcome === 'rejected-by-schema').length,
      errors: rows.filter((r) => r.outcome === 'error').length,
    };
  });
}

function printReport(report: RunReport) {
  const failures = report.results.filter((r) => !r.pass);

  if (failures.length > 0) {
    console.log(`\n${BOLD}Failures${RESET} (${failures.length})\n`);
    for (const f of failures) {
      console.log(`${RED}✗${RESET} ${BOLD}${f.id}${RESET} ${DIM}[${f.category}]${RESET}`);
      console.log(`    prompt    ${f.prompt}`);
      console.log(`    expected  ${describeExpectation(f.expect)}`);
      console.log(`    actual    ${describeActual(f.actual)}`);
      console.log(`    why       ${f.reason}`);
      if (f.text.trim()) {
        const oneLine = f.text.replace(/\s+/g, ' ').trim();
        console.log(`    said      ${DIM}${oneLine.slice(0, 160)}${oneLine.length > 160 ? '…' : ''}${RESET}`);
      }
      console.log('');
    }
  }

  const width = Math.max(14, ...report.byCategory.map((c) => c.category.length));
  console.log(`${BOLD}Pass rate by category${RESET}\n`);
  console.log(
    `${'category'.padEnd(width)}  ${'pass'.padStart(7)}  ${'rate'.padStart(6)}  ` +
      `${'correct'.padStart(7)}  ${'wrong'.padStart(5)}  ${'rejected'.padStart(8)}  ${'error'.padStart(5)}`
  );
  console.log('-'.repeat(width + 48));
  for (const c of [...report.byCategory].sort((a, b) => a.category.localeCompare(b.category))) {
    const colour = c.passRate === 1 ? GREEN : c.passRate >= 0.8 ? YELLOW : RED;
    console.log(
      `${c.category.padEnd(width)}  ${`${c.passed}/${c.total}`.padStart(7)}  ` +
        `${colour}${pct(c.passRate).padStart(6)}${RESET}  ` +
        `${String(c.correct).padStart(7)}  ${String(c.wrong).padStart(5)}  ` +
        `${String(c.rejectedBySchema).padStart(8)}  ${String(c.errors).padStart(5)}`
    );
  }
  console.log('-'.repeat(width + 48));
  const overallColour = report.passRate === 1 ? GREEN : report.passRate >= 0.8 ? YELLOW : RED;
  console.log(
    `${BOLD}${'OVERALL'.padEnd(width)}${RESET}  ${`${report.passed}/${report.total}`.padStart(7)}  ` +
      `${overallColour}${BOLD}${pct(report.passRate).padStart(6)}${RESET}`
  );
  console.log(`\nmodel: ${report.model}   prompt: ${report.systemPromptHash}   tools: ${report.toolsHash}`);
}

// ---------------------------------------------------------------------- main

async function main() {
  loadEnvLocal();
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.GROQ_API_KEY) {
    console.error(
      `\n${RED}GROQ_API_KEY is not set.${RESET}\n\n` +
        `The eval harness calls the model directly, so it needs a key.\n` +
        `Put one in .env.local (see .env.example) or export it:\n\n` +
        `  export GROQ_API_KEY=gsk_...\n`
    );
    process.exit(2);
  }

  const casesFile = JSON.parse(readFileSync(join(HERE, 'cases.json'), 'utf8')) as {
    cases: EvalCase[];
  };

  let cases = casesFile.cases;
  if (args.category) cases = cases.filter((c) => c.category === args.category);
  if (args.case) cases = cases.filter((c) => c.id === args.case);

  if (args.sample && args.sample > 0) {
    const perCategory = new Map<string, number>();
    cases = cases.filter((c) => {
      const seen = perCategory.get(c.category) ?? 0;
      if (seen >= args.sample!) return false;
      perCategory.set(c.category, seen + 1);
      return true;
    });
  }

  if (cases.length === 0) {
    console.error(`No cases matched. ${args.category ? `category=${args.category} ` : ''}${args.case ? `case=${args.case}` : ''}`);
    process.exit(2);
  }

  const concurrency = args.concurrency && args.concurrency > 0 ? args.concurrency : DEFAULT_CONCURRENCY;
  const tpm = args.tpm && args.tpm > 0 ? args.tpm : DEFAULT_TPM;
  const budget = new TokenBudget(Math.floor(tpm * TPM_SAFETY));

  // Every case costs at least two calls: one that emits the tool call, one that
  // confirms nothing else follows. Token budget, not latency, sets the pace.
  const estimatedRequests = cases.length * 2.1;
  const estimatedTokens = Math.round(estimatedRequests * budget.perRequestEstimate);
  const estimatedMinutes = Math.ceil(estimatedTokens / (tpm * TPM_SAFETY));
  const dailyBudget = args.tpd && args.tpd > 0 ? args.tpd : DEFAULT_TPD;

  const startedAt = new Date().toISOString();
  console.log(
    `\nRunning ${BOLD}${cases.length}${RESET} case${cases.length === 1 ? '' : 's'} ` +
      `against ${BOLD}${GROQ_MODEL}${RESET} (concurrency ${concurrency}, temperature 0)\n` +
      `${DIM}~${estimatedTokens.toLocaleString()} tokens at ~${budget.perRequestEstimate} a call, ` +
      `paced to ${tpm.toLocaleString()}/min — roughly ${estimatedMinutes} min.${RESET}\n`
  );

  if (estimatedTokens > dailyBudget) {
    console.log(
      `${YELLOW}This run needs about ${estimatedTokens.toLocaleString()} tokens but the daily cap is ` +
        `${dailyBudget.toLocaleString()}. It will stop partway when the cap is hit.${RESET}\n` +
        `${DIM}Use --sample 3 for a per-category signal (~${Math.round(
          (3 * 8 * 2.1 * budget.perRequestEstimate) / 1000
        )}k tokens), or --tpm/--tpd on a paid tier.${RESET}\n`
    );
  }

  let done = 0;
  let quotaError: DailyQuotaExhausted | undefined;
  const results = await pool(cases, concurrency, async (testCase) => {
    if (quotaError) {
      return {
        id: testCase.id,
        category: testCase.category,
        prompt: testCase.prompt,
        expect: testCase.expect,
        actual: [],
        text: '',
        outcome: 'error' as const,
        pass: false,
        reason: 'skipped: daily token quota exhausted',
        error: 'daily token quota exhausted',
        latencyMs: 0,
      };
    }
    let result: CaseResult;
    try {
      result = await runCase(testCase, budget);
    } catch (err) {
      if (err instanceof DailyQuotaExhausted) {
        quotaError = err;
        console.error(
          `\n${RED}Stopped: the day's token budget is gone.${RESET}\n` +
            `${DIM}${err.message}${RESET}\n` +
            `${DIM}The per-day limit refills gradually, so retrying now just waits. ` +
            `Run a smaller --sample tomorrow, or raise the tier.${RESET}\n`
        );
      }
      throw err;
    }
    done++;
    const mark = result.pass ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    // Project from the token budget, not from elapsed/done: the first cases
    // wait on the rolling window, which makes a naive rate wildly pessimistic.
    const remaining = cases.length - done;
    const eta = (remaining * 2.1 * budget.perRequestEstimate) / (tpm * TPM_SAFETY);
    process.stdout.write(
      `${mark} ${String(done).padStart(3)}/${cases.length}  ${result.id.padEnd(30)} ` +
        `${DIM}${remaining > 0 ? `~${Math.ceil(eta)}m left` : ''}${RESET}\n`
    );
    return result;
  });

  const passed = results.filter((r) => r.pass).length;
  const report: RunReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    model: GROQ_MODEL,
    systemPromptHash: createHash('sha256').update(SYSTEM_PROMPT).digest('hex').slice(0, 12),
    toolsHash: createHash('sha256')
      .update(JSON.stringify(Object.entries(assistantTools).map(([n, t]) => [n, t.description])))
      .digest('hex')
      .slice(0, 12),
    filter: args.category || args.case ? { category: args.category, case: args.case } : undefined,
    total: results.length,
    passed,
    passRate: results.length ? passed / results.length : 0,
    byCategory: summarise(results),
    results,
  };

  printReport(report);

  const outPath =
    args.out ??
    join(HERE, 'results', `${startedAt.replace(/[:.]/g, '-')}${args.label ? `-${args.label}` : ''}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nfull run written to ${outPath.replace(ROOT, '.')}\n`);

  // Non-zero exit on any failure so CI can gate on it. Set exitCode rather
  // than calling process.exit, which can trip a libuv assertion on Windows
  // while the provider keep-alive sockets are still closing.
  process.exitCode = passed === results.length ? 0 : 1;
}

main().catch((err) => {
  // The quota message has already been printed in full; a stack trace on top
  // of it just buries the one line that tells you what to do.
  if (!(err instanceof DailyQuotaExhausted)) console.error(err);
  process.exitCode = err instanceof DailyQuotaExhausted ? 3 : 1;
});
