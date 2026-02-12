'use client';

import { useState, useEffect, useRef } from 'react';
import SheetForm from '@/app/components/ui/SheetForm';
import { formatEurFull, formatUsdFull, formatMonthLabel } from '@/lib/format';
import { getCurrentMonthKey, pickDefaultMonthId } from '@/lib/months';
import type { PnlRow } from '@/lib/types';

export interface ActualsSectionProps {
  modelId: string;
  actuals: PnlRow[];
  canEdit: boolean;
  onRefresh: () => void;
  /** Month options from pnl (may be empty when no actuals). Used for default. */
  monthOptions: { month_id: string; month_key: string; month_name: string }[];
  /** When false (e.g. Overview tab), hide primary "Add actual line" button; edit/delete on rows still shown. */
  showAddButton?: boolean;
}

export default function ActualsSection({
  modelId,
  actuals,
  canEdit,
  onRefresh,
  monthOptions,
  showAddButton = true,
}: ActualsSectionProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<PnlRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<PnlRow | null>(null);
  const [months, setMonths] = useState<{ id: string; month_key: string; month_name: string }[]>([]);
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [monthId, setMonthId] = useState('');
  const [revenueType, setRevenueType] = useState<'gross' | 'net'>('gross');
  const [amountUsd, setAmountUsd] = useState('');
  const [notes, setNotes] = useState('');
  const formRef = useRef<HTMLFormElement>(null);

  const OF_FEE_RATE = 0.8; // net = gross * 0.8

  useEffect(() => {
    fetch('/api/months', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((arr: { id: string; month_key: string; month_name: string }[]) => {
        const list = Array.isArray(arr) ? arr : [];
        setMonths(list);
        if (list.length > 0 && !monthId) {
          const mapped = list.map((m) => ({ id: m.id, month_key: m.month_key }));
          const defaultId = pickDefaultMonthId(mapped, getCurrentMonthKey());
          setMonthId(defaultId ?? list[0]!.id);
        }
      })
      .catch(() => setMonths([]));
  }, [monthId]);

  useEffect(() => {
    fetch('/api/fx/usd-eur', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { rate?: number } | null) => {
        const rate = typeof data?.rate === 'number' && data.rate > 0 ? data.rate : null;
        setFxRate(rate);
      })
      .catch(() => setFxRate(null));
  }, []);

  const amountNum = Number(amountUsd);
  const isValidAmount = Number.isFinite(amountNum) && amountNum >= 0;

  /** Revenue: gross_usd and net_usd from user input (gross or net) */
  const revenueGrossUsd =
    isValidAmount
      ? revenueType === 'gross'
        ? amountNum
        : amountNum / OF_FEE_RATE
      : 0;
  const revenueNetUsd =
    isValidAmount
      ? revenueType === 'gross'
        ? amountNum * OF_FEE_RATE
        : amountNum
      : 0;
  const revenueNetEur =
    fxRate != null && fxRate > 0
      ? Math.round(revenueNetUsd * fxRate * 100) / 100
      : null;


  const openAdd = () => {
    setEditingRow(null);
    setRevenueType('gross');
    setAmountUsd('');
    setNotes('');
    setError(null);
    if (months.length > 0) {
      const mapped = months.map((m) => ({ id: m.id, month_key: m.month_key }));
      setMonthId(monthId || (pickDefaultMonthId(mapped, getCurrentMonthKey()) ?? months[0]!.id));
    }
    setModalOpen(true);
  };

  const openEdit = (row: PnlRow) => {
    setEditingRow(row);
    const g = row.gross_revenue ?? 0;
    const hasRevenue = g > 0;
    if (hasRevenue) {
      setRevenueType('gross');
      setAmountUsd(String(g));
    } else {
      setAmountUsd('0');
    }
    setNotes(row.notes_issues ?? '');
    setMonthId(row.month_id ?? '');
    setError(null);
    setModalOpen(true);
  };

  /** Expense-only rows (gross_revenue=0) cannot be edited here; managed in Expense Entries tab */
  const isExpenseOnlyRow = editingRow != null && (editingRow.gross_revenue ?? 0) === 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const amt = Number(amountUsd);
    if (!Number.isFinite(amt) || amt < 0) {
      setError('Amount (USD) must be ≥ 0');
      return;
    }
    if (!monthId) {
      setError('Month required');
      return;
    }
    if (isExpenseOnlyRow) return;

    /** Revenue: always persist gross_usd (API writes to gross_revenue) */
    const amountToSend =
      revenueType === 'gross'
        ? amt
        : Math.round((amt / OF_FEE_RATE) * 100) / 100;

    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        model_id: modelId,
        month_id: monthId,
        line_type: 'revenue',
        amount_usd: amountToSend,
        notes: notes || undefined,
      };

      if (editingRow) {
        const res = await fetch(`/api/pnl-lines/${editingRow.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError((data as { error?: string }).error ?? 'Update failed');
          return;
        }
      } else {
        const res = await fetch('/api/pnl-lines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError((data as { error?: string }).error ?? 'Create failed');
          return;
        }
      }
      setModalOpen(false);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteRow) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pnl-lines/${deleteRow.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? 'Delete failed');
        return;
      }
      setDeleteRow(null);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] px-6 py-6 shadow-[var(--shadow-sm)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Actuals
        </h2>
        {canEdit && showAddButton && (
          <button
            type="button"
            onClick={openAdd}
            className="btn-primary rounded-lg px-4 py-2 text-sm font-medium"
          >
            Add actual line
          </button>
        )}
      </div>

      {actuals.length === 0 ? (
        <p className="text-[var(--text-muted)]">No actuals yet. Add a line above.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[400px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                <th className="py-2 pr-4">Month</th>
                <th className="py-2 pr-4 text-right">Gross</th>
                <th className="py-2 pr-4 text-right">Net €</th>
                {canEdit && <th className="w-24 py-2" />}
              </tr>
            </thead>
            <tbody>
              {actuals.map((row) => (
                <tr key={row.id} className="border-b border-[var(--border-subtle)]/50">
                  <td className="py-2 pr-4 text-[var(--text)]">
                    {formatMonthLabel(row.month_key) || row.month_key}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-[var(--text)]">
                    {formatUsdFull(row.gross_revenue ?? 0)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-[var(--text)]">
                    {formatEurFull(row.net_revenue ?? 0)}
                  </td>
                  {canEdit && (
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(row)}
                          className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs font-medium text-[var(--text)] hover:bg-[var(--border-subtle)]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => { setDeleteRow(row); setError(null); }}
                          className="rounded border border-[var(--red)]/50 bg-transparent px-2 py-1 text-xs font-medium text-[var(--red)] hover:bg-[var(--red)]/10"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit modal */}
      <SheetForm
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editingRow ? 'Edit actual line' : 'Add actual line'}
        subtitle="Amounts in USD. EUR stored at save."
        footer={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => formRef.current?.requestSubmit()}
              disabled={busy || isExpenseOnlyRow}
              className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
            >
              {busy ? 'Saving…' : editingRow ? 'Save' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="btn rounded-lg px-4 py-2 text-sm"
            >
              Cancel
            </button>
            {error && <p className="w-full text-xs text-[var(--red)]">{error}</p>}
          </div>
        }
      >
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Month *</label>
            <select
              value={monthId}
              onChange={(e) => setMonthId(e.target.value)}
              required
              disabled={!!editingRow}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            >
              <option value="">Select month</option>
              {months.map((m) => (
                <option key={m.id} value={m.id}>
                  {formatMonthLabel(m.month_key) || m.month_key}
                </option>
              ))}
            </select>
          </div>
          {isExpenseOnlyRow ? (
            <p className="rounded-lg border border-[var(--yellow)]/50 bg-[var(--yellow)]/10 px-3 py-2 text-sm text-[var(--yellow)]">
              Expenses are managed in Expense Entries. Use the Expenses tab to add or edit expenses.
            </p>
          ) : (
            <>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Line type</label>
            <p className="rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-muted)]">Revenue</p>
          </div>
          <div className="space-y-3 transition-opacity duration-200">
              <div>
                <label className="mb-2 block text-xs font-medium text-[var(--text-muted)]">Revenue type *</label>
                <div className="flex flex-col gap-2">
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3 transition-all duration-200 hover:border-white/20 has-[:checked]:border-[var(--purple-500)]/50 has-[:checked]:bg-[var(--purple-500)]/10">
                    <input
                      type="radio"
                      name="revenueType"
                      value="gross"
                      checked={revenueType === 'gross'}
                      onChange={() => setRevenueType('gross')}
                      className="h-4 w-4 accent-[var(--purple-500)]"
                    />
                    <span className="text-sm font-medium text-[var(--text)]">Gross revenue (OnlyFans)</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3 transition-all duration-200 hover:border-white/20 has-[:checked]:border-[var(--purple-500)]/50 has-[:checked]:bg-[var(--purple-500)]/10">
                    <input
                      type="radio"
                      name="revenueType"
                      value="net"
                      checked={revenueType === 'net'}
                      onChange={() => setRevenueType('net')}
                      className="h-4 w-4 accent-[var(--purple-500)]"
                    />
                    <span className="text-sm font-medium text-[var(--text)]">Net revenue (after OF fee)</span>
                  </label>
                </div>
                <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">OF fee 20%. Net = Gross × 0.8</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                  {revenueType === 'gross' ? 'Gross amount (USD) *' : 'Net amount (USD) *'}
                </label>
                <input
                  type="number"
                  step="any"
                  min={0}
                  value={amountUsd}
                  onChange={(e) => setAmountUsd(e.target.value)}
                  required
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm tabular-nums"
                />
                {(revenueNetUsd > 0 || revenueNetEur != null) && (
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--text-muted)] tabular-nums">
                    <span>Net: {formatUsdFull(revenueNetUsd)}</span>
                    {revenueNetEur != null && <span>{formatEurFull(revenueNetEur)}</span>}
                  </div>
                )}
              </div>
            </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              placeholder="Optional"
            />
          </div>
          </>
          )}
        </form>
      </SheetForm>

      {/* Delete confirm */}
      {deleteRow && (
        <SheetForm
          open={!!deleteRow}
          onOpenChange={(open) => !open && (setDeleteRow(null), setError(null))}
          title="Delete actual line"
          subtitle="This cannot be undone."
          footer={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="rounded-lg border border-[var(--red)] bg-[var(--red)]/20 px-4 py-2 text-sm font-medium text-[var(--red)] hover:bg-[var(--red)]/30 disabled:opacity-50"
              >
                {busy ? 'Deleting…' : 'Delete'}
              </button>
              <button
                type="button"
                onClick={() => (setDeleteRow(null), setError(null))}
                disabled={busy}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--border-subtle)] disabled:opacity-50"
              >
                Cancel
              </button>
              {error && <p className="w-full text-xs text-[var(--red)]">{error}</p>}
            </div>
          }
        >
          <p className="text-sm text-[var(--text-muted)]">
            Month: {formatMonthLabel(deleteRow.month_key) || deleteRow.month_key}
          </p>
        </SheetForm>
      )}
    </div>
  );
}
