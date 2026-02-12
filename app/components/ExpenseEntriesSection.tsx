'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatEurFull } from '@/lib/format';
import { formatDual } from '@/lib/format-money';
import { round2 } from '@/lib/fx';
import type { ExpenseEntry } from '@/lib/types';
import SheetForm from '@/app/components/ui/SheetForm';
import SmartSelect from '@/app/components/ui/SmartSelect';
import MoneyInput from '@/app/components/MoneyInput';
import { useFxRate } from '@/app/hooks/useFxRate';
import KpiCard from '@/app/components/ui/KpiCard';
import EmptyState from '@/app/components/ui/EmptyState';

const EXPENSE_CATEGORIES = [
  'chatting_costs_team',
  'marketing_costs_team',
  'production_costs_team',
  'ads_spend',
  'other_marketing_costs',
  'salary',
  'affiliate_fee',
  'bonuses',
  'airbnbs',
  'softwares',
  'fx_withdrawal_fees',
  'other_costs',
] as const;

function categoryLabel(cat: string): string {
  return cat
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default function ExpenseEntriesSection({
  modelId,
  monthId,
  monthLabel,
  canEdit,
  onRefresh,
}: {
  modelId: string;
  monthId: string;
  monthLabel: string;
  canEdit: boolean;
  onRefresh?: () => void;
}) {
  const [entries, setEntries] = useState<ExpenseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<ExpenseEntry | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!monthId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`/api/models/${modelId}/expenses?month_id=${encodeURIComponent(monthId)}`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d === 'object' && Array.isArray(d.items)) {
          setEntries(d.items);
        } else if (Array.isArray(d)) {
          setEntries(d);
        } else {
          setEntries([]);
        }
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [modelId, monthId]);

  useEffect(() => {
    load();
  }, [load]);

  const eurFirst = true;
  const totals = entries.reduce((sum, e) => sum + (e.amount_eur ?? e.amount ?? 0), 0);
  const byCategory = entries.reduce<Record<string, number>>((acc, e) => {
    const c = e.category || 'other_costs';
    acc[c] = (acc[c] ?? 0) + (e.amount_eur ?? e.amount ?? 0);
    return acc;
  }, {});
  const topCategories = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  async function handleAdd(body: {
    category: string;
    amount_eur: number;
    amount_usd: number;
    description?: string;
    date?: string;
  }) {
    setError(null);
    const payload = {
      month_id: monthId,
      category: body.category,
      amount: round2(body.amount_eur),
      amount_eur: body.amount_eur,
      amount_usd: body.amount_usd,
      description: body.description,
      date: body.date,
    };
    if (process.env.NODE_ENV !== 'production') {
      console.log('POST /api/models/[id]/expenses payload', payload);
    }
    const res = await fetch(`/api/models/${modelId}/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? 'Failed to add expense');
      return;
    }
    setAddModalOpen(false);
    load();
    onRefresh?.();
  }

  const { rate: fxRate, asOf, refresh } = useFxRate();

  async function handlePatch(
    recordId: string,
    field: 'amount' | 'description',
    value: number | string
  ) {
    setSavingId(recordId);
    setError(null);
    const body: Record<string, unknown> = field === 'amount' ? {} : { [field]: value };
    if (field === 'amount' && typeof value === 'number') {
      body.amount_eur = value;
      body.amount_usd = fxRate != null && fxRate > 0 ? round2(value / fxRate) : undefined;
      body.amount = value;
    } else if (field !== 'amount') {
      body[field] = value;
    }
    const res = await fetch(`/api/expenses/${recordId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    setSavingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Update failed');
      return;
    }
    load();
    onRefresh?.();
  }

  async function handleUpdate(
    recordId: string,
    updates: { category?: string; amount_eur?: number; amount_usd?: number; date?: string }
  ) {
    setError(null);
    const res = await fetch(`/api/expenses/${recordId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Update failed');
      return;
    }
    setEditEntry(null);
    load();
    onRefresh?.();
  }

  async function handleDelete(recordId: string) {
    setError(null);
    const res = await fetch(`/api/expenses/${recordId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Delete failed');
      setDeleteConfirm(null);
      return;
    }
    setDeleteConfirm(null);
    load();
    onRefresh?.();
  }

  if (!monthId) {
    return (
      <EmptyState
        title="Expense entries"
        description="Select a month to add expenses."
        className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass)] backdrop-blur-xl"
      />
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass)] p-5 shadow-[var(--shadow-sm)] backdrop-blur-xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
          Expense entries
        </h2>
        {canEdit && (
          <button
            type="button"
            className="btn-primary rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50"
            disabled={!monthId}
            onClick={() => monthId && setAddModalOpen(true)}
          >
            Add expense
          </button>
        )}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <KpiCard label="Total" value={formatEurFull(totals)} />
        {topCategories.map(([cat, sum]) => (
          <KpiCard
            key={cat}
            label={categoryLabel(cat)}
            value={formatEurFull(sum)}
            className="min-w-0"
          />
        ))}
      </div>

      {error && (
        <div
          className="mb-3 rounded-lg border border-[var(--red)]/50 bg-[var(--red-dim)] px-3 py-2 text-sm text-[var(--red)]"
          role="alert"
        >
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
          <table className="w-full min-w-[600px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-[var(--text-muted)]">
                  Category
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase text-[var(--text-muted)]">
                  Amount
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-[var(--text-muted)]">
                  Description
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-[var(--text-muted)]">
                  Vendor
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-[var(--text-muted)]">
                  Date
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-[var(--text-muted)]">
                  Created by
                </th>
                {canEdit && <th className="w-24" />}
              </tr>
            </thead>
            <tbody>
              {entries.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-elevated)]/50"
                >
                  <td className="px-3 py-2 text-left text-[var(--text)]">
                    {canEdit ? (
                      <button
                        type="button"
                        className="text-left hover:underline focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                        onClick={() => setEditEntry(row)}
                      >
                        {categoryLabel(row.category)}
                      </button>
                    ) : (
                      categoryLabel(row.category)
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--text)]">
                    {canEdit ? (
                      <input
                        type="number"
                        step="0.01"
                        className="w-24 rounded border-0 bg-transparent py-0.5 text-right focus:ring-1 focus:ring-[var(--accent)]"
                        defaultValue={row.amount_eur ?? row.amount ?? ''}
                        onBlur={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!Number.isNaN(v) && (row.amount_eur ?? row.amount) !== v) handlePatch(row.id, 'amount', v);
                        }}
                        disabled={savingId === row.id}
                      />
                    ) : (
                      formatDual(row.amount_usd, row.amount_eur ?? row.amount, eurFirst)
                    )}
                  </td>
                  <td className="max-w-[160px] truncate px-3 py-2 text-left">
                    {canEdit ? (
                      <input
                        type="text"
                        className="w-full rounded border-0 bg-transparent py-0.5 text-[var(--text)] focus:ring-1 focus:ring-[var(--accent)]"
                        defaultValue={row.description}
                        onBlur={(e) => {
                          const v = e.target.value;
                          if (v !== row.description) handlePatch(row.id, 'description', v);
                        }}
                        disabled={savingId === row.id}
                      />
                    ) : (
                      row.description || '—'
                    )}
                  </td>
                  <td className="max-w-[120px] truncate px-3 py-2 text-left text-[var(--text-muted)]">
                    {canEdit ? (
                      <button
                        type="button"
                        className="text-left hover:underline focus:outline-none"
                        onClick={() => setEditEntry(row)}
                      >
                        {row.vendor || '—'}
                      </button>
                    ) : (
                      row.vendor || '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-left text-[var(--text-muted)]">
                    {canEdit ? (
                      <button
                        type="button"
                        className="text-left hover:underline focus:outline-none"
                        onClick={() => setEditEntry(row)}
                      >
                        {row.date || '—'}
                      </button>
                    ) : (
                      row.date || '—'
                    )}
                  </td>
                  <td className="max-w-[120px] truncate px-3 py-2 text-left text-[var(--text-muted)]">
                    {row.created_by || '—'}
                  </td>
                  {canEdit && (
                    <td className="px-3 py-2">
                      {deleteConfirm === row.id ? (
                        <span className="flex gap-1">
                          <button
                            type="button"
                            className="text-xs text-[var(--red)] hover:underline"
                            onClick={() => handleDelete(row.id)}
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            className="text-xs text-[var(--text-muted)] hover:underline"
                            onClick={() => setDeleteConfirm(null)}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="text-xs text-[var(--text-muted)] hover:text-[var(--red)]"
                          onClick={() => setDeleteConfirm(row.id)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 && (
            <EmptyState
              title="No expense entries for this month."
              className="rounded-none border-0 bg-transparent py-6 shadow-none"
            />
          )}
        </div>
      )}

      {addModalOpen && monthId && (
        <AddExpenseSheet
          monthLabel={monthLabel}
          categories={[...EXPENSE_CATEGORIES]}
          categoryLabel={categoryLabel}
          onAdd={handleAdd}
          onClose={() => setAddModalOpen(false)}
          fxRate={fxRate}
          asOf={asOf}
          onRefetch={refresh}
        />
      )}

      {editEntry && (
        <EditExpenseSheet
          entry={editEntry}
          categories={[...EXPENSE_CATEGORIES]}
          categoryLabel={categoryLabel}
          onSave={(updates) => handleUpdate(editEntry.id, updates)}
          onClose={() => setEditEntry(null)}
          fxRate={fxRate}
          asOf={asOf}
          onRefetch={refresh}
        />
      )}
    </div>
  );
}

function AddExpenseSheet({
  monthLabel,
  categories,
  categoryLabel,
  onAdd,
  onClose,
  fxRate,
  asOf,
  onRefetch,
}: {
  monthLabel: string;
  categories: readonly string[];
  categoryLabel: (c: string) => string;
  onAdd: (body: {
    category: string;
    amount_eur: number;
    amount_usd: number;
    description?: string;
    date?: string;
  }) => void;
  onClose: () => void;
  fxRate: number | null;
  asOf: string | null;
  onRefetch?: () => void;
}) {
  const [category, setCategory] = useState(categories[0] ?? 'other_costs');
  const [amountUsd, setAmountUsd] = useState<number | undefined>(undefined);
  const [amountEur, setAmountEur] = useState<number | undefined>(undefined);
  const [baseCurrency, setBaseCurrency] = useState<'usd' | 'eur'>('eur');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');

  // Set default date after mount to avoid server/client timestamp hydration mismatch
  useEffect(() => {
    setDate((d) => (d ? d : new Date().toISOString().slice(0, 10)));
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const eur =
      amountEur != null && Number.isFinite(amountEur)
        ? round2(amountEur)
        : fxRate != null && amountUsd != null
          ? round2(amountUsd * fxRate)
          : 0;
    const usd =
      amountUsd != null && Number.isFinite(amountUsd)
        ? round2(amountUsd)
        : fxRate != null && amountEur != null
          ? round2(amountEur / fxRate)
          : 0;
    if (eur < 0 && usd < 0) return;
    onAdd({
      category,
      amount_eur: eur,
      amount_usd: usd,
      description: description || undefined,
      date: date || undefined,
    });
  }

  const categoryOptions = categories.map((c) => ({ value: c, label: categoryLabel(c) }));

  return (
    <SheetForm
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add expense"
      subtitle={`Month: ${monthLabel}`}
      footer={
        <div className="flex gap-2">
          <button type="submit" form="add-expense-form" className="btn-primary flex-1 rounded-xl py-2.5 text-sm font-medium">
            Add
          </button>
          <button type="button" onClick={onClose} className="btn flex-1 rounded-xl py-2.5 text-sm">
            Cancel
          </button>
        </div>
      }
    >
      <form id="add-expense-form" onSubmit={submit} className="space-y-4">
        <SmartSelect
          label="Category *"
          value={category}
          onChange={setCategory}
          options={categoryOptions}
          searchable
        />
        <MoneyInput
          label="Amount *"
          valueUsd={amountUsd}
          valueEur={amountEur}
          onChange={({ amount_usd, amount_eur }) => {
            setAmountUsd(amount_usd);
            setAmountEur(amount_eur);
          }}
          fxRate={fxRate}
          baseCurrency={baseCurrency}
          onBaseCurrencyChange={setBaseCurrency}
          asOf={asOf ?? undefined}
          onRefetch={onRefetch}
          lockBaseCurrency={false}
        />
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-xl border border-[var(--stroke)] bg-[rgba(26,28,36,0.7)] px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--purple-500)] focus:ring-2 focus:ring-[var(--purple-glow)]"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl border border-[var(--stroke)] bg-[rgba(26,28,36,0.7)] px-3 py-2.5 text-sm text-[var(--text)] focus:border-[var(--purple-500)] focus:ring-2 focus:ring-[var(--purple-glow)]"
          />
        </div>
      </form>
    </SheetForm>
  );
}

function EditExpenseSheet({
  entry,
  categories,
  categoryLabel,
  onSave,
  onClose,
  fxRate,
  asOf,
  onRefetch,
}: {
  entry: ExpenseEntry;
  categories: readonly string[];
  categoryLabel: (c: string) => string;
  onSave: (updates: {
    category?: string;
    amount_eur?: number;
    amount_usd?: number;
    date?: string;
  }) => void;
  onClose: () => void;
  fxRate: number | null;
  asOf: string | null;
  onRefetch?: () => void;
}) {
  const [category, setCategory] = useState(entry.category);
  const [amountUsd, setAmountUsd] = useState<number | undefined>(
    entry.amount_usd ?? (entry.amount != null && fxRate ? entry.amount / fxRate : undefined)
  );
  const [amountEur, setAmountEur] = useState<number | undefined>(entry.amount_eur ?? entry.amount ?? undefined);
  const [baseCurrency, setBaseCurrency] = useState<'usd' | 'eur'>('eur');
  const [date, setDate] = useState(entry.date ? entry.date.slice(0, 10) : '');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const updates: Parameters<typeof onSave>[0] = {
      category,
      date: date || undefined,
    };
    if (amountEur != null && Number.isFinite(amountEur)) updates.amount_eur = round2(amountEur);
    if (amountUsd != null && Number.isFinite(amountUsd)) updates.amount_usd = round2(amountUsd);
    onSave(updates);
  }

  const categoryOptions = categories.map((c) => ({ value: c, label: categoryLabel(c) }));

  return (
    <SheetForm
      open
      onOpenChange={(o) => !o && onClose()}
      title="Edit expense"
      subtitle={formatDual(entry.amount_usd, entry.amount_eur ?? entry.amount, true)}
      footer={
        <div className="flex gap-2">
          <button type="submit" form="edit-expense-form" className="btn-primary flex-1 rounded-xl py-2.5 text-sm font-medium">
            Save
          </button>
          <button type="button" onClick={onClose} className="btn flex-1 rounded-xl py-2.5 text-sm">
            Cancel
          </button>
        </div>
      }
    >
      <form id="edit-expense-form" onSubmit={submit} className="space-y-4">
        <SmartSelect
          label="Category"
          value={category}
          onChange={setCategory}
          options={categoryOptions}
          searchable
        />
        <MoneyInput
          label="Amount"
          valueUsd={amountUsd}
          valueEur={amountEur}
          onChange={({ amount_usd, amount_eur }) => {
            setAmountUsd(amount_usd);
            setAmountEur(amount_eur);
          }}
          fxRate={fxRate}
          baseCurrency={baseCurrency}
          onBaseCurrencyChange={setBaseCurrency}
          asOf={asOf ?? undefined}
          onRefetch={onRefetch}
          lockBaseCurrency={false}
        />
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl border border-[var(--stroke)] bg-[rgba(26,28,36,0.7)] px-3 py-2.5 text-sm text-[var(--text)] focus:border-[var(--purple-500)] focus:ring-2 focus:ring-[var(--purple-glow)]"
          />
        </div>
      </form>
    </SheetForm>
  );
}
