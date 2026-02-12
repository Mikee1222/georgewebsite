'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useFxUsdEur } from '@/lib/hooks/useFxUsdEur';

const TOAST_DURATION_MS = 1_200;
const AUTO_REFRESH_MS = 60_000;

type Drive = 'usd' | 'eur';
type PctMode = 'of' | 'is';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseNum(s: string): number | null {
  const cleaned = s.replace(/,/g, '').replace(/\s/g, '').trim();
  if (cleaned === '') return null;
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? null : n;
}

export default function CeoToolsCard() {
  const { rate, asOf, loading, error, refresh, updatedAt } = useFxUsdEur();
  const [drive, setDrive] = useState<Drive>('usd');
  const [usdStr, setUsdStr] = useState('');
  const [eurStr, setEurStr] = useState('');
  const [pctMode, setPctMode] = useState<PctMode>('of');
  const [pctX, setPctX] = useState('');
  const [pctY, setPctY] = useState('');
  const [toast, setToast] = useState<{ msg: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [shimmer, setShimmer] = useState(false);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usdInputRef = useRef<HTMLInputElement>(null);
  const eurInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((msg: string) => {
    if (toastRef.current) clearTimeout(toastRef.current);
    setToast({ msg });
    toastRef.current = setTimeout(() => {
      setToast(null);
      toastRef.current = null;
    }, TOAST_DURATION_MS);
  }, []);

  const [refreshSpin, setRefreshSpin] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<'usd' | 'eur' | 'pct' | null>(null);

  const handleRefresh = useCallback(async () => {
    setRefreshSpin(true);
    setRefreshing(true);
    setShimmer(true);
    await refresh();
    setRefreshing(false);
    setTimeout(() => setShimmer(false), 400);
    setTimeout(() => setRefreshSpin(false), 600);
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(handleRefresh, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [handleRefresh]);

  /* When rate refreshes or drive changes: recompute driven from driver (one direction only).
     Intentionally omit usdStr/eurStr from deps to prevent feedback loops. */
  useEffect(() => {
    if (rate == null) return;
    if (drive === 'usd') {
      const n = parseNum(usdStr);
      setEurStr(n != null ? round2(n * rate).toFixed(2) : '');
    } else {
      const n = parseNum(eurStr);
      setUsdStr(n != null ? round2(n / rate).toFixed(2) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- usdStr/eurStr read on purpose; adding them causes loops
  }, [rate, drive]);

  const onUsdChange = (v: string) => {
    setUsdStr(v);
    if (rate != null) {
      const n = parseNum(v);
      setEurStr(n != null ? round2(n * rate).toFixed(2) : '');
    }
  };

  const onEurChange = (v: string) => {
    setEurStr(v);
    if (rate != null) {
      const n = parseNum(v);
      setUsdStr(n != null ? round2(n / rate).toFixed(2) : '');
    }
  };

  const switchToUsd = () => {
    if (rate != null && rate > 0) {
      const n = parseNum(eurStr);
      if (n != null) setUsdStr(round2(n / rate).toFixed(2));
    }
    setDrive('usd');
    setTimeout(() => usdInputRef.current?.focus(), 0);
  };

  const switchToEur = () => {
    if (rate != null && rate > 0) {
      const n = parseNum(usdStr);
      if (n != null) setEurStr(round2(n * rate).toFixed(2));
    }
    setDrive('eur');
    setTimeout(() => eurInputRef.current?.focus(), 0);
  };

  const computedUsd = rate != null ? (() => { const n = parseNum(eurStr); return n != null ? round2(n / rate).toFixed(2) : ''; })() : '';
  const computedEur = rate != null ? (() => { const n = parseNum(usdStr); return n != null ? round2(n * rate).toFixed(2) : ''; })() : '';
  const displayUsd = drive === 'usd' ? usdStr : computedUsd;
  const displayEur = drive === 'eur' ? eurStr : computedEur;

  const copyUsd = async () => {
    const val = drive === 'usd' ? usdStr : displayUsd;
    try {
      await navigator.clipboard.writeText(val);
      setCopyFeedback('usd');
      showToast('Copied');
      setTimeout(() => setCopyFeedback(null), 1200);
    } catch {
      showToast('Copy failed');
    }
  };

  const copyEur = async () => {
    const val = drive === 'eur' ? eurStr : displayEur;
    try {
      await navigator.clipboard.writeText(val);
      setCopyFeedback('eur');
      showToast('Copied');
      setTimeout(() => setCopyFeedback(null), 1200);
    } catch {
      showToast('Copy failed');
    }
  };

  const pctXNum = parseFloat(pctX) || 0;
  const pctYNum = parseFloat(pctY) || 0;
  const pctResult =
    pctMode === 'of'
      ? pctYNum !== 0
        ? round2((pctXNum / 100) * pctYNum)
        : null
      : pctYNum !== 0
        ? round2((pctXNum / pctYNum) * 100)
        : null;

  const copyPct = async () => {
    const val = pctResult?.toString() ?? '';
    try {
      await navigator.clipboard.writeText(val);
      setCopyFeedback('pct');
      showToast('Copied');
      setTimeout(() => setCopyFeedback(null), 1200);
    } catch {
      showToast('Copy failed');
    }
  };

  const timeLabel =
    updatedAt != null && Date.now() - updatedAt.getTime() < 60_000
      ? 'Updated just now'
      : asOf != null
        ? `As of ${asOf}`
        : '—';

  return (
    <div className="ceo-tools-card card-premium relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 sm:p-5 backdrop-blur-[16px] shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">
        CEO Tools
      </p>

      {/* FX row at top */}
      <div className="mt-3 space-y-3">
        <div
          className={`ceo-tools-rate-row relative overflow-hidden rounded-lg py-1.5 ${shimmer ? 'ceo-tools-shimmer' : ''}`}
        >
          {loading ? (
            <div className="ceo-tools-skeleton space-y-1.5">
              <div className="h-4 w-28 animate-pulse rounded bg-white/10" />
              <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
            </div>
          ) : (
            <>
              <p className="text-sm font-medium text-zinc-100">
                1 USD = {rate != null ? rate.toFixed(4) : '—'} EUR
              </p>
              <p className="text-[11px] text-zinc-500">{timeLabel}</p>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="ceo-tools-btn flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-medium text-zinc-300 transition-all duration-200 hover:border-white/15 hover:bg-white/[0.06] hover:text-zinc-100 hover:shadow-[0_0_12px_rgba(168,85,247,0.15)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple-500)]/30 active:scale-[0.98] disabled:opacity-50"
          >
            {refreshing ? (
              <span className="ceo-tools-spinner h-3.5 w-3.5 rounded-full border-2 border-zinc-500 border-t-zinc-300" />
            ) : (
              <svg
                className={`h-3.5 w-3.5 transition-transform duration-500 ${refreshSpin ? 'ceo-tools-refresh-rotate' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            Refresh
          </button>
        </div>

        {error && (
          <p className="text-xs text-red-400/90">{error}</p>
        )}

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="ceo-tools-pills relative flex rounded-lg border border-white/[0.08] bg-white/[0.02] p-0.5">
              <span
                className="absolute top-0.5 bottom-0.5 w-[calc(50%-4px)] rounded-md bg-white/10 shadow-sm transition-[left] duration-200 ease-out"
                style={{ left: drive === 'usd' ? '2px' : 'calc(50% + 2px)' }}
              />
              <button
                type="button"
                onClick={switchToUsd}
                className={`relative z-10 rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple-500)]/30 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent active:scale-[0.98] hover:shadow-[0_0_8px_rgba(255,255,255,0.06)] ${drive === 'usd' ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                USD drives
              </button>
              <button
                type="button"
                onClick={switchToEur}
                className={`relative z-10 rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple-500)]/30 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent active:scale-[0.98] hover:shadow-[0_0_8px_rgba(255,255,255,0.06)] ${drive === 'eur' ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                EUR drives
              </button>
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                USD
              </label>
              <div className="flex items-center gap-2">
                <input
                  ref={usdInputRef}
                  type="number"
                  inputMode="decimal"
                  value={displayUsd}
                  onChange={(e) => onUsdChange(e.target.value)}
                  readOnly={drive === 'eur'}
                  disabled={rate == null}
                  placeholder="0"
                  className="ceo-tools-input w-full rounded-lg border border-white/[0.08] bg-white/[0.03] py-2.5 pr-3 pl-3 text-right font-mono text-zinc-100 placeholder:text-zinc-600 focus:border-[var(--purple-500)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--purple-500)]/30 disabled:opacity-50 read-only:opacity-90 read-only:cursor-default"
                />
                <button
                  type="button"
                  onClick={copyUsd}
                  className="ceo-tools-btn flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-400 transition-all duration-200 hover:border-white/15 hover:bg-white/[0.06] hover:text-zinc-200 hover:shadow-[0_0_12px_rgba(168,85,247,0.15)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple-500)]/30 active:scale-[0.98]"
                  title="Copy USD"
                >
                  {copyFeedback === 'usd' ? (
                    <span className="text-[10px] font-medium text-[var(--green)]">OK</span>
                  ) : (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                EUR
              </label>
              <div className="flex items-center gap-2">
                <input
                  ref={eurInputRef}
                  type="number"
                  inputMode="decimal"
                  value={displayEur}
                  onChange={(e) => onEurChange(e.target.value)}
                  readOnly={drive === 'usd'}
                  disabled={rate == null}
                  placeholder="0"
                  className="ceo-tools-input w-full rounded-lg border border-white/[0.08] bg-white/[0.03] py-2.5 pr-3 pl-3 text-right font-mono text-zinc-100 placeholder:text-zinc-600 focus:border-[var(--purple-500)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--purple-500)]/30 disabled:opacity-50 read-only:opacity-90 read-only:cursor-default [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  onClick={copyEur}
                  className="ceo-tools-btn flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-400 transition-all duration-200 hover:border-white/15 hover:bg-white/[0.06] hover:text-zinc-200 hover:shadow-[0_0_12px_rgba(168,85,247,0.15)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple-500)]/30 active:scale-[0.98]"
                  title="Copy EUR"
                >
                  {copyFeedback === 'eur' ? (
                    <span className="text-[10px] font-medium text-[var(--green)]">OK</span>
                  ) : (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="my-4 border-t border-white/[0.06]" />

      {/* Percentage Section */}
      <div className="space-y-2.5">
        <div className="flex rounded-lg border border-white/[0.08] bg-white/[0.02] p-0.5">
          <button
            type="button"
            onClick={() => setPctMode('of')}
            className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-all duration-200 ${pctMode === 'of' ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            X% of Y
          </button>
          <button
            type="button"
            onClick={() => setPctMode('is')}
            className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-all duration-200 ${pctMode === 'is' ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            X is what % of Y
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              {pctMode === 'of' ? 'X (%)' : 'X'}
            </label>
            <input
              type="number"
              inputMode="decimal"
              value={pctX}
              onChange={(e) => setPctX(e.target.value)}
              placeholder="0"
              className="ceo-tools-input w-full rounded-lg border border-white/[0.08] bg-white/[0.03] py-2.5 pr-3 pl-3 text-right font-mono text-zinc-100 placeholder:text-zinc-600 focus:border-white/20 focus:outline-none focus:ring-2 focus:ring-[var(--purple-500)]/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              Y
            </label>
            <input
              type="number"
              inputMode="decimal"
              value={pctY}
              onChange={(e) => setPctY(e.target.value)}
              placeholder="0"
              className="ceo-tools-input w-full rounded-lg border border-white/[0.08] bg-white/[0.03] py-2.5 pr-3 pl-3 text-right font-mono text-zinc-100 placeholder:text-zinc-600 focus:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/10"
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <span className="text-sm text-zinc-500">
            {pctMode === 'of' ? 'Result' : '%'}
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg font-semibold text-zinc-100 tabular-nums">
              {pctResult != null ? pctResult : '—'}
            </span>
            <button
              type="button"
              onClick={copyPct}
              disabled={pctResult == null}
              className="ceo-tools-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-400 transition-all duration-200 hover:border-white/15 hover:bg-white/[0.06] hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple-500)]/30 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none"
              title="Copy"
            >
              {copyFeedback === 'pct' ? (
                <span className="text-[10px] font-medium text-[var(--green)]">OK</span>
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                </svg>
              )}
            </button>
          </div>
        </div>
        {pctMode === 'is' && pctYNum === 0 && pctXNum !== 0 && (
          <p className="text-xs text-zinc-500">Division by zero</p>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="ceo-tools-toast absolute bottom-4 right-4 rounded-lg border border-white/[0.1] bg-zinc-900/95 px-3 py-2 text-xs font-medium text-zinc-100 shadow-lg">
          {toast.msg}
        </div>
      )}
    </div>
  );
}
