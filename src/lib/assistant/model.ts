import { createOpenAI } from '@ai-sdk/openai';

/**
 * Groq exposes an OpenAI-compatible endpoint, so the OpenAI provider works
 * as-is.
 *
 * Model note: the previous `llama-3.1-8b-instant` was decommissioned by Groq
 * and every request failed with `model_not_found`, which presented as
 * "function calling stopped working". `openai/gpt-oss-120b` is current and
 * supports tool calling.
 */
export const GROQ_MODEL = 'openai/gpt-oss-120b';

export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

/** Build a Groq-backed provider. The key is read at call time, not at import. */
export function createGroq(apiKey = process.env.GROQ_API_KEY) {
  return createOpenAI({ baseURL: GROQ_BASE_URL, apiKey });
}
