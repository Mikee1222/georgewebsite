'use client';

import {
  formatEurFull,
  formatPercentCompact,
} from '@/lib/format';

export interface KpiBarModelProps {
  netRevenue: number;
  totalExpenses: number;
  netProfit: number;
  profitMarginPct: number;
  label?: string;
}

export interface KpiBarAgencyProps {
  netRevenue: number;
  totalExpenses: number;
  netProfit: number;
  avgMarginPct: number;
  label?: string;
}

export function KpiBarModel({
  netRevenue,
  totalExpenses,
  netProfit,
  profitMarginPct,
  label,
}: KpiBarModelProps) {
  return (
    <div
      className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] px-5 py-4 shadow-[var(--shadow-sm)]"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      {label && (
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
          {label}
        </p>
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-[var(--text-muted)]">Net revenue</p>
          <p className="tabular-nums text-lg font-semibold text-[var(--text)]">
            {formatEurFull(netRevenue)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-muted)]">Total expenses</p>
          <p className="tabular-nums text-lg font-semibold text-[var(--text)]">
            {formatEurFull(totalExpenses)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-muted)]">Net profit</p>
          <p className="tabular-nums text-lg font-semibold text-[var(--text)]">
            {formatEurFull(netProfit)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-muted)]">Margin</p>
          <p className="tabular-nums text-lg font-semibold text-[var(--accent)]">
            {formatPercentCompact(profitMarginPct)}
          </p>
        </div>
      </div>
    </div>
  );
}

export function KpiBarAgency({
  netRevenue,
  totalExpenses,
  netProfit,
  avgMarginPct,
  label,
}: KpiBarAgencyProps) {
  return (
    <div
      className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] px-5 py-4 shadow-[var(--shadow-sm)]"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      {label && (
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
          {label}
        </p>
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-[var(--text-muted)]">Net revenue</p>
          <p className="tabular-nums text-lg font-semibold text-[var(--text)]">
            {formatEurFull(netRevenue)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-muted)]">Total expenses</p>
          <p className="tabular-nums text-lg font-semibold text-[var(--text)]">
            {formatEurFull(totalExpenses)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-muted)]">Net profit</p>
          <p className="tabular-nums text-lg font-semibold text-[var(--text)]">
            {formatEurFull(netProfit)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-muted)]">Avg margin</p>
          <p className="tabular-nums text-lg font-semibold text-[var(--accent)]">
            {formatPercentCompact(avgMarginPct)}
          </p>
        </div>
      </div>
    </div>
  );
}
