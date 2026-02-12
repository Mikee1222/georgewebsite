'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/client-fetch';
import SheetForm from '@/app/components/ui/SheetForm';
import FormRow from '@/app/components/ui/FormRow';
import SmartSelect from '@/app/components/ui/SmartSelect';
import GlassCard from '@/app/components/ui/GlassCard';
import Toolbar from '@/app/components/ui/Toolbar';
import EmptyState from '@/app/components/ui/EmptyState';
import ErrorState from '@/app/components/ui/ErrorState';
import TableSkeleton from '@/app/components/ui/TableSkeleton';
import { tableWrapper, tableBase, theadTr, thBase, thRight, tbodyTr, tdBase, tdRight } from '@/app/components/ui/table-styles';
import * as Dialog from '@radix-ui/react-dialog';

interface AffiliateDeal {
  id: string;
  affiliator_id: string;
  model_id: string;
  percentage: number;
  basis: 'net' | 'gross';
  is_active: boolean;
  start_month_id?: string;
  end_month_id?: string;
  notes?: string;
}

interface TeamMemberOption {
  id: string;
  name: string;
  department?: string;
  role?: string;
}

interface ModelOption {
  id: string;
  name: string;
}

interface MonthOption {
  id: string;
  month_key: string;
  month_name?: string;
}

const DEFAULT_DEAL_FORM = {
  affiliator_id: '',
  model_id: '',
  percentage: '',
  basis: 'net' as 'net' | 'gross',
  is_active: true,
  start_month_id: '',
  end_month_id: '',
  notes: '',
};

function formatPct(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '—';
}

