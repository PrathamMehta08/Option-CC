import { streamText } from 'ai';
import { createGroq, GROQ_MODEL } from '@/lib/assistant/model';
import { SYSTEM_PROMPT } from '@/lib/assistant/prompt';
import { assistantTools } from '@/lib/assistant/tools';
import { describeAssistantError } from '@/lib/assistant/errors';

export const maxDuration = 30;

/**
 * Thin wrapper over the shared assistant definitions in src/lib/assistant/.
 * The tools and prompt live there so the eval harness (evals/run.ts) measures
 * exactly what ships rather than a copy that can drift.
 */
export async function POST(req: Request) {
  // The screener is the product; the assistant is an enhancement. Without a key
  // we say so plainly instead of failing with an opaque provider error.
  if (!process.env.GROQ_API_KEY) {
    return new Response(
      JSON.stringify({
        error:
          'The AI assistant is unavailable because GROQ_API_KEY is not set. The screener and all filters work without it.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { messages } = await req.json();

    const result = streamText({
      model: createGroq()(GROQ_MODEL),
      system: SYSTEM_PROMPT,
      messages,
      tools: assistantTools,
      // Groq's free tier is 8,000 tokens per minute and a single multi-step
      // turn can spend most of it, so a 429 mid-turn is routine rather than
      // exceptional. The SDK's backoff turns most of those into a pause instead
      // of a dead turn; the ones it cannot are reported honestly below.
      maxRetries: 3,
      onError: (error) => {
        console.error('[chat/route] streamText error:', describeAssistantError(error), error);
      },
    });

    return result.toDataStreamResponse({
      // Without this the SDK sends the literal string "An error occurred." to
      // the client for everything, so a rate limit, a bad key and a provider
      // outage are indistinguishable — and the user is told nothing they can
      // act on. Our errors carry no secrets; the key never appears in them.
      getErrorMessage: describeAssistantError,
    });
  } catch (err) {
    console.error('[chat/route] caught error:', err);
    return new Response(JSON.stringify({ error: describeAssistantError(err) }), { status: 500 });
  }
}
