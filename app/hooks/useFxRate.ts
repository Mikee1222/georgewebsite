'use client';

import { useState, useEffect, useCallback } from 'react';

export interface FxRateState {
  rate: number | null;
  asOf: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** Fetches /api/fx/usd-eur. Returns { rate, asOf, loading, error, refresh }. */
export function useFxRate(): FxRateState {
  const [rate, setRate] = useState<number | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/fx/usd-eur', { credentials: 'include', cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data.error as string) ?? `Request failed (${res.status})`);
        setRate(null);
        setAsOf(null);
        return;
      }
      const r = typeof data.rate === 'number' ? data.rate : null;
      const a = typeof (data.updatedAt ?? data.asOf) === 'string' ? (data.updatedAt ?? data.asOf) : null;
      setRate(r);
      setAsOf(a);
      if (r == null) setError('Invalid rate in response');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch FX rate');
      setRate(null);
      setAsOf(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRate();
  }, [fetchRate]);

  return { rate, asOf, loading, error, refresh: fetchRate };
}
