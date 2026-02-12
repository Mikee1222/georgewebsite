'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { SELECT_ALL } from '@/lib/select-constants';
import AgencyGrid from '../../components/AgencyGrid';
import SmartSelect from '../../components/ui/SmartSelect';
import TableSkeleton from '../../components/ui/TableSkeleton';
import CardSkeleton from '../../components/ui/CardSkeleton';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import { apiFetch } from '@/lib/client-fetch';
import { getCurrentMonthKey, pickDefaultMonthId } from '@/lib/months';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { formatEurFull, formatUsdFull, formatPercentFull, formatMonthLabel } from '@/lib/format';
import ChartTooltip from '@/app/components/charts/ChartTooltip';
import { getMarginColor } from '@/lib/business-rules';
import type { AgencyRow, AgencyMasterResponse } from '@/lib/types';

interface MonthOption {
  id: string;
  month_key: string;
  month_name: string;
}

interface EntriesByMonth {
  month_id: string;
  month_key: string;
  month_name: string;
  revenue_total: number;
  expenses_total: number;
  profit_total: number;
  expenses_by_department: Record<string, number>;
  expenses_by_category: Record<string, number>;
  top_cost_owners: { owner_type: string; owner_id: string; owner_name: string; total: number }[];
}

interface EntriesResponse {
  range: { from_month_id: string; to_month_id: string };
  byMonth: EntriesByMonth[];
  totals: {
    revenue_total: number;
    expenses_total: number;
    profit_total: number;
    expenses_by_department: Record<string, number>;
    expenses_by_category: Record<string, number>;
  };
}

function formatRefreshTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function marginBadge(margin: number): { label: string; color: string } {
  const c = getMarginColor(margin, null);
  if (c === 'green') return { label: 'good', color: 'text-[var(--green)]' };
  if (c === 'yellow') return { label: 'ok', color: 'text-[var(--yellow)]' };
  return { label: 'low', color: 'text-[var(--red)]' };
}

const DEPT_COLORS: Record<string, string> = {
  models: 'var(--accent)',
  chatting: '#34d399',
  marketing: '#fbbf24',
  production: '#60a5fa',
  ops: '#a78bfa',
};

