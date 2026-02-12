/**
 * Month helpers: current month in Europe/Athens and default month picker.
 * Use getCurrentMonthKey / pickDefaultMonthId only on the client (e.g. in useEffect)
 * to avoid hydration mismatch.
 */

const DEFAULT_TIMEZONE = 'Europe/Athens';

/**
 * Returns current month as yyyy-mm in Europe/Athens (or user local timezone).
 * Call only on client (e.g. inside useEffect or after months fetch).
 */
export function getCurrentMonthKey(timezone: string = DEFAULT_TIMEZONE): string {
  if (typeof window === 'undefined') {
    return '';
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  });
  const parts = formatter.formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const m = parts.find((p) => p.type === 'month')?.value ?? '';
  return `${y}-${m}`;
}

export interface MonthLike {
  id: string;
  month_key: string;
}

/**
 * Picks default month id: current month if in list, else nearest previous month, else first in list.
 * @param months - sorted or unsorted list (with id and month_key)
 * @param currentMonthKey - yyyy-mm from getCurrentMonthKey()
 */
export function pickDefaultMonthId(months: MonthLike[], currentMonthKey: string): string | null {
  if (!months.length) return null;
  const exact = months.find((m) => (m.month_key ?? '') === currentMonthKey);
  if (exact) return exact.id;
  const prev = months
    .filter((m) => (m.month_key ?? '') < currentMonthKey)
    .sort((a, b) => (b.month_key ?? '').localeCompare(a.month_key ?? ''))[0];
  if (prev) return prev.id;
  return months[0]?.id ?? null;
}
