'use client';

import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { formatEurFull } from '@/lib/format';
import { apiFetch } from '@/lib/client-fetch';
import type { TeamMember } from '@/lib/types';
import { SELECT_ALL, selectValueForQuery } from '@/lib/select-constants';
import {
  ROLES,
  DEPARTMENTS,
  getDepartmentForRole,
  getCompensationConfigForRole,
  roleHasCompensationSection,
  showLinkedModels,
  showAffiliateSection,
  type RoleValue,
} from '@/lib/team-member-form';
import EmptyState from '@/app/components/ui/EmptyState';
import ErrorState from '@/app/components/ui/ErrorState';
import TableSkeleton from '@/app/components/ui/TableSkeleton';
import SmartSelect from '@/app/components/ui/SmartSelect';
import FormRow from '@/app/components/ui/FormRow';
import { tableWrapper, tableBase, theadTr, thBase, thRight, tbodyTr, tdBase, tdRight, tdMuted } from '@/app/components/ui/table-styles';

const STATUSES = ['active', 'inactive'] as const;

interface AddFormState {
  name: string;
  email: string;
  role: RoleValue;
  department: string;
  status: string;
  notes: string;
  // Legacy comp_percentage kept for edit modal compatibility; Add flow uses payout_percentage_chatters instead.
  comp_percentage: string;
  // Chatter-specific payout %
  payout_percentage_chatters: string;
  // Manager/bucket-based payout %
  chatting_percentage: string;
  chatting_percentage_messages_tips: string;
  gunzo_percentage: string;
  gunzo_percentage_messages_tips: string;
  // Flat fee (all roles that use it)
  comp_flat_fee: string;
  model_ids: string[];
  /** Linked models (optional) — multi-select; sent as linked_models to API. */
  linked_model_ids: string[];
  /** Affiliator percentage (%) — only when role === affiliator or department === affiliate. */
  affiliator_percentage: string;
  /** Assigned models (affiliate only); persisted via model_assignments. */
  assigned_model_ids: string[];
}

const emptyAddForm = (): AddFormState => ({
  name: '',
  email: '',
  role: 'chatter',
  department: getDepartmentForRole('chatter'),
  status: 'active',
  notes: '',
  comp_percentage: '',
  payout_percentage_chatters: '',
  chatting_percentage: '',
  chatting_percentage_messages_tips: '',
  gunzo_percentage: '',
  gunzo_percentage_messages_tips: '',
  comp_flat_fee: '',
  model_ids: [],
  linked_model_ids: [],
  affiliator_percentage: '',
  assigned_model_ids: [],
});

