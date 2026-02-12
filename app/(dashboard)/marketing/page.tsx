'use client';

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { formatEurFull, formatNumberFull, formatMonthLabel } from '@/lib/format';
import { apiFetch } from '@/lib/client-fetch';
import { getCurrentMonthKey, pickDefaultMonthId } from '@/lib/months';
import type { ExpenseEntry } from '@/lib/types';
import {
  MARKETING_PRODUCTION_CATEGORIES,
  MARKETING_PRODUCTION_CATEGORY_VALUES,
  marketingProductionCategoryLabel,
} from '@/lib/expense-categories';
import GlassCard from '@/app/components/ui/GlassCard';
import KpiCard from '@/app/components/ui/KpiCard';
import Toolbar from '@/app/components/ui/Toolbar';
import SmartSelect from '@/app/components/ui/SmartSelect';
import SheetForm from '@/app/components/ui/SheetForm';
import FormRow from '@/app/components/ui/FormRow';
import EmptyState from '@/app/components/ui/EmptyState';
import ErrorState from '@/app/components/ui/ErrorState';
import TableSkeleton from '@/app/components/ui/TableSkeleton';

const MARKETING_EXPENSE_CATEGORIES_PARAM = 'marketing_tools,production_tools,marketing_other,production_other';

/** Payout line from GET /api/payouts?source=live (same computation as /payments). */
type PayoutLine = {
  id: string;
  team_member_id: string;
  team_member_name: string;
  department: string;
  role: string;
  bonus_amount: number;
  adjustments_amount: number;
  amount_eur: number | null;
  payout_flat_fee?: number;
  bonus_eur?: number | null;
  adjustments_eur?: number | null;
  hourly_eur?: number | null;
  pct_payout_eur?: number | null;
};

const MARKETING_DEPARTMENTS = ['marketing', 'production'] as const;

function formatCreated(created_at: string | undefined): string {
  if (!created_at) return '—';
  const d = created_at.slice(0, 10);
  return d || '—';
}

