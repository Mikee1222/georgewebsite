'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { formatEurFull, formatUsdFull, formatPercentFull, formatMonthLabel } from '@/lib/format';
import { useFxRate } from '@/app/hooks/useFxRate';
import { getMarginColor } from '@/lib/business-rules';
import { apiFetch } from '@/lib/client-fetch';
import { getCurrentMonthKey, pickDefaultMonthId } from '@/lib/months';
import type { ModelOverviewRow, ModelsOverviewResponse } from '@/app/api/models/overview/route';
import GlassCard from '@/app/components/ui/GlassCard';
import Toolbar from '@/app/components/ui/Toolbar';
import SmartSelect from '@/app/components/ui/SmartSelect';
import EmptyState from '@/app/components/ui/EmptyState';
import ErrorState from '@/app/components/ui/ErrorState';
import TableSkeleton from '@/app/components/ui/TableSkeleton';
import CardSkeleton from '@/app/components/ui/CardSkeleton';
import { TableWithEmpty } from '@/app/components/ui/DataTable';

interface MonthOption {
  id: string;
  month_key: string;
  month_name: string;
}

function marginBadge(margin: number): { label: string; color: string } {
  const c = getMarginColor(margin, null);
  if (c === 'green') return { label: 'good', color: 'text-[var(--green)]' };
  if (c === 'yellow') return { label: 'ok', color: 'text-[var(--yellow)]' };
  return { label: 'low', color: 'text-[var(--red)]' };
}

