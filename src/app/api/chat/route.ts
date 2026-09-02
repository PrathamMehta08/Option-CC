import { streamText } from 'ai';
import { createGroq, GROQ_MODEL } from '@/lib/assistant/model';
import { SYSTEM_PROMPT } from '@/lib/assistant/prompt';
import { assistantTools } from '@/lib/assistant/tools';

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
      onError: (error) => {
        console.error('[chat/route] streamText error:', JSON.stringify(error));
      },
    });

    return result.toDataStreamResponse();
  } catch (err) {
    console.error('[chat/route] caught error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
