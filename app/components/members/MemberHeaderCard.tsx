'use client';

import Link from 'next/link';

export interface MemberHeaderCardProps {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  status: string;
  created_at?: string;
  canManage: boolean;
  onEdit?: () => void;
  onToggleStatus?: () => void;
}

export default function MemberHeaderCard({
  name,
  email,
  role,
  department,
  status,
  created_at,
  canManage,
  onEdit,
  onToggleStatus,
}: MemberHeaderCardProps) {
  const lastUpdated = created_at
    ? new Date(created_at).toLocaleDateString(undefined, { dateStyle: 'medium' })
    : null;

  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)]/95 px-5 py-4 shadow-lg backdrop-blur-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/members"
            className="mb-3 inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--accent)]"
          >
            ← Members
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-[var(--text)]">{name}</h1>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">{email || '—'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--text)]">
              {role}
            </span>
            <span className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--text)]">
              {department}
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                status === 'active'
                  ? 'border border-[var(--green)]/50 bg-[var(--green-dim)] text-[var(--green)]'
                  : 'border border-[var(--text-muted)]/50 bg-[var(--surface-elevated)] text-[var(--text-muted)]'
              }`}
            >
              {status}
            </span>
          </div>
          {lastUpdated && (
            <p className="mt-2 text-xs text-[var(--text-muted)]">Last updated: {lastUpdated}</p>
          )}
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-elevated)]"
              >
                Edit member
              </button>
            )}
            {onToggleStatus && (
              <button
                type="button"
                onClick={onToggleStatus}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-elevated)]"
              >
                {status === 'active' ? 'Deactivate' : 'Activate'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
