'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { formatEurFull } from '@/lib/format';
import ChartTooltip from '@/app/components/charts/ChartTooltip';

export interface MemberExpenseEntry {
  id: string;
  category: string;
  amount: number;
  description: string;
  vendor?: string;
  date?: string;
  month_key: string;
  created_by: string;
  department: string;
}

export interface MemberChartsProps {
  total: number;
  byCategory: { category: string; total: number }[];
  entries: MemberExpenseEntry[];
  monthCount: number;
  groupByDepartment?: boolean;
}

const CATEGORY_COLORS = ['#34d399', '#fbbf24', '#60a5fa', '#a78bfa', '#f472b6', '#94a3b8'];

export default function MemberCharts({
  total,
  byCategory,
  entries,
  monthCount,
  groupByDepartment,
}: MemberChartsProps) {
  const avgPerMonth = monthCount > 0 ? total / monthCount : 0;
  const biggestCategory = byCategory.length
    ? byCategory.reduce((a, b) => (a.total >= b.total ? a : b), byCategory[0]!)
    : null;

  const byMonthMap: Record<string, number> = {};
  const byMonthDeptMap: Record<string, Record<string, number>> = {};
  for (const e of entries) {
    const key = e.month_key;
    byMonthMap[key] = (byMonthMap[key] ?? 0) + e.amount;
    if (groupByDepartment) {
      if (!byMonthDeptMap[key]) byMonthDeptMap[key] = {};
      byMonthDeptMap[key][e.department] = (byMonthDeptMap[key][e.department] ?? 0) + e.amount;
    }
  }
  const barData = Object.entries(byMonthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month_key, total]) => {
      const row: Record<string, number | string> = { month_key, name: month_key, total };
      if (groupByDepartment && byMonthDeptMap[month_key]) {
        Object.assign(row, byMonthDeptMap[month_key]);
      }
      return row;
    });

  const topCategories = [...byCategory].sort((a, b) => b.total - a.total).slice(0, 6);
  const otherTotal = byCategory.reduce((s, c) => s + c.total, 0) - topCategories.reduce((s, c) => s + c.total, 0);
  const pieData = [...topCategories.map((c) => ({ name: c.category, value: c.total }))];
  if (otherTotal > 0) pieData.push({ name: 'Other', value: otherTotal });

  const recentEntries = entries.slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)]/95 px-5 py-5 shadow-lg backdrop-blur-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">Total expenses</p>
          <p className="mt-1 tabular-nums text-2xl font-bold tracking-tight text-[var(--text)]">
            {formatEurFull(total)}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)]/95 px-5 py-5 shadow-lg backdrop-blur-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">Avg / month</p>
          <p className="mt-1 tabular-nums text-2xl font-bold tracking-tight text-[var(--text)]">
            {formatEurFull(avgPerMonth)}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)]/95 px-5 py-5 shadow-lg backdrop-blur-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">Biggest category</p>
          <p className="mt-1 text-lg font-semibold text-[var(--text)]">
            {biggestCategory ? `${biggestCategory.category} (${formatEurFull(biggestCategory.total)})` : '—'}
          </p>
        </div>
      </div>

      {barData.length > 0 && (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)]/95 p-5 shadow-lg backdrop-blur-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Expenses by month
          </h2>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="month_key" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={(v) => formatEurFull(Number(v))} />
                <Tooltip
                  content={<ChartTooltip formatter={(v) => formatEurFull(Number(v))} />}
                  cursor={{ fill: 'transparent' }}
                />
                <Legend />
                <Bar dataKey="total" name="Total" fill="var(--accent)" radius={[4, 4, 0, 0]} activeBar={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {pieData.length > 0 && (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)]/95 p-5 shadow-lg backdrop-blur-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Expenses by category (top 6 + other)
          </h2>
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
                    <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  content={<ChartTooltip formatter={(v) => formatEurFull(Number(v))} />}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)]/95 p-5 shadow-lg backdrop-blur-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Recent expenses (up to 10)
        </h2>
        {recentEntries.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">No expenses in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-left text-xs font-medium uppercase text-[var(--text-muted)]">
                  <th className="py-2">Month</th>
                  <th className="py-2">Category</th>
                  <th className="py-2">Department</th>
                  <th className="py-2 text-right">Amount</th>
                  <th className="py-2">Description</th>
                </tr>
              </thead>
              <tbody>
                {recentEntries.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--border-subtle)]/50 hover:bg-[var(--surface-elevated)]/30">
                    <td className="py-2 text-[var(--text)]">{e.month_key}</td>
                    <td className="py-2 text-[var(--text)]">{e.category}</td>
                    <td className="py-2 text-[var(--text)]">{e.department}</td>
                    <td className="py-2 text-right tabular-nums text-[var(--text)]">{formatEurFull(e.amount)}</td>
                    <td className="max-w-[200px] truncate py-2 text-[var(--text-muted)]">{e.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
