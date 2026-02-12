'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

let cachedRate: number | null = null;
let cachedAsOf: string | null = null;
let inFlight: Promise<void> | null = null;

export interface UseFxUsdEurResult {
  rate: number | null;
  asOf: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updatedAt: Date | null;
}

/** Fetches /api/fx/usd-eur. Caches in module scope, de-dupes in-flight. */
export function useFxUsdEur(): UseFxUsdEurResult {
  const [rate, setRate] = useState<number | null>(cachedRate);
  const [asOf, setAsOf] = useState<string | null>(cachedAsOf);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const mountedRef = useRef(true);

  const doFetch = useCallback(async () => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const res = await fetch('/api/fx/usd-eur', { credentials: 'include', cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err = (data.error as string) ?? `Request failed (${res.status})`;
          if (mountedRef.current) {
            setError(err);
            setRate(null);
            setAsOf(null);
          }
          return;
        }
        const r = typeof data.rate === 'number' ? data.rate : null;
        const a = typeof data.updatedAt === 'string' ? data.updatedAt : (typeof data.asOf === 'string' ? data.asOf : null);
        cachedRate = r;
        cachedAsOf = a;
        if (mountedRef.current) {
          setRate(r);
          setAsOf(a);
          setError(r == null ? 'Invalid rate' : null);
          setUpdatedAt(new Date());
        }
      } catch (e) {
        if (mountedRef.current) {
          setError(e instanceof Error ? e.message : 'Failed to fetch');
          setRate(null);
          setAsOf(null);
        }
      } finally {
        if (mountedRef.current) setLoading(false);
        inFlight = null;
      }
    })();
    return inFlight;
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    await doFetch();
  }, [doFetch]);

  useEffect(() => {
    mountedRef.current = true;
    doFetch();
    return () => {
      mountedRef.current = false;
    };
  }, [doFetch]);

  return { rate, asOf, loading, error, refresh, updatedAt };
}
