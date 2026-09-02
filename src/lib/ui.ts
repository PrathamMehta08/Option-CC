import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names, letting later Tailwind classes win. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "1234567.8" -> "1,234,567.8". Strips anything that is not a digit or dot. */
export function formatNumberWithCommas(value: string | number) {
  const numericString = value.toString().replace(/[^0-9.]/g, '');
  const parts = numericString.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

/**
 * "2026-09-04" -> "Sep 4". Falls back to the raw string if it will not parse.
 *
 * Parsed at midday: `new Date('2026-01-01')` is UTC midnight, which renders as
 * Dec 31 in any negative-offset timezone.
 *
 * The NaN check matters — an invalid Date does not throw from
 * toLocaleDateString, it returns the string "Invalid Date", so a try/catch
 * alone never reaches its fallback.
 */
export function formatExpirationLabel(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
