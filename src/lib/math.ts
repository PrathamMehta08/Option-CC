export function normCdf(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.821256 + t * 1.3302745))));
  return x > 0 ? 1 - p : p;
}

/**
 * Approximate Delta via Black-Scholes for European Puts
 * @param S Current price
 * @param K Strike price
 * @param t Time to expiration (years)
 * @param sigma Implied volatility (decimal)
 * @param r Risk-free rate (decimal, e.g. 0.05)
 * @returns Delta (negative for puts)
 */
export function calculatePutDelta(S: number, K: number, t: number, sigma: number, r: number = 0.05): number {
  if (t <= 0 || sigma <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma ** 2) * t) / (sigma * Math.sqrt(t));
  return normCdf(d1) - 1;
}

/**
 * Approximate Delta via Black-Scholes for European Calls
 * @param S Current price
 * @param K Strike price
 * @param t Time to expiration (years)
 * @param sigma Implied volatility (decimal)
 * @param r Risk-free rate (decimal, e.g. 0.05)
 * @returns Delta (positive for calls)
 */
export function calculateCallDelta(S: number, K: number, t: number, sigma: number, r: number = 0.05): number {
  if (t <= 0 || sigma <= 0) return 1;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma ** 2) * t) / (sigma * Math.sqrt(t));
  return normCdf(d1);
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

export function formatPercent(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}
