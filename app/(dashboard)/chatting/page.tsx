'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { formatEurFull, formatUsdFull, formatNumberFull, formatMonthLabel } from '@/lib/format';
import { apiFetch } from '@/lib/client-fetch';
import { getCurrentMonthKey, pickDefaultMonthId } from '@/lib/months';
import type { ExpenseEntry, TeamMember } from '@/lib/types';
import { SELECT_ALL } from '@/lib/select-constants';
import { CHATTING_DEPARTMENT_CATEGORIES } from '@/lib/expense-categories';
import GlassCard from '@/app/components/ui/GlassCard';
import KpiCard from '@/app/components/ui/KpiCard';
import Toolbar from '@/app/components/ui/Toolbar';
import SmartSelect from '@/app/components/ui/SmartSelect';
import SheetForm from '@/app/components/ui/SheetForm';
import EmptyState from '@/app/components/ui/EmptyState';
import ErrorState from '@/app/components/ui/ErrorState';
import TableSkeleton from '@/app/components/ui/TableSkeleton';

export default function ChattingPage() {
  const [monthId, setMonthId] = useState('');
  const [months, setMonths] = useState<{ id: string; month_key: string; month_name?: string }[]>([]);
  const [monthsLoading, setMonthsLoading] = useState(true);
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamMembersLoading, setTeamMembersLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>(SELECT_ALL);
  const [memberFilter, setMemberFilter] = useState<string>(SELECT_ALL);
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addForm, setAddForm] = useState<{ category: 'crm_cost' | 'bot_cost'; amount: string; description: string }>({ category: 'crm_cost', amount: '', description: '' });
  const [addFieldErrors, setAddFieldErrors] = useState<{ category?: string; amount?: string }>({});
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [error, setError] = useState<{ message: string; requestId: string | null } | null>(null);

  /** Live payout line from GET /api/payouts?source=live (same computation as /payments). */
  type LivePayoutLine = {
    id: string;
    team_member_id: string;
    team_member_name: string;
    department: string;
    role: string;
    basis_manual_amount: number;
    payout_percentage?: number;
    payout_flat_fee?: number;
    amount_eur: number | null;
    bonus_eur?: number | null;
    adjustments_eur?: number | null;
    hourly_eur?: number | null;
    pct_payout_eur?: number | null;
  };
  const CHATTING_ROLES = ['chatter', 'chatting_manager', 'va', 'va_manager', 'other'] as const;
  const [livePayoutLines, setLivePayoutLines] = useState<LivePayoutLine[]>([]);
  const [livePayrollLoading, setLivePayrollLoading] = useState(false);
  const [livePayrollError, setLivePayrollError] = useState<{ message: string; requestId: string | null } | null>(null);

  const loadLivePayouts = useCallback(() => {
    if (!monthId?.trim()) {
      setLivePayoutLines([]);
      setLivePayrollLoading(false);
      setLivePayrollError(null);
      return;
    }
    setLivePayrollLoading(true);
    setLivePayrollError(null);
    apiFetch<{ ok?: boolean; lines?: LivePayoutLine[] }>(`/api/payouts?source=live&month_id=${encodeURIComponent(monthId)}`)
      .then(({ ok, data, requestId }) => {
        if (!ok) {
          setLivePayrollError({ message: (data as { error?: string })?.error ?? 'Failed to load live payouts', requestId });
          setLivePayoutLines([]);
          return;
        }
        const lines = Array.isArray((data as { lines?: LivePayoutLine[] }).lines) ? (data as { lines: LivePayoutLine[] }).lines : [];
        const dept = (d: string) => (d ?? '').toLowerCase().trim();
        const role = (r: string) => (r ?? '').toLowerCase().trim();
        const filtered = lines.filter((l) => {
          const d = dept(l.department ?? '');
          const r = role(l.role ?? '');
          if (d !== 'chatting') return false;
          return CHATTING_ROLES.includes(r as (typeof CHATTING_ROLES)[number]);
        });
        const seen = new Set<string>();
        const deduped = filtered.filter((l) => {
          const id = l.team_member_id ?? l.id;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        setLivePayoutLines(deduped);
        setLivePayrollError(null);
      })
      .catch(() => {
        setLivePayoutLines([]);
        setLivePayrollError({ message: 'Failed to load live payouts', requestId: null });
      })
      .finally(() => setLivePayrollLoading(false));
  }, [monthId]);

  useEffect(() => {
    setTeamMembersLoading(true);
    Promise.all([
      fetch('/api/me', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/team-members', { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([me, members]) => {
        setCanEdit((me as { canEdit?: boolean })?.canEdit ?? false);
        setTeamMembers(Array.isArray(members) ? members : []);
      })
      .catch(() => setTeamMembers([]))
      .finally(() => setTeamMembersLoading(false));
  }, []);

  const loadExpenses = useCallback(() => {
    if (!monthId) {
      setExpenses([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const url = `/api/expenses?month_id=${encodeURIComponent(monthId)}&department=chatting`;
    apiFetch<ExpenseEntry[]>(url)
      .then(({ ok, data: d, requestId }) => {
        if (!ok) {
          setError({ message: (d as { error?: string })?.error ?? 'Failed to load expenses', requestId });
          setExpenses([]);
          return;
        }
        setExpenses(Array.isArray(d) ? d : []);
      })
      .catch(() => {
        setError({ message: 'Failed to load expenses', requestId: null });
        setExpenses([]);
      })
      .finally(() => setLoading(false));
  }, [monthId]);

  async function handleAddExpense(e: React.FormEvent) {
    e.preventDefault();
    if (addBusy) return;
    const fieldErrors: { category?: string; amount?: string } = {};
    if (!monthId) {
      setAddError('Select a month first');
      return;
    }
    const category = addForm.category?.trim() || 'crm_cost';
    if (!category) fieldErrors.category = 'Category is required';
    const amount = parseFloat(addForm.amount);
    if (Number.isNaN(amount) || amount <= 0) {
      fieldErrors.amount = 'Enter a valid amount greater than 0';
    }
    setAddFieldErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;
    const payload = {
      month_id: monthId,
      amount,
      category,
      department: 'chatting',
      cost_owner_type: 'agency' as const,
      description: addForm.description?.trim() || undefined,
    };
    setAddBusy(true);
    setAddError(null);
    setAddFieldErrors({});
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      const errMsg = (data as { error?: string }).error ?? 'Failed to add expense';
      if (!res.ok) {
        setAddError(errMsg);
        setToast({ type: 'error', message: errMsg });
        return;
      }
      setAddOpen(false);
      setAddForm({ category: 'crm_cost', amount: '', description: '' });
      setAddFieldErrors({});
      const created = data as ExpenseEntry;
      if (created?.id && created.month_id === monthId) {
        setExpenses((prev) => [...prev, created]);
      } else {
        loadExpenses();
      }
      setToast({ type: 'success', message: 'Expense added' });
    } finally {
      setAddBusy(false);
    }
  }

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

  useEffect(() => {
    loadLivePayouts();
  }, [loadLivePayouts]);

  const totalLivePayoutEur = useMemo(
    () => livePayoutLines.reduce((s, l) => s + (l.amount_eur ?? 0), 0),
    [livePayoutLines]
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(() => {
    let list = expenses;
    const memberId = memberFilter === SELECT_ALL ? undefined : memberFilter;
    const roleVal = roleFilter === SELECT_ALL ? undefined : roleFilter;
    if (memberId) list = list.filter((e) => e.team_member_id === memberId);
    if (roleVal) {
      const byRole = teamMembers.filter((m) => (m.role as string) === roleVal).map((m) => m.id);
      list = list.filter((e) => byRole.includes(e.team_member_id));
    }
    return list;
  }, [expenses, roleFilter, memberFilter, teamMembers]);

  const total = useMemo(() => filtered.reduce((s, e) => s + e.amount, 0), [filtered]);

  const totalPayoutsPlusExpensesEur = (totalLivePayoutEur ?? 0) + (total ?? 0);

  // Options with non-empty value only (SelectItem requirement)
  const monthOptions = useMemo(() => {
    if (monthsLoading) return [];
    return months
      .filter((m) => m.id && String(m.id).trim())
      .map((m) => ({ value: m.id, label: formatMonthLabel(m.month_key) || m.month_key || m.id }));
  }, [months, monthsLoading]);

  const roleOptions = useMemo(
    () => [
      { value: 'all', label: 'All' },
      { value: 'chatter', label: 'chatter' },
      { value: 'chatting_manager', label: 'chatting_manager' },
    ],
    []
  );

  const chattingMembers = useMemo(
    () => teamMembers.filter((m) => (m.department as string) === 'chatting' && m.id && String(m.id).trim()),
    [teamMembers]
  );

  const memberOptions = useMemo(
    () => [{ value: 'all', label: 'All' }, ...chattingMembers.map((m) => ({ value: m.id, label: m.name || m.id }))],
    [chattingMembers]
  );

  const canSubmitAddExpense = Boolean(
    monthId &&
    addForm.category?.trim() &&
    !Number.isNaN(parseFloat(addForm.amount)) &&
    parseFloat(addForm.amount) > 0
  );

  return (
    <div className="min-h-full">
      <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
        <GlassCard className="card-hero">
          <h1 className="text-2xl font-bold tracking-tight text-white/95">Chatting payroll</h1>
          <p className="mt-1.5 text-sm text-white/60">
            Chatter sales, bonuses and fines from monthly_member_basis. Expense entries below.
          </p>
        </GlassCard>

        <Toolbar className="justify-center">
          <span className="text-sm font-medium text-[var(--muted)]">Month</span>
          <SmartSelect
            value={monthId || null}
            onValueChange={(v) => setMonthId(v ?? '')}
            options={monthOptions}
            placeholder={monthsLoading ? 'Loading…' : monthOptions.length === 0 ? 'No months' : 'Select month'}
            disabled={monthsLoading || monthOptions.length === 0}
          />
        </Toolbar>

        <h2 className="text-base font-semibold text-white/90">Chatting payouts (live)</h2>
        <p className="mt-1 text-sm text-white/60">Same computation as /payments. All department=chatting members (chatters, VAs, managers).</p>
        {livePayrollLoading && monthId && (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-white/60">Loading live payouts…</div>
        )}
        {livePayrollError && monthId && (
          <ErrorState title="Could not load live payouts" description={livePayrollError.message} requestId={livePayrollError.requestId ?? undefined} />
        )}
        {!livePayrollLoading && monthId && !livePayrollError && (
          <>
            <div className="flex flex-wrap gap-4">
              <KpiCard label="Total payouts (EUR)" value={formatEurFull(totalLivePayoutEur)} />
              <KpiCard label="TOTAL PAYOUTS + EXPENSES" value={formatEurFull(totalPayoutsPlusExpensesEur)} />
            </div>
            {livePayoutLines.length > 0 ? (
              <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5 shadow-lg shadow-black/30 backdrop-blur-xl">
                <table className="w-full min-w-[900px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/80">Member</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Gross USD</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Payout %</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Base USD</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Pct payout EUR</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Flat fee EUR</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Bonus EUR</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Fine EUR</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Hourly EUR</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Total EUR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {livePayoutLines.map((row) => {
                      const isChatter = (row.role ?? '').toLowerCase().trim() === 'chatter';
                      const grossUsd = isChatter ? (row.basis_manual_amount ?? 0) : 0;
                      const pct = isChatter && row.payout_percentage != null ? row.payout_percentage : 0;
                      const baseUsd = isChatter ? grossUsd * (pct / 100) : 0;
                      return (
                        <tr key={row.team_member_id} className="hover:bg-white/5 transition-colors">
                          <td className="px-3 py-2.5 text-white/90">{row.team_member_name || '—'}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-white/90">{isChatter ? formatUsdFull(grossUsd) : '—'}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-white/90">{isChatter && row.payout_percentage != null ? `${row.payout_percentage}%` : '—'}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-white/90">{isChatter ? formatUsdFull(baseUsd) : '—'}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-white/90">{!isChatter && row.pct_payout_eur != null ? formatNumberFull(row.pct_payout_eur) : '—'}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-white/90">{!isChatter && row.payout_flat_fee != null ? formatNumberFull(row.payout_flat_fee) : '—'}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-white/90">{row.bonus_eur != null ? formatNumberFull(row.bonus_eur) : '—'}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-white/90">{row.adjustments_eur != null ? formatNumberFull(row.adjustments_eur) : '—'}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-white/90">{!isChatter && row.hourly_eur != null ? formatNumberFull(row.hourly_eur) : '—'}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-medium text-white/90">{row.amount_eur != null ? formatEurFull(row.amount_eur) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/60">No chatting department payouts for this month.</p>
            )}
          </>
        )}

        <h2 className="mt-8 text-base font-semibold text-white/90">Chatting expenses</h2>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-4 py-3 shadow-[var(--shadow-sm)] backdrop-blur-xl">
          <KpiCard label="TOTAL EXPENSES" value={formatEurFull(total)} />
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

        {!monthId && canEdit && (
          <p className="text-xs text-[var(--text-muted)]">Select a month above to enable add expense.</p>
        )}

        {addOpen && (
          <SheetForm
            open
            onOpenChange={(o) => !o && (setAddOpen(false), setAddError(null), setAddFieldErrors({}))}
            title="Add expense"
            subtitle={monthId ? `Month: ${formatMonthLabel(months.find((m) => m.id === monthId)?.month_key ?? '') || monthId}` : undefined}
            footer={
              <div className="flex gap-2">
                <button
                  type="submit"
                  form="chatting-add-form"
                  disabled={addBusy || !canSubmitAddExpense}
                  className="btn-primary flex-1 rounded-xl py-2.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {addBusy ? 'Adding…' : 'Add'}
                </button>
                <button type="button" onClick={() => setAddOpen(false)} className="btn flex-1 rounded-xl py-2.5 text-sm">Cancel</button>
              </div>
            }
          >
            <form id="chatting-add-form" onSubmit={handleAddExpense} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <SmartSelect
                    label="Category *"
                    value={addForm.category || null}
                    onValueChange={(c) => setAddForm((f) => ({ ...f, category: (c === 'bot_cost' ? 'bot_cost' : 'crm_cost') }))}
                    options={CHATTING_DEPARTMENT_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
                    placeholder="Select category"
                    allowClear={false}
                  />
                  {addFieldErrors.category && <p className="mt-1 text-xs text-[var(--danger)]" role="alert">{addFieldErrors.category}</p>}
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]">Currency</label>
                  <div className="flex h-[42px] items-center rounded-xl border border-[var(--stroke)] bg-[rgba(26,28,36,0.5)] px-3 text-sm text-[var(--text-muted)]">EUR (locked)</div>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]">Amount *</label>
                <div className="flex rounded-xl border border-[var(--stroke)] bg-[rgba(26,28,36,0.7)] focus-within:border-[var(--purple-500)] focus-within:ring-2 focus-within:ring-[var(--purple-glow)]">
                  <span className="flex items-center pl-3 text-sm text-[var(--text-muted)]">€</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={addForm.amount}
                    onChange={(e) => setAddForm((f) => ({ ...f, amount: e.target.value }))}
                    className="w-full bg-transparent px-2 py-2.5 text-sm text-[var(--text)] outline-none"
                  />
                </div>
                {addFieldErrors.amount && <p className="mt-1 text-xs text-[var(--danger)]" role="alert">{addFieldErrors.amount}</p>}
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]">Description</label>
                <textarea
                  value={addForm.description}
                  onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                  placeholder="optional note"
                  className="w-full resize-none rounded-xl border border-[var(--stroke)] bg-[rgba(26,28,36,0.7)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]/60 focus:border-[var(--purple-500)] focus:ring-2 focus:ring-[var(--purple-glow)]"
                />
              </div>
              {addError && <p className="text-sm text-[var(--danger)]" role="alert">{addError}</p>}
            </form>
          </SheetForm>
        )}

        {toast && (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              toast.type === 'success'
                ? 'border-[var(--success)]/50 bg-[var(--success-dim)] text-[var(--success)]'
                : 'border-[var(--danger)]/50 bg-[var(--danger-dim)] text-[var(--danger)]'
            }`}
            role="status"
          >
            {toast.message}
          </div>
        )}

        {error && monthId && (
          <ErrorState
            title="Could not load expenses"
            description={error.message}
            requestId={error.requestId ?? undefined}
          />
        )}

        {loading && monthId && <TableSkeleton rows={5} cols={4} />}

        {!loading && !monthId && (
          <EmptyState
            title="Select a month"
            description="Choose a month above to view chatting payroll expenses."
          />
        )}

        {!loading && monthId && !error && filtered.length === 0 && (
          <EmptyState
            title="No expense entries"
            description="No chatting expenses for this month or filters. Add an expense or adjust filters."
          />
        )}

        {!loading && monthId && !error && filtered.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5 shadow-lg shadow-black/30 backdrop-blur-xl">
            <table className="w-full min-w-[400px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/6">
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/80">Category</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Amount</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/80">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-3 py-2.5 text-white/90">{row.category || '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-white/90">{formatNumberFull(row.amount)}</td>
                    <td className="max-w-[280px] truncate px-3 py-2.5 text-white/70">{row.description || '—'}</td>
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