export default function AffiliateDealsPage() {
  const [deals, setDeals] = useState<AffiliateDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; requestId: string | null } | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMemberOption[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [months, setMonths] = useState<MonthOption[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(DEFAULT_DEAL_FORM);
  const [addBusy, setAddBusy] = useState(false);
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});
  const [editDeal, setEditDeal] = useState<AffiliateDeal | null>(null);
  const [editForm, setEditForm] = useState(DEFAULT_DEAL_FORM);
  const [editBusy, setEditBusy] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const loadDeals = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<AffiliateDeal[]>('/api/affiliate-deals')
      .then(({ ok, data }) => {
        if (!ok) {
          setError({ message: (data as { error?: string })?.error ?? 'Failed to load deals', requestId: null });
          setDeals([]);
          return;
        }
        setDeals(Array.isArray(data) ? data : []);
      })
      .catch((e) => {
        setError({ message: e instanceof Error ? e.message : 'Failed to load deals', requestId: null });
        setDeals([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadDeals();
  }, [loadDeals]);

  useEffect(() => {
    fetch('/api/team-members', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list: TeamMemberOption[]) => {
        const affiliators = Array.isArray(list)
          ? list.filter((m) => (m.department ?? '').toLowerCase() === 'affiliate' || (m.role ?? '').toLowerCase() === 'affiliator')
          : [];
        setTeamMembers(affiliators.map((m) => ({ id: m.id, name: m.name || m.id, department: m.department, role: m.role })));
      })
      .catch(() => setTeamMembers([]));
  }, []);

  useEffect(() => {
    fetch('/api/models', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list: ModelOption[]) => setModels(Array.isArray(list) ? list : []))
      .catch(() => setModels([]));
  }, []);

  useEffect(() => {
    fetch('/api/months', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list: MonthOption[]) => setMonths(Array.isArray(list) ? list : []))
      .catch(() => setMonths([]));
  }, []);

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  const affiliatorOptions = teamMembers.map((m) => ({ value: m.id, label: m.name || m.id }));
  const modelOptions = models.map((m) => ({ value: m.id, label: m.name || m.id }));
  const monthOptions = months.map((m) => ({ value: m.id, label: m.month_name || m.month_key || m.id }));

  function getAffiliatorName(id: string): string {
    return teamMembers.find((m) => m.id === id)?.name ?? id;
  }
  function getModelName(id: string): string {
    return models.find((m) => m.id === id)?.name ?? id;
  }
  function getMonthLabel(id: string): string {
    return months.find((m) => m.id === id)?.month_name ?? months.find((m) => m.id === id)?.month_key ?? id;
  }

  const addFormCanSave =
    !addBusy &&
    addForm.affiliator_id.trim() !== '' &&
    addForm.model_id.trim() !== '' &&
    (() => {
      const p = parseFloat(addForm.percentage);
      return addForm.percentage.trim() !== '' && !Number.isNaN(p) && p >= 0 && p <= 100;
    })();
  const editFormCanSave =
    !editBusy &&
    !!editDeal &&
    editForm.affiliator_id.trim() !== '' &&
    editForm.model_id.trim() !== '' &&
    (() => {
      const p = parseFloat(editForm.percentage);
      return editForm.percentage.trim() !== '' && !Number.isNaN(p) && p >= 0 && p <= 100;
    })();

  function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!addForm.affiliator_id.trim()) err.affiliator_id = 'Affiliator is required';
    if (!addForm.model_id.trim()) err.model_id = 'Model is required';
    const pct = addForm.percentage.trim() ? parseFloat(addForm.percentage) : NaN;
    if (Number.isNaN(pct) || pct < 0 || pct > 100) err.percentage = 'Percentage must be 0–100 (2 decimals)';
    setAddErrors(err);
    if (Object.keys(err).length) return;

    setAddBusy(true);
    const payload = {
      affiliator_id: addForm.affiliator_id.trim(),
      model_id: addForm.model_id.trim(),
      percentage: Math.round(pct * 100) / 100,
      basis: 'net' as const,
      is_active: addForm.is_active,
      start_month_id: addForm.start_month_id.trim() || undefined,
      end_month_id: addForm.end_month_id.trim() || undefined,
      notes: addForm.notes?.trim() || undefined,
    };
    fetch('/api/affiliate-deals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    })
      .then((r) => r.json().catch(() => ({})))
      .then((data: AffiliateDeal | { error?: string }) => {
        if ((data as { error?: string }).error) {
          showToast((data as { error: string }).error, 'error');
          return;
        }
        setAddOpen(false);
        setAddForm(DEFAULT_DEAL_FORM);
        setAddErrors({});
        showToast('Deal saved (upserted by affiliator + model)', 'success');
        loadDeals();
      })
      .finally(() => setAddBusy(false));
  }

  function openEdit(deal: AffiliateDeal) {
    setEditDeal(deal);
    setEditForm({
      affiliator_id: deal.affiliator_id,
      model_id: deal.model_id,
      percentage: String(deal.percentage),
      basis: deal.basis,
      is_active: deal.is_active,
      start_month_id: deal.start_month_id ?? '',
      end_month_id: deal.end_month_id ?? '',
      notes: deal.notes ?? '',
    });
  }

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editDeal) return;
    const pct = editForm.percentage.trim() ? parseFloat(editForm.percentage) : NaN;
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      showToast('Percentage must be 0–100', 'error');
      return;
    }

    setEditBusy(true);
    const payload = {
      affiliator_id: editForm.affiliator_id.trim(),
      model_id: editForm.model_id.trim(),
      percentage: Math.round(pct * 100) / 100,
      basis: (editForm.basis || 'net') as 'net' | 'gross',
      is_active: editForm.is_active,
      start_month_id: editForm.start_month_id.trim() || null,
      end_month_id: editForm.end_month_id.trim() || null,
      notes: editForm.notes?.trim() ?? '',
    };
    fetch(`/api/affiliate-deals/${editDeal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    })
      .then((r) => r.json().catch(() => ({})))
      .then((data: AffiliateDeal | { error?: string }) => {
        if ((data as { error?: string }).error) {
          showToast((data as { error: string }).error, 'error');
          return;
        }
        setEditDeal(null);
        showToast('Deal updated', 'success');
        loadDeals();
      })
      .finally(() => setEditBusy(false));
  }

  function handleDeleteConfirm() {
    if (!deleteId) return;
    setDeleteBusy(true);
    fetch(`/api/affiliate-deals/${deleteId}`, { method: 'DELETE', credentials: 'include' })
      .then((r) => {
        if (r.status === 204 || r.ok) {
          setDeleteId(null);
          showToast('Deal deleted', 'success');
          loadDeals();
        } else return r.json();
      })
      .then((data) => {
        if (data && (data as { error?: string }).error) showToast((data as { error: string }).error, 'error');
      })
      .finally(() => setDeleteBusy(false));
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <Toolbar>
        <div className="flex flex-1 flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-white">Affiliate deals</h1>
            <p className="text-sm text-white/70">Configure affiliate–model deals (percentage, basis). Upserted by affiliator + model.</p>
          </div>
          <button
            type="button"
            onClick={() => { setAddOpen(true); setAddForm(DEFAULT_DEAL_FORM); setAddErrors({}); }}
            className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20"
          >
            Add deal
          </button>
        </div>
      </Toolbar>

      {toast && (
        <div
          className={`rounded-lg px-4 py-2 text-sm ${toast.type === 'success' ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}
          role="alert"
        >
          {toast.message}
        </div>
      )}

      {error && (
        <ErrorState title={error.message} description="Try again or check your connection." requestId={error.requestId ?? undefined} />
      )}

      {!error && loading && (
        <GlassCard className="p-4">
          <TableSkeleton rows={5} cols={6} />
        </GlassCard>
      )}

      {!error && !loading && deals.length === 0 && (
        <GlassCard className="p-8">
          <EmptyState
            title="No affiliate deals"
            description="Add a deal to link an affiliator to a model with a percentage and basis (net/gross)."
            ctaText="Add deal"
            onCta={() => { setAddOpen(true); setAddForm(DEFAULT_DEAL_FORM); }}
          />
        </GlassCard>
      )}

      {!error && !loading && deals.length > 0 && (
        <GlassCard className="overflow-hidden p-0">
          <div className={tableWrapper}>
            <table className={tableBase}>
              <thead>
                <tr className={theadTr}>
                  <th className={`${thBase} py-2.5 px-4`}>Affiliator</th>
                  <th className={`${thBase} py-2.5 px-4`}>Model</th>
                  <th className={`${thRight} py-2.5 px-4`}>%</th>
                  <th className={`${thBase} py-2.5 px-4`}>Active</th>
                  <th className={`${thBase} py-2.5 px-4`}>Period</th>
                  <th className={`${thBase} py-2.5 px-4`}>Notes</th>
                  <th className={`${thBase} py-2.5 px-4 text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((d) => {
                  const periodText = d.start_month_id || d.end_month_id
                    ? `${d.start_month_id ? getMonthLabel(d.start_month_id) : '…'} – ${d.end_month_id ? getMonthLabel(d.end_month_id) : '…'}`
                    : '—';
                  return (
                    <tr key={d.id} className={tbodyTr}>
                      <td className={`${tdBase} px-4 py-3`}>{getAffiliatorName(d.affiliator_id)}</td>
                      <td className={`${tdBase} px-4 py-3`}>{getModelName(d.model_id)}</td>
                      <td className={`${tdRight} px-4 py-3`}>{formatPct(d.percentage)}</td>
                      <td className={`${tdBase} px-4 py-3`}>{d.is_active ? 'Yes' : 'No'}</td>
                      <td className={`${tdBase} px-4 py-3 max-w-[12rem] overflow-hidden text-ellipsis whitespace-nowrap`} title={periodText}>
                        {periodText}
                      </td>
                      <td className={`${tdBase} px-4 py-3 max-w-[10rem] overflow-hidden text-ellipsis whitespace-nowrap`} title={d.notes ?? undefined}>
                        {d.notes?.slice(0, 30) ?? '—'}{d.notes && d.notes.length > 30 ? '…' : ''}
                      </td>
                      <td className={`${tdBase} px-4 py-3 text-right`}>
                        <button
                          type="button"
                          onClick={() => openEdit(d)}
                          className="text-white/80 hover:text-white underline"
                        >
                          Edit
                        </button>
                        {' · '}
                        <button
                          type="button"
                          onClick={() => setDeleteId(d.id)}
                          className="text-red-400 hover:text-red-300 underline"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      <SheetForm
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add affiliate deal"
        subtitle="Upsert by affiliator + model (same pair updates existing)."
        className="md:w-[540px]"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAddOpen(false)} className="rounded-lg px-4 py-2 text-white/80 hover:bg-white/10">
              Cancel
            </button>
            <button type="submit" form="affiliate-deal-add-form" disabled={!addFormCanSave} className="rounded-lg bg-white/20 px-4 py-2 text-white disabled:opacity-50 hover:enabled:bg-white/30">
              {addBusy ? 'Saving…' : 'Save'}
            </button>
          </div>
        }
      >
        <form id="affiliate-deal-add-form" onSubmit={handleAddSubmit} className="space-y-3">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
            <FormRow label="Affiliator" error={addErrors.affiliator_id} className="min-w-0">
              <SmartSelect
                value={addForm.affiliator_id}
                onChange={(v) => setAddForm((f) => ({ ...f, affiliator_id: v }))}
                options={affiliatorOptions}
                placeholder="Select affiliator"
              />
            </FormRow>
            <FormRow label="Model" error={addErrors.model_id} className="min-w-0">
              <SmartSelect
                value={addForm.model_id}
                onChange={(v) => setAddForm((f) => ({ ...f, model_id: v }))}
                options={modelOptions}
                placeholder="Select model"
              />
            </FormRow>
          </div>
          <FormRow label="Percentage (0–100)" error={addErrors.percentage}>
            <div className="relative">
              <input
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={addForm.percentage}
                onChange={(e) => setAddForm((f) => ({ ...f, percentage: e.target.value }))}
                className="w-full rounded-lg border border-white/20 bg-white/5 py-2 pl-3 pr-8 text-white placeholder:text-white/40"
                placeholder="e.g. 10.50"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-white/50">%</span>
            </div>
          </FormRow>
          <div className="space-y-1 py-0.5">
            <span className="text-xs font-medium text-white/70">Active</span>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={addForm.is_active}
                onChange={(e) => setAddForm((f) => ({ ...f, is_active: e.target.checked }))}
                className="rounded border-white/20"
              />
              <span className="text-sm text-white/90">Deal is active</span>
            </label>
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
            <FormRow label="Start month (optional)" className="min-w-0">
              <SmartSelect
                value={addForm.start_month_id}
                onChange={(v) => setAddForm((f) => ({ ...f, start_month_id: v }))}
                options={[{ value: '', label: '—' }, ...monthOptions]}
                placeholder="Optional"
              />
            </FormRow>
            <FormRow label="End month (optional)" className="min-w-0">
              <SmartSelect
                value={addForm.end_month_id}
                onChange={(v) => setAddForm((f) => ({ ...f, end_month_id: v }))}
                options={[{ value: '', label: '—' }, ...monthOptions]}
                placeholder="Optional"
              />
            </FormRow>
          </div>
          <FormRow label="Notes (optional)">
            <textarea
              value={addForm.notes}
              onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-white placeholder:text-white/40"
              placeholder="Optional notes"
            />
          </FormRow>
        </form>
      </SheetForm>

      <SheetForm
        open={!!editDeal}
        onOpenChange={(open) => !open && setEditDeal(null)}
        title="Edit affiliate deal"
        className="md:w-[540px]"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditDeal(null)} className="rounded-lg px-4 py-2 text-white/80 hover:bg-white/10">
              Cancel
            </button>
            <button type="submit" form="affiliate-deal-edit-form" disabled={!editFormCanSave} className="rounded-lg bg-white/20 px-4 py-2 text-white disabled:opacity-50 hover:enabled:bg-white/30">
              {editBusy ? 'Saving…' : 'Save'}
            </button>
          </div>
        }
      >
        {editDeal && (
          <form id="affiliate-deal-edit-form" onSubmit={handleEditSubmit} className="space-y-3">
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
              <FormRow label="Affiliator" className="min-w-0">
                <SmartSelect
                  value={editForm.affiliator_id}
                  onChange={(v) => setEditForm((f) => ({ ...f, affiliator_id: v }))}
                  options={affiliatorOptions}
                  placeholder="Select affiliator"
                />
              </FormRow>
              <FormRow label="Model" className="min-w-0">
                <SmartSelect
                  value={editForm.model_id}
                  onChange={(v) => setEditForm((f) => ({ ...f, model_id: v }))}
                  options={modelOptions}
                  placeholder="Select model"
                />
              </FormRow>
            </div>
            <FormRow label="Percentage (0–100)">
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={editForm.percentage}
                  onChange={(e) => setEditForm((f) => ({ ...f, percentage: e.target.value }))}
                  className="w-full rounded-lg border border-white/20 bg-white/5 py-2 pl-3 pr-8 text-white placeholder:text-white/40"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-white/50">%</span>
              </div>
            </FormRow>
            <div className="space-y-1 py-0.5">
              <span className="text-xs font-medium text-white/70">Active</span>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={editForm.is_active}
                  onChange={(e) => setEditForm((f) => ({ ...f, is_active: e.target.checked }))}
                  className="rounded border-white/20"
                />
                <span className="text-sm text-white/90">Deal is active</span>
              </label>
            </div>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
              <FormRow label="Start month (optional)" className="min-w-0">
                <SmartSelect
                  value={editForm.start_month_id}
                  onChange={(v) => setEditForm((f) => ({ ...f, start_month_id: v }))}
                  options={[{ value: '', label: '—' }, ...monthOptions]}
                />
              </FormRow>
              <FormRow label="End month (optional)" className="min-w-0">
                <SmartSelect
                  value={editForm.end_month_id}
                  onChange={(v) => setEditForm((f) => ({ ...f, end_month_id: v }))}
                  options={[{ value: '', label: '—' }, ...monthOptions]}
                />
              </FormRow>
            </div>
            <FormRow label="Notes (optional)">
              <textarea
                value={editForm.notes}
                onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-white placeholder:text-white/40"
              />
            </FormRow>
          </form>
        )}
      </SheetForm>

      <Dialog.Root open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/10 bg-zinc-900 p-6 text-white shadow-xl">
            <Dialog.Title className="text-lg font-semibold">Delete deal?</Dialog.Title>
            <p className="mt-2 text-sm text-white/70">This cannot be undone.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteId(null)} className="rounded-lg px-4 py-2 text-white/80 hover:bg-white/10">
                Cancel
              </button>
              <button type="button" onClick={handleDeleteConfirm} disabled={deleteBusy} className="rounded-lg bg-red-500/20 px-4 py-2 text-red-300 hover:bg-red-500/30 disabled:opacity-50">
                {deleteBusy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