export default function ModelsPage() {
  const router = useRouter();
  const [months, setMonths] = useState<MonthOption[]>([]);
  const [selectedMonthId, setSelectedMonthId] = useState('');
  const [data, setData] = useState<ModelsOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; requestId: string | null } | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<keyof ModelOverviewRow>('profit');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const loggedRef = useRef(false);
  const { rate: fxRate } = useFxRate();

  const selectedMonth = useMemo(() => months.find((m) => m.id === selectedMonthId), [months, selectedMonthId]);
  const monthKey = selectedMonth?.month_key ?? '';

  useEffect(() => {
    apiFetch<MonthOption[]>('/api/months')
      .then(({ ok, data: list }) => {
        const arr = ok && Array.isArray(list) ? list : [];
        const sorted = [...arr].sort((a, b) => (b.month_key ?? '').localeCompare(a.month_key ?? ''));
        setMonths(sorted);
        if (sorted.length > 0 && !selectedMonthId) {
          const defaultId = pickDefaultMonthId(sorted, getCurrentMonthKey());
          setSelectedMonthId(defaultId ?? sorted[0]?.id ?? '');
        }
      })
      .catch(() => setMonths([]));
  }, [selectedMonthId]);

  useEffect(() => {
    if (!monthKey) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const url = `/api/models/overview?month_key=${encodeURIComponent(monthKey)}`;
    apiFetch<ModelsOverviewResponse>(url)
      .then(({ ok, status, data: d, requestId }) => {
        if (process.env.NODE_ENV === 'development' && !loggedRef.current) {
          console.log('[models] request', url);
          console.log('[models] response', { ok, status, requestId, sample: (d as ModelsOverviewResponse)?.models?.slice?.(0, 1) });
          loggedRef.current = true;
        }
        if (!ok) {
          const errMsg = (d as { error?: string })?.error ?? `Request failed (${status})`;
          setError({ message: errMsg, requestId });
          setData(null);
          return;
        }
        setData(d as ModelsOverviewResponse);
      })
      .catch((e) => {
        setError({ message: e instanceof Error ? e.message : 'Failed to load' , requestId: null });
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [monthKey]);

  const filtered = useMemo(() => {
    if (!data?.models) return [];
    let list = data.models;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((m) => m.model_name.toLowerCase().includes(q));
    }
    list = [...list].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      const numA = typeof aVal === 'number' ? aVal : 0;
      const numB = typeof bVal === 'number' ? bVal : 0;
      if (sortDir === 'asc') return numA - numB;
      return numB - numA;
    });
    return list;
  }, [data?.models, search, sortKey, sortDir]);

  const handleSort = (key: keyof ModelOverviewRow) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else setSortKey(key);
  };

  const monthOptions = useMemo(
    () =>
      months
        .filter((m) => typeof m.id === 'string' && m.id.trim().length > 0)
        .map((m) => ({ value: m.id, label: formatMonthLabel(m.month_key) || m.month_key || m.id })),
    [months]
  );

  const noMonthSelected = !monthKey && !loading;
  const noActualsThisMonth = data && data.totals.revenue === 0 && data.totals.expenses === 0 && data.totals.profit === 0;

  return (
    <div className="min-h-full">
      <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
        <GlassCard className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-lg shadow-black/30 backdrop-blur-xl">
          <h1 className="text-2xl font-bold tracking-tight text-white/95">Models</h1>
          <p className="mt-1.5 text-sm text-white/60">
            Executive overview by month. Select a model to view P&L, entries, and charts.
          </p>
        </GlassCard>

        <Toolbar>
          <span className="text-sm font-medium text-white/70">Month</span>
          <SmartSelect
            value={selectedMonthId || null}
            onValueChange={(v) => setSelectedMonthId(v ?? '')}
            options={monthOptions}
            placeholder={loading ? 'Loading…' : monthOptions.length === 0 ? 'No months' : 'Select month'}
            searchable={monthOptions.length > 8}
            disabled={loading || monthOptions.length === 0}
          />
          <span className="text-sm text-white/70">Search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Model name..."
            className="w-48 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 placeholder:text-white/50 focus:border-[var(--purple-500)] focus:ring-2 focus:ring-purple-400/30"
          />
        </Toolbar>

        {noMonthSelected && (
          <EmptyState
            title="Select a month"
            description="Choose a month above to load the models overview and P&L summary."
          />
        )}

        {monthKey && error && (
          <ErrorState
            title="Could not load overview"
            description={error.message}
            requestId={error.requestId ?? undefined}
          />
        )}

        {monthKey && loading && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
            <TableSkeleton rows={6} cols={6} />
          </>
        )}

        {monthKey && !loading && !error && !data && (
          <EmptyState
            title="No data for this month"
            description="The overview returned no data. Add pnl_lines rows in Airtable, or set up team and models in Members hub."
            ctaText="Go to Members"
            onCta={() => window.location.assign('/team')}
          />
        )}

        {monthKey && !loading && !error && data && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="metric-sweep card-hero rounded-2xl border border-white/10 bg-white/5 px-5 py-5 shadow-lg shadow-black/30 backdrop-blur-xl">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">Total revenue</p>
                <p className={`mt-1.5 tabular-nums text-2xl font-bold tracking-tight ${data.totals.revenue >= 0 ? 'value-positive' : 'value-negative'}`}>
                  {data.totals.revenue_display ?? formatUsdFull(data.totals.revenue)}
                </p>
                {fxRate != null && (
                  <p className="mt-0.5 text-sm tabular-nums text-white/50">
                    {formatEurFull(data.totals.revenue * fxRate)} EUR
                  </p>
                )}
              </div>
              <div className="metric-sweep card-hero rounded-2xl border border-white/10 bg-white/5 px-5 py-5 shadow-lg shadow-black/30 backdrop-blur-xl">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">Total expenses</p>
                <p className="mt-1.5 tabular-nums text-2xl font-bold tracking-tight text-white/90">
                  {data.totals.expenses_display ?? formatUsdFull(data.totals.expenses)}
                </p>
                {typeof data.totals.expenses_eur === 'number' && (
                  <p className="mt-0.5 text-sm tabular-nums text-white/50">
                    {data.totals.expenses_eur_display ?? formatEurFull(data.totals.expenses_eur)}
                  </p>
                )}
              </div>
              <div className="metric-sweep card-hero rounded-2xl border border-white/10 bg-white/5 px-5 py-5 shadow-lg shadow-black/30 backdrop-blur-xl">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">Total profit</p>
                <p className={`mt-1.5 tabular-nums text-2xl font-bold tracking-tight ${data.totals.profit >= 0 ? 'value-positive' : 'value-negative'}`}>
                  {data.totals.profit_display ?? formatUsdFull(data.totals.profit)}
                </p>
                {fxRate != null && (
                  <p className={`mt-0.5 text-sm tabular-nums ${data.totals.profit >= 0 ? 'text-white/50' : 'text-red-400/60'}`}>
                    {formatEurFull(data.totals.profit * fxRate)} EUR
                  </p>
                )}
              </div>
              <div className="metric-sweep card-hero rounded-2xl border border-white/10 bg-white/5 px-5 py-5 shadow-lg shadow-black/30 backdrop-blur-xl">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">Avg margin</p>
                <p className={`mt-1.5 tabular-nums text-2xl font-bold tracking-tight ${marginBadge(data.totals.avg_margin).color}`}>
                  {formatPercentFull(data.totals.avg_margin)}
                </p>
              </div>
            </div>
            {fxRate != null && (
              <p className="text-[11px] text-white/40">1 USD = {fxRate.toFixed(4)} EUR</p>
            )}

            {noActualsThisMonth && (
              <EmptyState
                title="No actuals for this month yet"
                description="P&L overview shows only actuals. Add pnl_lines rows with status “actual” for this month in Airtable, or set up team and models in Members hub."
                ctaText="Go to Members"
                onCta={() => router.push('/team')}
              />
            )}

            {!noActualsThisMonth && (
              <>
                <p className="text-xs text-white/70">Revenue from pnl_lines actuals. Expenses from expense_entries.</p>
                <TableWithEmpty<ModelOverviewRow>
              headers={[
                'Model',
                <span key="rev" className="cursor-pointer" onClick={() => handleSort('revenue')}>Revenue {sortKey === 'revenue' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</span>,
                <span key="exp" className="cursor-pointer" onClick={() => handleSort('expenses')}>Expenses {sortKey === 'expenses' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</span>,
                <span key="prof" className="cursor-pointer" onClick={() => handleSort('profit')}>Profit {sortKey === 'profit' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</span>,
                <span key="marg" className="cursor-pointer" onClick={() => handleSort('margin')}>Margin {sortKey === 'margin' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</span>,
                '',
              ]}
              rows={filtered}
              emptyTitle="No models match"
              emptyDescription="Add PnL rows in Airtable for this month or adjust search."
              numericColumns={[1, 2, 3, 4]}
              renderRow={(row) => {
                const badge = marginBadge(row.margin);
                return (
                  <tr
                    key={row.model_id}
                    className="cursor-pointer hover:bg-white/5 transition-colors"
                    onClick={() => router.push(`/models/${row.model_id}`)}
                  >
                    <td className="py-3 px-4 font-medium text-white/90">{row.model_name}</td>
                    <td className="py-3 px-4 text-right tabular-nums text-white/90">{row.revenue_display ?? formatUsdFull(row.revenue)}</td>
                    <td className="py-3 px-4 text-right tabular-nums text-white/90">
                      <span>{row.expenses_display ?? formatUsdFull(row.expenses)}</span>
                      {typeof row.expenses_eur === 'number' && (
                        <p className="text-xs text-white/50">{row.expenses_eur_display ?? formatEurFull(row.expenses_eur)}</p>
                      )}
                    </td>
                    <td className={`py-3 px-4 text-right tabular-nums ${row.profit >= 0 ? 'text-white/90' : 'text-red-400/90'}`}>{row.profit_display ?? formatUsdFull(row.profit)}</td>
                    <td className={`py-3 px-4 text-right tabular-nums ${badge.color}`}>{formatPercentFull(row.margin)}</td>
                    <td className="py-3 px-4"><span className="text-xs text-[var(--purple-400)]">View →</span></td>
                  </tr>
                );
              }}
            />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
