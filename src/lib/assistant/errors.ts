/**
 * Turning a provider failure into something the user can act on.
 *
 * The AI SDK masks every streaming error as the literal string "An error
 * occurred." before it reaches the browser, which is the right default for a
 * server that might leak internals and the wrong one here: the overwhelmingly
 * common failure is Groq's free-tier rate limit, and "an error occurred" gives
 * the user no reason to simply wait ten seconds and try again.
 */

/** What a provider error looks like once the SDK has wrapped it. */
interface ProviderErrorish {
  message?: unknown;
  statusCode?: unknown;
  responseBody?: unknown;
  responseHeaders?: Record<string, string> | undefined;
  data?: { error?: { message?: unknown; code?: unknown } };
  cause?: unknown;
}

function asRecord(value: unknown): ProviderErrorish {
  return (value && typeof value === 'object' ? value : {}) as ProviderErrorish;
}

/** Seconds to wait, from either the header or the message Groq returns. */
function retryAfterSeconds(error: ProviderErrorish): number | null {
  const header = error.responseHeaders?.['retry-after'];
  if (header) {
    const n = Number(header);
    if (Number.isFinite(n) && n > 0) return Math.ceil(n);
  }
  // Groq spells it out in prose: "Please try again in 8.06s."
  const text = [error.message, error.responseBody].filter((v) => typeof v === 'string').join(' ');
  const m = text.match(/try again in ([\d.]+)\s*s/i);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) return Math.max(1, Math.ceil(n));
  }
  return null;
}

/**
 * A one-line explanation, safe to show. Never includes the API key: it appears
 * only in a request header, which is not part of any error body we read.
 */
export function describeAssistantError(error: unknown): string {
  const e = asRecord(error);
  const status = typeof e.statusCode === 'number' ? e.statusCode : undefined;
  const message = typeof e.message === 'string' ? e.message : '';
  const combined = `${message} ${typeof e.responseBody === 'string' ? e.responseBody : ''}`;

  if (status === 429 || /rate.?limit|too many requests/i.test(combined)) {
    const wait = retryAfterSeconds(e);
    // The daily cap and the per-minute cap need different advice: one is a
    // pause, the other is the end of the day.
    if (/tokens per day|TPD|daily/i.test(combined)) {
      return 'The assistant has used up its daily Groq token allowance. The screener and every filter still work — the assistant will come back when the quota resets.';
    }
    return wait
      ? `Groq's rate limit was hit — this asks for about 8,000 tokens a minute and a full request uses most of that. Try again in ${wait}s.`
      : "Groq's rate limit was hit. Give it a few seconds and try again.";
  }

  if (status === 401 || status === 403 || /invalid.?api.?key|unauthorized/i.test(combined)) {
    return 'Groq rejected the API key. Check GROQ_API_KEY. The screener works without it.';
  }

  if (status === 404 || /model_not_found|does not exist|decommissioned/i.test(combined)) {
    return 'The configured Groq model is unavailable — it may have been retired. See src/lib/assistant/model.ts.';
  }

  if (status && status >= 500) {
    return 'Groq had a server error. This is on their end; try again in a moment.';
  }

  if (/abort|timeout|ETIMEDOUT|fetch failed/i.test(combined)) {
    return 'The request to Groq timed out. Try again.';
  }

  return message
    ? `The assistant failed: ${message}`
    : 'The assistant failed for an unknown reason.';
}