function MembersPageContent() {
  const searchParams = useSearchParams();
  const editIdFromUrl = searchParams.get('edit');
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [canManageMembers, setCanManageMembers] = useState(false);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState(SELECT_ALL);
  const [roleFilter, setRoleFilter] = useState(SELECT_ALL);
  const [statusFilter, setStatusFilter] = useState(SELECT_ALL);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(emptyAddForm());
  const [addBusy, setAddBusy] = useState(false);
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [editMember, setEditMember] = useState<TeamMember | null>(null);
  const [editForm, setEditForm] = useState<AddFormState>(emptyAddForm());
  const [editBusy, setEditBusy] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [error, setError] = useState<{ message: string; requestId: string | null } | null>(null);
  const loggedRef = useRef(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (search.trim()) params.set('q', search.trim());
    const dept = selectValueForQuery(departmentFilter);
    const role = selectValueForQuery(roleFilter);
    const status = selectValueForQuery(statusFilter);
    if (dept) params.set('department', dept);
    if (role) params.set('role', role);
    if (status) params.set('status', status);
    const url = `/api/team-members?${params.toString()}`;
    apiFetch<TeamMember[]>(url)
      .then(({ ok, data: d, requestId }) => {
        if (process.env.NODE_ENV === 'development' && !loggedRef.current) {
          console.log('[members] request', url);
          console.log('[members] response', { ok, requestId, sample: Array.isArray(d) ? (d as TeamMember[]).slice?.(0, 1) : null });
          loggedRef.current = true;
        }
        if (!ok) {
          setError({ message: (d as { error?: string })?.error ?? 'Failed to load members', requestId });
          setMembers([]);
          return;
        }
        setMembers(Array.isArray(d) ? d : []);
      })
      .catch((e) => {
        setError({ message: e instanceof Error ? e.message : 'Failed to load members', requestId: null });
        setMembers([]);
      })
      .finally(() => setLoading(false));
  }, [search, departmentFilter, roleFilter, statusFilter]);

  useEffect(() => {
    fetch('/api/me', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => setCanManageMembers((me as { canManageMembers?: boolean })?.canManageMembers ?? false))
      .catch(() => setCanManageMembers(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const needModelsForAdd =
    addOpen &&
    (addForm.role === 'chatting_manager' ||
      showLinkedModels(addForm.role, addForm.department) ||
      showAffiliateSection(addForm.role, addForm.department));
  const needModelsForEdit =
    !!editMember &&
    (editForm.role === 'chatting_manager' ||
      showLinkedModels(editForm.role, editForm.department) ||
      showAffiliateSection(editForm.role, editForm.department));
  useEffect(() => {
    if (needModelsForAdd || needModelsForEdit) {
      fetch('/api/models', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : []))
        .then((data: { id: string; name?: string }[]) => {
          setModels(Array.isArray(data) ? data.map((x) => ({ id: x.id, name: x.name ?? x.id })) : []);
        })
        .catch(() => setModels([]));
    } else {
      setModels([]);
    }
  }, [needModelsForAdd, needModelsForEdit]);

  useEffect(() => {
    if (!editIdFromUrl || !members.length) return;
    const m = members.find((x) => x.id === editIdFromUrl);
    if (m) openEdit(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openEdit is stable; only run when URL or members change
  }, [editIdFromUrl, members]);

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!addForm.name.trim()) err.name = 'Name is required';
    if (!addForm.email.trim()) err.email = 'Email is required';
    if (!addForm.role.trim()) err.role = 'Role is required';
    if (!addForm.department.trim()) err.department = 'Department is required';
    const compConfig = getCompensationConfigForRole(addForm.role);
    const isChatterFlow = addForm.role === 'chatter';

    // Chatter flow: single chatter payout %
    if (isChatterFlow && compConfig.percentage && !addForm.payout_percentage_chatters.trim()) {
      err.payout_percentage_chatters = 'Payout % (chatters) is required';
    }
    if (compConfig.flat_fee && !addForm.comp_flat_fee.trim()) err.comp_flat_fee = 'Flat fee is required';
    if ((addForm.department === 'affiliate' || addForm.role === 'affiliator') && addForm.affiliator_percentage.trim()) {
      const ap = Number(addForm.affiliator_percentage);
      if (Number.isNaN(ap) || ap < 0 || ap > 100) err.affiliator_percentage = 'Enter a valid percentage (0–100)';
    }
    const pctChatters = addForm.payout_percentage_chatters.trim()
      ? Number(addForm.payout_percentage_chatters)
      : NaN;
    const flat = addForm.comp_flat_fee.trim() ? Number(addForm.comp_flat_fee) : NaN;
    if (
      isChatterFlow &&
      compConfig.percentage &&
      addForm.payout_percentage_chatters.trim() &&
      (Number.isNaN(pctChatters) || pctChatters < 0 || pctChatters > 100)
    ) {
      err.payout_percentage_chatters = 'Enter a valid percentage (0–100)';
    }

    // Manager/bucket flow: 4 bucket %s, optional but must be 0–100 and not double-counted per agency
    if (!isChatterFlow && compConfig.percentage) {
      const chattingPct = addForm.chatting_percentage.trim() ? Number(addForm.chatting_percentage) : NaN;
      const chattingMsgsPct = addForm.chatting_percentage_messages_tips.trim()
        ? Number(addForm.chatting_percentage_messages_tips)
        : NaN;
      const gunzoPct = addForm.gunzo_percentage.trim() ? Number(addForm.gunzo_percentage) : NaN;
      const gunzoMsgsPct = addForm.gunzo_percentage_messages_tips.trim()
        ? Number(addForm.gunzo_percentage_messages_tips)
        : NaN;

      const hasChatting = addForm.chatting_percentage.trim();
      const hasChattingMsgs = addForm.chatting_percentage_messages_tips.trim();
      const hasGunzo = addForm.gunzo_percentage.trim();
      const hasGunzoMsgs = addForm.gunzo_percentage_messages_tips.trim();

      if (hasChatting && (Number.isNaN(chattingPct) || chattingPct < 0 || chattingPct > 100)) {
        err.chatting_percentage = 'Enter a valid percentage (0–100)';
      }
      if (hasChattingMsgs && (Number.isNaN(chattingMsgsPct) || chattingMsgsPct < 0 || chattingMsgsPct > 100)) {
        err.chatting_percentage_messages_tips = 'Enter a valid percentage (0–100)';
      }
      if (hasGunzo && (Number.isNaN(gunzoPct) || gunzoPct < 0 || gunzoPct > 100)) {
        err.gunzo_percentage = 'Enter a valid percentage (0–100)';
      }
      if (hasGunzoMsgs && (Number.isNaN(gunzoMsgsPct) || gunzoMsgsPct < 0 || gunzoMsgsPct > 100)) {
        err.gunzo_percentage_messages_tips = 'Enter a valid percentage (0–100)';
      }

      // Client-side double-counting guard
      if (chattingPct > 0 && chattingMsgsPct > 0) {
        err.chatting_percentage_messages_tips = 'Cannot use both total and messages+tips for chatting';
      }
      if (gunzoPct > 0 && gunzoMsgsPct > 0) {
        err.gunzo_percentage_messages_tips = 'Cannot use both total and messages+tips for gunzo';
      }
    }
    if (compConfig.flat_fee && addForm.comp_flat_fee.trim() && (Number.isNaN(flat) || flat < 0))
      err.comp_flat_fee = 'Enter a valid amount';
    setAddErrors(err);
    if (Object.keys(err).length > 0) return;
    setAddBusy(true);
    const payoutType = roleHasCompensationSection(addForm.role)
      ? (compConfig.kind as 'percentage' | 'flat_fee' | 'hybrid')
      : 'none';
    const isManagerBucketFlow = !isChatterFlow && compConfig.percentage;
    const payload = {
      name: addForm.name.trim(),
      email: addForm.email.trim(),
      role: addForm.role,
      department: addForm.department,
      status: addForm.status,
      notes: addForm.notes.trim() || undefined,
      payout_type: payoutType,
      payout_frequency: 'monthly' as const,
      linked_models: !showAffiliateSection(addForm.role, addForm.department) && addForm.linked_model_ids?.length ? addForm.linked_model_ids : undefined,
      assigned_model_ids: showAffiliateSection(addForm.role, addForm.department) ? (addForm.assigned_model_ids ?? []) : undefined,
      affiliator_percentage: (addForm.department === 'affiliate' || addForm.role === 'affiliator')
        ? Number(addForm.affiliator_percentage || 0)
        : undefined,
      // Chatter flow: single chatter % written to payout_percentage_chatters
      payout_percentage_chatters:
        isChatterFlow &&
        (payoutType === 'percentage' || payoutType === 'hybrid') &&
        addForm.payout_percentage_chatters.trim()
          ? Number(addForm.payout_percentage_chatters)
          : undefined,
      // Manager flow: 4 bucket % fields in EUR system
      chatting_percentage:
        isManagerBucketFlow && addForm.chatting_percentage.trim()
          ? Number(addForm.chatting_percentage)
          : undefined,
      chatting_percentage_messages_tips:
        isManagerBucketFlow && addForm.chatting_percentage_messages_tips.trim()
          ? Number(addForm.chatting_percentage_messages_tips)
          : undefined,
      gunzo_percentage:
        isManagerBucketFlow && addForm.gunzo_percentage.trim()
          ? Number(addForm.gunzo_percentage)
          : undefined,
      gunzo_percentage_messages_tips:
        isManagerBucketFlow && addForm.gunzo_percentage_messages_tips.trim()
          ? Number(addForm.gunzo_percentage_messages_tips)
          : undefined,
      // Flat fee remains as before, optional for flat_fee/hybrid
      payout_flat_fee:
        (payoutType === 'flat_fee' || payoutType === 'hybrid') && addForm.comp_flat_fee.trim()
          ? Number(addForm.comp_flat_fee)
          : undefined,
      models_scope: addForm.role === 'chatting_manager' && addForm.model_ids?.length ? addForm.model_ids : undefined,
    };
    if (process.env.NODE_ENV === 'development') {
      // Dev-only: inspect what Add team member sends to the API
      // Note: this payload is sent to POST /api/team-members
      // and then mapped to Airtable fields via createTeamMember in lib/airtable.ts.
      // Contains no secrets.
      console.log('[members] Add team member submit payload:', payload);
    }
    fetch('/api/team-members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (data.error) {
          setAddErrors({ submit: (data as { error: string }).error });
          return;
        }
        setAddOpen(false);
        setAddForm(emptyAddForm());
        setAddErrors({});
        showToast('Member created', 'success');
        load();
      })
      .finally(() => setAddBusy(false));
  }

  function openEdit(m: TeamMember) {
    setEditMember(m);
    const role = (m.role as RoleValue) ?? 'chatter';
    setEditForm({
      name: m.name ?? '',
      email: (m as TeamMember & { email?: string }).email ?? '',
      role,
      department: (m.department as string)?.trim() || getDepartmentForRole(role),
      status: (m.status as string) ?? 'active',
      notes: m.notes ?? '',
      comp_percentage: m.payout_percentage != null ? String(m.payout_percentage) : '',
      comp_flat_fee: m.payout_flat_fee != null ? String(m.payout_flat_fee) : '',
      payout_percentage_chatters: '',
      chatting_percentage: '',
      chatting_percentage_messages_tips: '',
      gunzo_percentage: '',
      gunzo_percentage_messages_tips: '',
      model_ids: Array.isArray(m.models_scope) ? m.models_scope : [],
      linked_model_ids: Array.isArray((m as TeamMember & { linked_models?: string[] }).linked_models) ? (m as TeamMember & { linked_models: string[] }).linked_models : [],
      affiliator_percentage: (m as TeamMember & { affiliator_percentage?: number }).affiliator_percentage != null ? String((m as TeamMember & { affiliator_percentage: number }).affiliator_percentage) : '',
      assigned_model_ids: Array.isArray((m as TeamMember & { assigned_model_ids?: string[] }).assigned_model_ids) ? (m as TeamMember & { assigned_model_ids: string[] }).assigned_model_ids : [],
    });
  }

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editMember) return;
    setEditBusy(true);
    const editCompConfig = getCompensationConfigForRole(editForm.role);
    const payoutType = roleHasCompensationSection(editForm.role) ? (editCompConfig.kind as 'percentage' | 'flat_fee' | 'hybrid') : 'none';
    const payload: Record<string, unknown> = {
      name: editForm.name.trim() || undefined,
      email: editForm.email.trim() || undefined,
      role: editForm.role || undefined,
      department: editForm.department || undefined,
      status: editForm.status || undefined,
      notes: editForm.notes.trim() || undefined,
      payout_type: payoutType,
      payout_frequency: 'monthly',
      linked_models: !showAffiliateSection(editForm.role, editForm.department) && editForm.linked_model_ids?.length ? editForm.linked_model_ids : undefined,
      assigned_model_ids: showAffiliateSection(editForm.role, editForm.department) ? (editForm.assigned_model_ids ?? []) : undefined,
      affiliator_percentage: (editForm.department === 'affiliate' || editForm.role === 'affiliator')
        ? Number(editForm.affiliator_percentage || 0)
        : undefined,
      payout_percentage: (payoutType === 'percentage' || payoutType === 'hybrid') && editForm.comp_percentage.trim() ? Number(editForm.comp_percentage) : undefined,
      payout_flat_fee: (payoutType === 'flat_fee' || payoutType === 'hybrid') && editForm.comp_flat_fee.trim() ? Number(editForm.comp_flat_fee) : undefined,
      models_scope: editForm.role === 'chatting_manager' ? (editForm.model_ids ?? []) : [],
    };
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
    if (Object.keys(payload).length === 0) {
      setEditBusy(false);
      return;
    }
    fetch(`/api/team-members/${editMember.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (data.error) {
          showToast((data as { error: string }).error, 'error');
          return;
        }
        setEditMember(null);
        showToast('Member updated', 'success');
        load();
      })
      .finally(() => setEditBusy(false));
  }

  function handleDelete() {
    if (!deleteId) return;
    setDeleteBusy(true);
    fetch(`/api/team-members/${deleteId}`, { method: 'DELETE', credentials: 'include' })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (data.error) showToast((data as { error: string }).error, 'error');
        else {
          setDeleteId(null);
          showToast('Member deleted', 'success');
          load();
        }
      })
      .finally(() => setDeleteBusy(false));
  }

  return (
    <div className="min-h-full">
      <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
        <div className="card-hero rounded-2xl border border-white/10 bg-white/5 px-6 py-5 shadow-lg shadow-black/30 backdrop-blur-xl">
          <h1 className="text-2xl font-bold tracking-tight text-white/95">Members</h1>
          <p className="mt-1.5 text-sm text-white/60">Team directory and roles</p>
        </div>
        {error && (
          <ErrorState title="Could not load members" description={error.message} requestId={error.requestId ?? undefined} />
        )}

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 shadow-lg backdrop-blur-md">
          <input
            type="search"
            placeholder="Search name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="glass-input w-48"
          />
          <span className="text-sm text-white/70">Department</span>
          <SmartSelect
            value={departmentFilter}
            onChange={setDepartmentFilter}
            options={[{ value: SELECT_ALL, label: 'All' }, ...DEPARTMENTS.map((d) => ({ value: d, label: d }))]}
            placeholder="All"
          />
          <span className="text-sm text-white/70">Role</span>
          <SmartSelect
            value={roleFilter}
            onChange={setRoleFilter}
            options={[{ value: SELECT_ALL, label: 'All' }, ...ROLES.map((r) => ({ value: r, label: r }))]}
            placeholder="All"
          />
          <span className="text-sm text-white/70">Status</span>
          <SmartSelect
            value={statusFilter}
            onChange={setStatusFilter}
            options={[{ value: SELECT_ALL, label: 'All' }, ...STATUSES.map((s) => ({ value: s, label: s }))]}
            placeholder="All"
          />
          {canManageMembers && (
            <button
              type="button"
              onClick={() => { setAddOpen(true); setAddErrors({}); }}
              className="btn-primary ml-auto rounded-lg px-4 py-2 text-sm font-medium"
            >
              Add member
            </button>
          )}
        </div>

        {toast && (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              toast.type === 'success'
                ? 'border-[var(--green)]/50 bg-[var(--green-dim)] text-[var(--green)]'
                : 'border-[var(--red)]/50 bg-[var(--red-dim)] text-[var(--red)]'
            }`}
            role="status"
          >
            {toast.message}
          </div>
        )}

        {loading ? (
          <TableSkeleton rows={6} cols={8} />
        ) : error ? null : members.length === 0 ? (
          <EmptyState
            title="No members yet"
            description="Add your first team member to get started."
            ctaText={canManageMembers ? 'Add member' : undefined}
            onCta={canManageMembers ? () => setAddOpen(true) : undefined}
          />
        ) : (
          <div className={`overflow-x-auto ${tableWrapper}`}>
            <table className={`${tableBase} min-w-[800px]`}>
              <thead>
                <tr className={theadTr}>
                  <th className={`${thBase} text-left`}>Name</th>
                  <th className={`${thBase} text-left`}>Email</th>
                  <th className={`${thBase} text-left`}>Role</th>
                  <th className={`${thBase} text-left`}>Department</th>
                  <th className={`${thBase} text-left`}>Status</th>
                  <th className={thRight}>Monthly cost</th>
                  <th className={`${thBase} text-left max-w-[120px]`}>Notes</th>
                  {canManageMembers && <th className="w-24 px-4 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {members.map((m) => (
                  <tr key={m.id} className={tbodyTr}>
                    <td className={`${tdBase} font-medium`}>
                      <Link href={`/members/${m.id}`} className="text-purple-300 hover:underline">
                        {m.name}
                      </Link>
                    </td>
                    <td className={tdBase}>{(m as TeamMember & { email?: string }).email ?? '—'}</td>
                    <td className={tdBase}>{m.role ?? '—'}</td>
                    <td className={tdBase}>{m.department ?? '—'}</td>
                    <td className={`${tdBase} capitalize`}>{m.status ?? '—'}</td>
                    <td className={tdRight}>
                      {(m as TeamMember & { monthly_cost?: number }).monthly_cost != null
                        ? formatEurFull((m as TeamMember & { monthly_cost: number }).monthly_cost)
                        : '—'}
                    </td>
                    <td className={`max-w-[120px] ${tdMuted}`}>
                      <div className="truncate">{m.notes || '—'}</div>
                      {showAffiliateSection(m.role as string, m.department as string) && (
                        <span className="mt-1 inline-block rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70">
                          {(m as TeamMember & { assigned_model_ids?: string[] }).assigned_model_ids?.length
                            ? `affiliate: ${(m as TeamMember & { assigned_model_ids: string[] }).assigned_model_ids.length} models @ ${(m as TeamMember & { affiliator_percentage?: number }).affiliator_percentage ?? 0}%`
                            : 'affiliate: no models'}
                        </span>
                      )}
                    </td>
                    {canManageMembers && (
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => openEdit(m)} className="text-purple-300 hover:underline text-xs mr-2">
                          Edit
                        </button>
                        <button type="button" onClick={() => setDeleteId(m.id)} className="text-red-300 hover:underline text-xs">
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setAddOpen(false)}>
          <div
            className="w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-zinc-950/80 p-0 shadow-2xl shadow-black/40 backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-white/10 px-6 py-4">
              <h3 className="text-lg font-semibold text-white/95">Add team member</h3>
              <p className="mt-0.5 text-sm text-white/60">Role drives department and compensation</p>
            </div>
            <form onSubmit={handleAddSubmit} className="space-y-0">
              {/* Basic Info */}
              <section className="border-b border-white/10 px-6 py-4">
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/50">Basic info</h4>
                <div className="space-y-3">
                  <FormRow label="Name" required error={addErrors.name}>
                    <input
                      value={addForm.name}
                      onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                      className="glass-input w-full"
                      placeholder="Full name"
                    />
                  </FormRow>
                  <FormRow label="Email" required error={addErrors.email}>
                    <input
                      type="email"
                      value={addForm.email}
                      onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                      className="glass-input w-full"
                      placeholder="email@example.com"
                    />
                  </FormRow>
                  <FormRow label="Role" required error={addErrors.role}>
                    <SmartSelect
                      value={addForm.role}
                      onChange={(r) => {
                        const role = r as RoleValue;
                        setAddForm((f) => ({
                          ...f,
                          role,
                          department: getDepartmentForRole(role),
                          comp_percentage: '',
                          comp_flat_fee: '',
                          model_ids: [],
                          linked_model_ids: [],
                          affiliator_percentage: '',
                          assigned_model_ids: [],
                        }));
                      }}
                      options={ROLES.map((r) => ({ value: r, label: r.replace(/_/g, ' ') }))}
                      allowClear={false}
                    />
                  </FormRow>
                  <FormRow label="Department">
                    <input
                      value={addForm.department}
                      readOnly
                      disabled
                      className="glass-input w-full cursor-not-allowed opacity-80"
                      title="Derived from role"
                    />
                  </FormRow>
                </div>
              </section>

              {/* Affiliator percentage — only when department === affiliate OR role === affiliator (step 1: single field) */}
              {(addForm.department === 'affiliate' || addForm.role === 'affiliator') && (
                <section className="border-b border-white/10 px-6 py-4">
                  <FormRow label="Affiliator percentage (%)" error={addErrors.affiliator_percentage}>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={addForm.affiliator_percentage}
                      onChange={(e) => setAddForm((f) => ({ ...f, affiliator_percentage: e.target.value }))}
                      className="glass-input w-full"
                      placeholder="5"
                    />
                  </FormRow>
                </section>
              )}

              {/* Compensation — only after role selection; hidden for affiliator */}
              {roleHasCompensationSection(addForm.role) && (
                <section className="border-b border-white/10 px-6 py-4">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/50">Compensation</h4>
                  <div className="space-y-3">
                    {getCompensationConfigForRole(addForm.role).percentage && (
                      <>
                        {/* Chatter flow: single chatter % */}
                        {addForm.role === 'chatter' && (
                          <FormRow
                            label="Payout % (chatters)"
                            required={getCompensationConfigForRole(addForm.role).kind === 'percentage'}
                            error={addErrors.payout_percentage_chatters}
                          >
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step="0.01"
                              value={addForm.payout_percentage_chatters}
                              onChange={(e) =>
                                setAddForm((f) => ({ ...f, payout_percentage_chatters: e.target.value }))
                              }
                              className="glass-input w-full"
                              placeholder="0–100"
                            />
                          </FormRow>
                        )}
                        {/* Manager/bucket flow: 4 bucket %s */}
                        {addForm.role !== 'chatter' && (
                          <>
                            <FormRow
                              label="Chatting % (agency total net)"
                              error={addErrors.chatting_percentage}
                            >
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step="0.01"
                                value={addForm.chatting_percentage}
                                onChange={(e) =>
                                  setAddForm((f) => ({ ...f, chatting_percentage: e.target.value }))
                                }
                                className="glass-input w-full"
                                placeholder="0–100"
                              />
                            </FormRow>
                            <FormRow
                              label="Chatting % (messages+tips net)"
                              error={addErrors.chatting_percentage_messages_tips}
                            >
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step="0.01"
                                value={addForm.chatting_percentage_messages_tips}
                                onChange={(e) =>
                                  setAddForm((f) => ({
                                    ...f,
                                    chatting_percentage_messages_tips: e.target.value,
                                  }))
                                }
                                className="glass-input w-full"
                                placeholder="0–100"
                              />
                            </FormRow>
                            <FormRow
                              label="Gunzo % (agency total net)"
                              error={addErrors.gunzo_percentage}
                            >
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step="0.01"
                                value={addForm.gunzo_percentage}
                                onChange={(e) =>
                                  setAddForm((f) => ({ ...f, gunzo_percentage: e.target.value }))
                                }
                                className="glass-input w-full"
                                placeholder="0–100"
                              />
                            </FormRow>
                            <FormRow
                              label="Gunzo % (messages+tips net)"
                              error={addErrors.gunzo_percentage_messages_tips}
                            >
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step="0.01"
                                value={addForm.gunzo_percentage_messages_tips}
                                onChange={(e) =>
                                  setAddForm((f) => ({
                                    ...f,
                                    gunzo_percentage_messages_tips: e.target.value,
                                  }))
                                }
                                className="glass-input w-full"
                                placeholder="0–100"
                              />
                            </FormRow>
                          </>
                        )}
                      </>
                    )}
                    {getCompensationConfigForRole(addForm.role).flat_fee && (
                      <FormRow
                        label="Flat fee (€)"
                        required={getCompensationConfigForRole(addForm.role).kind === 'flat_fee'}
                        error={addErrors.comp_flat_fee}
                      >
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={addForm.comp_flat_fee}
                          onChange={(e) => setAddForm((f) => ({ ...f, comp_flat_fee: e.target.value }))}
                          className="glass-input w-full"
                          placeholder="0.00"
                        />
                      </FormRow>
                    )}
                  </div>
                </section>
              )}

              {/* Models scope — chatting_manager only */}
              {addForm.role === 'chatting_manager' && (
                <section className="border-b border-white/10 px-6 py-4">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/50">Models scope</h4>
                  <p className="mb-2 text-xs text-white/60">Optional: limit to specific models</p>
                  <div className="max-h-32 space-y-2 overflow-y-auto rounded-lg border border-white/10 bg-white/5 p-3">
                    {models.length === 0 ? (
                      <p className="text-xs text-white/50">Loading models…</p>
                    ) : (
                      models.map((model) => (
                        <label key={model.id} className="flex cursor-pointer items-center gap-2 text-sm text-white/90">
                          <input
                            type="checkbox"
                            checked={addForm.model_ids.includes(model.id)}
                            onChange={(e) => {
                              setAddForm((f) => ({
                                ...f,
                                model_ids: e.target.checked
                                  ? [...f.model_ids, model.id]
                                  : f.model_ids.filter((id) => id !== model.id),
                              }));
                            }}
                            className="rounded border-white/20 bg-white/10 text-[var(--accent)] focus:ring-[var(--accent)]"
                          />
                          {model.name}
                        </label>
                      ))
                    )}
                  </div>
                </section>
              )}

              {/* Linked models (optional) — chatter or va/manager with department marketing (not for affiliate) */}
              {showLinkedModels(addForm.role, addForm.department) && !showAffiliateSection(addForm.role, addForm.department) && (
                <section className="border-b border-white/10 px-6 py-4">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/50">Linked models (optional)</h4>
                  <div className="max-h-32 space-y-2 overflow-y-auto rounded-lg border border-white/10 bg-white/5 p-3">
                    {models.length === 0 ? (
                      <p className="text-xs text-white/50">Loading models…</p>
                    ) : (
                      models.map((model) => (
                        <label key={model.id} className="flex cursor-pointer items-center gap-2 text-sm text-white/90">
                          <input
                            type="checkbox"
                            checked={addForm.linked_model_ids.includes(model.id)}
                            onChange={(e) => {
                              setAddForm((f) => ({
                                ...f,
                                linked_model_ids: e.target.checked
                                  ? [...f.linked_model_ids, model.id]
                                  : f.linked_model_ids.filter((id) => id !== model.id),
                              }));
                            }}
                            className="rounded border-white/20 bg-white/10 text-[var(--accent)] focus:ring-[var(--accent)]"
                          />
                          {model.name}
                        </label>
                      ))
                    )}
                  </div>
                </section>
              )}

              {/* Meta */}
              <section className="border-b border-white/10 px-6 py-4">
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/50">Meta</h4>
                <div className="space-y-3">
                  <FormRow label="Status">
                    <SmartSelect
                      value={addForm.status}
                      onChange={(s) => setAddForm((f) => ({ ...f, status: s }))}
                      options={STATUSES.map((s) => ({ value: s, label: s }))}
                      allowClear={false}
                    />
                  </FormRow>
                  <FormRow label="Notes">
                    <input
                      value={addForm.notes}
                      onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))}
                      className="glass-input w-full"
                      placeholder="Optional notes"
                    />
                  </FormRow>
                </div>
              </section>

              {addErrors.submit && (
                <div className="px-6 py-2">
                  <p className="text-sm text-[var(--red)]">{addErrors.submit}</p>
                </div>
              )}
              <div className="flex gap-3 px-6 py-4">
                <button type="submit" className="btn-primary flex-1 rounded-xl py-2.5 text-sm font-medium" disabled={addBusy}>
                  {addBusy ? 'Creating…' : 'Create'}
                </button>
                <button type="button" onClick={() => setAddOpen(false)} className="btn rounded-xl py-2.5 text-sm">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setEditMember(null)}>
          <div
            className="w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-zinc-950/80 p-0 shadow-2xl shadow-black/40 backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-white/10 px-6 py-4">
              <h3 className="text-lg font-semibold text-white/95">Edit member</h3>
              <p className="mt-0.5 text-sm text-white/60">Role drives department</p>
            </div>
            <form onSubmit={handleEditSubmit} className="space-y-0">
              <section className="border-b border-white/10 px-6 py-4">
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/50">Basic info</h4>
                <div className="space-y-3">
                  <FormRow label="Name">
                    <input
                      value={editForm.name}
                      onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                      className="glass-input w-full"
                    />
                  </FormRow>
                  <FormRow label="Email">
                    <input
                      type="email"
                      value={editForm.email}
                      onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                      className="glass-input w-full"
                    />
                  </FormRow>
                  <FormRow label="Role">
                    <SmartSelect
                      value={editForm.role}
                      onChange={(r) => {
                        const role = r as RoleValue;
                        setEditForm((f) => ({
                          ...f,
                          role,
                          department: getDepartmentForRole(role),
                          comp_percentage: '',
                          comp_flat_fee: '',
                          model_ids: [],
                          linked_model_ids: [],
                          affiliator_percentage: '',
                          assigned_model_ids: [],
                        }));
                      }}
                      options={ROLES.map((r) => ({ value: r, label: r.replace(/_/g, ' ') }))}
                      allowClear={false}
                    />
                  </FormRow>
                  <FormRow label="Department">
                    <input
                      value={editForm.department}
                      readOnly
                      disabled
                      className="glass-input w-full cursor-not-allowed opacity-80"
                      title="Derived from role"
                    />
                  </FormRow>
                </div>
              </section>
              {/* Affiliator percentage — only when department === affiliate OR role === affiliator (step 1) */}
              {(editForm.department === 'affiliate' || editForm.role === 'affiliator') && (
                <section className="border-b border-white/10 px-6 py-4">
                  <FormRow label="Affiliator percentage (%)">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={editForm.affiliator_percentage}
                      onChange={(e) => setEditForm((f) => ({ ...f, affiliator_percentage: e.target.value }))}
                      className="glass-input w-full"
                      placeholder="5"
                    />
                  </FormRow>
                </section>
              )}
              {roleHasCompensationSection(editForm.role) && (
                <section className="border-b border-white/10 px-6 py-4">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/50">Compensation</h4>
                  <div className="space-y-3">
                    {getCompensationConfigForRole(editForm.role).percentage && (
                      <FormRow label="Percentage (%)">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="0.01"
                          value={editForm.comp_percentage}
                          onChange={(e) => setEditForm((f) => ({ ...f, comp_percentage: e.target.value }))}
                          className="glass-input w-full"
                          placeholder="0–100"
                        />
                      </FormRow>
                    )}
                    {getCompensationConfigForRole(editForm.role).flat_fee && (
                      <FormRow label="Flat fee (€)">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={editForm.comp_flat_fee}
                          onChange={(e) => setEditForm((f) => ({ ...f, comp_flat_fee: e.target.value }))}
                          className="glass-input w-full"
                          placeholder="0.00"
                        />
                      </FormRow>
                    )}
                  </div>
                </section>
              )}
              {showLinkedModels(editForm.role, editForm.department) && !showAffiliateSection(editForm.role, editForm.department) && (
                <section className="border-b border-white/10 px-6 py-4">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/50">Linked models (optional)</h4>
                  <div className="max-h-32 space-y-2 overflow-y-auto rounded-lg border border-white/10 bg-white/5 p-3">
                    {models.length === 0 ? (
                      <p className="text-xs text-white/50">Loading models…</p>
                    ) : (
                      models.map((model) => (
                        <label key={model.id} className="flex cursor-pointer items-center gap-2 text-sm text-white/90">
                          <input
                            type="checkbox"
                            checked={editForm.linked_model_ids.includes(model.id)}
                            onChange={(e) => {
                              setEditForm((f) => ({
                                ...f,
                                linked_model_ids: e.target.checked
                                  ? [...f.linked_model_ids, model.id]
                                  : f.linked_model_ids.filter((id) => id !== model.id),
                              }));
                            }}
                            className="rounded border-white/20 bg-white/10 text-[var(--accent)] focus:ring-[var(--accent)]"
                          />
                          {model.name}
                        </label>
                      ))
                    )}
                  </div>
                </section>
              )}
              <section className="border-b border-white/10 px-6 py-4">
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/50">Meta</h4>
                <div className="space-y-3">
                  <FormRow label="Status">
                    <SmartSelect
                      value={editForm.status}
                      onChange={(s) => setEditForm((f) => ({ ...f, status: s }))}
                      options={STATUSES.map((s) => ({ value: s, label: s }))}
                      allowClear={false}
                    />
                  </FormRow>
                  <FormRow label="Notes">
                    <input
                      value={editForm.notes}
                      onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                      className="glass-input w-full"
                    />
                  </FormRow>
                </div>
              </section>
              <div className="flex gap-3 px-6 py-4">
                <button type="submit" className="btn-primary flex-1 rounded-xl py-2.5 text-sm font-medium" disabled={editBusy}>
                  {editBusy ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={() => setEditMember(null)} className="btn rounded-xl py-2.5 text-sm">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4" onClick={() => setDeleteId(null)}>
          <div
            className="w-full max-w-sm max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[var(--text)]">Delete member? This can&apos;t be undone.</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteBusy}
                className="btn rounded-lg bg-[var(--red-dim)] px-4 py-2 text-sm font-medium text-[var(--red)] hover:opacity-90 disabled:opacity-50"
              >
                {deleteBusy ? 'Deleting…' : 'Delete'}
              </button>
              <button type="button" onClick={() => setDeleteId(null)} className="btn rounded-lg py-2 text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MembersPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-full p-6">
          <div className="animate-pulse rounded-2xl border border-[var(--border-subtle)] h-32 bg-[var(--surface)]" />
        </div>
      }
    >
      <MembersPageContent />
    </Suspense>
  );
}
