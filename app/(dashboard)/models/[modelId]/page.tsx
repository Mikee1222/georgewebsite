'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
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
import PnlTable from '../../../components/PnlTable';
import ActualsSection from '../../../components/models/ActualsSection';
import ExpenseEntriesSection from '../../../components/ExpenseEntriesSection';
import EarningsSection from '../../../components/EarningsSection';
import WeeklyStatsPanel from '../../../components/models/WeeklyStatsPanel';
import SmartSelect from '../../../components/ui/SmartSelect';
import ChartCard from '../../../components/ui/ChartCard';
import SkeletonKpiBar from '../../../components/SkeletonKpiBar';
import SkeletonTable from '../../../components/SkeletonTable';
import { formatEurFull, formatUsdFull, formatPercentFull, formatMonthLabel } from '@/lib/format';
import ChartTooltip from '@/app/components/charts/ChartTooltip';
import { useFxRate } from '@/app/hooks/useFxRate';
import { getMarginColor } from '@/lib/business-rules';
import { getCurrentMonthKey, pickDefaultMonthId } from '@/lib/months';
import type { PnlRow } from '@/lib/types';
import type { SettingsMap } from '@/lib/types';

type ModelTab = 'overview' | 'earnings' | 'expenses' | 'profit' | 'weekly_stats';

/** Rows by month_key (for charts). */
function byMonthRows(actuals: PnlRow[]): PnlRow[] {
  return [...actuals].sort((a, b) => (a.month_key ?? '').localeCompare(b.month_key ?? ''));
}

/** Latest available month row by month_key desc. */
function latestRow(actuals: PnlRow[]): PnlRow | null {
  if (actuals.length === 0) return null;
  const sorted = [...actuals].sort((a, b) => (b.month_key || '').localeCompare(a.month_key || ''));
  return sorted[0] ?? null;
}

function monthRangeLabel(actuals: PnlRow[]): string {
  if (actuals.length === 0) return '';
  const keys = actuals.map((r) => r.month_key).filter(Boolean);
  if (keys.length === 0) return '';
  keys.sort();
  const min = keys[0];
  const max = keys[keys.length - 1];
  return min === max ? min! : `${min} → ${max}`;
}

function marginBadge(margin: number, settings: Partial<SettingsMap> | null): { label: string; color: string } {
  const c = getMarginColor(margin, settings);
  if (c === 'green') return { label: 'good', color: 'text-[var(--green)]' };
  if (c === 'yellow') return { label: 'ok', color: 'text-[var(--yellow)]' };
  return { label: 'low', color: 'text-[var(--red)]' };
}

/** Parse month_key range from URL; returns nulls if invalid/missing (use default). */
function parseRangeFromUrl(searchParams: URLSearchParams | null): { from: string; to: string } | null {
  if (!searchParams) return null;
  const from = searchParams.get('from')?.trim() ?? '';
  const to = searchParams.get('to')?.trim() ?? '';
  if (!from || !to) return null;
  if (from > to) return null;
  return { from, to };
}

