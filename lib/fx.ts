/**
 * FX utilities: parsing, rounding, USD↔EUR conversion.
 * Edge-safe (no Node crypto, no server-only libs).
 */

/** Parse user input to number; empty or invalid => null. */
export function parseAmount(input: string): number | null {
  if (input == null || typeof input !== 'string') return null;
  const trimmed = input.trim().replace(/,/g, '');
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Round to 2 decimal places. */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Convert USD to EUR: eur = usd * rate (rate = EUR per 1 USD). */
export function convertUsdToEur(usd: number, rate: number): number {
  if (!Number.isFinite(usd) || !Number.isFinite(rate) || rate <= 0) return 0;
  return round2(usd * rate);
}

/** Convert EUR to USD: usd = eur / rate. */
export function convertEurToUsd(eur: number, rate: number): number {
  if (!Number.isFinite(eur) || !Number.isFinite(rate) || rate <= 0) return 0;
  return round2(eur / rate);
}

/** Alias for convertUsdToEur. */
export function usdToEur(usd: number, rate: number): number {
  return convertUsdToEur(usd, rate);
}

/** Alias for convertEurToUsd. */
export function eurToUsd(eur: number, rate: number): number {
  return convertEurToUsd(eur, rate);
}

/**
 * Server-side: fetch USD→EUR rate without calling internal API (avoids auth).
 * Uses Frankfurter API, then FX_FALLBACK_RATE env, then 0.92. EUR = USD * rate.
 */
export async function getFxRateDirect(): Promise<number> {
  const fallbackUrl = process.env.FX_API_URL ?? 'https://api.frankfurter.app/latest?from=USD&to=EUR';
  try {
    const res = await fetch(fallbackUrl, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const data = (await res.json()) as { rates?: { EUR?: number } };
      const r = data?.rates?.EUR;
      if (typeof r === 'number' && r > 0) return r;
    }
  } catch {
    /* ignore */
  }
  if (process.env.FX_FALLBACK_RATE != null) {
    const r = parseFloat(process.env.FX_FALLBACK_RATE);
    if (Number.isFinite(r) && r > 0) return r;
  }
  return 0.92;
}

/**
 * Server-side: fetch current USD→EUR rate from our FX API.
 * Call with request origin (e.g. new URL(request.url).origin) so the same route is used (and cached).
 * Returns null if fetch fails.
 */
export async function getFxRateForServer(origin: string): Promise<{ rate: number; asOf: string } | null> {
  try {
    const url = `${origin.replace(/\/$/, '')}/api/fx/usd-eur`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = (await res.json()) as { rate?: number; asOf?: string };
    const rate = typeof data?.rate === 'number' && data.rate > 0 ? data.rate : null;
    const asOf = typeof data?.asOf === 'string' ? data.asOf : new Date().toISOString().slice(0, 10);
    if (rate == null) return null;
    return { rate, asOf };
  } catch {
    return null;
  }
}

/**
 * Given amount_usd and/or amount_eur from payload, fill the missing one using rate.
 * Returns { amount_usd, amount_eur } suitable for Airtable (both set when possible).
 */
export function ensureDualAmounts(
  amount_usd: number | undefined,
  amount_eur: number | undefined,
  rate: number | null
): { amount_usd: number; amount_eur: number } {
  const hasUsd = typeof amount_usd === 'number' && Number.isFinite(amount_usd);
  const hasEur = typeof amount_eur === 'number' && Number.isFinite(amount_eur);
  if (hasUsd && hasEur) return { amount_usd: round2(amount_usd!), amount_eur: round2(amount_eur!) };
  if (hasUsd && rate != null && rate > 0) return { amount_usd: round2(amount_usd!), amount_eur: convertUsdToEur(amount_usd!, rate) };
  if (hasEur && rate != null && rate > 0) return { amount_usd: convertEurToUsd(amount_eur!, rate), amount_eur: round2(amount_eur!) };
  return {
    amount_usd: hasUsd ? round2(amount_usd!) : 0,
    amount_eur: hasEur ? round2(amount_eur!) : 0,
  };
}