// Default and only view is PnL; Entries view is hidden (revenue_entries table not present).
// Fetch: viewSource === 'entries' → GET /api/agency/entries; else → GET /api/agency (PnL).
export default function AgencyPage() {
  const [viewSource, setViewSource] = useState<'entries' | 'pnl'>('pnl');
  const [months, setMonths] = useState<MonthOption[]>([]);
  const [fromMonthId, setFromMonthId] = useState('');
  const [toMonthId, setToMonthId] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [entriesData, setEntriesData] = useState<EntriesResponse | null>(null);
  const [pnlData, setPnlData] = useState<AgencyRow[]>([]);
  const [agencyTotals, setAgencyTotals] = useState<AgencyMasterResponse['totals'] | null>(null);
  const [payoutsMode, setPayoutsMode] = useState<'owed' | 'paid'>('owed');
  const [payoutsSource, setPayoutsSource] = useState<'live' | 'locked'>('live');
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [sortKey, setSortKey] = useState<keyof AgencyRow>('net_profit');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedMonthId, setSelectedMonthId] = useState('');
  const [error, setError] = useState<{ message: string; requestId: string | null } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const loggedRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    fetch('/api/months', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: MonthOption[]) => {
        const list = Array.isArray(data) ? data : [];
        setMonths(list.sort((a, b) => a.month_key.localeCompare(b.month_key)));
        if (list.length > 0 && !fromMonthId) {
          const defaultId = pickDefaultMonthId(list, getCurrentMonthKey());
          const id = defaultId ?? list[0]?.id ?? '';
          setFromMonthId(id);
          setToMonthId(id);
          setSelectedMonthId(id);
        }
      })
      .catch(() => setMonths([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount to load month options
  }, []);

  useEffect(() => {
    if (viewSource === 'entries') {
      if (!fromMonthId || !toMonthId) {
        setEntriesData(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      const url = `/api/agency/entries?from_month_id=${encodeURIComponent(fromMonthId)}&to_month_id=${encodeURIComponent(toMonthId)}&department=${encodeURIComponent(departmentFilter === SELECT_ALL ? 'all' : departmentFilter ?? '')}`;
      apiFetch<EntriesResponse>(url)
        .then(({ ok, data: d, requestId }) => {
          if (process.env.NODE_ENV === 'development' && !loggedRef.current['entries']) {
            console.log('[agency] entries request', url);
            console.log('[agency] entries response', { ok, requestId, sample: (d as EntriesResponse)?.byMonth?.slice?.(0, 1) });
            loggedRef.current['entries'] = true;
          }
          if (!ok) {
            setError({ message: (d as { error?: string })?.error ?? 'Failed to load entries', requestId });
            setEntriesData(null);
            return;
          }
          setError(null);
          setEntriesData(d as EntriesResponse);
          setLastRefresh(new Date());
          if ((d as EntriesResponse).byMonth?.length && !selectedMonthId)
            setSelectedMonthId((d as EntriesResponse).byMonth[(d as EntriesResponse).byMonth!.length - 1]!.month_id);
        })
        .catch((err) => {
          setError({ message: err instanceof Error ? err.message : 'Failed to load entries', requestId: null });
          setEntriesData(null);
        })
        .finally(() => setLoading(false));
    } else {
      const fromKey = months.find((m) => m.id === fromMonthId)?.month_key ?? getCurrentMonthKey();
      const toKey = months.find((m) => m.id === toMonthId)?.month_key ?? fromKey;
      setLoading(true);
      setError(null);
      const url = `/api/agency?from=${encodeURIComponent(fromKey)}&to=${encodeURIComponent(toKey)}&payouts_mode=${encodeURIComponent(payoutsMode)}&payouts_source=${encodeURIComponent(payoutsSource)}`;
      apiFetch<AgencyMasterResponse>(url)
        .then(({ ok, data: d, requestId }) => {
          if (process.env.NODE_ENV === 'development' && !loggedRef.current['pnl']) {
            console.log('[agency] pnl request', url);
            console.log('[agency] pnl response', { ok, requestId, hasTotals: !!(d as AgencyMasterResponse)?.totals, modelsCount: (d as AgencyMasterResponse)?.models?.length });
            loggedRef.current['pnl'] = true;
          }
          if (!ok) {
            setError({ message: (d as { error?: string })?.error ?? 'Failed to load PnL', requestId });
            setPnlData([]);
            setAgencyTotals(null);
            return;
          }
          setError(null);
          const body = d as AgencyMasterResponse;
          setPnlData(Array.isArray(body?.models) ? body.models : []);
          setAgencyTotals(body?.totals ?? null);
          setLastRefresh(new Date());
        })
        .catch((err) => {
          setError({ message: err instanceof Error ? err.message : 'Failed to load PnL', requestId: null });
          setPnlData([]);
          setAgencyTotals(null);
        })
        .finally(() => setLoading(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedMonthId is UI-only, not fetch trigger
  }, [viewSource, fromMonthId, toMonthId, months, payoutsMode, payoutsSource, refreshKey]);

  const sorted = useMemo(() => {
    const arr = [...pnlData];
    arr.sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      const numA = typeof va === 'number' ? va : 0;
      const numB = typeof vb === 'number' ? vb : 0;
      if (sortDir === 'asc') return numA > numB ? 1 : numA < numB ? -1 : 0;
      return numB > numA ? 1 : numB < numA ? -1 : 0;
    });
    return arr;
  }, [pnlData, sortKey, sortDir]);

  const pnlKpiTotals = useMemo(() => {
    if (agencyTotals) {
      return {
        revenueUsd: agencyTotals.revenue_usd,
        revenueEur: agencyTotals.revenue_eur,
        expensesUsd: agencyTotals.expenses_usd,
        expensesEur: agencyTotals.expenses_eur,
        profitUsd: agencyTotals.profit_usd,
        profitEur: agencyTotals.profit_eur,
        avgMarginPct: agencyTotals.margin_pct,
        payoutUsd: agencyTotals.payout_usd,
        payoutEur: agencyTotals.payout_eur,
      };
    }
    const netRevenue = pnlData.reduce((s, r) => s + (r.net_revenue ?? 0), 0);
    const totalExpenses = pnlData.reduce((s, r) => s + (r.total_expenses ?? 0), 0);
    const netProfit = pnlData.reduce((s, r) => s + (r.net_profit ?? 0), 0);
    const avgMargin = netRevenue > 0 ? netProfit / netRevenue : 0;
    return {
      revenueUsd: 0,
      revenueEur: netRevenue,
      expensesUsd: 0,
      expensesEur: totalExpenses,
      profitUsd: 0,
      profitEur: netProfit,
      avgMarginPct: avgMargin,
      payoutUsd: 0,
      payoutEur: 0,
    };
  }, [agencyTotals, pnlData]);

  const entriesTotals = useMemo(() => {
    if (!entriesData?.totals) return null;
    const t = entriesData.totals;
    const isAllDept = departmentFilter === SELECT_ALL || departmentFilter === 'all';
    const deptFilter = !isAllDept ? t.expenses_by_department[departmentFilter] ?? 0 : t.expenses_total;
    const revenue = t.revenue_total;
    const expenses = isAllDept ? t.expenses_total : deptFilter;
    const profit = revenue - expenses;
    const margin = revenue > 0 ? profit / revenue : 0;
    return {
      revenue_total: revenue,
      expenses_total: expenses,
      profit_total: profit,
      marginPct: margin,
    };
  }, [entriesData, departmentFilter]);

  const selectedMonthData = useMemo(() => {
    if (!entriesData?.byMonth || !selectedMonthId) return null;
    return entriesData.byMonth.find((m) => m.month_id === selectedMonthId) ?? null;
  }, [entriesData, selectedMonthId]);

  const stackedBarData = useMemo(() => {
    if (!entriesData?.byMonth) return [];
    const depts = ['models', 'chatting', 'marketing', 'production', 'ops'];
    return entriesData.byMonth.map((m) => {
      const row: Record<string, number | string> = {
        month: formatMonthLabel(m.month_key) || m.month_key,
        name: formatMonthLabel(m.month_key) || m.month_key,
      };
      for (const dept of depts) {
        const val = departmentFilter === 'all' || departmentFilter === dept
          ? (m.expenses_by_department[dept] ?? 0)
          : 0;
        row[dept] = val;
      }
      return row;
    });
  }, [entriesData, departmentFilter]);

  const lineChartData = useMemo(() => {
    if (!entriesData?.byMonth) return [];
    return entriesData.byMonth.map((m) => ({
      month: formatMonthLabel(m.month_key) || m.month_key,
      name: formatMonthLabel(m.month_key) || m.month_key,
      revenue: m.revenue_total,
      expenses: m.expenses_total,
      profit: m.profit_total,
    }));
  }, [entriesData]);

  const pieData = useMemo(() => {
    if (!selectedMonthData?.expenses_by_category) return [];
    return Object.entries(selectedMonthData.expenses_by_category)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }));
  }, [selectedMonthData]);

  const marginBadgeInfo = useMemo(() => {
    const margin = viewSource === 'entries' ? (entriesTotals?.marginPct ?? 0) : pnlKpiTotals.avgMarginPct;
    return marginBadge(margin);
  }, [viewSource, entriesTotals, pnlKpiTotals.avgMarginPct]);

  const exportUrl = `/api/export/agency?from=${months.find((m) => m.id === fromMonthId)?.month_key ?? ''}&to=${months.find((m) => m.id === toMonthId)?.month_key ?? ''}`;

  return (
    <div className="min-h-full bg-gradient-to-b from-[var(--bg)] to-[var(--surface)]/30">
      <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
        <div className="card-hero flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-6 py-5 shadow-lg shadow-black/30 backdrop-blur-xl">
          <h1 className="text-2xl font-bold tracking-tight text-white/95">Agency master</h1>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-white/70">From</span>
            <SmartSelect
              value={fromMonthId ?? ''}
              onChange={setFromMonthId}
              options={months.map((m) => ({ value: m.id, label: formatMonthLabel(m.month_key) || m.month_key }))}
              placeholder="From"
              disabled={months.length === 0}
            />
            <span className="text-sm text-white/70">To</span>
            <SmartSelect
              value={toMonthId ?? ''}
              onChange={setToMonthId}
              options={months.map((m) => ({ value: m.id, label: formatMonthLabel(m.month_key) || m.month_key }))}
              placeholder="To"
              disabled={months.length === 0}
            />
            {viewSource === 'pnl' && (
              <>
                <span className="text-sm text-white/70">Payouts</span>
                <SmartSelect
                  value={payoutsMode}
                  onChange={(v) => setPayoutsMode(v as 'owed' | 'paid')}
                  options={[
                    { value: 'owed', label: 'Owed' },
                    { value: 'paid', label: 'Paid' },
                  ]}
                  placeholder="Owed"
                />
                <span className="text-sm text-white/70">Source</span>
                <SmartSelect
                  value={payoutsSource}
                  onChange={(v) => setPayoutsSource(v as 'live' | 'locked')}
                  options={[
                    { value: 'live', label: 'Live' },
                    { value: 'locked', label: 'Locked' },
                  ]}
                  placeholder="Live"
                />
              </>
            )}
            {viewSource === 'entries' && (
              <>
                <span className="text-sm text-white/70">Department</span>
                <SmartSelect
                  value={departmentFilter ?? SELECT_ALL}
                  onChange={setDepartmentFilter}
                  options={[
                    { value: SELECT_ALL, label: 'All' },
                    { value: 'models', label: 'Models' },
                    { value: 'chatting', label: 'Chatting' },
                    { value: 'marketing', label: 'Marketing' },
                    { value: 'production', label: 'Production' },
                    { value: 'ops', label: 'Ops' },
                  ]}
                  placeholder="All"
                />
              </>
            )}
            <a
              href={exportUrl}
              className="btn-primary rounded-lg px-4 py-2 text-sm font-medium no-underline"
              download
            >
              Export CSV
            </a>
          </div>
        </div>

        {months.length === 0 && !loading ? (
          <EmptyState
            title="No months available"
            description="Load months from Airtable first. Check that the months table exists and has records, or try again later."
          />
        ) : viewSource === 'entries' ? (
          !fromMonthId || !toMonthId ? (
            <EmptyState
              title="Select date range"
              description="Choose From and To month above to load entries data."
            />
          ) : loading ? (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[1, 2, 3, 4].map((i) => (
                  <CardSkeleton key={i} />
                ))}
              </div>
              <TableSkeleton rows={8} cols={10} />
            </>
          ) : error ? (
            <ErrorState
              title="Could not load data"
              description={error.message}
              requestId={error.requestId ?? undefined}
            />
          ) : entriesData ? (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="card-hero rounded-2xl border border-white/10 bg-white/5 px-5 py-5 shadow-lg shadow-black/30 backdrop-blur-xl">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">Total revenue</p>
                <p className={`mt-1.5 tabular-nums text-2xl font-bold tracking-tight ${(entriesTotals?.revenue_total ?? 0) >= 0 ? 'value-positive' : 'value-negative'}`}>
                  {formatEurFull(entriesTotals?.revenue_total ?? 0)}
                </p>
              </div>
              <div className="card-hero rounded-2xl border border-white/10 bg-white/5 px-5 py-5 shadow-lg shadow-black/30 backdrop-blur-xl">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">Total expenses</p>
                <p className="mt-1.5 tabular-nums text-2xl font-bold tracking-tight text-white/90">
                  {formatEurFull(entriesTotals?.expenses_total ?? 0)}
                </p>
              </div>
              <div className="card-hero rounded-2xl border border-white/10 bg-white/5 px-5 py-5 shadow-lg shadow-black/30 backdrop-blur-xl">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">Net profit</p>
                <p className={`mt-1.5 tabular-nums text-2xl font-bold tracking-tight ${(entriesTotals?.profit_total ?? 0) >= 0 ? 'value-positive' : 'value-negative'}`}>
                  {formatEurFull(entriesTotals?.profit_total ?? 0)}
                </p>
              </div>
              <div className="card-hero rounded-2xl border border-white/10 bg-white/5 px-5 py-5 shadow-lg shadow-black/30 backdrop-blur-xl">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">Profit margin</p>
                <p className="mt-1 flex items-center gap-2">
                  <span className={`tabular-nums text-2xl font-bold tracking-tight ${marginBadgeInfo.color}`}>
                    {formatPercentFull(entriesTotals?.marginPct ?? 0)}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${marginBadgeInfo.color}`}
                    style={{
                      background:
                        marginBadgeInfo.label === 'good'
                          ? 'var(--green-dim)'
                          : marginBadgeInfo.label === 'ok'
                            ? 'var(--yellow-dim)'
                            : 'var(--red-dim)',
                    }}
                  >
                    {marginBadgeInfo.label}
                  </span>
                </p>
              </div>
            </div>

            {entriesData.byMonth?.length === 0 && (
              <EmptyState
                title="No entries in range"
                description="No agency entries found for the selected from/to months. Add expense or revenue data, or choose a different range."
              />
            )}

            {lastRefresh && (
              <p className="text-xs text-white/70">Last refresh: {formatRefreshTime(lastRefresh)}</p>
            )}

            {lineChartData.length > 0 && (
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)]/95 p-5 shadow-lg backdrop-blur-sm">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Revenue vs expenses vs profit (by month)
                </h2>
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={lineChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={(v) => formatEurFull(Number(v))} />
                      <Tooltip
                        content={<ChartTooltip formatter={(v) => formatEurFull(Number(v))} labelFormatter={(l) => `Month: ${l}`} />}
                        cursor={{ fill: 'transparent' }}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="revenue" name="Revenue" stroke="var(--green)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 4 }} />
                      <Line type="monotone" dataKey="expenses" name="Expenses" stroke="var(--red)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 4 }} />
                      <Line type="monotone" dataKey="profit" name="Profit" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {stackedBarData.length > 0 && (
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)]/95 p-5 shadow-lg backdrop-blur-sm">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Expenses by department (by month)
                </h2>
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stackedBarData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }} stackOffset="sign">
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={(v) => formatEurFull(Number(v))} />
                      <Tooltip
                        content={<ChartTooltip formatter={(v) => formatEurFull(v)} />}
                        cursor={{ fill: 'transparent' }}
                      />
                      <Legend />
                      {['models', 'chatting', 'marketing', 'production', 'ops'].map((dept) => (
                        <Bar key={dept} dataKey={dept} stackId="dept" fill={DEPT_COLORS[dept] ?? '#888'} name={dept} activeBar={false} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <div className="grid gap-6 sm:grid-cols-2">
              {selectedMonthData && (
                <>
                  <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)]/95 p-5 shadow-lg backdrop-blur-sm">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                        Expenses by category ({formatMonthLabel(selectedMonthData.month_key) || selectedMonthData.month_key})
                      </h2>
                      <SmartSelect
                        value={selectedMonthId ?? ''}
                        onChange={setSelectedMonthId}
                        options={entriesData.byMonth.map((m) => ({ value: m.month_id, label: formatMonthLabel(m.month_key) || m.month_key }))}
                        placeholder="Month"
                        className="min-w-[120px]"
                      />
                    </div>
                    {pieData.length > 0 ? (
                      <div className="h-[240px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={pieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={90}
                              paddingAngle={2}
                              dataKey="value"
                              nameKey="name"
                              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                            >
                              {pieData.map((_, i) => (
                                <Cell key={i} fill={Object.values(DEPT_COLORS)[i % 5]} />
                              ))}
                            </Pie>
                            <Tooltip
                              content={<ChartTooltip formatter={(v) => formatEurFull(v)} />}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="py-8 text-center text-sm text-[var(--text-muted)]">No expense data for this month.</p>
                    )}
                  </div>
                  <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)]/95 p-5 shadow-lg backdrop-blur-sm">
                    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Top cost owners ({formatMonthLabel(selectedMonthData.month_key) || selectedMonthData.month_key})
                    </h2>
                    {selectedMonthData.top_cost_owners?.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-[var(--border-subtle)] text-left text-xs font-medium uppercase text-[var(--text-muted)]">
                              <th className="py-2">Owner</th>
                              <th className="py-2 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedMonthData.top_cost_owners.map((o) => (
                              <tr key={`${o.owner_type}-${o.owner_id}`} className="border-b border-[var(--border-subtle)]/50">
                                <td className="py-2 text-[var(--text)]">{o.owner_name}</td>
                                <td className="py-2 text-right tabular-nums text-[var(--text)]">{formatEurFull(o.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="py-8 text-center text-sm text-[var(--text-muted)]">No cost owner data.</p>
                    )}
                  </div>
                </>
              )}
            </div>

            {selectedMonthData && Object.keys(selectedMonthData.expenses_by_category ?? {}).length > 0 && (
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)]/95 p-5 shadow-lg backdrop-blur-sm">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Category breakdown ({formatMonthLabel(selectedMonthData.month_key) || selectedMonthData.month_key})
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border-subtle)] text-left text-xs font-medium uppercase text-[var(--text-muted)]">
                        <th className="py-2">Category</th>
                        <th className="py-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(selectedMonthData.expenses_by_category)
                        .filter(([, v]) => v > 0)
                        .sort((a, b) => b[1] - a[1])
                        .map(([cat, amt]) => (
                          <tr key={cat} className="border-b border-[var(--border-subtle)]/50">
                            <td className="py-2 text-[var(--text)]">{cat}</td>
                            <td className="py-2 text-right tabular-nums text-[var(--text)]">{formatEurFull(amt)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
          ) : (
            <EmptyState
              title="Select date range"
              description="Choose From and To month above to load entries data."
            />
          )
        ) : viewSource === 'pnl' ? (
          <>
            {error ? (
              <ErrorState
                title="Could not load PnL data"
                description={error.message}
                requestId={error.requestId ?? undefined}
              />
            ) : (
            <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <div className="card-hero rounded-2xl border border-white/10 bg-white/5 px-5 py-5 shadow-lg shadow-black/30 backdrop-blur-xl">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">Revenue</p>
                <p className={`mt-1.5 tabular-nums text-2xl font-bold tracking-tight ${pnlKpiTotals.revenueUsd >= 0 ? 'value-positive' : 'value-negative'}`}>{formatUsdFull(pnlKpiTotals.revenueUsd)}</p>
                <p className="mt-0.5 text-xs tabular-nums text-white/50">{formatEurFull(pnlKpiTotals.revenueEur)}</p>
              </div>
              <div className="card-hero rounded-2xl border border-white/10 bg-white/5 px-5 py-5 shadow-lg shadow-black/30 backdrop-blur-xl">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">Expenses</p>
                <p className="mt-1.5 tabular-nums text-2xl font-bold tracking-tight text-white/90">{formatUsdFull(pnlKpiTotals.expensesUsd)}</p>
                <p className="mt-0.5 text-xs tabular-nums text-white/50">{formatEurFull(pnlKpiTotals.expensesEur)}</p>
              </div>
              <div className="card-hero rounded-2xl border border-white/10 bg-white/5 px-5 py-5 shadow-lg shadow-black/30 backdrop-blur-xl">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">Profit</p>
                <p className={`mt-1.5 tabular-nums text-2xl font-bold tracking-tight ${pnlKpiTotals.profitUsd >= 0 ? 'value-positive' : 'value-negative'}`}>{formatUsdFull(pnlKpiTotals.profitUsd)}</p>
                <p className="mt-0.5 text-xs tabular-nums text-white/50">{formatEurFull(pnlKpiTotals.profitEur)}</p>
              </div>
              <div className="card-hero rounded-2xl border border-white/10 bg-white/5 px-5 py-5 shadow-lg shadow-black/30 backdrop-blur-xl">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">Margin</p>
                <p className="mt-1 flex items-center gap-2">
                  <span className={`tabular-nums text-xl font-semibold ${marginBadgeInfo.color}`}>
                    {formatPercentFull(pnlKpiTotals.avgMarginPct)}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${marginBadgeInfo.color}`}
                    style={{
                      background:
                        marginBadgeInfo.label === 'good' ? 'var(--green-dim)' : marginBadgeInfo.label === 'ok' ? 'var(--yellow-dim)' : 'var(--red-dim)',
                    }}
                  >
                    {marginBadgeInfo.label}
                  </span>
                </p>
              </div>
              <div className="card-hero rounded-2xl border border-white/10 bg-white/5 px-5 py-5 shadow-lg shadow-black/30 backdrop-blur-xl">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">Total payouts</p>
                <p className="mt-1.5 tabular-nums text-2xl font-bold tracking-tight text-white/90">{formatUsdFull(pnlKpiTotals.payoutUsd)}</p>
                <p className="mt-0.5 text-xs tabular-nums text-white/50">{formatEurFull(pnlKpiTotals.payoutEur)}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--text-muted)]">
              {lastRefresh && <span>Last refresh: {formatRefreshTime(lastRefresh)}</span>}
              <button
                type="button"
                onClick={() => setRefreshKey((k) => k + 1)}
                disabled={loading}
                className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-white/90 hover:bg-white/10 disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
            {sorted.length === 0 ? (
              <EmptyState
                title="No PnL data in range"
                description="Add pnl_lines rows in Airtable for the selected from/to months, or choose a different range."
              />
            ) : (
              <AgencyGrid
                rows={sorted}
                totals={agencyTotals}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={(key) => {
                  setSortKey(key);
                  setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                }}
              />
            )}
            </>
            )}
          </>
        ) : (
          <EmptyState
            title="Select date range"
            description="Choose From and To month above to load entries data."
          />
        )}
      </div>
    </div>
  );
}
