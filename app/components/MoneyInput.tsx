'use client';

import { useId, useState, useEffect } from 'react';
import { parseAmount, round2, convertUsdToEur, convertEurToUsd } from '@/lib/fx';

export type BaseCurrency = 'usd' | 'eur';

export interface MoneyInputProps {
  /** Current USD value (controlled). */
  valueUsd: number | undefined | null;
  /** Current EUR value (controlled). */
  valueEur: number | undefined | null;
  /** Called when user changes amount; always pass both. */
  onChange: (payload: { amount_usd: number; amount_eur: number }) => void;
  /** USD→EUR rate (e.g. 0.92). */
  fxRate: number | null;
  /** Which currency is the editable base. */
  baseCurrency: BaseCurrency;
  /** Optional: called when user toggles base currency (USD/EUR). */
  onBaseCurrencyChange?: (c: BaseCurrency) => void;
  /** Optional: lock base currency (no toggle). */
  lockBaseCurrency?: boolean;
  /** Optional: callback when user clicks refresh. */
  onRefetch?: () => void;
  /** Rate date string for helper text. */
  asOf?: string | null;
  disabled?: boolean;
  label?: string;
}

function formatOther(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function MoneyInput({
  valueUsd,
  valueEur,
  onChange,
  fxRate,
  baseCurrency,
  onBaseCurrencyChange,
  lockBaseCurrency = false,
  onRefetch,
  asOf = null,
  disabled = false,
  label = 'Amount',
}: MoneyInputProps) {
  const id = useId();
  const baseValue = baseCurrency === 'usd' ? valueUsd : valueEur;
  const [localBase, setLocalBase] = useState(() =>
    baseValue != null && Number.isFinite(baseValue) ? String(baseValue) : ''
  );

  useEffect(() => {
    const v = baseCurrency === 'usd' ? valueUsd : valueEur;
    if (v != null && Number.isFinite(v)) setLocalBase(String(v));
    else setLocalBase('');
  }, [baseCurrency, valueUsd, valueEur]);

  const numBase = parseAmount(localBase);
  const computedOther =
    fxRate != null && fxRate > 0 && numBase != null && numBase >= 0
      ? baseCurrency === 'eur'
        ? convertEurToUsd(numBase, fxRate)
        : convertUsdToEur(numBase, fxRate)
      : null;

  const handleBaseChange = (raw: string) => {
    setLocalBase(raw);
    const n = parseAmount(raw);
    if (n != null && n >= 0 && fxRate != null && fxRate > 0) {
      const amount_usd = baseCurrency === 'usd' ? round2(n) : round2(n / fxRate);
      const amount_eur = baseCurrency === 'eur' ? round2(n) : round2(n * fxRate);
      onChange({ amount_usd, amount_eur });
    }
  };

  const canChangeCurrency = !lockBaseCurrency && !disabled && onBaseCurrencyChange != null;

  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={id} className="block text-xs font-medium text-white/70">
          {label}
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-zinc-950/70 p-2 shadow-inner backdrop-blur-xl focus-within:ring-2 focus-within:ring-[var(--purple-500)]/30">
        {canChangeCurrency && (
          <div className="flex rounded-xl bg-black/20 p-0.5">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onBaseCurrencyChange?.('usd')}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                baseCurrency === 'usd'
                  ? 'bg-[var(--purple-500)] text-white'
                  : 'text-white/80 hover:bg-white/10'
              }`}
            >
              USD
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onBaseCurrencyChange?.('eur')}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                baseCurrency === 'eur'
                  ? 'bg-[var(--purple-500)] text-white'
                  : 'text-white/80 hover:bg-white/10'
              }`}
            >
              EUR
            </button>
          </div>
        )}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={localBase}
          onChange={(e) => handleBaseChange(e.target.value)}
          disabled={disabled}
          placeholder={baseCurrency === 'usd' ? '0.00' : '0,00'}
          className="min-w-[100px] flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm tabular-nums text-white placeholder:text-white/40 focus:border-[var(--purple-500)] focus:outline-none focus:ring-2 focus:ring-[var(--purple-500)]/30 disabled:opacity-50"
        />
        <div className="flex min-w-[90px] items-center justify-end rounded-xl bg-white/5 px-3 py-2 text-sm tabular-nums text-white/80">
          <span className="mr-1 text-white/60">{baseCurrency === 'usd' ? '€' : '$'}</span>
          {formatOther(computedOther)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/60">
        {fxRate != null && fxRate > 0 ? (
          <span>1 USD = {fxRate.toFixed(4)} EUR</span>
        ) : (
          <span>No rate — enter amount</span>
        )}
        {asOf && <span>· as of {asOf}</span>}
        {onRefetch && (
          <>
            <span>·</span>
            <button
              type="button"
              onClick={() => onRefetch()}
              disabled={disabled}
              className="text-[var(--purple-400)] hover:underline disabled:opacity-50"
            >
              Refresh rate
            </button>
          </>
        )}
      </div>
    </div>
  );
}
