/**
 * Does the configured model actually work with this app?
 *
 * Switching provider is three environment variables, but "it accepted my key"
 * is not the same as "it can drive the screener". Two things have already gone
 * wrong here in ways that only showed up mid-conversation:
 *
 *   - Groq validates tool schemas strictly and rejects `.optional()` fields.
 *     That surfaced as a failed turn, not a startup error.
 *   - A model that does not do tool calling will happily chat instead, so the
 *     assistant looks like it works and simply never touches the app.
 *
 * This sends one real request with the real tool schemas and reports what came
 * back, including what a turn will cost against the provider's rate limit.
 *
 *   npm run llm:check
 */
import { generateText } from 'ai';
import { loadEnvLocal } from './env';
import {
  createLlm,
  llmModel,
  llmBaseUrl,
  isAssistantConfigured,
  isLocalEndpoint,
  providerName,
} from '@/lib/assistant/model';
import { SYSTEM_PROMPT } from '@/lib/assistant/prompt';
import { assistantTools } from '@/lib/assistant/tools';
import { describeAssistantError } from '@/lib/assistant/errors';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

/** A request that a working setup answers with exactly one applySettings call. */
const PROBE = 'NVDA, 20k capital, 30 delta, within 3 months';

/** Roughly what a full multi-step turn costs, for the budget warning below. */
const STEPS_PER_TURN = 3;

async function main() {
  loadEnvLocal();

  console.log(
    `\n${BOLD}Checking the assistant's model${RESET}\n` +
      `  provider  ${providerName()}\n` +
      `  endpoint  ${llmBaseUrl()}\n` +
      `  model     ${llmModel()}\n` +
      `  key       ${
        isLocalEndpoint()
          ? `${DIM}not needed for a local endpoint${RESET}`
          : isAssistantConfigured()
            ? 'set'
            : `${RED}missing${RESET}`
      }\n`
  );

  if (!isAssistantConfigured()) {
    console.error(
      `${RED}No model is configured.${RESET} Set LLM_API_KEY, or point LLM_BASE_URL\n` +
        `at a local model server. See .env.example for working values.\n`
    );
    process.exit(1);
  }

  let result: Awaited<ReturnType<typeof generateText>>;
  try {
    result = await generateText({
      model: createLlm()(llmModel()),
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: PROBE }],
      tools: assistantTools,
      temperature: 0,
      // One attempt: a check that silently retries past a rate limit is telling
      // you the wrong thing about your quota.
      maxRetries: 0,
    });
  } catch (err) {
    console.error(`${RED}✗ The request failed.${RESET}\n  ${describeAssistantError(err)}\n`);
    // A schema rejection is the one failure that is this app's problem rather
    // than the provider's, so point at the file that would need to change.
    if (/schema/i.test(String((err as { message?: string })?.message ?? ''))) {
      console.error(
        `  ${DIM}This provider validates tool schemas differently. The tool\n` +
          `  definitions are in src/lib/assistant/tools.ts.${RESET}\n`
      );
    }
    process.exit(1);
  }

  const calls = result.toolCalls ?? [];
  const prompt = result.usage?.promptTokens ?? 0;
  const completion = result.usage?.completionTokens ?? 0;

  if (calls.length === 0) {
    console.error(
      `${RED}✗ The model answered without calling a tool.${RESET}\n` +
        `  It replied: ${JSON.stringify((result.text ?? '').slice(0, 120))}\n\n` +
        `  ${DIM}The assistant can only drive the screener through tool calls, so this\n` +
        `  model will chat but change nothing. Pick one that supports them.${RESET}\n`
    );
    process.exit(1);
  }

  console.log(`${GREEN}✓ Tool calling works.${RESET}`);
  for (const c of calls) {
    console.log(`  ${c.toolName}(${JSON.stringify(c.args)})`);
  }
  if (calls.length === 1 && calls[0].toolName === 'applySettings') {
    console.log(`  ${DIM}One call for four settings — the cheap path.${RESET}`);
  } else {
    console.log(
      `  ${YELLOW}Expected a single applySettings call.${RESET} ${DIM}This model splits the\n` +
        `  work up, so a turn costs more round trips than the prompt assumes.${RESET}`
    );
  }

  const perTurn = prompt * STEPS_PER_TURN + completion;
  console.log(
    `\n${BOLD}Cost${RESET}\n` +
      `  ${prompt} prompt + ${completion} completion tokens for this one step.\n` +
      `  A full turn is about ${STEPS_PER_TURN} steps, so roughly ${DIM}${perTurn.toLocaleString()}${RESET} tokens.\n` +
      `  ${DIM}Every step re-sends the system prompt and all tool schemas; that fixed\n` +
      `  cost, not the length of your question, is what a turn is made of.${RESET}\n`
  );
  console.log(
    `  Check this provider's tokens-per-minute limit against that number.\n` +
      `  ${DIM}A cap of 8,000/min fits about one turn a minute.${RESET}\n`
  );

  console.log(`${GREEN}Ready.${RESET}\n`);
}

main().catch((err) => {
  console.error(`${RED}Unexpected failure:${RESET}`, err);
  process.exit(1);
});
