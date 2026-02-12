/**
 * Server-side display formatting: full precision, no compact/rounding.
 * Used to build *_display fields in API responses so UI shows values exactly (no "1.3k", no "≈").
 * Matches Airtable-style display: en-US locale, 2 decimal places for currency/numbers.
 */

const LOCALE = 'en-US';
const CURRENCY_OPTS: Intl.NumberFormatOptions = {
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

const NUMBER_OPTS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

function isValid(n: number | undefined | null): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** EUR display string for API *_display fields. */
export function formatEurDisplay(n: number | undefined | null): string {
  if (!isValid(n)) return '—';
  return new Intl.NumberFormat(LOCALE, CURRENCY_OPTS).format(n);
}

/** USD display string for API *_display fields. */
export function formatUsdDisplay(n: number | undefined | null): string {
  if (!isValid(n)) return '—';
  return new Intl.NumberFormat(LOCALE, USD_OPTS).format(n);
}

/** Plain number display (2 decimals) for API *_display fields. */
export function formatNumberDisplay(n: number | undefined | null): string {
  if (!isValid(n)) return '—';
  return new Intl.NumberFormat(LOCALE, NUMBER_OPTS).format(n);
}
