import type { ScreenedOption } from '@/lib/optionChain';

/**
 * The contract an answer is talking about, if it is talking about exactly one.
 *
 * The prompt tells the assistant to call showOptionCard whenever it names a
 * contract. It does not reliably do so, and asking more loudly has already
 * failed twice — so this reads the answer instead and shows the card anyway.
 * Prompt instructions are a request; this is a guarantee.
 *
 * Deliberately conservative: it returns null unless one row is unambiguously
 * indicated. A wrong card is worse than no card, because it looks authoritative.
 */
export function findMentionedContract(
  text: string,
  rows: ScreenedOption[]
): ScreenedOption | null {
  if (!text || rows.length === 0) return null;

  // Dollar figures that could be a strike. Commas are stripped so "$1,250"
  // reads as 1250; a capital of "$100,000" simply will not match any strike.
  const amounts = new Set<number>();
  for (const m of text.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g)) {
    const value = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(value)) amounts.add(value);
  }
  if (amounts.size === 0) return null;

  const matching = rows.filter((r) => amounts.has(r.strike));
  if (matching.length === 0) return null;

  // One strike, one contract: unambiguous.
  const strikes = new Set(matching.map((r) => r.strike));
  if (strikes.size === 1 && matching.length === 1) return matching[0];

  // Several rows share that strike across expirations, or several strikes were
  // named. An expiration in the text settles it — the ISO date the screen gave,
  // or a "Mar 2027"-style reference to it.
  const dated = matching.filter((r) => mentionsExpiration(text, r.expiration));
  if (dated.length === 1) return dated[0];

  // Still ambiguous. Say nothing rather than pick.
  return null;
}

/** Whether the text refers to this expiration, by ISO date or by month and year. */
function mentionsExpiration(text: string, expiration: string): boolean {
  if (text.includes(expiration)) return true;

  const date = new Date(`${expiration}T12:00:00`);
  if (Number.isNaN(date.getTime())) return false;

  const year = String(date.getFullYear());
  const long = date.toLocaleDateString('en-US', { month: 'long' });
  const short = date.toLocaleDateString('en-US', { month: 'short' });
  const lower = text.toLowerCase();

  // The year has to be there too: "March" alone matches half the board.
  return (
    lower.includes(year) && (lower.includes(long.toLowerCase()) || lower.includes(short.toLowerCase()))
  );
}
