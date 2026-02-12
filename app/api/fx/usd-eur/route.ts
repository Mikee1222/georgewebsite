import { NextResponse } from 'next/server';
import { requestId } from '@/lib/api-utils';

/** Edge-compatible for Cloudflare Workers. No in-memory cache (workers are stateless). */
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const FRANKFURTER_URL = 'https://api.frankfurter.app/latest?from=USD&to=EUR';

const CACHE_CONTROL = 'private, no-store, no-cache';

/** GET /api/fx/usd-eur — returns { rate: number, updatedAt: string }. Never crash; fallback from env if fetch fails. */
export async function GET() {
  const reqId = requestId();
  const apiUrl = process.env.FX_API_URL ?? FRANKFURTER_URL;
  const fallbackRate = process.env.FX_FALLBACK_RATE != null ? parseFloat(process.env.FX_FALLBACK_RATE) : null;
  try {
    const res = await fetch(apiUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`FX API ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { rates?: { EUR?: number }; date?: string };
    const rate = data?.rates?.EUR;
    if (rate == null || typeof rate !== 'number' || rate <= 0) {
      throw new Error('Invalid FX response: missing or invalid rates.EUR');
    }
    const asOf = typeof data?.date === 'string' ? data.date : new Date().toISOString().slice(0, 10);
    const out = NextResponse.json({ rate, updatedAt: asOf });
    out.headers.set('request-id', reqId);
    out.headers.set('Cache-Control', CACHE_CONTROL);
    return out;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[api/fx/usd-eur]', e);
    }
    const useRate =
      fallbackRate != null && Number.isFinite(fallbackRate) && fallbackRate > 0
        ? fallbackRate
        : 0.92;
    const asOf = new Date().toISOString().slice(0, 10);
    const out = NextResponse.json({ rate: useRate, updatedAt: asOf });
    out.headers.set('request-id', reqId);
    out.headers.set('Cache-Control', CACHE_CONTROL);
    return out;
  }
}
