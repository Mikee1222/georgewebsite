'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatEurFull } from '@/lib/format';
import { formatDual } from '@/lib/format-money';
import { round2 } from '@/lib/fx';
import type { RevenueEntry } from '@/lib/types';
import MoneyInput from '@/app/components/MoneyInput';
import { useFxRate } from '@/app/hooks/useFxRate';

export default function RevenueEntriesSection({
  modelId,
  monthId,
  canEdit,
  onRefresh,
}: {
  modelId: string;
  monthId: string;
  canEdit: boolean;
  onRefresh?: () => void;
}) {
  const [entries, setEntries] = useState<RevenueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tableExists, setTableExists] = useState(true);

  const load = useCallback(() => {
    if (!monthId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`/api/models/${modelId}/revenue?month_id=${encodeURIComponent(monthId)}`, {
      credentials: 'include',
    })
      .then((r) => {
        if (r.status === 404 || r.status === 500) {
          setTableExists(false);
          return [];
        }
        return r.ok ? r.json() : [];
      })
      .then((d) => setEntries(Array.isArray(d) ? d : []))
      .catch(() => {
        setTableExists(false);
        setEntries([]);
      })
      .finally(() => setLoading(false));
  }, [modelId, monthId]);

  useEffect(() => {
    load();
  }, [load]);

  const eurFirst = false;
  const totalRevenue = entries.reduce((sum, e) => sum + (e.amount_usd ?? e.amount ?? 0), 0);

  const { rate: fxRate, asOf, refresh } = useFxRate();

  async function handleAdd(body: { type: string; amount_usd: number; amount_eur: number; description?: string; date?: string }) {
    setError(null);
    const payload = { month_id: monthId, ...body };
    if (process.env.NODE_ENV === 'development') {
      console.log('[RevenueEntriesSection] POST payload', payload);
    }
    const res = await fetch(`/api/models/${modelId}/revenue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? 'Failed to add revenue');
      return;
    }
    setModalOpen(false);
    load();
    onRefresh?.();
  }

  async function handlePatch(
    recordId: string,
    field: 'amount' | 'amount_usd' | 'amount_eur' | 'description' | 'type',
    value: number | string
  ) {
    setSavingId(recordId);
    setError(null);
    const body: Record<string, unknown> = { [field]: value };
    if (field === 'amount' && typeof value === 'number') {
      body.amount_usd = value;
      body.amount_eur = fxRate != null && fxRate > 0 ? round2(value * fxRate) : undefined;
    }
    const res = await fetch(`/api/revenue/${recordId}`, {
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

  async function handleDelete(recordId: string) {
    setError(null);
    const res = await fetch(`/api/revenue/${recordId}`, {
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

  // Stable header row: "Revenue entries" left + "Add revenue" right — always visible, never tied to async data
  const headerRow = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Revenue entries
      </h2>
      {canEdit && (
        <button
          type="button"
          className="btn-primary rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
          onClick={() => setModalOpen(true)}
          disabled={!monthId}
        >
          Add revenue
        </button>
      )}
    </div>
  );

  if (!monthId) {
    return (
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
        {headerRow}
        <p className="text-sm text-[var(--text-muted)]">Create pnl line first or select a month above to add revenue.</p>
      </div>
    );
  }

  // Content area: total, table/loading/empty/error — below stable header
  const contentArea = !tableExists ? (
    <p className="text-sm text-[var(--text-muted)]">Unable to load revenue entries. The revenue table may not exist.</p>
  ) : (
    <>
      <div className="mb-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg)] px-3 py-2">
        <p className="text-[10px] uppercase text-[var(--text-muted)]">Total gross revenue</p>
        <p className="tabular-nums text-lg font-semibold text-[var(--text)]">
          {formatEurFull(totalRevenue)}
        </p>
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
          <table className="w-full min-w-[400px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-[var(--text-muted)]">Type</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase text-[var(--text-muted)]">Amount</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-[var(--text-muted)]">Description</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-[var(--text-muted)]">Created by</th>
                {canEdit && <th className="w-20" />}
              </tr>
            </thead>
            <tbody>
              {entries.map((row) => (
                <tr key={row.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-elevated)]/50">
                  <td className="px-3 py-2 text-left text-[var(--text)]">
                    {canEdit ? (
                      <input
                        type="text"
                        className="w-full max-w-[120px] rounded border-0 bg-transparent py-0.5 text-[var(--text)] focus:ring-1 focus:ring-[var(--accent)]"
                        defaultValue={row.type}
                        onBlur={(e) => {
                          const v = e.target.value;
                          if (v !== row.type) handlePatch(row.id, 'type', v);
                        }}
                        disabled={savingId === row.id}
                      />
                    ) : (
                      row.type || '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--text)]">
                    {canEdit ? (
                      <input
                        type="number"
                        step="0.01"
                        className="w-24 rounded border-0 bg-transparent py-0.5 text-right focus:ring-1 focus:ring-[var(--accent)]"
                        defaultValue={row.amount_usd ?? row.amount ?? ''}
                        onBlur={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!Number.isNaN(v) && (row.amount_usd ?? row.amount) !== v) handlePatch(row.id, 'amount', v);
                        }}
                        disabled={savingId === row.id}
                      />
                    ) : (
                      formatDual(row.amount_usd, row.amount_eur ?? row.amount, eurFirst)
                    )}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2 text-left">
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
                  <td className="max-w-[120px] truncate px-3 py-2 text-left text-[var(--text-muted)]">{row.created_by || '—'}</td>
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
            <p className="py-6 text-center text-sm text-[var(--text-muted)]">No revenue entries for this month.</p>
          )}
        </div>
      )}
    </>
  );

  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
      {headerRow}
      {contentArea}
      {modalOpen && (
        <AddRevenueModal
          onAdd={handleAdd}
          onClose={() => setModalOpen(false)}
          fxRate={fxRate}
          asOf={asOf}
          onRefetch={refresh}
        />
      )}
    </div>
  );
}

function AddRevenueModal({
  onAdd,
  onClose,
  fxRate,
  asOf,
  onRefetch,
}: {
  onAdd: (body: { type: string; amount_usd: number; amount_eur: number; description?: string; date?: string }) => void;
  onClose: () => void;
  fxRate: number | null;
  asOf: string | null;
  onRefetch?: () => void;
}) {
  const [type, setType] = useState('');
  const [amountUsd, setAmountUsd] = useState<number | undefined>(undefined);
  const [amountEur, setAmountEur] = useState<number | undefined>(undefined);
  const [baseCurrency, setBaseCurrency] = useState<'usd' | 'eur'>('usd');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const usd =
      amountUsd != null && Number.isFinite(amountUsd)
        ? round2(amountUsd)
        : fxRate != null && amountEur != null
          ? round2(amountEur / fxRate)
          : 0;
    const eur =
      amountEur != null && Number.isFinite(amountEur)
        ? round2(amountEur)
        : fxRate != null && amountUsd != null
          ? round2(amountUsd * fxRate)
          : 0;
    if (usd < 0 && eur < 0) return;
    onAdd({
      type: type.trim() || 'Revenue',
      amount_usd: usd,
      amount_eur: eur,
      description: description || undefined,
      date: date || undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-zinc-950/85 p-6 shadow-xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-semibold text-white">Add revenue</h3>
        <form onSubmit={submit}>
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-white/70">Type</label>
            <input
              type="text"
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="e.g. Subscriptions"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-[var(--purple-500)] focus:ring-2 focus:ring-[var(--purple-500)]/30"
            />
          </div>
          <div className="mb-3">
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
          </div>
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-white/70">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            />
          </div>
          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-white/70">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary flex-1 rounded-xl py-2 text-sm">
              Add
            </button>
            <button type="button" onClick={onClose} className="btn rounded-xl py-2 text-sm">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
