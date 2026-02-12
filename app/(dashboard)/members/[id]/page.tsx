'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import MemberHeaderCard from '@/app/components/members/MemberHeaderCard';
import MemberCharts from '@/app/components/members/MemberCharts';
import MemberExpenseTable from '@/app/components/members/MemberExpenseTable';
import MemberTimeline from '@/app/components/members/MemberTimeline';
import type { TimelineItem } from '@/app/components/members/MemberTimeline';
import type { MemberExpenseRow } from '@/app/components/members/MemberExpenseTable';
import SmartSelect from '@/app/components/ui/SmartSelect';
import FormRow from '@/app/components/ui/FormRow';
import { formatMonthLabel } from '@/lib/format';

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  status: string;
  monthly_cost?: number;
  notes?: string;
  created_at?: string;
}

interface MonthOption {
  id: string;
  month_key: string;
  month_name: string;
}

interface ExpensesResponse {
  memberId: string;
  totals: { total: number };
  byCategory: { category: string; total: number }[];
  entries: MemberExpenseRow[];
}

const DEPARTMENTS = ['chatting', 'marketing', 'production', 'ops'] as const;
type RangePreset = 'last_3' | 'last_6' | 'ytd' | 'custom';

export default function MemberDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params?.id === 'string' ? params.id : '';

  const [member, setMember] = useState<Member | null>(null);
  const [memberLoading, setMemberLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [tab, setTab] = useState<'overview' | 'expenses' | 'timeline'>('overview');

  const [months, setMonths] = useState<MonthOption[]>([]);
  const [rangePreset, setRangePreset] = useState<RangePreset>('last_6');
  const [fromKey, setFromKey] = useState('');
  const [toKey, setToKey] = useState('');
  const [overviewData, setOverviewData] = useState<ExpensesResponse | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);

  const [expenseMonthId, setExpenseMonthId] = useState('');
  const [expensesData, setExpensesData] = useState<ExpensesResponse | null>(null);
  const [expensesLoading, setExpensesLoading] = useState(false);

  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [addExpenseBusy, setAddExpenseBusy] = useState(false);
  const [addExpenseForm, setAddExpenseForm] = useState({
    month_id: '',
    department: 'chatting',
    category: '',
    amount: '',
    description: '',
    date: '',
  });
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    if (!id) return;
    setMemberLoading(true);
    fetch(`/api/team-members/${id}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMember(d))
      .catch(() => setMember(null))
      .finally(() => setMemberLoading(false));
  }, [id]);

  useEffect(() => {
    fetch('/api/me', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => setCanManage((me as { canManageMembers?: boolean })?.canManageMembers ?? false))
      .catch(() => setCanManage(false));
  }, []);

  useEffect(() => {
    fetch('/api/months', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: MonthOption[]) => {
        const list = Array.isArray(data) ? data.sort((a, b) => a.month_key.localeCompare(b.month_key)) : [];
        setMonths(list);
        if (list.length > 0 && !expenseMonthId) setExpenseMonthId(list[list.length - 1]!.id);
        if (list.length > 0 && !fromKey) {
          const last = list[list.length - 1]!;
          const sixBack = list[Math.max(0, list.length - 6)]!;
          setFromKey(sixBack.month_key);
          setToKey(last.month_key);
        }
      })
      .catch(() => setMonths([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only set initial month/range once on mount
  }, []);

  const loadOverview = useCallback(() => {
    if (!id || !fromKey || !toKey) {
      setOverviewData(null);
      return;
    }
    setOverviewLoading(true);
    fetch(
      `/api/team-members/${id}/expenses?from=${encodeURIComponent(fromKey)}&to=${encodeURIComponent(toKey)}`,
      { credentials: 'include' }
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ExpensesResponse | null) => setOverviewData(d))
      .catch(() => setOverviewData(null))
      .finally(() => setOverviewLoading(false));
  }, [id, fromKey, toKey]);

  useEffect(() => {
    if (tab === 'overview') loadOverview();
  }, [tab, loadOverview]);

  const loadExpenses = useCallback(() => {
    if (!id) return;
    if (!expenseMonthId) {
      setExpensesData(null);
      return;
    }
    setExpensesLoading(true);
    fetch(`/api/team-members/${id}/expenses?month_id=${encodeURIComponent(expenseMonthId)}`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ExpensesResponse | null) => setExpensesData(d))
      .catch(() => setExpensesData(null))
      .finally(() => setExpensesLoading(false));
  }, [id, expenseMonthId]);

  useEffect(() => {
    if (tab === 'expenses') loadExpenses();
  }, [tab, loadExpenses]);

  const loadTimeline = useCallback(() => {
    if (!id) return;
    setTimelineLoading(true);
    fetch(`/api/team-members/${id}/timeline?limit=50`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: TimelineItem[]) => setTimelineItems(Array.isArray(d) ? d : []))
      .catch(() => setTimelineItems([]))
      .finally(() => setTimelineLoading(false));
  }, [id]);

  useEffect(() => {
    if (tab === 'timeline') loadTimeline();
  }, [tab, loadTimeline]);

  useEffect(() => {
    if (rangePreset === 'custom' || !months.length) return;
    const sorted = [...months].sort((a, b) => a.month_key.localeCompare(b.month_key));
    const last = sorted[sorted.length - 1]!;
    if (rangePreset === 'last_3') {
      const start = sorted[Math.max(0, sorted.length - 3)]!;
      setFromKey(start.month_key);
      setToKey(last.month_key);
    } else if (rangePreset === 'last_6') {
      const start = sorted[Math.max(0, sorted.length - 6)]!;
      setFromKey(start.month_key);
      setToKey(last.month_key);
    } else if (rangePreset === 'ytd') {
      const y = new Date().getFullYear();
      const ytdStart = sorted.find((m) => m.month_key.startsWith(String(y)));
      setFromKey(ytdStart?.month_key ?? sorted[0]!.month_key);
      setToKey(last.month_key);
    }
  }, [rangePreset, months]);

  const monthCount = overviewData?.entries?.length
    ? new Set(overviewData.entries.map((e) => e.month_key)).size
    : 0;

  const handleAddExpenseSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    const amount = Number(addExpenseForm.amount);
    if (!addExpenseForm.month_id || !addExpenseForm.category?.trim() || !addExpenseForm.department || Number.isNaN(amount)) {
      showToast('Month, department, category, and amount are required', 'error');
      return;
    }
    setAddExpenseBusy(true);
    fetch(`/api/team-members/${id}/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        month_id: addExpenseForm.month_id,
        department: addExpenseForm.department,
        category: addExpenseForm.category.trim(),
        amount,
        description: addExpenseForm.description.trim() || undefined,
        date: addExpenseForm.date || undefined,
      }),
    })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (data.error) {
          showToast(data.error, 'error');
          return;
        }
        setAddExpenseOpen(false);
        setAddExpenseForm({ month_id: '', department: 'chatting', category: '', amount: '', description: '', date: '' });
        showToast('Expense added', 'success');
        loadOverview();
        loadExpenses();
      })
      .finally(() => setAddExpenseBusy(false));
  };

  const handleDeleteExpense = (recordId: string) => {
    fetch(`/api/expenses/${recordId}`, { method: 'DELETE', credentials: 'include' })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (data.error) showToast(data.error, 'error');
        else {
          setDeleteConfirmId(null);
          showToast('Expense deleted', 'success');
          loadOverview();
          loadExpenses();
        }
      });
  };

  const handleEditMember = () => {
    router.push(`/members?edit=${id}`);
  };

  const handleToggleStatus = () => {
    if (!member) return;
    const next = member.status === 'active' ? 'inactive' : 'active';
    fetch(`/api/team-members/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status: next }),
    })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (data.error) showToast(data.error, 'error');
        else {
          setMember((m) => (m ? { ...m, status: next } : null));
          showToast(`Member ${next}`, 'success');
        }
      });
  };

  if (memberLoading || !id) {
    return (
      <div className="min-h-full bg-gradient-to-b from-[var(--bg)] to-[var(--surface)]/30">
        <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
          <div className="animate-pulse rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)]/95 h-32" />
        </div>
      </div>
    );
  }

  if (!member) {
    return (
      <div className="min-h-full bg-gradient-to-b from-[var(--bg)] to-[var(--surface)]/30">
        <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
          <p className="text-[var(--text-muted)]">Member not found.</p>
          <a href="/members" className="text-[var(--accent)] hover:underline">← Back to Members</a>
        </div>
      </div>
    );
  }

  const tabs = [
    { key: 'overview' as const, label: 'Overview' },
    { key: 'expenses' as const, label: 'Expenses' },
    { key: 'timeline' as const, label: 'Timeline' },
  ];

  return (
    <div className="min-h-full bg-gradient-to-b from-[var(--bg)] to-[var(--surface)]/30">
      <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
        <MemberHeaderCard
          id={member.id}
          name={member.name}
          email={member.email}
          role={member.role}
          department={member.department}
          status={member.status}
          created_at={member.created_at}
          canManage={canManage}
          onEdit={handleEditMember}
          onToggleStatus={handleToggleStatus}
        />

        <div className="flex gap-2 border-b border-[var(--border-subtle)]">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md">
              <span className="text-sm text-white/70">Range</span>
              <SmartSelect
                value={rangePreset}
                onChange={(v) => setRangePreset(v as RangePreset)}
                options={[
                  { value: 'last_3', label: 'Last 3 months' },
                  { value: 'last_6', label: 'Last 6 months' },
                  { value: 'ytd', label: 'YTD' },
                  { value: 'custom', label: 'Custom' },
                ]}
              />
              {rangePreset === 'custom' && (
                <>
                  <span className="text-sm text-white/70">From</span>
                  <SmartSelect
                    value={fromKey}
                    onChange={setFromKey}
                    options={months.map((m) => ({ value: m.month_key, label: formatMonthLabel(m.month_key) || m.month_key }))}
                    placeholder="From"
                    disabled={months.length === 0}
                  />
                  <span className="text-sm text-white/70">To</span>
                  <SmartSelect
                    value={toKey}
                    onChange={setToKey}
                    options={months.map((m) => ({ value: m.month_key, label: formatMonthLabel(m.month_key) || m.month_key }))}
                    placeholder="To"
                    disabled={months.length === 0}
                  />
                </>
              )}
            </div>
            {overviewLoading ? (
              <div className="animate-pulse rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)]/95 h-64" />
            ) : overviewData ? (
              <MemberCharts
                total={overviewData.totals.total}
                byCategory={overviewData.byCategory}
                entries={overviewData.entries}
                monthCount={monthCount || 1}
              />
            ) : (
              <p className="py-8 text-center text-sm text-[var(--text-muted)]">Select a range to view overview.</p>
            )}
          </>
        )}

        {tab === 'expenses' && (
          <MemberExpenseTable
            entries={expensesData?.entries ?? []}
            monthOptions={months}
            selectedMonthId={expenseMonthId}
            onMonthChange={setExpenseMonthId}
            canManage={canManage}
            onAddExpense={() => {
                setAddExpenseForm((f) => ({ ...f, month_id: expenseMonthId }));
                setAddExpenseOpen(true);
              }}
            onDelete={(eid) => setDeleteConfirmId(eid)}
            loading={expensesLoading}
          />
        )}

        {tab === 'timeline' && <MemberTimeline items={timelineItems} loading={timelineLoading} />}

        {toast && (
          <div
            className={`fixed bottom-4 right-4 rounded-lg border px-4 py-3 text-sm ${
              toast.type === 'success'
                ? 'border-[var(--green)]/50 bg-[var(--green-dim)] text-[var(--green)]'
                : 'border-[var(--red)]/50 bg-[var(--red-dim)] text-[var(--red)]'
            }`}
            role="status"
          >
            {toast.message}
          </div>
        )}

        {deleteConfirmId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
            <div className="w-full max-w-sm max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] p-6 shadow-xl">
              <p className="text-sm text-[var(--text)]">Delete this expense? This cannot be undone.</p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => handleDeleteExpense(deleteConfirmId)}
                  className="btn rounded-lg bg-[var(--red)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteConfirmId(null)}
                  className="btn rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {addExpenseOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 backdrop-blur-[2px]" onClick={() => setAddExpenseOpen(false)}>
            <div
              className="glass-card w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-white/90">Add expense</h3>
              <form onSubmit={handleAddExpenseSubmit} className="mt-4 space-y-4">
                <FormRow label="Month" required>
                  <SmartSelect
                    value={addExpenseForm.month_id}
                    onChange={(id) => setAddExpenseForm((f) => ({ ...f, month_id: id }))}
                    options={months.map((m) => ({ value: m.id, label: formatMonthLabel(m.month_key) || m.month_key }))}
                    placeholder="Select month"
                    disabled={months.length === 0}
                  />
                </FormRow>
                <FormRow label="Department" required>
                  <SmartSelect
                    value={addExpenseForm.department}
                    onChange={(d) => setAddExpenseForm((f) => ({ ...f, department: d }))}
                    options={DEPARTMENTS.map((d) => ({ value: d, label: d }))}
                  />
                </FormRow>
                <FormRow label="Category" required>
                  <input
                    value={addExpenseForm.category}
                    onChange={(e) => setAddExpenseForm((f) => ({ ...f, category: e.target.value }))}
                    className="glass-input"
                    placeholder="e.g. salary, software"
                    required
                  />
                </FormRow>
                <FormRow label="Amount" required>
                  <input
                    type="number"
                    step="any"
                    value={addExpenseForm.amount}
                    onChange={(e) => setAddExpenseForm((f) => ({ ...f, amount: e.target.value }))}
                    className="glass-input"
                    required
                  />
                </FormRow>
                <FormRow label="Description">
                  <input
                    value={addExpenseForm.description}
                    onChange={(e) => setAddExpenseForm((f) => ({ ...f, description: e.target.value }))}
                    className="glass-input"
                  />
                </FormRow>
                <FormRow label="Date">
                  <input
                    type="date"
                    value={addExpenseForm.date}
                    onChange={(e) => setAddExpenseForm((f) => ({ ...f, date: e.target.value }))}
                    className="glass-input"
                  />
                </FormRow>
                <div className="flex gap-2 pt-2">
                  <button type="submit" className="btn-primary flex-1 rounded-lg py-2 text-sm" disabled={addExpenseBusy}>
                    {addExpenseBusy ? 'Adding…' : 'Add expense'}
                  </button>
                  <button type="button" onClick={() => setAddExpenseOpen(false)} className="btn rounded-lg py-2 text-sm">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
