'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { formatEurFull, formatUsdFull, formatMonthLabel } from '@/lib/format';
import SheetForm from '@/app/components/ui/SheetForm';
import { getCurrentMonthKey, pickDefaultMonthId } from '@/lib/months';

/** Single actual pnl row for model+month (from GET /api/models/[id]/earnings). */
interface EarningsRow {
  id: string;
  model_id: string;
  month_id: string;
  month_key: string;
  gross_revenue: number;
  net_revenue: number;
  notes_issues?: string;
  status: 'actual';
}

const OF_FEE_RATE = 0.8; // net = gross * 0.8

export default function EarningsSection({
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
  const [row, setRow] = useState<EarningsRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<EarningsRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!monthId) {
      setRow(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/models/${modelId}/earnings?month_id=${encodeURIComponent(monthId)}`, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load');
        return r.json();
      })
      .then((data) => {
        setRow(data && typeof data === 'object' && data.id ? data : null);
      })
      .catch(() => {
        setError('Failed to load earnings');
        setRow(null);
      })
      .finally(() => setLoading(false));
  }, [modelId, monthId]);

  useEffect(() => {
    load();
  }, [load]);

  const openAdd = () => {
    setEditingRow(null);
    setModalOpen(true);
  };

  const openEdit = (r: EarningsRow) => {
    setEditingRow(r);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingRow(null);
    setError(null);
  };

  async function handleSave(payload: { month_id: string; gross_revenue: number; net_revenue?: number; notes_issues?: string }) {
    setError(null);
    const gross = Math.round(payload.gross_revenue * 100) / 100;
    const net = payload.net_revenue != null ? Math.round(payload.net_revenue * 100) / 100 : undefined;
    if (editingRow) {
      setSavingId(editingRow.id);
      const res = await fetch(`/api/pnl-lines/${editingRow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          gross_revenue: gross,
          ...(net != null && { net_revenue: net }),
          notes_issues: payload.notes_issues ?? '',
        }),
      });
      setSavingId(null);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Update failed');
        return;
      }
      closeModal();
      load();
      onRefresh?.();
    } else {
      const res = await fetch(`/api/models/${modelId}/earnings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          month_id: payload.month_id,
          gross_revenue: gross,
          ...(net != null && { net_revenue: net }),
          notes_issues: payload.notes_issues ?? '',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Failed to add revenue');
        return;
      }
      closeModal();
      load();
      onRefresh?.();
    }
  }

  async function handleDelete(recordId: string) {
    setError(null);
    const res = await fetch(`/api/pnl-lines/${recordId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ gross_revenue: 0, net_revenue: 0, notes_issues: '' }),
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

  const headerRow = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Revenue (PnL actual)
      </h2>
      {canEdit && (
        <button
          type="button"
          className="btn-primary rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
          onClick={openAdd}
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
        <p className="text-sm text-[var(--text-muted)]">Select a month above to view or add revenue.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
      {headerRow}
      {error && (
        <div className="mb-3 rounded-lg border border-[var(--red)]/50 bg-[var(--red-dim)] px-3 py-2 text-sm text-[var(--red)]" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      ) : row ? (
        <>
          <div className="mb-4 flex flex-wrap gap-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg)] px-3 py-2">
            <div>
              <p className="text-[10px] uppercase text-[var(--text-muted)]">Gross revenue (USD)</p>
              <p className="tabular-nums text-lg font-semibold text-[var(--text)]">
                {formatUsdFull(row.gross_revenue)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-[var(--text-muted)]">Net revenue (USD)</p>
              <p className="tabular-nums text-lg font-semibold text-[var(--text)]">
                {formatUsdFull(row.net_revenue ?? 0)}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
            <table className="w-full min-w-[320px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase text-[var(--text-muted)]">Gross revenue</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase text-[var(--text-muted)]">Net revenue</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-[var(--text-muted)]">Notes</th>
                  {canEdit && <th className="w-32 px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-elevated)]/50">
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--text)]">
                    {formatUsdFull(row.gross_revenue)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--text)]">
                    {formatUsdFull(row.net_revenue ?? 0)}
                  </td>
                  <td className="px-3 py-2 text-left text-[var(--text)]">
                    {row.notes_issues ?? '—'}
                  </td>
                  {canEdit && (
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="text-xs font-medium text-[var(--purple-400)] hover:underline"
                          onClick={() => openEdit(row)}
                        >
                          Edit
                        </button>
                        {deleteConfirm === row.id ? (
                          <>
                            <button type="button" className="text-xs text-[var(--red)] hover:underline" onClick={() => handleDelete(row.id)}>Confirm</button>
                            <button type="button" className="text-xs text-[var(--text-muted)] hover:underline" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                          </>
                        ) : (
                          <button type="button" className="text-xs text-[var(--text-muted)] hover:text-[var(--red)]" onClick={() => setDeleteConfirm(row.id)}>Clear</button>
                        )}
                      </span>
                    </td>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="py-6 text-center text-sm text-[var(--text-muted)]">No revenue for this month. Click &quot;Add revenue&quot; to create.</p>
      )}
      {modalOpen && (
        <AddEditRevenueModal
          modelId={modelId}
          mode={editingRow ? 'edit' : 'add'}
          initialMonthId={editingRow?.month_id ?? monthId}
          initialGross={editingRow?.gross_revenue ?? 0}
          initialNet={editingRow?.net_revenue ?? (editingRow ? undefined : undefined)}
          initialNotes={editingRow?.notes_issues ?? ''}
          onSave={handleSave}
          onClose={closeModal}
          busy={!!savingId}
        />
      )}
    </div>
  );
}

function AddEditRevenueModal({
  modelId,
  mode,
  initialMonthId,
  initialGross,
  initialNet,
  initialNotes,
  onSave,
  onClose,
  busy,
}: {
  modelId: string;
  mode: 'add' | 'edit';
  initialMonthId: string;
  initialGross: number;
  initialNet?: number;
  initialNotes: string;
  onSave: (payload: { month_id: string; gross_revenue: number; net_revenue?: number; notes_issues?: string }) => Promise<void>;
  onClose: () => void;
  busy: boolean;
}) {
  const [months, setMonths] = useState<{ id: string; month_key: string; month_name: string }[]>([]);
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [monthId, setMonthId] = useState(initialMonthId);
  const [feePct, setFeePct] = useState(20);
  const [lastEdited, setLastEdited] = useState<'gross' | 'net' | null>(
    initialGross > 0 ? 'gross' : initialNet != null && initialNet > 0 ? 'net' : null
  );
  const [amountGross, setAmountGross] = useState(initialGross > 0 ? String(initialGross) : '');
  const [amountNet, setAmountNet] = useState(
    initialNet != null && Number.isFinite(initialNet)
      ? String(Math.round(initialNet * 100) / 100)
      : initialGross > 0
        ? String(Math.round(initialGross * 0.8 * 100) / 100)
        : ''
  );
  const [notes, setNotes] = useState(initialNotes);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const feeFactor = 1 - feePct / 100;
  const isFeeValid = feePct > 0 && feePct < 100;
  const feeError = !isFeeValid ? 'Platform fee must be between 0 and 100' : null;

  useEffect(() => {
    fetch('/api/months', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((arr: { id: string; month_key: string; month_name: string }[]) => {
        const list = Array.isArray(arr) ? arr : [];
        setMonths(list);
        if (list.length > 0 && mode === 'add' && !initialMonthId) {
          const defaultId = pickDefaultMonthId(list.map((m) => ({ id: m.id, month_key: m.month_key })), getCurrentMonthKey());
          setMonthId(defaultId ?? list[0]!.id);
        } else if (initialMonthId) {
          setMonthId(initialMonthId);
        }
      })
      .catch(() => setMonths([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount; initialMonthId/mode set monthId when modal opens
  }, []);
  useEffect(() => {
    if (mode === 'edit' && initialMonthId) setMonthId(initialMonthId);
    else if (mode === 'add' && initialMonthId) setMonthId(initialMonthId);
  }, [mode, initialMonthId]);

  useEffect(() => {
    fetch('/api/fx/usd-eur', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { rate?: number } | null) => {
        const rate = typeof data?.rate === 'number' && data.rate > 0 ? data.rate : null;
        setFxRate(rate);
      })
      .catch(() => setFxRate(null));
  }, []);

  useEffect(() => {
    if (!isFeeValid || feeFactor <= 0) return;
    if (lastEdited === 'gross') {
      const g = Number(amountGross);
      if (Number.isFinite(g) && g >= 0) setAmountNet(String(Math.round(g * feeFactor * 100) / 100));
      else setAmountNet('');
    } else if (lastEdited === 'net') {
      const n = Number(amountNet);
      if (Number.isFinite(n) && n >= 0) setAmountGross(String(Math.round((n / feeFactor) * 100) / 100));
      else setAmountGross('');
    }
    // Only re-derive when fee % changes; gross/net updates are handled in onChange
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feePct]);

  const grossNum = Number(amountGross);
  const netNum = Number(amountNet);
  const isValidGross = Number.isFinite(grossNum) && grossNum >= 0;
  const netToUse = Number.isFinite(netNum) && netNum >= 0 ? netNum : isValidGross ? Math.round(grossNum * feeFactor * 100) / 100 : 0;
  const netEur = fxRate != null && fxRate > 0 ? Math.round(netToUse * fxRate * 100) / 100 : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!monthId) {
      setError('Month is required');
      return;
    }
    if (!isFeeValid) {
      setError('Platform fee must be between 0 and 100');
      return;
    }
    const gross = Number(amountGross);
    if (!Number.isFinite(gross) || gross < 0) {
      setError('Gross amount must be ≥ 0');
      return;
    }
    const net = Number.isFinite(netNum) && netNum >= 0 ? Math.round(netNum * 100) / 100 : undefined;
    await onSave({
      month_id: monthId,
      gross_revenue: Math.round(gross * 100) / 100,
      net_revenue: net,
      notes_issues: notes.trim() || undefined,
    });
  };

  return (
    <SheetForm
      open={true}
      onOpenChange={(open) => !open && onClose()}
      title={mode === 'edit' ? 'Edit revenue' : 'Add revenue'}
      subtitle="Amounts in USD. EUR preview uses current FX rate."
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => formRef.current?.requestSubmit()}
            disabled={busy || !isFeeValid}
            className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--border-subtle)] disabled:opacity-50"
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
            disabled={mode === 'edit'}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]"
          >
            <option value="">Select month</option>
            {months.map((m) => (
              <option key={m.id} value={m.id}>
                {formatMonthLabel(m.month_key) || m.month_key}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Platform fee %</label>
          <input
            type="number"
            step="any"
            min={0}
            max={100}
            value={feePct}
            onChange={(e) => setFeePct(Number(e.target.value))}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm tabular-nums text-[var(--text)]"
          />
          {feeError && <p className="mt-1 text-xs text-[var(--red)]">{feeError}</p>}
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">Net = Gross × (1 − fee/100). Stored in UI only.</p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Gross revenue (USD) *</label>
          <input
            type="number"
            step="any"
            min={0}
            value={amountGross}
            onChange={(e) => {
              const v = e.target.value;
              setAmountGross(v);
              setLastEdited('gross');
              const g = Number(v);
              if (Number.isFinite(g) && g >= 0 && isFeeValid)
                setAmountNet(String(Math.round(g * feeFactor * 100) / 100));
              else setAmountNet('');
            }}
            required
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm tabular-nums text-[var(--text)]"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Net revenue (USD)</label>
          <input
            type="number"
            step="any"
            min={0}
            value={amountNet}
            onChange={(e) => {
              const v = e.target.value;
              setAmountNet(v);
              setLastEdited('net');
              const n = Number(v);
              if (Number.isFinite(n) && n >= 0 && isFeeValid && feeFactor > 0)
                setAmountGross(String(Math.round((n / feeFactor) * 100) / 100));
              else setAmountGross('');
            }}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm tabular-nums text-[var(--text)]"
          />
          {(netToUse > 0 || netEur != null) && (
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--text-muted)] tabular-nums">
              {netEur != null && <span>{formatEurFull(netEur)} EUR</span>}
            </div>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)]"
            placeholder="Optional"
          />
        </div>
      </form>
    </SheetForm>
  );
}
