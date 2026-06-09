import { generateText, tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('c:/Users/capta/Desktop/All/option_csp/cc/.env.local') });

const groq = createOpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY,
});

async function main() {
  try {
    const result = await generateText({
      model: groq('llama-3.3-70b-versatile'),
      messages: [{ role: 'user', content: 'sort the table by iv descending' }],
      tools: {
        setSort: tool({
          description: 'Sort the option data table by a specific column.',
          parameters: z.object({
            key: z.enum(['expiration', 'daysToExpiration', 'strike', 'lastPrice', 'delta', 'iv', 'moneyness', 'openInterest', 'volume', 'maxContracts', 'totalCapitalRequired', 'totalPremiumReceived', 'annualizedReturn']),
            direction: z.enum(['asc', 'desc']),
          }),
        }),
      },
    });
    console.log("Success:", result.toolCalls);
  } catch (e: any) {
    console.error("Error:", e.message);
    if (e.cause) console.error("Cause:", e.cause);
  }
}
main();
