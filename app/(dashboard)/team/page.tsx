'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { formatEurFull, formatUsdFull } from '@/lib/format';
import { apiFetch } from '@/lib/client-fetch';
import { useFxRate } from '@/app/hooks/useFxRate';
import { round2 } from '@/lib/fx';
import type { TeamMember } from '@/lib/types';
import { SELECT_ALL, SELECT_NONE } from '@/lib/select-constants';
import SheetForm from '@/app/components/ui/SheetForm';
import SmartSelect from '@/app/components/ui/SmartSelect';
import FormRow from '@/app/components/ui/FormRow';
import KpiCard from '@/app/components/ui/KpiCard';
import Toolbar from '@/app/components/ui/Toolbar';
import EmptyState from '@/app/components/ui/EmptyState';
import ErrorState from '@/app/components/ui/ErrorState';
import TableSkeleton from '@/app/components/ui/TableSkeleton';
import GlassCard from '@/app/components/ui/GlassCard';
import { tableWrapper, tableBase, theadTr, thBase, thRight, tbodyTr, tdBase, tdRight, tdMuted } from '@/app/components/ui/table-styles';

type TabKey = 'users' | 'models' | 'team_members';

interface UserRow {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
  allowed_model_ids: string[];
  allowed_models_count: number;
  last_login_at?: string;
  created_at?: string;
}

interface ModelRow {
  id: string;
  name: string;
  status: string;
  compensation_type?: string;
  creator_payout_pct?: number;
  salary_eur?: number;
  salary_usd?: number;
  deal_threshold?: number;
  deal_flat_under_threshold?: number;
  deal_flat_under_threshold_usd?: number;
  deal_percent_above_threshold?: number;
  notes?: string;
}

const USER_ROLES = ['admin', 'finance', 'viewer'] as const;
/** Add User form: only admin can be selected (dropdown disabled). */
const ADD_USER_ROLES = ['admin'] as const;
const MODEL_STATUSES = ['Active', 'Inactive', 'On Hold'] as const;
/** Exact Airtable select option label; do not change. */
const COMP_TIERED_DEAL = 'Tiered deal (threshold)';
const COMP_TYPES = ['Salary', 'Percentage', 'Hybrid', COMP_TIERED_DEAL] as const;
const TEAM_DEPARTMENTS = ['chatting', 'marketing', 'production', 'ops', 'affiliate'] as const;
const TEAM_ROLES = ['chatter', 'chatting_manager', 'va', 'va_manager', 'marketing_manager', 'editor', 'production', 'other', 'affiliator'] as const;
type TeamDepartment = (typeof TEAM_DEPARTMENTS)[number];
type TeamRole = (typeof TEAM_ROLES)[number];

/** Allowed roles per department (va can belong to multiple depts). */
const ROLE_OPTIONS_BY_DEPT: Record<TeamDepartment, readonly TeamRole[]> = {
  chatting: ['chatter', 'chatting_manager', 'va', 'va_manager', 'other'],
  marketing: ['marketing_manager', 'editor', 'va', 'va_manager', 'production', 'other'],
  production: ['production', 'editor', 'va', 'other'],
  ops: ['va', 'other'],
  affiliate: ['affiliator'],
};

function getRoleOptionsForDepartment(department: string): TeamRole[] {
  const allowed = ROLE_OPTIONS_BY_DEPT[department as TeamDepartment];
  return allowed ? [...allowed] : [...TEAM_ROLES];
}

function isRoleAllowedForDepartment(role: string, department: string): boolean {
  const allowed = ROLE_OPTIONS_BY_DEPT[department as TeamDepartment];
  if (!allowed) return true;
  return allowed.includes(role as TeamRole);
}

/** Departments available in add/edit form (ops removed; legacy ops members still display in list). */
const TEAM_DEPARTMENTS_FOR_FORM = TEAM_DEPARTMENTS.filter((d) => d !== 'ops');

/** Role options for dropdown: allowed list, or for edit when role is legacy, inject it at top. Dedupe by value so "affiliator" appears once. Ops department: only show legacy role in edit, no new ops role selection. */
function getRoleSelectOptions(department: string, currentRole: string, isEditWithLegacyRole?: boolean): { value: string; label: string }[] {
  if (department === 'ops') {
    if (isEditWithLegacyRole && currentRole) return [{ value: currentRole, label: currentRole }];
    return [];
  }
  const allowed = getRoleOptionsForDepartment(department);
  const byValue = new Map<string, string>();
  for (const r of allowed) {
    if (!byValue.has(r)) byValue.set(r, r);
  }
  const base = Array.from(byValue.entries()).map(([value, label]) => ({ value, label }));
  if (isEditWithLegacyRole && currentRole && !byValue.has(currentRole)) {
    return [{ value: currentRole, label: currentRole }, ...base];
  }
  return base;
}

const STATUSES = ['active', 'inactive'] as const;
const PAYOUT_TYPES = ['none', 'percentage', 'flat_fee', 'hybrid'] as const;
const PAYOUT_FREQUENCIES = ['weekly', 'monthly'] as const;
const DEFAULT_MEMBER_FORM = {
  name: '',
  email: '',
  department: 'chatting',
  role: 'chatter',
  status: 'active',
  notes: '',
  model_id: '',
  payout_type: 'none' as string,
  // Chatter-only % (new system)
  payout_percentage_chatters: '' as string | number,
  // Manager bucket %s (new system)
  chatting_percentage: 0 as number,
  chatting_percentage_messages_tips: 0 as number,
  gunzo_percentage: 0 as number,
  gunzo_percentage_messages_tips: 0 as number,
  payout_flat_fee: '' as string | number,
  payout_frequency: 'monthly' as string,
  models_scope: [] as string[],
  payout_scope: 'agency_total_net' as 'agency_total_net' | 'messages_tips_net',
};

const isDev = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

