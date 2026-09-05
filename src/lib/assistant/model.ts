import { createOpenAI } from '@ai-sdk/openai';

/**
 * Which LLM the assistant talks to.
 *
 * Every provider worth using speaks the OpenAI wire format, so switching one
 * out is a base URL, a key and a model name — not a code change. This reads all
 * three from the environment and falls back to Groq, which is what the app
 * shipped with.
 *
 * The reason it is configurable at all: Groq's free tier allows 8,000 tokens a
 * minute, and one multi-step tool-calling turn here costs about 7,000 of them.
 * That fits exactly once. Moving to a provider with room, or to a model running
 * on your own machine, is the difference between the assistant working and it
 * apologising about rate limits.
 *
 * Every value is read at CALL time, never captured at import. The eval harness
 * loads .env.local from inside main(), which runs after every import has
 * already been evaluated — module-level constants would have been fixed to the
 * defaults before the file was read, so setting LLM_MODEL there would have been
 * silently ignored.
 *
 * Model note: the original `llama-3.1-8b-instant` was decommissioned by Groq and
 * every request failed with `model_not_found`, which presented as "function
 * calling stopped working". Whatever you point this at must support tool
 * calling, or the assistant can only talk.
 */

const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

/** Where the OpenAI-compatible endpoint lives. */
export function llmBaseUrl(): string {
  return process.env.LLM_BASE_URL || DEFAULT_BASE_URL;
}

/** The model id, as that provider spells it. */
export function llmModel(): string {
  return process.env.LLM_MODEL || DEFAULT_MODEL;
}

/**
 * The key. LLM_API_KEY wins; GROQ_API_KEY still works so an existing .env.local
 * keeps running untouched.
 */
export function llmApiKey(): string | undefined {
  return process.env.LLM_API_KEY || process.env.GROQ_API_KEY || undefined;
}

/**
 * A local runtime (Ollama, LM Studio, llama.cpp) has no key and needs none.
 * Recognising that is what lets "unlimited and free" actually work: the only
 * genuinely uncapped option is a model on your own hardware.
 */
export function isLocalEndpoint(baseUrl = llmBaseUrl()): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(baseUrl);
}

/** Whether the assistant can run at all. */
export function isAssistantConfigured(): boolean {
  return isLocalEndpoint() || Boolean(llmApiKey());
}

/** The provider's name, for error messages. Derived from the host. */
export function providerName(baseUrl = llmBaseUrl()): string {
  if (isLocalEndpoint(baseUrl)) return 'your local model server';
  try {
    const host = new URL(baseUrl).hostname.replace(/^api\./, '');
    if (host.includes('groq')) return 'Groq';
    if (host.includes('googleapis')) return 'Google Gemini';
    if (host.includes('openrouter')) return 'OpenRouter';
    if (host.includes('cerebras')) return 'Cerebras';
    if (host.includes('mistral')) return 'Mistral';
    if (host.includes('deepseek')) return 'DeepSeek';
    if (host.includes('openai')) return 'OpenAI';
    return host;
  } catch {
    return 'the model provider';
  }
}

/** Build the provider. Everything is resolved now, not at import. */
export function createLlm(apiKey = llmApiKey()) {
  return createOpenAI({
    baseURL: llmBaseUrl(),
    // A local server ignores this, but the SDK insists on a string.
    apiKey: apiKey ?? 'local',
  });
}