export default function ModelDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const modelId = params.modelId as string;
  const [actuals, setActuals] = useState<PnlRow[]>([]);
  const [settings, setSettings] = useState<Partial<SettingsMap> | null>(null);
  const [modelName, setModelName] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ModelTab>('overview');
  const [weeklyStatsMonths, setWeeklyStatsMonths] = useState<{ id: string; month_key: string; month_name: string }[]>([]);
  const [weeklyStatsMonthId, setWeeklyStatsMonthId] = useState('');
  const [weeklyWeeks, setWeeklyWeeks] = useState<{ id: string; week_key: string; week_start: string; week_end: string }[]>([]);
  const [weeklyStats, setWeeklyStats] = useState<Record<string, { id: string; gross_revenue: number; net_revenue: number; amount_usd: number; amount_eur: number; computed_gross_usd: number; computed_net_usd: number }>>({});
  const [weeklyForecasts, setWeeklyForecasts] = useState<Record<string, Record<string, { id: string; scenario: string; projected_net_usd: number; projected_net_eur: number; projected_gross_usd: number | null; projected_gross_eur: number | null; fx_rate_usd_eur: number; source_type: string; is_locked: boolean; notes: string }>>>({});
  const [weeklyStatsLoading, setWeeklyStatsLoading] = useState(false);
  const [weeklyStatsEditing, setWeeklyStatsEditing] = useState<string | null>(null);
  const weeklyStatsLastWriteRef = useRef(0);
  const [expensesByMonth, setExpensesByMonth] = useState<Record<string, { totalAmountEur: number; totalAmountUsd: number }>>({});
  const [overviewExpenseTotal, setOverviewExpenseTotal] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { rate: fxRate } = useFxRate();

  /** All months from API (for global range selector). */
  const [allMonths, setAllMonths] = useState<{ id: string; month_key: string; month_name: string }[]>([]);
  /** Model-level month range (month_key). Default: current month only. */
  const [rangeFromKey, setRangeFromKey] = useState<string>('');
  const [rangeToKey, setRangeToKey] = useState<string>('');
  const hasLoadedOnce = useRef(false);

  const load = useCallback(() => {
    if (!modelId) return;
    const isRefresh = hasLoadedOnce.current;
    hasLoadedOnce.current = true;
    if (isRefresh) setIsRefreshing(true);
    Promise.all([
      fetch(`/api/models/${modelId}/pnl?status=actual`, { credentials: 'include' }).then((r) =>
        r.ok ? r.json() : []
      ),
      fetch('/api/settings', { credentials: 'include' }).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch('/api/models', { credentials: 'include' }).then((r) =>
        r.ok ? r.json() : []
      ),
      fetch('/api/me', { credentials: 'include' }).then((r) =>
        r.ok ? r.json() : { canEdit: false }
      ),
    ])
      .then(([a, s, models, me]) => {
        const actualsArr = Array.isArray(a) ? a : [];
        const inRange =
          !rangeFromKey || !rangeToKey
            ? actualsArr
            : actualsArr.filter((r) => {
                const k = r.month_key ?? '';
                return k >= rangeFromKey && k <= rangeToKey;
              });
        const latest =
          inRange.length > 0
            ? [...inRange].sort((x, y) => (y.month_key || '').localeCompare(x.month_key || ''))[0]
            : null;
        const mid = latest?.month_id;
        if (!mid) {
          setActuals(actualsArr);
          setSettings(s);
          const m = Array.isArray(models) ? models.find((x: { id: string }) => x.id === modelId) : null;
          setModelName(m?.name ?? modelId);
          setCanEdit(me?.canEdit ?? false);
          return;
        }
        return fetch(`/api/models/${modelId}/expenses?month_id=${encodeURIComponent(mid)}`, {
          credentials: 'include',
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            let expenseTotal: number | null = null;
            if (d && typeof d === 'object' && typeof (d as { totalAmountEur?: number }).totalAmountEur === 'number') {
              expenseTotal = (d as { totalAmountEur: number }).totalAmountEur;
            } else if (Array.isArray(d)) {
              expenseTotal = d.reduce(
                (sum: number, e: { amount_eur?: number; amount?: number }) =>
                  sum + (e.amount_eur ?? e.amount ?? 0),
                0
              );
            }
            return { actualsArr, s, models, me, expenseTotal };
          })
          .catch(() => ({ actualsArr, s, models, me, expenseTotal: null as number | null }));
      })
      .then((result) => {
        if (result == null || typeof result !== 'object' || !('actualsArr' in result)) return;
        const { actualsArr, s, models, me, expenseTotal } = result as {
          actualsArr: PnlRow[];
          s: Partial<SettingsMap> | null;
          models: { id: string; name?: string }[];
          me: { canEdit?: boolean };
          expenseTotal: number | null;
        };
        setActuals(actualsArr);
        setSettings(s);
        const m = Array.isArray(models) ? models.find((x: { id: string }) => x.id === modelId) : null;
        setModelName(m?.name ?? modelId);
        setCanEdit(me?.canEdit ?? false);
        if (expenseTotal != null) setOverviewExpenseTotal(expenseTotal);
      })
      .catch(() => {
        if (!isRefresh) {
          setActuals([]);
          setSettings(null);
          setModelName(modelId);
          setCanEdit(false);
        }
      })
      .finally(() => {
        setLoading(false);
        setIsRefreshing(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- range used at Refresh click; omit so range change does not refetch
  }, [modelId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Fetch all months once for range selector. */
  useEffect(() => {
    fetch('/api/months', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((arr: { id: string; month_key: string; month_name: string }[]) => {
        const list = Array.isArray(arr) ? arr : [];
        setAllMonths(list.sort((a, b) => (a.month_key ?? '').localeCompare(b.month_key ?? '')));
      })
      .catch(() => setAllMonths([]));
  }, []);

  /** Initialize range from URL once, or default to current month. */
  const rangeInitialized = useRef(false);
  useEffect(() => {
    if (rangeInitialized.current) return;
    const fromUrl = parseRangeFromUrl(searchParams);
    if (fromUrl) {
      setRangeFromKey(fromUrl.from);
      setRangeToKey(fromUrl.to);
      rangeInitialized.current = true;
      return;
    }
    const current = getCurrentMonthKey();
    if (current) {
      setRangeFromKey(current);
      setRangeToKey(current);
      rangeInitialized.current = true;
    }
  }, [searchParams]);

  /** Update URL when range changes (no reload). */
  const setMonthRange = useCallback(
    (from: string, to: string) => {
      setRangeFromKey(from);
      setRangeToKey(to);
      const url = new URL(window.location.href);
      url.searchParams.set('from', from);
      url.searchParams.set('to', to);
      router.replace(url.pathname + url.search, { scroll: false });
    },
    [router]
  );

  /** Effective range for filtering; when unset show all (avoid empty flash before init). */
  const effectiveFrom = rangeFromKey || '';
  const effectiveTo = rangeToKey || '';

  /** Filter PnL rows by selected month range (month_key inclusive). */
  const actualsInRange = useMemo(() => {
    if (!effectiveFrom || !effectiveTo) return actuals;
    return actuals.filter((r) => {
      const k = r.month_key ?? '';
      return k >= effectiveFrom && k <= effectiveTo;
    });
  }, [actuals, effectiveFrom, effectiveTo]);
  const latest = useMemo(() => latestRow(actualsInRange), [actualsInRange]);
  const kpiFromLatest = useMemo(() => {
    if (!latest) {
      return {
        netRevenue: 0,
        totalExpenses: 0,
        netProfit: 0,
        profitMarginPct: 0,
        monthLabel: '',
      };
    }
    const margin =
      (latest.net_revenue ?? 0) > 0
        ? (latest.net_profit ?? 0) / (latest.net_revenue ?? 1)
        : 0;
    return {
      netRevenue: latest.net_revenue ?? 0,
      totalExpenses: latest.total_expenses ?? 0,
      netProfit: latest.net_profit ?? 0,
      profitMarginPct: margin,
      monthLabel: formatMonthLabel(latest.month_key) || latest.month_key,
    };
  }, [latest]);
  /** Display label for selected range (from state, not from data). */
  const rangeLabelDisplay = useMemo(() => {
    if (!rangeFromKey || !rangeToKey) return '';
    return rangeFromKey === rangeToKey ? rangeFromKey : `${rangeFromKey} → ${rangeToKey}`;
  }, [rangeFromKey, rangeToKey]);
  const rangeLabel = rangeLabelDisplay;

  /** Overview tab: actuals only. Expenses from expense_entries. Uses selected range. */
  const latestForOverview = useMemo(() => latestRow(actualsInRange), [actualsInRange]);

  const marginBadgeInfo = useMemo(
    () => marginBadge(kpiFromLatest.profitMarginPct, settings),
    [kpiFromLatest.profitMarginPct, settings]
  );

  /** Months in selected range only (from allMonths /api/months). Unique by month_key, sorted ascending. Single month => one option. */
  const monthOptions = useMemo(() => {
    if (!effectiveFrom || !effectiveTo || allMonths.length === 0) return [];
    const byKey = new Map<string, { month_id: string; month_key: string; month_name: string }>();
    for (const m of allMonths) {
      const key = m.month_key ?? '';
      if (key >= effectiveFrom && key <= effectiveTo && !byKey.has(key))
        byKey.set(key, {
          month_id: m.id,
          month_key: key,
          month_name: m.month_name ?? key,
        });
    }
    return Array.from(byKey.values()).sort((a, b) => a.month_key.localeCompare(b.month_key));
  }, [allMonths, effectiveFrom, effectiveTo]);

  /** Reference month for overview KPI: latest with pnl in range, or first month in range when no pnl (so expenses still show). */
  const overviewReferenceMonthId = useMemo(
    () => latestForOverview?.month_id ?? monthOptions[0]?.month_id ?? '',
    [latestForOverview?.month_id, monthOptions]
  );
  const overviewReferenceMonthLabel = useMemo(() => {
    if (latestForOverview?.month_key) return formatMonthLabel(latestForOverview.month_key) || latestForOverview.month_key;
    if (monthOptions[0]?.month_key) return formatMonthLabel(monthOptions[0].month_key) || monthOptions[0].month_key;
    return '';
  }, [latestForOverview?.month_key, monthOptions]);
  const kpiFromLatestForOverview = useMemo(() => {
    const netRev = latestForOverview?.net_revenue ?? 0;
    const exp = overviewExpenseTotal;
    const profit = netRev - exp;
    const margin = netRev > 0 ? profit / netRev : null;
    return {
      netRevenue: netRev,
      totalExpenses: exp,
      netProfit: profit,
      profitMarginPct: margin as number | null,
      monthLabel: overviewReferenceMonthLabel,
    };
  }, [latestForOverview?.net_revenue, overviewExpenseTotal, overviewReferenceMonthLabel]);
  const marginBadgeInfoForOverview = useMemo(
    () =>
      kpiFromLatestForOverview.profitMarginPct !== null
        ? marginBadge(kpiFromLatestForOverview.profitMarginPct, settings)
        : { label: '', color: 'text-white/50' },
    [kpiFromLatestForOverview.profitMarginPct, settings]
  );

  /** Selected month record id (for expenses/earnings APIs); derive month_key from selected option */
  const [selectedMonthId, setSelectedMonthId] = useState('');
  const selectedMonthOption = useMemo(
    () => monthOptions.find((o) => o.month_id === selectedMonthId) ?? null,
    [monthOptions, selectedMonthId]
  );

  /** When range changes: if current selection is outside new range, set to first month in range. */
  useEffect(() => {
    if (monthOptions.length === 0) {
      setSelectedMonthId('');
      return;
    }
    const currentInOptions = monthOptions.some((o) => o.month_id === selectedMonthId);
    if (selectedMonthId !== '' && currentInOptions) return;

    const firstInRange = monthOptions[0];
    setSelectedMonthId(firstInRange?.month_id ?? '');
  }, [monthOptions, selectedMonthId]);

  const exportCsvUrl = `/api/export/model/${modelId}.csv`;

  /** Chart data: revenue/profit from pnl in range; expenses from expense_entries only */
  const chartRows = useMemo(() => byMonthRows(actualsInRange), [actualsInRange]);
  const chartData = useMemo(
    () =>
      chartRows.map((r) => {
        const monthId = r.month_id ?? '';
        const expFromEntries = expensesByMonth[monthId]?.totalAmountEur ?? 0;
        const rev = r.gross_revenue ?? r.net_revenue ?? 0;
        const profit = rev - expFromEntries;
        return {
          month: formatMonthLabel(r.month_key) || r.month_key || '',
          revenue: rev,
          expenses: expFromEntries,
          profit,
        };
      }),
    [chartRows, expensesByMonth]
  );
  const pieData = useMemo(() => {
    if (chartData.length === 0) return [];
    const totals = chartData.reduce(
      (acc, r) => {
        acc.revenue += r.revenue;
        acc.expenses += r.expenses;
        return acc;
      },
      { revenue: 0, expenses: 0 }
    );
    const out: { name: string; value: number; color: string }[] = [];
    if (totals.revenue > 0) out.push({ name: 'Revenue', value: totals.revenue, color: 'var(--green)' });
    if (totals.expenses > 0) out.push({ name: 'Expenses', value: totals.expenses, color: 'var(--red)' });
    return out;
  }, [chartData]);

  /** Y-axis domain from data: [0, max * 1.1] for bar charts. */
  const chartYDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 100] as [number, number];
    let max = 0;
    for (const row of chartData) {
      if (Number.isFinite(row.revenue) && row.revenue > max) max = row.revenue;
      if (Number.isFinite(row.expenses) && row.expenses > max) max = row.expenses;
      if (Number.isFinite(row.profit) && row.profit > max) max = row.profit;
    }
    const top = max * 1.1;
    return [0, top <= 0 ? 100 : top] as [number, number];
  }, [chartData]);

  /** Y-axis domain for line chart (profit can be negative): [min * 1.1, max * 1.1]. */
  const chartYDomainLine = useMemo(() => {
    if (chartData.length === 0) return [0, 100] as [number, number];
    let min = 0;
    let max = 0;
    for (const row of chartData) {
      for (const v of [row.revenue, row.expenses, row.profit]) {
        if (Number.isFinite(v)) {
          if (v > max) max = v;
          if (v < min) min = v;
        }
      }
    }
    const padding = Math.max((max - min) * 0.1, 1);
    return [min - padding, max + padding] as [number, number];
  }, [chartData]);

  const tabButtons: { id: ModelTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'earnings', label: 'Earnings' },
    { id: 'expenses', label: 'Expenses' },
    { id: 'profit', label: 'Profit' },
    { id: 'weekly_stats', label: 'Weekly stats' },
  ];

  const loadWeeklyStatsMonths = useCallback(() => {
    fetch('/api/months', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((arr: { id: string; month_key: string; month_name: string }[]) => {
        const list = Array.isArray(arr) ? arr : [];
        setWeeklyStatsMonths(list);
        if (list.length > 0 && !weeklyStatsMonthId) {
          const mapped = list.map((m) => ({ id: m.id, month_key: m.month_key }));
          const defaultId = pickDefaultMonthId(mapped, getCurrentMonthKey());
          setWeeklyStatsMonthId(defaultId ?? list[0]!.id);
        }
      })
      .catch(() => setWeeklyStatsMonths([]));
  }, [weeklyStatsMonthId]);

  const loadWeeklyStats = useCallback(() => {
    if (!modelId || !weeklyStatsMonthId) return;
    const startedAt = Date.now();
    setWeeklyStatsLoading(true);
    Promise.all([
      fetch(`/api/weeks?month_id=${encodeURIComponent(weeklyStatsMonthId)}`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : { weeks: [] })),
      fetch(`/api/weekly-model-stats?model_id=${encodeURIComponent(modelId)}&month_id=${encodeURIComponent(weeklyStatsMonthId)}`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : { weeks: [], stats: {} })),
      fetch(`/api/weekly-model-forecasts?model_id=${encodeURIComponent(modelId)}&month_id=${encodeURIComponent(weeklyStatsMonthId)}`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : { forecastsByWeek: {} })),
    ])
      .then(([weeksRes, statsRes, forecastsRes]) => {
        const weeks = (weeksRes as { weeks?: { id: string; week_key: string; week_start: string; week_end: string }[] }).weeks ?? [];
        const stats = (statsRes as { stats?: Record<string, { id: string; gross_revenue: number; net_revenue: number; amount_usd: number; amount_eur: number; computed_gross_usd: number; computed_net_usd: number }> }).stats ?? {};
        const forecastsByWeek = (forecastsRes as { forecastsByWeek?: Record<string, Record<string, { id: string; scenario: string; projected_net_usd: number; projected_net_eur: number; projected_gross_usd: number | null; projected_gross_eur: number | null; fx_rate_usd_eur: number; source_type: string; is_locked: boolean; notes: string }>> }).forecastsByWeek ?? {};
        setWeeklyWeeks(weeks);
        if (startedAt >= weeklyStatsLastWriteRef.current) {
          setWeeklyStats(stats);
          setWeeklyForecasts(forecastsByWeek);
        }
      })
      .catch(() => {
        // Do not clear stats/weeks on error; keep previous data
      })
      .finally(() => setWeeklyStatsLoading(false));
  }, [modelId, weeklyStatsMonthId]);

  useEffect(() => {
    if (activeTab === 'weekly_stats') loadWeeklyStatsMonths();
  }, [activeTab, loadWeeklyStatsMonths]);

  useEffect(() => {
    if (activeTab === 'weekly_stats' && weeklyStatsMonthId) loadWeeklyStats();
  }, [activeTab, weeklyStatsMonthId, loadWeeklyStats]);

  /** Fetch expense totals by month for chart (expense_entries only) */
  useEffect(() => {
    if (!modelId || monthOptions.length === 0) return;
    const ids = monthOptions.map((o) => o.month_id).filter(Boolean);
    if (ids.length === 0) return;
    const url = `/api/models/${modelId}/expenses/summary?month_ids=${ids.map(encodeURIComponent).join(',')}`;
    fetch(url, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.byMonth && typeof d.byMonth === 'object') {
          const out: Record<string, { totalAmountEur: number; totalAmountUsd: number }> = {};
          for (const [mid, v] of Object.entries(d.byMonth)) {
            const val = v as { totalAmountEur?: number; totalAmountUsd?: number };
            out[mid] = { totalAmountEur: val.totalAmountEur ?? 0, totalAmountUsd: val.totalAmountUsd ?? 0 };
          }
          setExpensesByMonth(out);
        }
      })
      .catch(() => setExpensesByMonth({}));
  }, [modelId, monthOptions]);

  /** Overview: fetch expense total for reference month from expense_entries (independent of revenue/pnl). */
  useEffect(() => {
    if (!modelId || !overviewReferenceMonthId) {
      if (!isRefreshing) setOverviewExpenseTotal(0);
      return;
    }
    fetch(`/api/models/${modelId}/expenses?month_id=${encodeURIComponent(overviewReferenceMonthId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d === 'object' && typeof d.totalAmountEur === 'number') {
          setOverviewExpenseTotal(d.totalAmountEur);
        } else if (Array.isArray(d)) {
          setOverviewExpenseTotal(d.reduce((s: number, e: { amount_eur?: number; amount?: number }) => s + (e.amount_eur ?? e.amount ?? 0), 0));
        } else if (!isRefreshing) {
          setOverviewExpenseTotal(0);
        }
      })
      .catch(() => {
        if (!isRefreshing) setOverviewExpenseTotal(0);
      });
  }, [modelId, overviewReferenceMonthId, isRefreshing]);

  const exportButtonLabel = 'Export CSV';
  const exportLabel = exportButtonLabel || 'Export CSV';

  if (loading) {
    return (
      <div className="min-h-full bg-gradient-to-b from-[var(--bg)] to-[var(--surface)]/30">
        <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
          <div className="h-10 w-64 animate-pulse rounded bg-[var(--surface-elevated)]" />
          <SkeletonKpiBar />
          <SkeletonTable cols={20} rows={5} hasFrozenCol />
          <SkeletonTable cols={20} rows={3} hasFrozenCol />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gradient-to-b from-[var(--bg)] to-[var(--surface)]/30">
      <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
        {/* Hero header bar: model name, month range, actions */}
        <div className="card-hero flex flex-col gap-5 rounded-2xl border border-white/10 bg-white/5 px-6 py-6 shadow-lg shadow-black/30 backdrop-blur-xl sm:gap-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-6">
            <div className="min-w-0 flex-1">
              <h1 className="m-0 text-2xl font-bold tracking-tight text-white/95">
                {modelName}
              </h1>
              <p className="mt-1.5 text-xs text-white/55">
                {rangeLabel ? `Actuals · ${rangeLabel}` : 'Actuals'}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <a
                href={exportCsvUrl}
                title={exportLabel}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--purple-500)] px-4 py-2 text-sm font-medium text-white no-underline transition-all duration-200 hover:shadow-[0_0_20px_rgba(168,85,247,0.3)]"
                download
              >
                <svg className="h-4 w-4 shrink-0 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span className="text-white">{exportLabel}</span>
              </a>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/90 transition-all duration-200 hover:bg-white/10 disabled:opacity-70 disabled:pointer-events-none"
                onClick={() => load()}
                disabled={isRefreshing}
              >
                {isRefreshing ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Refreshing…</span>
                  </>
                ) : (
                  'Refresh'
                )}
              </button>
            </div>
          </div>
          {/* Model-level month range: applies to all tabs */}
          <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4 sm:gap-4">
            <span className="text-sm font-medium text-white/70">Month range</span>
            <SmartSelect
              value={allMonths.find((m) => m.month_key === rangeFromKey)?.id ?? ''}
              onChange={(id) => {
                const m = allMonths.find((x) => x.id === id);
                if (m) setMonthRange(m.month_key, rangeToKey >= m.month_key ? rangeToKey : m.month_key);
              }}
              options={allMonths.map((m) => ({ value: m.id, label: formatMonthLabel(m.month_key) || m.month_key }))}
              placeholder="From"
              disabled={allMonths.length === 0}
            />
            <SmartSelect
              value={allMonths.find((m) => m.month_key === rangeToKey)?.id ?? ''}
              onChange={(id) => {
                const m = allMonths.find((x) => x.id === id);
                if (m) setMonthRange(rangeFromKey <= m.month_key ? rangeFromKey : m.month_key, m.month_key);
              }}
              options={allMonths.map((m) => ({ value: m.id, label: formatMonthLabel(m.month_key) || m.month_key }))}
              placeholder="To"
              disabled={allMonths.length === 0}
            />
            <span className="text-xs text-white/50">or</span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const cur = getCurrentMonthKey();
                  setMonthRange(cur, cur);
                }}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/10"
              >
                This month
              </button>
              <button
                type="button"
                onClick={() => {
                  const cur = getCurrentMonthKey();
                  const [y, m] = cur.split('-').map(Number);
                  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
                  setMonthRange(prev, prev);
                }}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/10"
              >
                Last month
              </button>
              <button
                type="button"
                onClick={() => {
                  const cur = getCurrentMonthKey();
                  const [y, m] = cur.split('-').map(Number);
                  const fromM = m <= 2 ? m + 10 : m - 2;
                  const fromY = m <= 2 ? y - 1 : y;
                  const from = `${fromY}-${String(fromM).padStart(2, '0')}`;
                  const inRange = allMonths.filter((k) => k.month_key >= from && k.month_key <= cur).sort((a, b) => a.month_key.localeCompare(b.month_key));
                  const fromKey = inRange[0]?.month_key ?? from;
                  setMonthRange(fromKey, cur);
                }}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/10"
              >
                Last 3 months
              </button>
            </div>
          </div>
        </div>

        {/* Tabs – smooth transitions */}
        <div className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1.5 backdrop-blur-sm">
          {tabButtons.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
                activeTab === id
                  ? 'bg-[var(--purple-500)] text-white shadow-[0_0_14px_rgba(168,85,247,0.25)]'
                  : 'text-white/70 hover:bg-white/5 hover:text-white/90'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                {label}
                {id === 'weekly_stats' && (
                  <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/80">
                    Beta
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>

        {/* Overview tab: KPI row + Actuals table – actuals only, never forecast */}
        {activeTab === 'overview' && (
          <>
        {/* Hero KPI row: latest actuals month only */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="card-hero min-h-[100px] rounded-2xl border border-white/10 bg-white/5 px-5 py-5 shadow-lg shadow-black/30 backdrop-blur-xl">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">
              {kpiFromLatestForOverview.monthLabel ? `Net revenue (${kpiFromLatestForOverview.monthLabel})` : 'Net revenue'}
            </p>
            <p className={`mt-1.5 tabular-nums text-2xl font-bold tracking-tight ${kpiFromLatestForOverview.netRevenue >= 0 ? 'value-positive' : 'value-negative'}`}>
              {!overviewReferenceMonthId && !isRefreshing ? '—' : formatUsdFull(kpiFromLatestForOverview.netRevenue)}
            </p>
            {fxRate != null && overviewReferenceMonthId && (
              <p className="mt-0.5 text-sm tabular-nums text-white/50">{formatEurFull(kpiFromLatestForOverview.netRevenue * fxRate)}</p>
            )}
          </div>
          <div className="card-hero min-h-[100px] rounded-2xl border border-white/10 bg-white/5 px-5 py-5 shadow-lg shadow-black/30 backdrop-blur-xl">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">
              {kpiFromLatestForOverview.monthLabel ? `Total expenses (${kpiFromLatestForOverview.monthLabel})` : 'Total expenses'}
            </p>
            <p className="mt-1.5 tabular-nums text-2xl font-bold tracking-tight text-white/90">
              {!overviewReferenceMonthId && !isRefreshing ? '—' : formatEurFull(kpiFromLatestForOverview.totalExpenses)}
            </p>
            {fxRate != null && fxRate > 0 && overviewReferenceMonthId && (
              <p className="mt-0.5 text-sm tabular-nums text-white/50">{formatUsdFull(kpiFromLatestForOverview.totalExpenses / fxRate)}</p>
            )}
          </div>
          <div className="card-hero min-h-[100px] rounded-2xl border border-white/10 bg-white/5 px-5 py-5 shadow-lg shadow-black/30 backdrop-blur-xl">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">
              {kpiFromLatestForOverview.monthLabel ? `Net profit (${kpiFromLatestForOverview.monthLabel})` : 'Net profit'}
            </p>
            <p className={`mt-1.5 tabular-nums text-2xl font-bold tracking-tight ${kpiFromLatestForOverview.netProfit >= 0 ? 'value-positive' : 'value-negative'}`}>
              {!overviewReferenceMonthId && !isRefreshing ? '—' : formatUsdFull(kpiFromLatestForOverview.netProfit)}
            </p>
            {fxRate != null && overviewReferenceMonthId && (
              <p className={`mt-0.5 text-sm tabular-nums ${kpiFromLatestForOverview.netProfit >= 0 ? 'text-white/50' : 'text-red-400/60'}`}>{formatEurFull(kpiFromLatestForOverview.netProfit * fxRate)}</p>
            )}
          </div>
          <div className="card-hero min-h-[100px] rounded-2xl border border-white/10 bg-white/5 px-5 py-5 shadow-lg shadow-black/30 backdrop-blur-xl">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">
              {kpiFromLatestForOverview.monthLabel ? `Margin (${kpiFromLatestForOverview.monthLabel})` : 'Margin'}
            </p>
            <p className="mt-1.5 flex items-center gap-2">
              <span className={`tabular-nums text-2xl font-bold tracking-tight ${marginBadgeInfoForOverview.color}`}>
                {!overviewReferenceMonthId && !isRefreshing
                  ? '—'
                  : kpiFromLatestForOverview.profitMarginPct === null
                    ? '—'
                    : formatPercentFull(kpiFromLatestForOverview.profitMarginPct)}
              </span>
              {marginBadgeInfoForOverview.label ? (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${marginBadgeInfoForOverview.color}`}
                  style={{
                    background:
                      marginBadgeInfoForOverview.label === 'good'
                        ? 'var(--green-dim)'
                        : marginBadgeInfoForOverview.label === 'ok'
                          ? 'var(--yellow-dim)'
                          : 'var(--red-dim)',
                  }}
                >
                  {marginBadgeInfoForOverview.label}
                </span>
              ) : null}
            </p>
          </div>
        </div>

        {/* Actuals section: view + edit/delete only in Overview; no Add actual line */}
        <ActualsSection
          modelId={modelId}
          actuals={actualsInRange}
          canEdit={canEdit}
          onRefresh={load}
          monthOptions={monthOptions}
          showAddButton={false}
        />

          </>
        )}

        {/* Earnings tab: revenue entries + chart (no apply entries) */}
        {activeTab === 'earnings' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md">
              <span className="text-sm font-medium text-white/70">Entries for month</span>
              <SmartSelect
                value={selectedMonthId}
                onChange={setSelectedMonthId}
                options={monthOptions.map((opt) => ({ value: opt.month_id, label: formatMonthLabel(opt.month_key) || opt.month_key }))}
                placeholder={monthOptions.length === 0 ? '—' : 'Select month'}
                disabled={monthOptions.length === 0}
              />
            </div>
            {chartData.length > 0 && (
              <ChartCard title="Revenue by month">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={chartData}
                    margin={{ top: 12, right: 12, left: 12, bottom: 24 }}
                    barCategoryGap="20%"
                    barSize={36}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                    <YAxis domain={chartYDomain} tick={{ fontSize: 11 }} stroke="var(--text-muted)" tickFormatter={(v) => formatEurFull(Number(v))} />
                    <Tooltip
                      content={<ChartTooltip formatter={(v) => formatEurFull(v)} />}
                      cursor={{ fill: 'transparent' }}
                    />
                    <Bar dataKey="revenue" fill="var(--green)" radius={[4, 4, 0, 0]} name="Revenue" activeBar={false} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            <EarningsSection
              modelId={modelId}
              monthId={selectedMonthId}
              canEdit={canEdit}
              onRefresh={load}
            />
          </div>
        )}

        {/* Expenses tab: expense entries + chart (no apply entries) */}
        {activeTab === 'expenses' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md">
              <span className="text-sm font-medium text-white/70">Entries for month</span>
              <SmartSelect
                value={selectedMonthId}
                onChange={setSelectedMonthId}
                options={monthOptions.map((opt) => ({ value: opt.month_id, label: formatMonthLabel(opt.month_key) || opt.month_key }))}
                placeholder={monthOptions.length === 0 ? '—' : 'Select month'}
                disabled={monthOptions.length === 0}
              />
            </div>
            {chartData.length > 0 && (
              <ChartCard title="Expenses by month">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={chartData}
                    margin={{ top: 12, right: 12, left: 12, bottom: 24 }}
                    barCategoryGap="20%"
                    barSize={36}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                    <YAxis domain={chartYDomain} tick={{ fontSize: 11 }} stroke="var(--text-muted)" tickFormatter={(v) => formatEurFull(Number(v))} />
                    <Tooltip
                      content={<ChartTooltip formatter={(v) => formatEurFull(v)} />}
                      cursor={{ fill: 'transparent' }}
                    />
                    <Bar dataKey="expenses" fill="var(--red)" radius={[4, 4, 0, 0]} name="Expenses" activeBar={false} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            <ExpenseEntriesSection
              modelId={modelId}
              monthId={selectedMonthId}
              monthLabel={selectedMonthOption ? (formatMonthLabel(selectedMonthOption.month_key) || selectedMonthOption.month_key) : ''}
              canEdit={canEdit}
              onRefresh={load}
            />
          </div>
        )}

        {/* Weekly stats tab: full months list from Airtable */}
        {activeTab === 'weekly_stats' && (
          <WeeklyStatsPanel
            modelId={modelId}
            canEdit={canEdit}
            monthKey={/^\d{4}-\d{2}$/.test(weeklyStatsMonthId) ? weeklyStatsMonthId : (weeklyStatsMonths.find((m) => m.id === weeklyStatsMonthId)?.month_key ?? '')}
            months={weeklyStatsMonths}
            monthId={weeklyStatsMonthId}
            setMonthId={setWeeklyStatsMonthId}
            weeks={weeklyWeeks}
            stats={weeklyStats}
            forecasts={weeklyForecasts}
            loading={weeklyStatsLoading}
            editingWeekId={weeklyStatsEditing}
            setEditingWeekId={setWeeklyStatsEditing}
            onLoad={loadWeeklyStats}
            onBeforeStatSave={() => {
              weeklyStatsLastWriteRef.current = Date.now();
            }}
            onStatSaved={(record) => {
              setWeeklyStats((prev) => ({
                ...prev,
                [record.week_id]: {
                  id: record.id,
                  gross_revenue: record.gross_revenue,
                  net_revenue: record.net_revenue,
                  amount_usd: record.amount_usd,
                  amount_eur: record.amount_eur,
                  computed_gross_usd: record.computed_gross_usd,
                  computed_net_usd: record.computed_net_usd,
                },
              }));
            }}
          />
        )}

        {/* Profit tab: revenue vs expenses vs profit chart + pie */}
        {activeTab === 'profit' && (
          <div className="space-y-6">
            {chartData.length > 0 ? (
              <>
                <ChartCard title="Revenue vs expenses vs profit by month">
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={chartData} margin={{ top: 12, right: 12, left: 12, bottom: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                      <YAxis domain={chartYDomainLine} tick={{ fontSize: 11 }} stroke="var(--text-muted)" tickFormatter={(v) => formatEurFull(Number(v))} />
                      <Tooltip
                        content={<ChartTooltip formatter={(v, name) => formatEurFull(v)} labelFormatter={(l) => l} />}
                        cursor={{ fill: 'transparent' }}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="revenue" stroke="var(--green)" strokeWidth={2} dot={{ r: 4 }} name="Revenue" activeDot={{ r: 4 }} />
                      <Line type="monotone" dataKey="expenses" stroke="var(--red)" strokeWidth={2} dot={{ r: 4 }} name="Expenses" activeDot={{ r: 4 }} />
                      <Line type="monotone" dataKey="profit" stroke="var(--accent)" strokeWidth={2} dot={{ r: 4 }} name="Profit" activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
                {pieData.length > 0 && (
                  <ChartCard title="Total revenue vs expenses (all months)">
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie
                          data={pieData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          label={({ name, value }) => `${name}: €${formatEurFull(value)}`}
                        >
                          {pieData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          content={<ChartTooltip formatter={(v) => formatEurFull(v)} />}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </ChartCard>
                )}
              </>
            ) : (
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] px-6 py-10 shadow-[var(--shadow-sm)]">
                <p className="text-[var(--text-muted)]">No monthly data yet. Add actuals to see profit by month.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

