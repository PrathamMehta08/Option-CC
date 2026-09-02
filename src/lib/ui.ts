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

/** "2026-09-04" -> "Sep 4". Falls back to the raw string if it will not parse. */
export function formatExpirationLabel(dateStr: string) {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}