function MarketingPageContent() {
  const [monthId, setMonthId] = useState('');
  const [months, setMonths] = useState<{ id: string; month_key: string; month_name?: string }[]>([]);
  const [monthsLoading, setMonthsLoading] = useState(true);
  const [payoutLines, setPayoutLines] = useState<PayoutLine[]>([]);
  const [fxRate, setFxRate] = useState<number>(0.92);
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [payrollError, setPayrollError] = useState<{ message: string; requestId: string | null } | null>(null);
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);
  const [expenseTotals, setExpenseTotals] = useState({
    marketing_eur: 0,
    production_eur: 0,
    total_eur: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; requestId: string | null } | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addForm, setAddForm] = useState<{
    department: 'marketing' | 'production';
    category: string;
    amount_eur: string;
    description: string;
  }>({ department: 'marketing', category: 'marketing_tools', amount_eur: '', description: '' });

  const loadPayroll = useCallback(() => {
    if (!monthId?.trim()) {
      setPayoutLines([]);
      setPayrollLoading(false);
      setPayrollError(null);
      return;
    }
    setPayrollLoading(true);
    setPayrollError(null);
    apiFetch<{
      ok?: boolean;
      lines?: PayoutLine[];
      fx_rate?: number;
    }>(`/api/payouts?source=live&month_id=${encodeURIComponent(monthId)}`)
      .then(({ ok, data, requestId }) => {
        if (!ok) {
          setPayrollError({ message: (data as { error?: string })?.error ?? 'Failed to load payroll', requestId });
          setPayoutLines([]);
          return;
        }
        const lines = Array.isArray((data as { lines?: PayoutLine[] }).lines) ? (data as { lines: PayoutLine[] }).lines : [];
        const rate = typeof (data as { fx_rate?: number }).fx_rate === 'number' ? (data as { fx_rate: number }).fx_rate : 0.92;
        setFxRate(rate);
        const dept = (d: string) => (d ?? '').toLowerCase().trim();
        const role = (r: string) => (r ?? '').toLowerCase().trim();
        const filtered = lines.filter((l) => {
          const d = dept(l.department ?? '');
          const r = role(l.role ?? '');
          if (r === 'chatter' || d === 'chatting' || d === 'ops') return false;
          return MARKETING_DEPARTMENTS.includes(d as (typeof MARKETING_DEPARTMENTS)[number]);
        });
        const seen = new Set<string>();
        const deduped = filtered.filter((l) => {
          const id = l.team_member_id ?? l.id;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        setPayoutLines(deduped);
        setPayrollError(null);
      })
      .catch(() => {
        setPayoutLines([]);
        setPayrollError({ message: 'Failed to load payroll', requestId: null });
      })
      .finally(() => setPayrollLoading(false));
  }, [monthId]);

  const loadExpenses = useCallback(() => {
    if (!monthId?.trim()) {
      setExpenses([]);
      setExpenseTotals({ marketing_eur: 0, production_eur: 0, total_eur: 0 });
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const url = `/api/expenses?month_id=${encodeURIComponent(monthId)}&categories=${encodeURIComponent(MARKETING_EXPENSE_CATEGORIES_PARAM)}`;
    apiFetch<{ entries?: ExpenseEntry[]; totals?: { marketing_eur: number; production_eur: number; total_eur: number } }>(url)
      .then(({ ok, data, requestId }) => {
        if (!ok) {
          setError({ message: (data as { error?: string })?.error ?? 'Failed to load expenses', requestId });
          setExpenses([]);
          setExpenseTotals({ marketing_eur: 0, production_eur: 0, total_eur: 0 });
          return;
        }
        const list = Array.isArray((data as { entries?: ExpenseEntry[] }).entries) ? (data as { entries: ExpenseEntry[] }).entries : [];
        const t = (data as { totals?: { marketing_eur: number; production_eur: number; total_eur: number } }).totals;
        setExpenses(list);
        setExpenseTotals(
          t ?? { marketing_eur: 0, production_eur: 0, total_eur: 0 }
        );
      })
      .catch(() => {
        setError({ message: 'Failed to load expenses', requestId: null });
        setExpenses([]);
        setExpenseTotals({ marketing_eur: 0, production_eur: 0, total_eur: 0 });
      })
      .finally(() => setLoading(false));
  }, [monthId]);

  useEffect(() => {
    fetch('/api/me', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((me: { canEdit?: boolean } | null) => setCanEdit(me?.canEdit ?? false))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadPayroll();
  }, [loadPayroll]);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  useEffect(() => {
    setMonthsLoading(true);
    apiFetch<{ id: string; month_key: string; month_name?: string }[]>('/api/months')
      .then(({ ok, data }) => {
        const list = ok && Array.isArray(data) ? data : [];
        const valid = list.filter((m) => m.id && String(m.id).trim());
        setMonths(list.sort((a, b) => (a.month_key ?? '').localeCompare(b.month_key ?? '')));
        if (!monthId && valid.length > 0) {
          const defaultId = pickDefaultMonthId(valid, getCurrentMonthKey());
          setMonthId(defaultId ?? valid[valid.length - 1]!.id ?? '');
        }
      })
      .catch(() => setMonths([]))
      .finally(() => setMonthsLoading(false));
  }, [monthId]);

  const monthOptions = useMemo(() => {
    if (monthsLoading) return [];
    return months
      .filter((m) => m.id && String(m.id).trim())
      .map((m) => ({ value: m.id, label: formatMonthLabel(m.month_key) || m.month_key || m.id }));
  }, [months, monthsLoading]);

  const totalPayoutEur = useMemo(
    () => payoutLines.reduce((s, l) => s + (l.amount_eur ?? 0), 0),
    [payoutLines]
  );

  const categoryOptionsByDept = useMemo(() => {
    const marketing = MARKETING_PRODUCTION_CATEGORIES.filter((c) => c.value.startsWith('marketing'));
    const production = MARKETING_PRODUCTION_CATEGORIES.filter((c) => c.value.startsWith('production'));
    return { marketing, production, all: MARKETING_PRODUCTION_CATEGORIES };
  }, []);

  async function handleAddExpense(e: React.FormEvent) {
    e.preventDefault();
    if (addBusy || !monthId) return;
    const department = addForm.department;
    const rawCategory = addForm.category?.trim() || (department === 'production' ? 'production_tools' : 'marketing_tools');
    const category = MARKETING_PRODUCTION_CATEGORY_VALUES.includes(rawCategory as (typeof MARKETING_PRODUCTION_CATEGORY_VALUES)[number]) ? rawCategory : (department === 'production' ? 'production_tools' : 'marketing_tools');
    const amountEur = parseFloat(addForm.amount_eur);
    if (Number.isNaN(amountEur) || amountEur <= 0) {
      setAddError('Enter a valid amount (EUR) greater than 0');
      return;
    }
    setAddBusy(true);
    setAddError(null);
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          month_id: monthId,
          amount_eur: amountEur,
          category,
          department,
          cost_owner_type: 'agency',
          description: addForm.description?.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddError((data as { error?: string }).error ?? 'Failed to add expense');
        return;
      }
      setAddOpen(false);
      setAddForm((f) => ({ ...f, amount_eur: '', description: '' }));
      loadExpenses();
    } finally {
      setAddBusy(false);
    }
  }

  const canSubmitAdd =
    Boolean(monthId) &&
    (addForm.department === 'marketing' || addForm.department === 'production') &&
    addForm.category?.trim() &&
    !Number.isNaN(parseFloat(addForm.amount_eur)) &&
    parseFloat(addForm.amount_eur) > 0;

  return (
    <div className="min-h-full">
      <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
        <GlassCard className="card-hero">
          <h1 className="text-2xl font-bold tracking-tight text-white/95">Marketing &amp; production payroll</h1>
          <p className="mt-1.5 text-sm text-white/60">
            Same payout computation as /payments (monthly_member_basis: bonus, fine, hourly, %). Department=marketing, roles marketing/production/va. Expenses below (marketing/production categories only).
          </p>
        </GlassCard>

        <Toolbar>
          <span className="text-sm font-medium text-[var(--muted)]">Month</span>
          <SmartSelect
            value={monthId || null}
            onValueChange={(v) => setMonthId(v ?? '')}
            options={monthOptions}
            placeholder={monthsLoading ? 'Loading…' : monthOptions.length === 0 ? 'No months' : 'Select month'}
            disabled={monthsLoading || monthOptions.length === 0}
          />
        </Toolbar>

        {payrollLoading && monthId && (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-white/60">Loading payroll…</div>
        )}
        {!payrollLoading && monthId && (
          <>
            <div className="flex flex-wrap gap-4">
              <KpiCard label="Total payouts (EUR)" value={formatEurFull(totalPayoutEur)} />
              <KpiCard label="Total expenses (EUR)" value={formatEurFull(expenseTotals.total_eur ?? 0)} />
              <KpiCard label="Total (EUR)" value={formatEurFull((totalPayoutEur ?? 0) + (expenseTotals.total_eur ?? 0))} />
            </div>
            {payoutLines.length > 0 ? (
              <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5 shadow-lg shadow-black/30 backdrop-blur-xl">
                <table className="w-full min-w-[700px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/80">Member</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Pct payout EUR</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Flat fee (EUR)</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Bonus EUR</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Fine EUR</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Hourly EUR</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Total EUR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {payoutLines.map((row) => (
                      <tr key={row.team_member_id} className="hover:bg-white/5 transition-colors">
                        <td className="px-3 py-2.5 text-white/90">{row.team_member_name || '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-white/90">
                          {row.pct_payout_eur != null ? formatNumberFull(row.pct_payout_eur) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-white/90">
                          {row.payout_flat_fee != null ? formatNumberFull(row.payout_flat_fee) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-white/90">
                          {row.bonus_eur != null ? formatNumberFull(row.bonus_eur) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-white/90">
                          {row.adjustments_eur != null ? formatNumberFull(row.adjustments_eur) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-white/90">
                          {row.hourly_eur != null ? formatNumberFull(row.hourly_eur) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium text-white/90">
                          {row.amount_eur != null ? formatEurFull(row.amount_eur) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/60">No marketing/production payroll members for this month.</p>
            )}
          </>
        )}

        {payrollError && monthId && (
          <ErrorState title="Could not load payroll" description={payrollError.message} requestId={payrollError.requestId ?? undefined} />
        )}

        <h2 className="mt-8 text-base font-semibold text-white/90">Marketing &amp; production expenses</h2>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-4 py-3 shadow-[var(--shadow-sm)] backdrop-blur-xl">
          <div className="flex flex-wrap gap-4">
            <KpiCard label="Marketing total" value={formatEurFull(expenseTotals.marketing_eur)} />
            <KpiCard label="Production total" value={formatEurFull(expenseTotals.production_eur)} />
            <KpiCard label="Total expenses (EUR)" value={formatEurFull(expenseTotals.total_eur)} />
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              disabled={!monthId}
              className="btn-primary rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add expense
            </button>
          )}
        </div>

        {addOpen && (
          <SheetForm
            open
            onOpenChange={(o) => !o && (setAddOpen(false), setAddError(null))}
            title="Add marketing/production expense"
            subtitle={monthId ? `Month: ${formatMonthLabel(months.find((m) => m.id === monthId)?.month_key ?? '') || monthId}` : undefined}
            footer={
              <div className="flex gap-2">
                <button
                  type="submit"
                  form="marketing-add-expense-form"
                  disabled={addBusy || !canSubmitAdd}
                  className="btn-primary flex-1 rounded-xl py-2.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {addBusy ? 'Adding…' : 'Add'}
                </button>
                <button type="button" onClick={() => setAddOpen(false)} className="btn flex-1 rounded-xl py-2.5 text-sm">Cancel</button>
              </div>
            }
          >
            <form id="marketing-add-expense-form" onSubmit={handleAddExpense} className="space-y-4">
              <FormRow label="Department" required>
                <SmartSelect
                  value={addForm.department}
                  onValueChange={(v) => {
                    const d = v === 'production' ? 'production' : 'marketing';
                    setAddForm((f) => ({
                      ...f,
                      department: d,
                      category: d === 'production' ? 'production_tools' : 'marketing_tools',
                    }));
                  }}
                  options={[
                    { value: 'marketing', label: 'Marketing' },
                    { value: 'production', label: 'Production' },
                  ]}
                  placeholder="Select department"
                  allowClear={false}
                />
              </FormRow>
              <FormRow label="Category" required>
                <SmartSelect
                  value={addForm.category || null}
                  onValueChange={(c) => setAddForm((f) => ({ ...f, category: c ?? 'marketing_tools' }))}
                  options={categoryOptionsByDept[addForm.department].map((c) => ({ value: c.value, label: c.label }))}
                  placeholder="Select category"
                  allowClear={false}
                />
              </FormRow>
              <FormRow label="Amount (EUR)" required>
                <div className="flex rounded-xl border border-[var(--stroke)] bg-[rgba(26,28,36,0.7)] focus-within:border-[var(--purple-500)] focus-within:ring-2 focus-within:ring-[var(--purple-glow)]">
                  <span className="flex items-center pl-3 text-sm text-[var(--text-muted)]">€</span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    value={addForm.amount_eur}
                    onChange={(e) => setAddForm((f) => ({ ...f, amount_eur: e.target.value }))}
                    className="w-full bg-transparent px-2 py-2.5 text-sm text-[var(--text)] outline-none"
                  />
                </div>
              </FormRow>
              <FormRow label="Description">
                <textarea
                  value={addForm.description}
                  onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                  placeholder="Optional"
                  className="w-full resize-none rounded-xl border border-[var(--stroke)] bg-[rgba(26,28,36,0.7)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]/60 focus:border-[var(--purple-500)] focus:ring-2 focus:ring-[var(--purple-glow)]"
                />
              </FormRow>
              {addError && <p className="text-sm text-[var(--danger)]" role="alert">{addError}</p>}
            </form>
          </SheetForm>
        )}

        {error && monthId && (
          <ErrorState title="Could not load expenses" description={error.message} requestId={error.requestId ?? undefined} />
        )}

        {loading && monthId && <TableSkeleton rows={5} cols={4} />}

        {!loading && !monthId && (
          <EmptyState title="Select a month" description="Choose a month above to view marketing/production payroll and expenses." />
        )}

        {!loading && monthId && !error && expenses.length === 0 && (
          <EmptyState title="No expense entries" description="No marketing/production expenses for this month." />
        )}

        {!loading && monthId && !error && expenses.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5 shadow-lg shadow-black/30 backdrop-blur-xl">
            <table className="w-full min-w-[500px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/6">
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/80">Category</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Amount EUR</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/80">Description</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/80">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {expenses.map((row) => (
                  <tr key={row.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-3 py-2.5 text-white/90">{marketingProductionCategoryLabel(row.category ?? '') || row.category || '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-white/90">
                      {typeof row.amount_eur === 'number' && Number.isFinite(row.amount_eur)
                        ? formatNumberFull(row.amount_eur)
                        : typeof row.amount === 'number' && Number.isFinite(row.amount)
                          ? formatNumberFull(row.amount)
                          : '—'}
                    </td>
                    <td className="max-w-[280px] truncate px-3 py-2.5 text-white/70">{row.description || '—'}</td>
                    <td className="px-3 py-2.5 text-white/60 text-xs">{formatCreated(row.created_at)}</td>
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

export default function MarketingPage() {
  return (
    <Suspense fallback={<div className="min-h-full p-6 text-white/60">Loading…</div>}>
      <MarketingPageContent />
    </Suspense>
  );
}