export default function TeamPage() {
  const [tab, setTab] = useState<TabKey>('users');
  const [canManageUsers, setCanManageUsers] = useState(false);
  const [canManageModels, setCanManageModels] = useState(false);
  const [canManageMembers, setCanManageMembers] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Users
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<{ message: string; requestId: string | null } | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [addUserForm, setAddUserForm] = useState({
    email: '',
    role: 'admin' as string,
    is_active: true,
    password: '',
    password_confirm: '',
    allowed_model_ids: [] as string[],
  });
  const [addUserBusy, setAddUserBusy] = useState(false);
  const [lastCreatedPassword, setLastCreatedPassword] = useState<string | null>(null);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [editUserForm, setEditUserForm] = useState({ role: 'viewer' as string, is_active: true, allowed_model_ids: [] as string[], allowed_model_ids_text: '' });
  const [editUserBusy, setEditUserBusy] = useState(false);

  // Models
  const [models, setModels] = useState<ModelRow[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<{ message: string; requestId: string | null } | null>(null);
  const [modelSearch, setModelSearch] = useState('');
  const [addModelOpen, setAddModelOpen] = useState(false);
  const [addModelForm, setAddModelForm] = useState({
    name: '',
    status: 'Active',
    compensation_type: 'Salary' as string,
    creator_payout_pct: '' as string | number,
    salary_eur: '' as string | number,
    salary_currency: 'eur',
    deal_threshold: '' as string | number,
    deal_flat_under_threshold: '' as string | number,
    deal_flat_currency: 'eur' as 'eur' | 'usd',
    deal_percent_above_threshold: '' as string | number,
    notes: '',
  });
  const [addModelErrors, setAddModelErrors] = useState<{ deal_threshold?: string; deal_flat_under_threshold?: string; deal_percent_above_threshold?: string }>({});
  const [addModelBusy, setAddModelBusy] = useState(false);
  const [editModel, setEditModel] = useState<ModelRow | null>(null);
  const [editModelForm, setEditModelForm] = useState({
    name: '',
    status: 'Active',
    compensation_type: 'Salary' as string,
    creator_payout_pct: '' as string | number,
    salary_eur: '' as string | number,
    salary_currency: 'eur',
    deal_threshold: '' as string | number,
    deal_flat_under_threshold: '' as string | number,
    deal_flat_currency: 'eur' as 'eur' | 'usd',
    deal_percent_above_threshold: '' as string | number,
    notes: '',
  });
  const [editModelErrors, setEditModelErrors] = useState<{ deal_threshold?: string; deal_flat_under_threshold?: string; deal_percent_above_threshold?: string }>({});
  const [editModelBusy, setEditModelBusy] = useState(false);
  const [deleteModel, setDeleteModel] = useState<ModelRow | null>(null);
  const [deleteModelBusy, setDeleteModelBusy] = useState(false);

  const { rate: fxRate } = useFxRate();

  // Team members (all with filters)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamMembersLoading, setTeamMembersLoading] = useState(false);
  const [teamMembersError, setTeamMembersError] = useState<{ message: string; requestId: string | null } | null>(null);
  const [teamDeptFilter, setTeamDeptFilter] = useState(SELECT_ALL);
  const [teamRoleFilter, setTeamRoleFilter] = useState(SELECT_ALL);
  const [teamStatusFilter, setTeamStatusFilter] = useState(SELECT_ALL);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [addMemberForm, setAddMemberForm] = useState(DEFAULT_MEMBER_FORM);
  const [addMemberBusy, setAddMemberBusy] = useState(false);
  const [editMember, setEditMember] = useState<TeamMember | null>(null);
  const [editMemberForm, setEditMemberForm] = useState<{
    name: string;
    email: string;
    department: string;
    role: string;
    status: string;
    notes: string;
    model_id: string;
    payout_type: string;
    payout_percentage?: string | number;
    payout_flat_fee: string | number;
    payout_frequency: string;
    models_scope: string[];
    payout_scope: 'agency_total_net' | 'messages_tips_net';
  }>(DEFAULT_MEMBER_FORM);
  const [editMemberBusy, setEditMemberBusy] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const prevEditDeptRef = useRef<string>('');

  useEffect(() => {
    if (!addMemberForm.department || addMemberOpen === false) return;
    const allowed = getRoleOptionsForDepartment(addMemberForm.department);
    if (addMemberForm.role && !allowed.includes(addMemberForm.role as TeamRole)) {
      setAddMemberForm((f) => ({ ...f, role: '' }));
    }
  }, [addMemberForm.department, addMemberForm.role, addMemberOpen]);

  useEffect(() => {
    if (editMember) prevEditDeptRef.current = (editMember.department as string) ?? '';
  }, [editMember]);

  useEffect(() => {
    if (!editMemberForm.department || !editMember) return;
    const allowed = getRoleOptionsForDepartment(editMemberForm.department);
    const deptChanged = prevEditDeptRef.current !== editMemberForm.department;
    if (deptChanged) prevEditDeptRef.current = editMemberForm.department;
    if (deptChanged && editMemberForm.role && !allowed.includes(editMemberForm.role as TeamRole)) {
      setEditMemberForm((f) => ({ ...f, role: '' }));
    }
  }, [editMemberForm.department, editMemberForm.role, editMember]);

  const loggedRef = useRef<Record<string, boolean>>({});

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    fetch('/api/me', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((me: { canManageUsers?: boolean; canManageModels?: boolean; canManageMembers?: boolean } | null) => {
        setCanManageUsers(me?.canManageUsers ?? false);
        setCanManageModels(me?.canManageModels ?? false);
        setCanManageMembers(me?.canManageMembers ?? false);
      })
      .catch(() => {});
  }, []);

  const loadUsers = useCallback(() => {
    if (!canManageUsers) {
      setUsers([]);
      setUsersLoading(false);
      return;
    }
    setUsersLoading(true);
    const q = userSearch.trim() ? `?q=${encodeURIComponent(userSearch.trim())}` : '';
    fetch(`/api/users${q}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setUsers(Array.isArray(d) ? d : []))
      .catch(() => setUsers([]))
      .finally(() => setUsersLoading(false));
  }, [canManageUsers, userSearch]);

  const loadModels = useCallback(() => {
    setModelsLoading(true);
    setModelsError(null);
    apiFetch<ModelRow[]>('/api/models')
      .then(({ ok, data: d, requestId }) => {
        if (process.env.NODE_ENV === 'development' && !loggedRef.current['models']) {
          console.log('[team] models request', '/api/models');
          console.log('[team] models response', { ok, requestId, sample: Array.isArray(d) ? (d as ModelRow[]).slice?.(0, 1) : null });
          loggedRef.current['models'] = true;
        }
        if (!ok) {
          setModelsError({ message: (d as { error?: string })?.error ?? 'Failed to load models', requestId });
          setModels([]);
          return;
        }
        setModels(Array.isArray(d) ? d : []);
      })
      .catch((e) => {
        setModelsError({ message: e instanceof Error ? e.message : 'Failed to load models', requestId: null });
        setModels([]);
      })
      .finally(() => setModelsLoading(false));
  }, []);

  const loadTeamMembers = useCallback(() => {
    setTeamMembersLoading(true);
    setTeamMembersError(null);
    const params = new URLSearchParams();
    if (teamDeptFilter && teamDeptFilter !== SELECT_ALL) params.set('department', teamDeptFilter);
    if (teamRoleFilter && teamRoleFilter !== SELECT_ALL) params.set('role', teamRoleFilter);
    if (teamStatusFilter && teamStatusFilter !== SELECT_ALL) params.set('status', teamStatusFilter);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const url = `/api/team-members${qs}`;
    apiFetch<TeamMember[]>(url)
      .then(({ ok, data: d, requestId }) => {
        if (process.env.NODE_ENV === 'development' && !loggedRef.current['team_members']) {
          console.log('[team] team_members request', url);
          console.log('[team] team_members response', { ok, requestId, sample: Array.isArray(d) ? (d as TeamMember[]).slice?.(0, 1) : null });
          loggedRef.current['team_members'] = true;
        }
        if (!ok) {
          setTeamMembersError({ message: (d as { error?: string })?.error ?? 'Failed to load team members', requestId });
          setTeamMembers([]);
          return;
        }
        setTeamMembers(Array.isArray(d) ? d : []);
      })
      .catch((e) => {
        setTeamMembersError({ message: e instanceof Error ? e.message : 'Failed to load team members', requestId: null });
        setTeamMembers([]);
      })
      .finally(() => setTeamMembersLoading(false));
  }, [teamDeptFilter, teamRoleFilter, teamStatusFilter]);

  useEffect(() => {
    if (tab === 'users') loadUsers();
  }, [tab, loadUsers]);
  useEffect(() => {
    if (tab === 'models') loadModels();
  }, [tab, loadModels]);
  useEffect(() => {
    if (tab === 'team_members') {
      loadTeamMembers();
      loadModels(); // so Linked model column shows names
    }
  }, [tab, loadTeamMembers, loadModels]);

  const generatePassword = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*';
    let p = '';
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    for (let i = 0; i < 16; i++) p += chars[arr[i]! % chars.length];
    setAddUserForm((f) => ({ ...f, password: p, password_confirm: p }));
    try {
      navigator.clipboard.writeText(p);
      showToast('Password generated and copied', 'success');
    } catch {
      showToast('Password generated', 'success');
    }
  };

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addUserForm.email.trim()) { showToast('Email required', 'error'); return; }
    if (!addUserForm.password || addUserForm.password.length < 8) { showToast('Password required (min 8 characters)', 'error'); return; }
    if (addUserForm.password !== addUserForm.password_confirm) { showToast('Passwords do not match', 'error'); return; }
    setAddUserBusy(true);
    setLastCreatedPassword(null);
    fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        email: addUserForm.email.trim(),
        role: addUserForm.role,
        is_active: addUserForm.is_active,
        password: addUserForm.password,
        allowed_model_ids: addUserForm.allowed_model_ids,
      }),
    })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (data.error) showToast(data.error, 'error');
        else {
          setAddUserOpen(false);
          const wasGenerated = addUserForm.password_confirm === addUserForm.password && addUserForm.password.length >= 16;
          if (wasGenerated) setLastCreatedPassword(addUserForm.password);
          setAddUserForm({ email: '', role: 'admin', is_active: true, password: '', password_confirm: '', allowed_model_ids: [] });
          showToast('User created', 'success');
          loadUsers();
        }
      })
      .finally(() => setAddUserBusy(false));
  };

  const handleEditUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setEditUserBusy(true);
    const ids = editUserForm.allowed_model_ids_text.trim() ? editUserForm.allowed_model_ids_text.split(',').map((s) => s.trim()).filter(Boolean) : editUserForm.allowed_model_ids;
    fetch(`/api/users/${editUser.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        role: editUserForm.role,
        is_active: editUserForm.is_active,
        allowed_model_ids: ids,
      }),
    })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (data.error) showToast(data.error, 'error');
        else {
          setEditUser(null);
          showToast('User updated', 'success');
          loadUsers();
        }
      })
      .finally(() => setEditUserBusy(false));
  };

  const handleAddModel = (e: React.FormEvent) => {
    e.preventDefault();
    setAddModelErrors({});
    if (!addModelForm.name.trim()) { showToast('Name required', 'error'); return; }
    const compType = addModelForm.compensation_type as string;
    const pct = addModelForm.creator_payout_pct === '' ? undefined : Number(addModelForm.creator_payout_pct);
    const salaryAmountRaw = addModelForm.salary_eur === '' ? undefined : Number(addModelForm.salary_eur);
    const salaryCurrency = (addModelForm.salary_currency === 'usd' ? 'usd' : 'eur') as 'eur' | 'usd';
    const threshold = addModelForm.deal_threshold === '' ? undefined : Number(addModelForm.deal_threshold);
    const flatAmount = addModelForm.deal_flat_under_threshold === '' ? undefined : Number(addModelForm.deal_flat_under_threshold);
    const dealFlatCurrency = (addModelForm.deal_flat_currency === 'usd' ? 'usd' : 'eur') as 'eur' | 'usd';
    const percentDeal = addModelForm.deal_percent_above_threshold === '' ? undefined : Number(addModelForm.deal_percent_above_threshold);
    if (compType === COMP_TIERED_DEAL) {
      const err: typeof addModelErrors = {};
      if (threshold == null || Number.isNaN(threshold) || threshold <= 0) err.deal_threshold = 'Required, must be > 0';
      if (flatAmount == null || Number.isNaN(flatAmount) || flatAmount < 0) err.deal_flat_under_threshold = 'Required, must be ≥ 0';
      if (percentDeal == null || Number.isNaN(percentDeal) || percentDeal < 0 || percentDeal > 100) err.deal_percent_above_threshold = 'Required, 0–100';
      if (Object.keys(err).length) { setAddModelErrors(err); return; }
    } else if (compType === 'Percentage') {
      if (pct == null || Number.isNaN(pct) || pct < 0 || pct > 100) {
        showToast('Creator payout % is required (0–100) for Percentage', 'error');
        return;
      }
    } else if (compType === 'Salary') {
      if (salaryAmountRaw == null || Number.isNaN(salaryAmountRaw) || salaryAmountRaw < 0) {
        showToast('Salary amount is required for Salary compensation', 'error');
        return;
      }
      if (!fxRate || fxRate <= 0) {
        showToast('FX rate is loading; please try again in a moment', 'error');
        return;
      }
    } else if (compType === 'Hybrid') {
      if (pct == null || Number.isNaN(pct) || pct < 0 || pct > 100) {
        showToast('Creator payout % is required (0–100) for Hybrid', 'error');
        return;
      }
      if (salaryAmountRaw == null || Number.isNaN(salaryAmountRaw) || salaryAmountRaw < 0) {
        showToast('Salary amount is required for Hybrid', 'error');
        return;
      }
      if (!fxRate || fxRate <= 0) {
        showToast('FX rate is loading; please try again in a moment', 'error');
        return;
      }
    }
    let salary_eur: number | undefined;
    let salary_usd: number | undefined;
    if ((compType === 'Salary' || compType === 'Hybrid') && salaryAmountRaw != null && Number.isFinite(salaryAmountRaw) && fxRate != null && fxRate > 0) {
      if (salaryCurrency === 'eur') {
        salary_eur = round2(salaryAmountRaw);
        salary_usd = round2(salaryAmountRaw / fxRate);
      } else {
        salary_usd = round2(salaryAmountRaw);
        salary_eur = round2(salaryAmountRaw * fxRate);
      }
    }
    setAddModelBusy(true);
    const payload: Record<string, unknown> = {
      name: addModelForm.name.trim(),
      status: addModelForm.status,
      compensation_type: compType,
      notes: addModelForm.notes.trim() || undefined,
    };
    if (compType === 'Percentage' || compType === 'Hybrid') payload.creator_payout_pct = pct;
    if (compType === 'Salary' || compType === 'Hybrid') {
      payload.salary_eur = salary_eur;
      payload.salary_usd = salary_usd;
    }
    if (compType === COMP_TIERED_DEAL) {
      payload.deal_threshold = threshold;
      if (dealFlatCurrency === 'eur') {
        payload.deal_flat_under_threshold = flatAmount;
      } else {
        payload.deal_flat_under_threshold_usd = flatAmount;
      }
      payload.deal_percent_above_threshold = percentDeal;
    }
    fetch('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (data.error) showToast(data.error, 'error');
        else {
          setAddModelOpen(false);
          setAddModelForm({
            name: '',
            status: 'Active',
            compensation_type: 'Salary',
            creator_payout_pct: '',
            salary_eur: '',
            salary_currency: 'eur',
            deal_threshold: '',
            deal_flat_under_threshold: '',
            deal_flat_currency: 'eur',
            deal_percent_above_threshold: '',
            notes: '',
          });
          setAddModelErrors({});
          showToast('Model created', 'success');
          loadModels();
        }
      })
      .finally(() => setAddModelBusy(false));
  };

  const handleEditModel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModel) return;
    setEditModelErrors({});
    const compType = editModelForm.compensation_type as string;
    const pct = editModelForm.creator_payout_pct === '' ? undefined : Number(editModelForm.creator_payout_pct);
    const salaryAmountRaw = editModelForm.salary_eur === '' ? undefined : Number(editModelForm.salary_eur);
    const salaryCurrency = (editModelForm.salary_currency === 'usd' ? 'usd' : 'eur') as 'eur' | 'usd';
    const threshold = editModelForm.deal_threshold === '' ? undefined : Number(editModelForm.deal_threshold);
    const flatAmount = editModelForm.deal_flat_under_threshold === '' ? undefined : Number(editModelForm.deal_flat_under_threshold);
    const dealFlatCurrency = (editModelForm.deal_flat_currency === 'usd' ? 'usd' : 'eur') as 'eur' | 'usd';
    const percentDeal = editModelForm.deal_percent_above_threshold === '' ? undefined : Number(editModelForm.deal_percent_above_threshold);
    if (compType === COMP_TIERED_DEAL) {
      const err: typeof editModelErrors = {};
      if (threshold == null || Number.isNaN(threshold) || threshold <= 0) err.deal_threshold = 'Required, must be > 0';
      if (flatAmount == null || Number.isNaN(flatAmount) || flatAmount < 0) err.deal_flat_under_threshold = 'Required, must be ≥ 0';
      if (percentDeal == null || Number.isNaN(percentDeal) || percentDeal < 0 || percentDeal > 100) err.deal_percent_above_threshold = 'Required, 0–100';
      if (Object.keys(err).length) { setEditModelErrors(err); return; }
    } else if (compType === 'Percentage') {
      if (pct == null || Number.isNaN(pct) || pct < 0 || pct > 100) {
        showToast('Creator payout % is required (0–100) for Percentage', 'error');
        return;
      }
    } else if (compType === 'Salary') {
      if (salaryAmountRaw == null || Number.isNaN(salaryAmountRaw) || salaryAmountRaw < 0) {
        showToast('Salary amount is required for Salary compensation', 'error');
        return;
      }
      if (!fxRate || fxRate <= 0) {
        showToast('FX rate is loading; please try again in a moment', 'error');
        return;
      }
    } else if (compType === 'Hybrid') {
      if (pct == null || Number.isNaN(pct) || pct < 0 || pct > 100) {
        showToast('Creator payout % is required (0–100) for Hybrid', 'error');
        return;
      }
      if (salaryAmountRaw == null || Number.isNaN(salaryAmountRaw) || salaryAmountRaw < 0) {
        showToast('Salary amount is required for Hybrid', 'error');
        return;
      }
      if (!fxRate || fxRate <= 0) {
        showToast('FX rate is loading; please try again in a moment', 'error');
        return;
      }
    }
    let salary_eur: number | undefined;
    let salary_usd: number | undefined;
    if ((compType === 'Salary' || compType === 'Hybrid') && salaryAmountRaw != null && Number.isFinite(salaryAmountRaw) && fxRate != null && fxRate > 0) {
      if (salaryCurrency === 'eur') {
        salary_eur = round2(salaryAmountRaw);
        salary_usd = round2(salaryAmountRaw / fxRate);
      } else {
        salary_usd = round2(salaryAmountRaw);
        salary_eur = round2(salaryAmountRaw * fxRate);
      }
    }
    setEditModelBusy(true);
    const payload: Record<string, unknown> = {
      name: editModelForm.name.trim(),
      status: editModelForm.status,
      compensation_type: compType,
      notes: editModelForm.notes.trim() || undefined,
    };
    if (compType === 'Percentage' || compType === 'Hybrid') payload.creator_payout_pct = pct;
    if (compType === 'Salary' || compType === 'Hybrid') {
      payload.salary_eur = salary_eur;
      payload.salary_usd = salary_usd;
    }
    if (compType === COMP_TIERED_DEAL) {
      payload.deal_threshold = threshold;
      if (dealFlatCurrency === 'eur') {
        payload.deal_flat_under_threshold = flatAmount;
      } else {
        payload.deal_flat_under_threshold_usd = flatAmount;
      }
      payload.deal_percent_above_threshold = percentDeal;
    }
    fetch(`/api/models/${editModel.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (data.error) showToast(data.error, 'error');
        else {
          setEditModel(null);
          showToast('Model updated', 'success');
          loadModels();
        }
      })
      .finally(() => setEditModelBusy(false));
  };

  const handleDeleteModel = (m: ModelRow) => {
    if (m.status !== 'Active') {
      showToast('Already inactive', 'error');
      return;
    }
    setDeleteModelBusy(true);
    fetch(`/api/models/${m.id}`, { method: 'DELETE', credentials: 'include' })
      .then((r) => r.json().catch(() => ({})))
      .then((data: { error?: string }) => {
        if (data.error) {
          showToast(data.error, 'error');
          return;
        }
        setModels((prev) => prev.map((x) => (x.id === m.id ? { ...x, status: 'Inactive' as const } : x)));
        setDeleteModel(null);
        showToast('Model set to Inactive', 'success');
      })
      .finally(() => setDeleteModelBusy(false));
  };

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addMemberForm.name.trim()) { showToast('Name required', 'error'); return; }
    const pt = addMemberForm.payout_type || 'none';
    if (pt === 'flat_fee') {
      const flat = Number(addMemberForm.payout_flat_fee);
      if (Number.isNaN(flat) || flat < 0) { showToast('Payout flat fee must be ≥ 0', 'error'); return; }
    }
    if (pt === 'hybrid') {
      const flat = addMemberForm.payout_flat_fee !== '' ? Number(addMemberForm.payout_flat_fee) : undefined;
      if (flat == null || Number.isNaN(flat)) { showToast('Hybrid requires at least flat fee', 'error'); return; }
    }
    if (!isRoleAllowedForDepartment(addMemberForm.role, addMemberForm.department)) {
      showToast('Role is not allowed for the selected department', 'error');
      return;
    }
    // New payout validation by role
    const isChatter = addMemberForm.role === 'chatter';
    if (pt === 'percentage' || pt === 'hybrid') {
      if (isChatter) {
        const pct = Number(addMemberForm.payout_percentage_chatters);
        if (Number.isNaN(pct) || pct <= 0 || pct > 100) {
          showToast('Payout % (chatters) must be 0–100', 'error');
          return;
        }
      } else {
        const chattingPct = Number(addMemberForm.chatting_percentage ?? 0);
        const chattingMsgsPct = Number(addMemberForm.chatting_percentage_messages_tips ?? 0);
        const gunzoPct = Number(addMemberForm.gunzo_percentage ?? 0);
        const gunzoMsgsPct = Number(addMemberForm.gunzo_percentage_messages_tips ?? 0);

        if (chattingPct < 0 || chattingPct > 100 ||
            chattingMsgsPct < 0 || chattingMsgsPct > 100 ||
            gunzoPct < 0 || gunzoPct > 100 ||
            gunzoMsgsPct < 0 || gunzoMsgsPct > 100) {
          showToast('All percentages must be 0–100', 'error');
          return;
        }
        if (chattingPct > 0 && chattingMsgsPct > 0) {
          showToast('Cannot use both total and messages+tips for chatting', 'error');
          return;
        }
        if (gunzoPct > 0 && gunzoMsgsPct > 0) {
          showToast('Cannot use both total and messages+tips for gunzo', 'error');
          return;
        }
      }
    }

    setAddMemberBusy(true);
    const payload = {
      name: addMemberForm.name.trim(),
      email: addMemberForm.email.trim() || undefined,
      role: addMemberForm.role,
      department: addMemberForm.department,
      status: addMemberForm.status,
      notes: addMemberForm.notes.trim() || undefined,
      payout_type: pt,
      payout_frequency: pt !== 'none' ? (addMemberForm.payout_frequency || 'monthly') : 'monthly',
      // Chatter: single chatter %; managers: bucket %s
      payout_percentage_chatters:
        addMemberForm.role === 'chatter' && (pt === 'percentage' || pt === 'hybrid')
          ? Number(addMemberForm.payout_percentage_chatters)
          : undefined,
      chatting_percentage:
        addMemberForm.role !== 'chatter' ? Number(addMemberForm.chatting_percentage ?? 0) : undefined,
      chatting_percentage_messages_tips:
        addMemberForm.role !== 'chatter' ? Number(addMemberForm.chatting_percentage_messages_tips ?? 0) : undefined,
      gunzo_percentage:
        addMemberForm.role !== 'chatter' ? Number(addMemberForm.gunzo_percentage ?? 0) : undefined,
      gunzo_percentage_messages_tips:
        addMemberForm.role !== 'chatter' ? Number(addMemberForm.gunzo_percentage_messages_tips ?? 0) : undefined,
      payout_flat_fee: pt === 'flat_fee' || pt === 'hybrid' ? (addMemberForm.payout_flat_fee !== '' ? Number(addMemberForm.payout_flat_fee) : undefined) : undefined,
      models_scope: addMemberForm.role === 'chatting_manager' && addMemberForm.models_scope?.length ? addMemberForm.models_scope : undefined,
      payout_scope:
        addMemberForm.role.toLowerCase().includes('manager')
          ? (addMemberForm.payout_scope ?? 'agency_total_net')
          : undefined,
    };
    fetch('/api/team-members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (data.error) showToast(data.error, 'error');
        else {
          setAddMemberOpen(false);
          setAddMemberForm(DEFAULT_MEMBER_FORM);
          showToast('Member added', 'success');
          loadTeamMembers();
        }
      })
      .finally(() => setAddMemberBusy(false));
  };

  const handleEditMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editMember) return;
    const pt = editMemberForm.payout_type || 'none';
    if (pt === 'flat_fee') {
      const flat = Number(editMemberForm.payout_flat_fee);
      if (Number.isNaN(flat) || flat < 0) { showToast('Payout flat fee must be ≥ 0', 'error'); return; }
    }
    if (pt === 'hybrid') {
      const flat = editMemberForm.payout_flat_fee !== '' ? Number(editMemberForm.payout_flat_fee) : undefined;
      if (flat == null || Number.isNaN(flat)) { showToast('Hybrid requires at least flat fee', 'error'); return; }
    }
    const roleAllowed = isRoleAllowedForDepartment(editMemberForm.role, editMemberForm.department);
    const legacyUnchanged = editMemberForm.role === (editMember?.role as string);
    if (!roleAllowed && !legacyUnchanged) {
      showToast('Role is not allowed for the selected department', 'error');
      return;
    }
    setEditMemberBusy(true);
    const payload = {
      name: editMemberForm.name.trim(),
      email: editMemberForm.email.trim() || undefined,
      role: editMemberForm.role,
      department: editMemberForm.department,
      status: editMemberForm.status,
      notes: editMemberForm.notes.trim() || undefined,
      payout_type: pt,
      payout_frequency: pt !== 'none' ? (editMemberForm.payout_frequency || 'monthly') : 'monthly',
      payout_flat_fee: pt === 'flat_fee' || pt === 'hybrid' ? (editMemberForm.payout_flat_fee !== '' ? Number(editMemberForm.payout_flat_fee) : undefined) : undefined,
      models_scope: editMemberForm.role === 'chatting_manager' ? (editMemberForm.models_scope ?? []) : [],
      payout_scope:
        editMemberForm.role.toLowerCase().includes('manager')
          ? (editMemberForm.payout_scope ?? 'agency_total_net')
          : undefined,
    };
    fetch(`/api/team-members/${editMember.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (data.error) showToast(data.error, 'error');
        else {
          setEditMember(null);
          showToast('Member updated', 'success');
          loadTeamMembers();
        }
      })
      .finally(() => setEditMemberBusy(false));
  };

  const handleDeleteMember = (id: string) => {
    setDeleteBusy(true);
    fetch(`/api/team-members/${id}`, { method: 'DELETE', credentials: 'include' })
      .then((r) => (r.ok ? r.json() : r.json().catch(() => ({}))))
      .then((data) => {
        if (data?.error) showToast(data.error, 'error');
        else {
          setDeleteConfirmId(null);
          showToast('Member removed', 'success');
          loadTeamMembers();
        }
      })
      .finally(() => setDeleteBusy(false));
  };

  const filteredModels = (modelSearch.trim()
    ? models.filter((m) => m.name.toLowerCase().includes(modelSearch.trim().toLowerCase()))
    : models
  ).filter((m) => m.status === 'Active');

  const activeUsersCount = users.filter((u) => u.is_active).length;
  const activeModelsCount = models.filter((m) => m.status === 'Active').length;
  const modelIdToName = Object.fromEntries(models.map((m) => [m.id, m.name]));

  /** Group team members by department for display */
  const teamByDepartment = TEAM_DEPARTMENTS.reduce<Record<string, TeamMember[]>>((acc, d) => {
    acc[d] = teamMembers.filter((m) => (m.department ?? '').toLowerCase() === d);
    return acc;
  }, {});

  function formatPayout(m: TeamMember): string {
    if (m.payout_type === 'none' || !m.payout_type) return '—';
    const parts: string[] = [m.payout_type];
    if (m.payout_percentage != null) parts.push(`${m.payout_percentage}%`);
    if (m.payout_flat_fee != null) parts.push(formatEurFull(m.payout_flat_fee));
    if (m.models_scope?.length) parts.push(`${m.models_scope.length} model(s)`);
    if (m.payout_frequency) parts.push(m.payout_frequency);
    return parts.filter(Boolean).join(' · ');
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'users', label: 'Users' },
    { key: 'models', label: 'Models' },
    { key: 'team_members', label: 'Team members' },
  ];

  return (
    <div className="min-h-full bg-gradient-to-b from-[var(--bg-0)] to-[var(--bg-1)]">
      <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
        <GlassCard>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text)]">Team hub</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Users, models, and operational staff</p>
        </GlassCard>

        <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-4 py-3 shadow-[var(--shadow-sm)] backdrop-blur-xl">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'bg-[var(--accent)] text-white'
                  : 'border border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

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

        {tab === 'users' && (
          <>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-5 shadow-lg shadow-black/30 backdrop-blur-xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/70">Active users</p>
              <p className="mt-1 tabular-nums text-2xl font-bold text-white/90">{activeUsersCount}</p>
            </div>
            {!canManageUsers ? (
              <EmptyState
                title="User management is admin only"
                description="Only admins can view and manage users. Contact an admin to get access."
              />
            ) : usersError ? (
              <ErrorState title="Could not load users" description={usersError.message} requestId={usersError.requestId ?? undefined} />
            ) : usersLoading ? (
              <TableSkeleton rows={5} cols={6} />
            ) : users.length === 0 ? (
              <EmptyState title="No users yet" description="Add the first user to get started." ctaText="Add user" onCta={() => setAddUserOpen(true)} />
            ) : (
              <>
                <Toolbar>
                  <input
                    type="search"
                    placeholder="Search by email..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="w-56 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 placeholder:text-white/50 focus:border-purple-400/50 focus:ring-2 focus:ring-purple-400/30"
                  />
                  <button type="button" onClick={() => setAddUserOpen(true)} className="btn-primary ml-auto rounded-xl px-4 py-2 text-sm font-medium">
                    Add user
                  </button>
                </Toolbar>
                <div className={`overflow-x-auto ${tableWrapper}`}>
                  <table className={tableBase}>
                    <thead>
                      <tr className={theadTr}>
                        <th className={`${thBase} text-left`}>Email</th>
                        <th className={`${thBase} text-left`}>Role</th>
                        <th className={`${thBase} text-left`}>Status</th>
                        <th className={thRight}>Allowed models</th>
                        <th className={`${thBase} text-left`}>Last login</th>
                        <th className="w-20 px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {users.map((u) => (
                        <tr key={u.id} className={tbodyTr}>
                          <td className={`${tdBase} font-medium`}>{u.email}</td>
                          <td className={tdBase}><span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/90">{u.role}</span></td>
                          <td className={tdBase}><span className={`rounded-full px-2 py-0.5 text-xs ${u.is_active ? 'bg-green-500/20 text-green-300' : 'bg-white/10 text-white/70'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                          <td className={tdRight}>{u.allowed_models_count}</td>
                          <td className={tdMuted}>{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : '—'}</td>
                          <td className="px-4 py-3">
                            <button type="button" onClick={() => { setEditUser(u); setEditUserForm({ role: u.role, is_active: u.is_active, allowed_model_ids: u.allowed_model_ids ?? [], allowed_model_ids_text: (u.allowed_model_ids ?? []).join(', ') }); }} className="text-purple-300 hover:underline text-xs">
                              Edit
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {tab === 'models' && (
          <>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-5 shadow-lg shadow-black/30 backdrop-blur-xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/70">Active models</p>
              <p className="mt-1 tabular-nums text-2xl font-bold text-white/90">{activeModelsCount}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 shadow-lg shadow-black/30 backdrop-blur-xl">
              <input
                type="search"
                placeholder="Search models..."
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 w-56 placeholder:text-white/50"
              />
              {canManageModels && (
                <button type="button" onClick={() => setAddModelOpen(true)} className="btn-primary ml-auto rounded-lg px-4 py-2 text-sm font-medium">
                  Add model
                </button>
              )}
            </div>
            {modelsError ? (
              <ErrorState title="Could not load models" description={modelsError.message} requestId={modelsError.requestId ?? undefined} />
            ) : modelsLoading ? (
              <TableSkeleton rows={6} cols={4} />
            ) : filteredModels.length === 0 ? (
              <EmptyState title="No models" description="Add your first model or adjust search." ctaText="Add model" onCta={() => setAddModelOpen(true)} />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredModels.map((m) => (
                  <Link
                    key={m.id}
                    href={`/models/${m.id}`}
                    className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/30 backdrop-blur-xl transition hover:border-purple-400/30 hover:shadow-xl"
                  >
                    <p className="font-semibold text-white/90">{m.name}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/90">{m.status}</span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/90">{m.compensation_type ?? '—'}</span>
                      {m.creator_payout_pct != null && (
                        <span className="text-xs text-white/70">{m.creator_payout_pct}% payout</span>
                      )}
                      {((m.salary_eur != null && m.salary_eur > 0) || (m.salary_usd != null && m.salary_usd > 0)) && (
                        <span className="text-xs text-white/70">
                          {m.salary_eur != null && m.salary_eur > 0 ? formatEurFull(m.salary_eur) : formatUsdFull(m.salary_usd!)}
                          {' '}salary
                        </span>
                      )}
                    </div>
                    {canManageModels && (
                      <div className="mt-3 flex gap-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            setEditModel(m);
                            const salaryEur = m.salary_eur;
                            const salaryUsd = m.salary_usd;
                            const hasEur = salaryEur != null && Number.isFinite(salaryEur) && salaryEur >= 0;
                            const hasUsd = salaryUsd != null && Number.isFinite(salaryUsd) && salaryUsd >= 0;
                            const salaryAmount = hasEur ? salaryEur : hasUsd ? salaryUsd : '';
                            const salaryCurrency = hasEur ? 'eur' : hasUsd ? 'usd' : 'eur';
                            const flatUsd = m.deal_flat_under_threshold_usd;
                            const flatEur = m.deal_flat_under_threshold;
                            const hasFlatUsd = flatUsd != null && Number.isFinite(flatUsd) && flatUsd >= 0;
                            const hasFlatEur = flatEur != null && Number.isFinite(flatEur) && flatEur >= 0;
                            const dealFlatAmount = hasFlatUsd ? flatUsd : hasFlatEur ? flatEur : '';
                            const dealFlatCurr = hasFlatUsd ? 'usd' : hasFlatEur ? 'eur' : 'eur';
                            setEditModelForm({ name: m.name, status: m.status, compensation_type: m.compensation_type ?? 'Salary', creator_payout_pct: m.creator_payout_pct ?? '', salary_eur: salaryAmount, salary_currency: salaryCurrency, deal_threshold: m.deal_threshold ?? '', deal_flat_under_threshold: dealFlatAmount, deal_flat_currency: dealFlatCurr, deal_percent_above_threshold: m.deal_percent_above_threshold ?? '', notes: m.notes ?? '' });
                            setEditModelErrors({});
                          }}
                          className="text-xs text-purple-300 hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            setDeleteModel(m);
                          }}
                          className="text-xs text-white/60 hover:text-red-300 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'team_members' && (
          <>
            <Toolbar>
              <span className="text-sm text-white/70">Department</span>
              <SmartSelect
                value={teamDeptFilter ?? SELECT_ALL}
                onChange={(v) => setTeamDeptFilter(v === null || v === '' ? SELECT_ALL : v)}
                options={[{ value: SELECT_ALL, label: 'All' }, ...TEAM_DEPARTMENTS_FOR_FORM.map((d) => ({ value: d, label: d }))]}
                placeholder="All"
              />
              <span className="text-sm text-white/70">Role</span>
              <SmartSelect
                value={teamRoleFilter ?? SELECT_ALL}
                onChange={(v) => setTeamRoleFilter(v === null || v === '' ? SELECT_ALL : v)}
                options={[{ value: SELECT_ALL, label: 'All' }, ...TEAM_ROLES.map((r) => ({ value: r, label: r }))]}
                placeholder="All"
              />
              <span className="text-sm text-white/70">Status</span>
              <SmartSelect
                value={teamStatusFilter ?? SELECT_ALL}
                onChange={(v) => setTeamStatusFilter(v === null || v === '' ? SELECT_ALL : v)}
                options={[{ value: SELECT_ALL, label: 'All' }, ...STATUSES.map((s) => ({ value: s, label: s }))]}
                placeholder="All"
              />
              {canManageMembers && (
                <button type="button" onClick={() => setAddMemberOpen(true)} className="btn-primary ml-auto rounded-xl px-4 py-2 text-sm font-medium">Add member</button>
              )}
            </Toolbar>
            {teamMembersError ? (
              <ErrorState title="Could not load team members" description={teamMembersError.message} requestId={teamMembersError.requestId ?? undefined} />
            ) : teamMembersLoading ? (
              <TableSkeleton rows={6} cols={8} />
            ) : teamMembers.length === 0 ? (
              <EmptyState title="No team members match the filters" description="Try changing department, role, or status—or add a new member." ctaText="Add member" onCta={() => setAddMemberOpen(true)} />
            ) : (
              <>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/30 backdrop-blur-xl">
                  <p className="text-xs font-semibold uppercase tracking-wider text-white/70">By department</p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {TEAM_DEPARTMENTS.filter((d) => d !== 'ops').map((dept) => {
                      const list = teamByDepartment[dept] ?? [];
                      return (
                        <div key={dept} className="rounded-xl border border-white/10 bg-white/5 p-4">
                          <p className="text-sm font-medium capitalize text-white/90">{dept}</p>
                          <p className="mt-1 tabular-nums text-xs text-white/60">{list.length} member{list.length !== 1 ? 's' : ''}</p>
                          <ul className="mt-2 space-y-1">
                            {list.length === 0 ? (
                              <li className="text-xs text-white/50">—</li>
                            ) : (
                              list.map((m) => (
                                <li key={m.id} className="text-xs text-white/80">
                                  {m.name}
                                  {m.role ? ` · ${m.role}` : ''}
                                </li>
                              ))
                            )}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className={`overflow-x-auto ${tableWrapper}`}>
                  <table className={tableBase}>
                    <thead>
                      <tr className={theadTr}>
                        <th className={`${thBase} text-left`}>Name</th>
                        <th className={`${thBase} text-left`}>Department</th>
                        <th className={`${thBase} text-left`}>Role</th>
                        <th className={`${thBase} text-left`}>Status</th>
                        <th className={thRight}>Monthly cost</th>
                        <th className={`${thBase} text-left`}>Compensation</th>
                        <th className={`${thBase} text-left`}>Linked model</th>
                        {canManageMembers && <th className="w-24 px-4 py-3" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {teamMembers.map((m) => (
                        <tr key={m.id} className={tbodyTr}>
                          <td className={`${tdBase} font-medium`}>{m.name}</td>
                          <td className={tdBase}><span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs capitalize text-white/90">{m.department}</span></td>
                          <td className={tdBase}><span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/90">{m.role}</span></td>
                          <td className={tdBase}><span className={`rounded-full px-2 py-0.5 text-xs capitalize ${m.status === 'active' ? 'bg-green-500/20 text-green-300' : 'text-white/70'}`}>{m.status}</span></td>
                          <td className={tdRight}>{m.monthly_cost != null ? formatEurFull(m.monthly_cost) : '—'}</td>
                          <td className={tdMuted}>{formatPayout(m)}</td>
                          <td className={tdMuted}>{m.model_id ? (modelIdToName[m.model_id] ?? m.model_id) : '—'}</td>
                          {canManageMembers && (
                            <td className="px-4 py-3 flex gap-2">
                              <button type="button" onClick={() => { setEditMember(m); setEditMemberForm({ ...DEFAULT_MEMBER_FORM, name: m.name, email: m.email ?? '', department: (m.department as string) ?? '', role: (m.role as string) ?? '', status: (m.status as string) ?? '', notes: m.notes ?? '', model_id: m.model_id ?? '', payout_type: m.payout_type ?? 'none', payout_flat_fee: m.payout_flat_fee ?? '', payout_frequency: m.payout_frequency ?? 'monthly', models_scope: Array.isArray(m.models_scope) ? m.models_scope : [] }); }} className="text-purple-300 hover:underline text-xs">Edit</button>
                              <button type="button" onClick={() => setDeleteConfirmId(m.id)} className="text-red-300 hover:underline text-xs">Delete</button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {/* Add User Modal */}
        {addUserOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setAddUserOpen(false)}>
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950/85 p-6 shadow-xl backdrop-blur-xl max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain" onClick={(e) => e.stopPropagation()}>
              <h3 className="mb-4 text-lg font-semibold text-[var(--text)]">Add user</h3>
              <form onSubmit={handleAddUser} className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Email *</label>
                  <input type="email" value={addUserForm.email} onChange={(e) => setAddUserForm((f) => ({ ...f, email: e.target.value }))} className="glass-input" required />
                </div>
                <FormRow label="Role" required>
                  <SmartSelect value={addUserForm.role} onChange={(r) => setAddUserForm((f) => ({ ...f, role: r }))} options={ADD_USER_ROLES.map((r) => ({ value: r, label: r }))} disabled allowClear={false} />
                </FormRow>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="add-user-active" checked={addUserForm.is_active} onChange={(e) => setAddUserForm((f) => ({ ...f, is_active: e.target.checked }))} />
                  <label htmlFor="add-user-active" className="text-sm text-[var(--text)]">Active</label>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-white/70">Password * (min 8 characters)</label>
                  <input type="password" value={addUserForm.password} onChange={(e) => setAddUserForm((f) => ({ ...f, password: e.target.value }))} className="glass-input w-full" placeholder="Enter password" minLength={8} required />
                  <button type="button" onClick={generatePassword} className="mt-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10">Generate password</button>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-white/70">Confirm password *</label>
                  <input type="password" value={addUserForm.password_confirm} onChange={(e) => setAddUserForm((f) => ({ ...f, password_confirm: e.target.value }))} className="glass-input w-full" placeholder="Confirm password" minLength={8} required />
                </div>
                <div className="flex gap-2 pt-2">
                  <button type="submit" className="btn-primary flex-1 rounded-xl py-2.5 text-sm font-medium disabled:opacity-50" disabled={addUserBusy}>{addUserBusy ? 'Creating…' : 'Create'}</button>
                  <button type="button" onClick={() => setAddUserOpen(false)} className="btn rounded-xl py-2.5 text-sm">Cancel</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {lastCreatedPassword && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-950/95 p-6 shadow-2xl backdrop-blur-xl max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain">
              <p className="text-sm font-medium text-white/90">User created. Copy the password (shown only once):</p>
              <div className="mt-3 flex gap-2">
                <input type="text" readOnly value={lastCreatedPassword} className="glass-input flex-1 font-mono text-sm" />
                <button type="button" onClick={() => { navigator.clipboard.writeText(lastCreatedPassword); showToast('Copied', 'success'); }} className="btn rounded-xl px-4 py-2 text-sm">Copy</button>
              </div>
              <button type="button" onClick={() => setLastCreatedPassword(null)} className="mt-4 w-full rounded-xl bg-[var(--accent)] py-2 text-sm font-medium text-white">Done</button>
            </div>
          </div>
        )}

        {/* Edit User Modal */}
        {editUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setEditUser(null)}>
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950/85 p-6 shadow-xl backdrop-blur-xl max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain" onClick={(e) => e.stopPropagation()}>
              <h3 className="mb-4 text-lg font-semibold text-[var(--text)]">Edit user</h3>
              <form onSubmit={handleEditUser} className="space-y-3">
                <p className="text-sm text-[var(--text-muted)]">{editUser.email}</p>
                <FormRow label="Role">
                  <SmartSelect value={editUserForm.role} onChange={(r) => setEditUserForm((f) => ({ ...f, role: r }))} options={USER_ROLES.map((r) => ({ value: r, label: r }))} />
                </FormRow>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="edit-user-active" checked={editUserForm.is_active} onChange={(e) => setEditUserForm((f) => ({ ...f, is_active: e.target.checked }))} />
                  <label htmlFor="edit-user-active" className="text-sm text-[var(--text)]">Active</label>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Allowed model IDs (comma-separated)</label>
                  <input value={editUserForm.allowed_model_ids_text} onChange={(e) => setEditUserForm((f) => ({ ...f, allowed_model_ids_text: e.target.value }))} className="glass-input" placeholder="recXXX, recYYY" />
                </div>
                <div className="flex gap-2 pt-2">
                  <button type="submit" className="btn-primary flex-1 rounded-lg py-2 text-sm" disabled={editUserBusy}>{editUserBusy ? 'Saving…' : 'Save'}</button>
                  <button type="button" onClick={() => setEditUser(null)} className="btn rounded-lg py-2 text-sm">Cancel</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Add Model Modal */}
        {addModelOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setAddModelOpen(false)}>
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950/85 p-6 shadow-xl backdrop-blur-xl max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain" onClick={(e) => e.stopPropagation()}>
              <h3 className="mb-4 text-lg font-semibold text-[var(--text)]">Add model</h3>
              <form onSubmit={handleAddModel} className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Name *</label>
                  <input value={addModelForm.name} onChange={(e) => setAddModelForm((f) => ({ ...f, name: e.target.value }))} className="glass-input" required />
                </div>
                <FormRow label="Status">
                  <SmartSelect value={addModelForm.status} onChange={(s) => setAddModelForm((f) => ({ ...f, status: s }))} options={MODEL_STATUSES.map((s) => ({ value: s, label: s }))} />
                </FormRow>
                <FormRow label="Compensation type">
                  <SmartSelect
                    value={addModelForm.compensation_type}
                    onChange={(c) => {
                      setAddModelForm((f) => {
                        const next = { ...f, compensation_type: c };
                        if (c === 'Salary') { next.creator_payout_pct = ''; next.deal_threshold = ''; next.deal_flat_under_threshold = ''; next.deal_percent_above_threshold = ''; }
                        if (c === 'Percentage') { next.salary_eur = ''; next.deal_threshold = ''; next.deal_flat_under_threshold = ''; next.deal_percent_above_threshold = ''; }
                        if (c === 'Hybrid') { next.deal_threshold = ''; next.deal_flat_under_threshold = ''; next.deal_percent_above_threshold = ''; }
                        if (c === COMP_TIERED_DEAL) { next.creator_payout_pct = ''; next.salary_eur = ''; next.deal_flat_currency = 'eur'; }
                        return next;
                      });
                      setAddModelErrors({});
                    }}
                    options={COMP_TYPES.map((c) => ({ value: c, label: c }))}
                  />
                </FormRow>
                {(addModelForm.compensation_type === 'Percentage' || addModelForm.compensation_type === 'Hybrid') && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Creator payout % *</label>
                    <input type="number" step="any" min={0} max={100} value={addModelForm.creator_payout_pct} onChange={(e) => setAddModelForm((f) => ({ ...f, creator_payout_pct: e.target.value }))} className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]" />
                    <p className="mt-0.5 text-xs text-[var(--muted)]">Creator gets X% of earnings</p>
                  </div>
                )}
                {(addModelForm.compensation_type === 'Salary' || addModelForm.compensation_type === 'Hybrid') && (
                  <div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Salary amount *</label>
                        <input type="number" step="any" min={0} value={addModelForm.salary_eur} onChange={(e) => setAddModelForm((f) => ({ ...f, salary_eur: e.target.value }))} className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]" />
                      </div>
                      <div className="w-24 shrink-0">
                        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Currency</label>
                        <select value={addModelForm.salary_currency} onChange={(e) => setAddModelForm((f) => ({ ...f, salary_currency: e.target.value as 'eur' | 'usd' }))} className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]">
                          <option value="eur">EUR</option>
                          <option value="usd">USD</option>
                        </select>
                      </div>
                    </div>
                    {(() => {
                      const amt = addModelForm.salary_eur === '' ? null : Number(addModelForm.salary_eur);
                      if (amt == null || !Number.isFinite(amt) || amt < 0 || !fxRate || fxRate <= 0) return null;
                      if (addModelForm.salary_currency === 'eur') {
                        return <p className="mt-0.5 text-xs text-[var(--muted)]">≈ {formatUsdFull(round2(amt / fxRate))} USD</p>;
                      }
                      return <p className="mt-0.5 text-xs text-[var(--muted)]">≈ {formatEurFull(round2(amt * fxRate))} EUR</p>;
                    })()}
                  </div>
                )}
                {addModelForm.compensation_type === COMP_TIERED_DEAL && (
                  <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg)]/50 p-3">
                    <p className="text-xs font-medium text-[var(--text-muted)]">Rule is MONTHLY (not weekly): if monthly revenue ≤ threshold → payout = flat; if monthly revenue &gt; threshold → payout = revenue × (percent/100)</p>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Monthly threshold (USD) *</label>
                      <input type="number" step="any" min={0.01} value={addModelForm.deal_threshold} onChange={(e) => { setAddModelForm((f) => ({ ...f, deal_threshold: e.target.value })); setAddModelErrors((err) => ({ ...err, deal_threshold: undefined })); }} className={`w-full rounded-lg border px-3 py-2 text-sm text-[var(--text)] ${addModelErrors.deal_threshold ? 'border-[var(--danger)]' : 'border-[var(--border)]'} bg-[var(--bg)]`} />
                      {addModelErrors.deal_threshold && <p className="mt-1 text-xs text-[var(--danger)]">{addModelErrors.deal_threshold}</p>}
                    </div>
                    <div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Flat payout under threshold ({addModelForm.deal_flat_currency === 'usd' ? 'USD' : 'EUR'}) *</label>
                          <input type="number" step="any" min={0} value={addModelForm.deal_flat_under_threshold} onChange={(e) => { setAddModelForm((f) => ({ ...f, deal_flat_under_threshold: e.target.value })); setAddModelErrors((err) => ({ ...err, deal_flat_under_threshold: undefined })); }} className={`w-full rounded-lg border px-3 py-2 text-sm text-[var(--text)] ${addModelErrors.deal_flat_under_threshold ? 'border-[var(--danger)]' : 'border-[var(--border)]'} bg-[var(--bg)]`} />
                          {addModelErrors.deal_flat_under_threshold && <p className="mt-1 text-xs text-[var(--danger)]">{addModelErrors.deal_flat_under_threshold}</p>}
                        </div>
                        <div className="w-24 shrink-0">
                          <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Currency</label>
                          <select value={addModelForm.deal_flat_currency} onChange={(e) => setAddModelForm((f) => ({ ...f, deal_flat_currency: e.target.value as 'eur' | 'usd' }))} className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]">
                            <option value="eur">EUR</option>
                            <option value="usd">USD</option>
                          </select>
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Percent payout above threshold (%) *</label>
                      <input type="number" step="any" min={0} max={100} value={addModelForm.deal_percent_above_threshold} onChange={(e) => { setAddModelForm((f) => ({ ...f, deal_percent_above_threshold: e.target.value })); setAddModelErrors((err) => ({ ...err, deal_percent_above_threshold: undefined })); }} className={`w-full rounded-lg border px-3 py-2 text-sm text-[var(--text)] ${addModelErrors.deal_percent_above_threshold ? 'border-[var(--danger)]' : 'border-[var(--border)]'} bg-[var(--bg)]`} />
                      {addModelErrors.deal_percent_above_threshold && <p className="mt-1 text-xs text-[var(--danger)]">{addModelErrors.deal_percent_above_threshold}</p>}
                    </div>
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Notes</label>
                  <input value={addModelForm.notes} onChange={(e) => setAddModelForm((f) => ({ ...f, notes: e.target.value }))} className="glass-input" />
                </div>
                <div className="flex gap-2 pt-2">
                  <button type="submit" className="btn-primary flex-1 rounded-lg py-2 text-sm" disabled={addModelBusy}>{addModelBusy ? 'Creating…' : 'Create'}</button>
                  <button type="button" onClick={() => setAddModelOpen(false)} className="btn rounded-lg py-2 text-sm">Cancel</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit Model Modal */}
        {editModel && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setEditModel(null)}>
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950/85 p-6 shadow-xl backdrop-blur-xl max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain" onClick={(e) => e.stopPropagation()}>
              <h3 className="mb-4 text-lg font-semibold text-[var(--text)]">Edit model</h3>
              <form onSubmit={handleEditModel} className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Name *</label>
                  <input value={editModelForm.name} onChange={(e) => setEditModelForm((f) => ({ ...f, name: e.target.value }))} className="glass-input" required />
                </div>
                <FormRow label="Status">
                  <SmartSelect value={editModelForm.status} onChange={(s) => setEditModelForm((f) => ({ ...f, status: s }))} options={MODEL_STATUSES.map((s) => ({ value: s, label: s }))} />
                </FormRow>
                <FormRow label="Compensation type">
                  <SmartSelect
                    value={editModelForm.compensation_type}
                    onChange={(c) => {
                      setEditModelForm((f) => {
                        const next = { ...f, compensation_type: c };
                        if (c === 'Salary') { next.creator_payout_pct = ''; next.deal_threshold = ''; next.deal_flat_under_threshold = ''; next.deal_percent_above_threshold = ''; }
                        if (c === 'Percentage') { next.salary_eur = ''; next.deal_threshold = ''; next.deal_flat_under_threshold = ''; next.deal_percent_above_threshold = ''; }
                        if (c === 'Hybrid') { next.deal_threshold = ''; next.deal_flat_under_threshold = ''; next.deal_percent_above_threshold = ''; }
                        if (c === COMP_TIERED_DEAL) { next.creator_payout_pct = ''; next.salary_eur = ''; next.deal_flat_currency = 'eur'; }
                        return next;
                      });
                      setEditModelErrors({});
                    }}
                    options={COMP_TYPES.map((c) => ({ value: c, label: c }))}
                  />
                </FormRow>
                {(editModelForm.compensation_type === 'Percentage' || editModelForm.compensation_type === 'Hybrid') && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Creator payout % *</label>
                    <input type="number" step="any" min={0} max={100} value={editModelForm.creator_payout_pct} onChange={(e) => setEditModelForm((f) => ({ ...f, creator_payout_pct: e.target.value }))} className="glass-input" />
                    <p className="mt-0.5 text-xs text-[var(--muted)]">Creator gets X% of earnings</p>
                  </div>
                )}
                {(editModelForm.compensation_type === 'Salary' || editModelForm.compensation_type === 'Hybrid') && (
                  <div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Salary amount *</label>
                        <input type="number" step="any" min={0} value={editModelForm.salary_eur} onChange={(e) => setEditModelForm((f) => ({ ...f, salary_eur: e.target.value }))} className="glass-input" />
                      </div>
                      <div className="w-24 shrink-0">
                        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Currency</label>
                        <select value={editModelForm.salary_currency} onChange={(e) => setEditModelForm((f) => ({ ...f, salary_currency: e.target.value as 'eur' | 'usd' }))} className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]">
                          <option value="eur">EUR</option>
                          <option value="usd">USD</option>
                        </select>
                      </div>
                    </div>
                    {(() => {
                      const amt = editModelForm.salary_eur === '' ? null : Number(editModelForm.salary_eur);
                      if (amt == null || !Number.isFinite(amt) || amt < 0 || !fxRate || fxRate <= 0) return null;
                      if (editModelForm.salary_currency === 'eur') {
                        return <p className="mt-0.5 text-xs text-[var(--muted)]">≈ {formatUsdFull(round2(amt / fxRate))} USD</p>;
                      }
                      return <p className="mt-0.5 text-xs text-[var(--muted)]">≈ {formatEurFull(round2(amt * fxRate))} EUR</p>;
                    })()}
                  </div>
                )}
                {editModelForm.compensation_type === COMP_TIERED_DEAL && (
                  <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg)]/50 p-3">
                    <p className="text-xs font-medium text-[var(--text-muted)]">Rule is MONTHLY (not weekly): if monthly revenue ≤ threshold → payout = flat; if monthly revenue &gt; threshold → payout = revenue × (percent/100)</p>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Monthly threshold (USD) *</label>
                      <input type="number" step="any" min={0.01} value={editModelForm.deal_threshold} onChange={(e) => { setEditModelForm((f) => ({ ...f, deal_threshold: e.target.value })); setEditModelErrors((err) => ({ ...err, deal_threshold: undefined })); }} className={`w-full rounded-lg border px-3 py-2 text-sm text-[var(--text)] ${editModelErrors.deal_threshold ? 'border-[var(--danger)]' : 'border-[var(--border)]'} bg-[var(--bg)]`} />
                      {editModelErrors.deal_threshold && <p className="mt-1 text-xs text-[var(--danger)]">{editModelErrors.deal_threshold}</p>}
                    </div>
                    <div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Flat payout under threshold ({editModelForm.deal_flat_currency === 'usd' ? 'USD' : 'EUR'}) *</label>
                          <input type="number" step="any" min={0} value={editModelForm.deal_flat_under_threshold} onChange={(e) => { setEditModelForm((f) => ({ ...f, deal_flat_under_threshold: e.target.value })); setEditModelErrors((err) => ({ ...err, deal_flat_under_threshold: undefined })); }} className={`w-full rounded-lg border px-3 py-2 text-sm text-[var(--text)] ${editModelErrors.deal_flat_under_threshold ? 'border-[var(--danger)]' : 'border-[var(--border)]'} bg-[var(--bg)]`} />
                          {editModelErrors.deal_flat_under_threshold && <p className="mt-1 text-xs text-[var(--danger)]">{editModelErrors.deal_flat_under_threshold}</p>}
                        </div>
                        <div className="w-24 shrink-0">
                          <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Currency</label>
                          <select value={editModelForm.deal_flat_currency} onChange={(e) => setEditModelForm((f) => ({ ...f, deal_flat_currency: e.target.value as 'eur' | 'usd' }))} className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]">
                            <option value="eur">EUR</option>
                            <option value="usd">USD</option>
                          </select>
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Percent payout above threshold (%) *</label>
                      <input type="number" step="any" min={0} max={100} value={editModelForm.deal_percent_above_threshold} onChange={(e) => { setEditModelForm((f) => ({ ...f, deal_percent_above_threshold: e.target.value })); setEditModelErrors((err) => ({ ...err, deal_percent_above_threshold: undefined })); }} className={`w-full rounded-lg border px-3 py-2 text-sm text-[var(--text)] ${editModelErrors.deal_percent_above_threshold ? 'border-[var(--danger)]' : 'border-[var(--border)]'} bg-[var(--bg)]`} />
                      {editModelErrors.deal_percent_above_threshold && <p className="mt-1 text-xs text-[var(--danger)]">{editModelErrors.deal_percent_above_threshold}</p>}
                    </div>
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Notes</label>
                  <input value={editModelForm.notes} onChange={(e) => setEditModelForm((f) => ({ ...f, notes: e.target.value }))} className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]" />
                </div>
                <div className="flex gap-2 pt-2">
                  <button type="submit" className="btn-primary flex-1 rounded-lg py-2 text-sm" disabled={editModelBusy}>{editModelBusy ? 'Saving…' : 'Save'}</button>
                  <button type="button" onClick={() => setEditModel(null)} className="btn rounded-lg py-2 text-sm">Cancel</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Delete Model Confirm */}
        {deleteModel && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => !deleteModelBusy && setDeleteModel(null)}>
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-950/85 p-6 shadow-xl backdrop-blur-xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="mb-2 text-lg font-semibold text-[var(--text)]">Delete model</h3>
              <p className="mb-4 text-sm text-[var(--text-muted)]">
                This will set the model to Inactive and hide it from Active models. You can re-activate later.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => handleDeleteModel(deleteModel)} className="btn-primary flex-1 rounded-lg py-2 text-sm" disabled={deleteModelBusy}>{deleteModelBusy ? 'Deleting…' : 'Delete'}</button>
                <button type="button" onClick={() => !deleteModelBusy && setDeleteModel(null)} className="btn flex-1 rounded-lg py-2 text-sm" disabled={deleteModelBusy}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Add Team Member Modal */}
        {addMemberOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setAddMemberOpen(false)}>
            <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-950/85 p-6 shadow-xl backdrop-blur-xl max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain" onClick={(e) => e.stopPropagation()}>
              <h3 className="mb-4 text-lg font-semibold text-[var(--text)]">Add team member</h3>
              <form onSubmit={handleAddMember} className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Name *</label>
                  <input value={addMemberForm.name} onChange={(e) => setAddMemberForm((f) => ({ ...f, name: e.target.value }))} className="glass-input w-full" required />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Email (optional)</label>
                  <input type="email" value={addMemberForm.email} onChange={(e) => setAddMemberForm((f) => ({ ...f, email: e.target.value }))} className="glass-input w-full" />
                </div>
                <SmartSelect label="Department" value={addMemberForm.department} onChange={(d) => setAddMemberForm((f) => ({ ...f, department: d }))} options={TEAM_DEPARTMENTS_FOR_FORM.map((d) => ({ value: d, label: d }))} />
                <SmartSelect label="Role" value={addMemberForm.role} onChange={(r) => setAddMemberForm((f) => ({ ...f, role: r }))} options={getRoleSelectOptions(addMemberForm.department, addMemberForm.role, false)} />
                <SmartSelect label="Status" value={addMemberForm.status} onChange={(s) => setAddMemberForm((f) => ({ ...f, status: s }))} options={STATUSES.map((s) => ({ value: s, label: s }))} />
                <div className="border-t border-white/10 pt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/70">Payout</p>
                  <div className="space-y-3">
                    <SmartSelect label="Payout type" value={addMemberForm.payout_type || 'none'} onChange={(v) => setAddMemberForm((f) => ({ ...f, payout_type: v || 'none' }))} options={PAYOUT_TYPES.map((t) => ({ value: t, label: t }))} />
                    {(addMemberForm.payout_type === 'percentage' || addMemberForm.payout_type === 'hybrid') && (
                      <>
                        {addMemberForm.role === 'chatter' ? (
                          <div>
                            <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Payout % (chatters)</label>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={0.1}
                              value={addMemberForm.payout_percentage_chatters}
                              onChange={(e) =>
                                setAddMemberForm((f) => ({
                                  ...f,
                                  payout_percentage_chatters: e.target.value,
                                }))
                              }
                              className="glass-input w-full"
                            />
                          </div>
                        ) : (
                          <>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                                Chatting % (agency total net)
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step={0.1}
                                value={addMemberForm.chatting_percentage}
                                onChange={(e) =>
                                  setAddMemberForm((f) => ({
                                    ...f,
                                    chatting_percentage: Number(e.target.value || 0),
                                  }))
                                }
                                className="glass-input w-full"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                                Chatting % (messages+tips net)
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step={0.1}
                                value={addMemberForm.chatting_percentage_messages_tips}
                                onChange={(e) =>
                                  setAddMemberForm((f) => ({
                                    ...f,
                                    chatting_percentage_messages_tips: Number(e.target.value || 0),
                                  }))
                                }
                                className="glass-input w-full"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                                Gunzo % (agency total net)
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step={0.1}
                                value={addMemberForm.gunzo_percentage}
                                onChange={(e) =>
                                  setAddMemberForm((f) => ({
                                    ...f,
                                    gunzo_percentage: Number(e.target.value || 0),
                                  }))
                                }
                                className="glass-input w-full"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                                Gunzo % (messages+tips net)
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step={0.1}
                                value={addMemberForm.gunzo_percentage_messages_tips}
                                onChange={(e) =>
                                  setAddMemberForm((f) => ({
                                    ...f,
                                    gunzo_percentage_messages_tips: Number(e.target.value || 0),
                                  }))
                                }
                                className="glass-input w-full"
                              />
                            </div>
                          </>
                        )}
                      </>
                    )}
                    {(addMemberForm.payout_type === 'flat_fee' || addMemberForm.payout_type === 'hybrid') && (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Payout flat fee (€)</label>
                        <input type="number" min={0} step={0.01} value={addMemberForm.payout_flat_fee} onChange={(e) => setAddMemberForm((f) => ({ ...f, payout_flat_fee: e.target.value }))} className="glass-input w-full" />
                      </div>
                    )}
                    {addMemberForm.payout_type && addMemberForm.payout_type !== 'none' && (
                      <SmartSelect label="Frequency" value={addMemberForm.payout_frequency || 'monthly'} onChange={(v) => setAddMemberForm((f) => ({ ...f, payout_frequency: v || 'monthly' }))} options={PAYOUT_FREQUENCIES.map((f) => ({ value: f, label: f }))} />
                    )}
                    {addMemberForm.role.toLowerCase().includes('manager') && (
                      <SmartSelect
                        label="Payout scope"
                        value={addMemberForm.payout_scope || 'agency_total_net'}
                        onChange={(v) => setAddMemberForm((f) => ({ ...f, payout_scope: (v as 'agency_total_net' | 'messages_tips_net') || 'agency_total_net' }))}
                        options={[
                          { value: 'agency_total_net', label: 'agency total net' },
                          { value: 'messages_tips_net', label: 'messages + tips net' },
                        ]}
                      />
                    )}
                    {addMemberForm.role === 'chatting_manager' && (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Models scope (optional)</label>
                        <div className="max-h-32 overflow-y-auto rounded-lg border border-white/10 bg-white/5 p-2">
                          {models.filter((mo) => mo.id && String(mo.id).trim()).map((mo) => (
                            <label key={mo.id} className="flex items-center gap-2 py-1 text-sm text-white/90">
                              <input type="checkbox" checked={addMemberForm.models_scope?.includes(mo.id) ?? false} onChange={(e) => setAddMemberForm((f) => ({ ...f, models_scope: e.target.checked ? [...(f.models_scope ?? []), mo.id] : (f.models_scope ?? []).filter((id) => id !== mo.id) }))} className="rounded border-white/20" />
                              {mo.name || mo.id}
                            </label>
                          ))}
                          {models.length === 0 && <p className="text-xs text-white/50">No models</p>}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Notes</label>
                  <input value={addMemberForm.notes} onChange={(e) => setAddMemberForm((f) => ({ ...f, notes: e.target.value }))} className="glass-input w-full" />
                </div>
                <div className="flex gap-2 pt-2">
                  <button type="submit" className="btn-primary flex-1 rounded-xl py-2.5 text-sm font-medium disabled:opacity-50" disabled={addMemberBusy}>{addMemberBusy ? 'Adding…' : 'Add'}</button>
                  <button type="button" onClick={() => setAddMemberOpen(false)} className="btn rounded-xl py-2.5 text-sm">Cancel</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit Team Member Modal */}
        {editMember && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setEditMember(null)}>
            <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-950/85 p-6 shadow-xl backdrop-blur-xl max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain" onClick={(e) => e.stopPropagation()}>
              <h3 className="mb-4 text-lg font-semibold text-[var(--text)]">Edit team member</h3>
              <form onSubmit={handleEditMember} className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Name *</label>
                  <input value={editMemberForm.name} onChange={(e) => setEditMemberForm((f) => ({ ...f, name: e.target.value }))} className="glass-input w-full" required />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Email (optional)</label>
                  <input type="email" value={editMemberForm.email} onChange={(e) => setEditMemberForm((f) => ({ ...f, email: e.target.value }))} className="glass-input w-full" />
                </div>
                <SmartSelect label="Department" value={editMemberForm.department} onChange={(d) => setEditMemberForm((f) => ({ ...f, department: d }))} options={TEAM_DEPARTMENTS_FOR_FORM.map((d) => ({ value: d, label: d }))} />
                <SmartSelect label="Role" value={editMemberForm.role} onChange={(r) => setEditMemberForm((f) => ({ ...f, role: r }))} options={getRoleSelectOptions(editMemberForm.department, editMemberForm.role, true)} />
                <SmartSelect label="Status" value={editMemberForm.status} onChange={(s) => setEditMemberForm((f) => ({ ...f, status: s }))} options={STATUSES.map((s) => ({ value: s, label: s }))} />
                <div className="border-t border-white/10 pt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/70">Payout</p>
                  <div className="space-y-3">
                    <SmartSelect label="Payout type" value={editMemberForm.payout_type || 'none'} onChange={(v) => setEditMemberForm((f) => ({ ...f, payout_type: v || 'none' }))} options={PAYOUT_TYPES.map((t) => ({ value: t, label: t }))} />
                    {(editMemberForm.payout_type === 'percentage' || editMemberForm.payout_type === 'hybrid') && (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Payout % (0–100)</label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          value={editMemberForm.payout_percentage as any}
                          onChange={(e) =>
                            setEditMemberForm((f) => ({
                              ...f,
                              payout_percentage: e.target.value as any,
                            }))
                          }
                          className="glass-input w-full"
                        />
                      </div>
                    )}
                    {(editMemberForm.payout_type === 'flat_fee' || editMemberForm.payout_type === 'hybrid') && (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Payout flat fee (€)</label>
                        <input type="number" min={0} step={0.01} value={editMemberForm.payout_flat_fee} onChange={(e) => setEditMemberForm((f) => ({ ...f, payout_flat_fee: e.target.value }))} className="glass-input w-full" />
                      </div>
                    )}
                    {editMemberForm.payout_type && editMemberForm.payout_type !== 'none' && (
                      <SmartSelect label="Frequency" value={editMemberForm.payout_frequency || 'monthly'} onChange={(v) => setEditMemberForm((f) => ({ ...f, payout_frequency: v || 'monthly' }))} options={PAYOUT_FREQUENCIES.map((f) => ({ value: f, label: f }))} />
                    )}
                    {editMemberForm.role.toLowerCase().includes('manager') && (
                      <SmartSelect
                        label="Payout scope"
                        value={editMemberForm.payout_scope || 'agency_total_net'}
                        onChange={(v) => setEditMemberForm((f) => ({ ...f, payout_scope: (v as 'agency_total_net' | 'messages_tips_net') || 'agency_total_net' }))}
                        options={[
                          { value: 'agency_total_net', label: 'agency total net' },
                          { value: 'messages_tips_net', label: 'messages + tips net' },
                        ]}
                      />
                    )}
                    {editMemberForm.role === 'chatting_manager' && (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Models scope (optional)</label>
                        <div className="max-h-32 overflow-y-auto rounded-lg border border-white/10 bg-white/5 p-2">
                          {models.filter((mo) => mo.id && String(mo.id).trim()).map((mo) => (
                            <label key={mo.id} className="flex items-center gap-2 py-1 text-sm text-white/90">
                              <input type="checkbox" checked={editMemberForm.models_scope?.includes(mo.id) ?? false} onChange={(e) => setEditMemberForm((f) => ({ ...f, models_scope: e.target.checked ? [...(f.models_scope ?? []), mo.id] : (f.models_scope ?? []).filter((id) => id !== mo.id) }))} className="rounded border-white/20" />
                              {mo.name || mo.id}
                            </label>
                          ))}
                          {models.length === 0 && <p className="text-xs text-white/50">No models</p>}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Notes</label>
                  <input value={editMemberForm.notes} onChange={(e) => setEditMemberForm((f) => ({ ...f, notes: e.target.value }))} className="glass-input w-full" />
                </div>
                <div className="flex gap-2 pt-2">
                  <button type="submit" className="btn-primary flex-1 rounded-xl py-2.5 text-sm font-medium disabled:opacity-50" disabled={editMemberBusy}>{editMemberBusy ? 'Saving…' : 'Save'}</button>
                  <button type="button" onClick={() => setEditMember(null)} className="btn rounded-xl py-2.5 text-sm">Cancel</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Delete Team Member Confirm */}
        {deleteConfirmId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => !deleteBusy && setDeleteConfirmId(null)}>
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-950/85 p-6 shadow-xl backdrop-blur-xl max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain" onClick={(e) => e.stopPropagation()}>
              <h3 className="mb-2 text-lg font-semibold text-[var(--text)]">Remove team member</h3>
              <p className="mb-4 text-sm text-[var(--text-muted)]">This cannot be undone. Are you sure?</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => handleDeleteMember(deleteConfirmId)} className="btn flex-1 rounded-lg py-2 text-sm border-[var(--red)] text-[var(--red)] hover:bg-[var(--red-dim)]" disabled={deleteBusy}>{deleteBusy ? 'Removing…' : 'Remove'}</button>
                <button type="button" onClick={() => !deleteBusy && setDeleteConfirmId(null)} className="btn flex-1 rounded-lg py-2 text-sm" disabled={deleteBusy}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
