/**
 * Whether this request is the first step of a turn — the one that has to act.
 *
 * The model can, and does, answer a request to change the screen with prose
 * alone: "The NVDA scan with $100k, expirations between 6 and 12 months and
 * strikes no lower than 115% of the current price returns a list of contracts
 * that all meet the 1-delta ceiling" — written without a single tool call,
 * about a screen still showing "Analyze the Markets". Confidently wrong is the
 * worst of the failure modes, worse than an error, because nothing marks it.
 *
 * Tools are client-side, so every step is its own HTTP request: the first
 * carries a user message last, later ones carry the assistant's own tool calls.
 * That makes "is this the first step" answerable here, and toolChoice can be
 * required for it and left alone afterwards, so the closing sentence still gets
 * written.
 *
 * The cost is a knowledge question ("what does delta mean") spending one call
 * on readScreen before answering. That is a step, not a wrong answer.
 */
export function isFirstStepOfTurn(messages: unknown): boolean {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const last = messages[messages.length - 1] as { role?: unknown } | null;
  return !!last && typeof last === 'object' && last.role === 'user';
}
