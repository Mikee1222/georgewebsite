/**
 * Money formatting: USD, EUR, and dual currency display.
 * Robust to null/undefined; shows "—" when missing.
 */

const EUR_LOCALE = 'de-DE';
const USD_LOCALE = 'en-US';

const EUR_OPTS: Intl.NumberFormatOptions = {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

const USD_OPTS: Intl.NumberFormatOptions = {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

function isValid(n: number | undefined | null): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Format USD for display; "—" when missing or invalid. */
export function formatUsd(n: number | undefined | null): string {
  if (!isValid(n)) return '—';
  return new Intl.NumberFormat(USD_LOCALE, USD_OPTS).format(n);
}

/** Format EUR for display; "—" when missing or invalid. */
export function formatEur(n: number | undefined | null): string {
  if (!isValid(n)) return '—';
  return new Intl.NumberFormat(EUR_LOCALE, EUR_OPTS).format(n);
}

/** Display both currencies (e.g. "€1,234.56 · $1,350.00"). eurFirst=true by default. "—" when both missing. */
export function formatDual(
  usd: number | undefined | null,
  eur: number | undefined | null,
  eurFirst = true
): string {
  const hasUsd = isValid(usd);
  const hasEur = isValid(eur);
  if (!hasUsd && !hasEur) return '—';
  if (hasUsd && !hasEur) return formatUsd(usd);
  if (hasEur && !hasUsd) return formatEur(eur);
  const eurStr = new Intl.NumberFormat(EUR_LOCALE, EUR_OPTS).format(eur!);
  const usdStr = new Intl.NumberFormat(USD_LOCALE, USD_OPTS).format(usd!);
  return eurFirst ? `${eurStr} · ${usdStr}` : `${usdStr} · ${eurStr}`;
}
