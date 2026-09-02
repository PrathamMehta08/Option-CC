import { createOpenAI } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import { FilterConditionToolSchema } from '@/lib/filters';
import { NUMERIC_FIELDS } from '@/lib/optionChain';

export const maxDuration = 30;

// Groq exposes an OpenAI-compatible endpoint, so the OpenAI provider works as-is.
// Model note: the previous `llama-3.1-8b-instant` was decommissioned by Groq and
// every request failed with `model_not_found`, which presented as "function
// calling stopped working". `openai/gpt-oss-120b` is current and supports tools.
const GROQ_MODEL = 'openai/gpt-oss-120b';

const groq = createOpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY,
});

// Free-form strings let the model answer "descending" where the UI expects
// "desc", silently producing a no-op sort. Enums make the provider conform.
const SORT_KEY = z.enum([...NUMERIC_FIELDS, 'expiration', 'returnPct']);

const SORT_DIRECTION = z.enum(['asc', 'desc']);

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
      model: groq(GROQ_MODEL),
      system: `You are a helpful AI assistant for an options trading platform.
You help the user filter and sort the option chain data by invoking tools.
DO NOT make up data.
Use the setSort tool to sort the table.
Use addCustomFilter for numeric conditions the dedicated tools do not cover (e.g. IV above 50). Emit its conditions as structured data, never as code. Do not use addCustomFilter to sort.`,
      messages,
      tools: {
        setCapital: tool({
          description: 'Set the total capital available for the user to trade with.',
          parameters: z.object({
            capital: z.number().describe('The capital amount in dollars'),
          }),
        }),
        setSort: tool({
          description: 'Sort the option data table by a specific column.',
          parameters: z.object({
            key: SORT_KEY.describe('The column to sort by'),
            direction: SORT_DIRECTION.describe('Sort direction'),
          }),
        }),
        setTicker: tool({
          description: 'Set the stock ticker symbol to analyze (e.g. AAPL, TSLA)',
          parameters: z.object({
            ticker: z.string().describe('The stock ticker symbol'),
          }),
        }),
        setMonthsRange: tool({
          description: 'Set the minimum and maximum months to expiration (e.g., 0 to 6 months)',
          parameters: z.object({
            minMonths: z.number().describe('Minimum months to expiration'),
            maxMonths: z.number().describe('Maximum months to expiration'),
          }),
        }),
        setDelta: tool({
          description:
            'Set the delta limit for the options. Give the magnitude as a positive number between 0 and 1 (e.g. 0.3 for a 30 delta); the app applies the correct sign for the active strategy.',
          parameters: z.object({
            delta: z.number().min(0).max(1).describe('The delta magnitude, between 0 and 1'),
          }),
        }),
        setStrikeRange: tool({
          description: 'Set the minimum and maximum strike price',
          parameters: z.object({
            minStrike: z.number().describe('Minimum strike price'),
            maxStrike: z.number().describe('Maximum strike price'),
          }),
        }),
        addCustomFilter: tool({
          description:
            'Filter the option table on numeric columns. Use this for conditions the dedicated tools do not cover, e.g. "IV above 50" or "open interest over 500 and annualized return above 20". Emit conditions as data; do not write code.',
          parameters: z.object({
            id: z.string().describe('A unique identifier for this filter'),
            name: z
              .string()
              .describe('A short, human-readable name for the filter chip, e.g. "High IV"'),
            mode: z
              .enum(['and', 'or'])
              .describe('Whether every condition must hold ("and") or any one ("or")'),
            conditions: z
              .array(FilterConditionToolSchema)
              .min(1)
              .max(10)
              .describe(
                'The conditions. Each is a column, an operator, and a value. "between" takes a [low, high] pair; every other operator takes a single number. IV is a percentage (50 means 50%), delta is signed, moneyness is a percentage.'
              ),
          }),
        }),
      },
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
