/**
 * Consistent number formatting: EUR currency + percent.
 * - Compact: for KPIs (e.g. 1.2M, 45%)
 * - Full: for table cells (e.g. 1,234,567.89 €, 45.0%)
 */

const EUR_LOCALE = 'de-DE';
const CURRENCY_OPTS_FULL: Intl.NumberFormatOptions = {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

/** Full EUR for table cells (e.g. 1 234,56 €) */
export function formatEurFull(value: number): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(EUR_LOCALE, CURRENCY_OPTS_FULL).format(value);
}

/** Compact EUR for KPIs (e.g. 1.2M €, 45k €) */
export function formatEurCompact(value: number): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M €`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}k €`;
  return new Intl.NumberFormat(EUR_LOCALE, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/** Full percent for table cells (e.g. 45.0%) */
export function formatPercentFull(value: number): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

/** Compact percent for KPIs (e.g. 45%) */
export function formatPercentCompact(value: number): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  const pct = value * 100;
  return pct >= 100 || pct === Math.floor(pct)
    ? `${Math.round(pct)}%`
    : `${pct.toFixed(1)}%`;
}

/** Raw number for table cells (no currency), tabular-friendly */
export function formatNumberFull(value: number): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(EUR_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

const USD_LOCALE = 'en-US';
const USD_OPTS: Intl.NumberFormatOptions = {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

/** Format USD for display */
export function formatUsdFull(value: number): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(USD_LOCALE, USD_OPTS).format(value);
}

/** Compact USD for KPIs (e.g. $1.2k, $45) */
export function formatUsdCompact(value: number): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}k`;
  return new Intl.NumberFormat(USD_LOCALE, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/** Format ISO date (yyyy-mm-dd) to short label (e.g. "Jan 29"). Edge-safe. Capitalized. */
export function formatShortDate(isoDate: string | undefined): string {
  if (!isoDate?.trim()) return '—';
  const d = new Date(isoDate.trim() + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
}

/**
 * Format week range for display.
 * Same month: "Feb 1 – 7, 2026"
 * Month changes: "Jan 30 – Feb 5, 2026"
 * Uses ISO date strings (yyyy-mm-dd). Parses with noon local to avoid timezone shift.
 */
export function formatWeekRange(start: string, end: string): string {
  if (!start?.trim() || !end?.trim()) return '—';
  const startDate = new Date(start.trim() + 'T12:00:00');
  const endDate = new Date(end.trim() + 'T12:00:00');
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return `${start} – ${end}`;
  const sameMonth = startDate.getMonth() === endDate.getMonth();
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  if (sameMonth && sameYear) {
    return `${startDate.toLocaleString('en-US', { month: 'short' })} ${startDate.getDate()} – ${endDate.getDate()}, ${startDate.getFullYear()}`;
  }
  return `${startDate.toLocaleString('en-US', { month: 'short' })} ${startDate.getDate()} – ${endDate.toLocaleString('en-US', { month: 'short' })} ${endDate.getDate()}, ${endDate.getFullYear()}`;
}

/** Format month_key (yyyy-mm) to label (e.g. "Feb 2026"). Capitalized first letter. */
export function formatMonthLabel(monthKey: string): string {
  if (!monthKey?.trim() || !/^\d{4}-\d{2}$/.test(monthKey.trim())) return monthKey?.trim() ?? '—';
  const [year, month] = monthKey.trim().split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

/** Format month_key (yyyy-mm) to label (e.g. "Feb 2026"). Delegates to formatMonthLabel. */
export function formatMonthKey(monthKey: string | undefined): string {
  if (!monthKey?.trim()) return monthKey ?? '—';
  return formatMonthLabel(monthKey.trim());
}

/** Compact currency for charts: 0, 10, 120, 1k, 12.5k, 1.2m. No leading zeros. Single source for YAxis + tooltips. */
export function formatCompactCurrency(value: number | string, currencySymbol = '€'): string {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1e6) return `${sign}${currencySymbol}${(abs / 1e6).toFixed(1)}m`;
  if (abs >= 1e3) return `${sign}${currencySymbol}${abs % 1e3 === 0 ? (abs / 1e3).toFixed(0) : (abs / 1e3).toFixed(1)}k`;
  return `${sign}${currencySymbol}${Math.round(abs)}`;
}

/** Chart Y-axis tick: delegates to formatCompactCurrency (no leading zeros). */
export function chartTickFormat(value: number | string, prefix = '€'): string {
  return formatCompactCurrency(value, prefix);
}

/** Exact money: full value, 2 decimals (no compact/abbreviation). For forecast and stored values. */
export function formatMoneyExact(value: number, currency: 'USD' | 'EUR'): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(currency === 'EUR' ? EUR_LOCALE : USD_LOCALE, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Display both USD and EUR (e.g. "$1,250.00 · €1,145.20"). eurFirst controls order. */
export function formatDualCurrency(
  amountUsd: number | undefined | null,
  amountEur: number | undefined | null,
  eurFirst = false
): string {
  const hasUsd = typeof amountUsd === 'number' && !Number.isNaN(amountUsd);
  const hasEur = typeof amountEur === 'number' && !Number.isNaN(amountEur);
  if (!hasUsd && !hasEur) return '—';
  if (hasUsd && !hasEur) return new Intl.NumberFormat(USD_LOCALE, USD_OPTS).format(amountUsd!);
  if (hasEur && !hasUsd) return new Intl.NumberFormat(EUR_LOCALE, CURRENCY_OPTS_FULL).format(amountEur!);
  const usdStr = new Intl.NumberFormat(USD_LOCALE, USD_OPTS).format(amountUsd!);
  const eurStr = new Intl.NumberFormat(EUR_LOCALE, CURRENCY_OPTS_FULL).format(amountEur!);
  return eurFirst ? `${eurStr} · ${usdStr}` : `${usdStr} · ${eurStr}`;
}
