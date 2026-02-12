/**
 * Unified period abstraction (month_key ranges).
 * Used by routes to normalize month_key, from_month_key+to_month_key, or legacy from/to.
 */

export interface Period {
  from_month_key: string;
  to_month_key: string;
}

export type ParsePeriodResult = { ok: true; period: Period } | { ok: false; error: string };

/**
 * Parse period from URL search params.
 * - month_key (single) → from = to = month_key
 * - from_month_key + to_month_key (or legacy "from" / "to") → period range
 * - If none provided → { ok: false, error: "period required" }
 * - Validates from_month_key <= to_month_key lexicographically.
 */
export function parsePeriodFromQuery(params: URLSearchParams): ParsePeriodResult {
  const month_key = params.get('month_key')?.trim() ?? '';
  const from_month_key = params.get('from_month_key')?.trim() ?? params.get('from')?.trim() ?? '';
  const to_month_key = params.get('to_month_key')?.trim() ?? params.get('to')?.trim() ?? '';

  if (month_key) {
    return { ok: true, period: { from_month_key: month_key, to_month_key: month_key } };
  }
  const to = to_month_key || from_month_key;
  if (from_month_key && to) {
    if (from_month_key > to) {
      return { ok: false, error: 'from_month_key must be <= to_month_key' };
    }
    return { ok: true, period: { from_month_key, to_month_key: to } };
  }
  return { ok: false, error: 'period required (month_key or from_month_key+to_month_key)' };
}
