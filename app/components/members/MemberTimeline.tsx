'use client';

export interface TimelineItem {
  timestamp: string;
  actor: string;
  action: string;
  table: string;
  record_id: string;
  field_name?: string;
  old_value?: string;
  new_value?: string;
  summary: string;
}

export interface MemberTimelineProps {
  items: TimelineItem[];
  loading?: boolean;
}

export default function MemberTimeline({ items, loading }: MemberTimelineProps) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)]/95 p-5 shadow-lg backdrop-blur-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">Activity timeline</h2>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-[var(--surface-elevated)]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)]/95 p-5 shadow-lg backdrop-blur-sm">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">Activity timeline</h2>
      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">No activity yet.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item, i) => (
            <li
              key={`${item.timestamp}-${item.record_id}-${i}`}
              className="flex flex-wrap gap-3 rounded-lg border border-[var(--border-subtle)]/50 bg-[var(--bg)]/50 px-4 py-3"
            >
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  item.table === 'team_members'
                    ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                    : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                }`}
              >
                {item.table === 'team_members' ? 'Member' : 'Expense'}
              </span>
              <span className="text-sm text-[var(--text)]">{item.summary}</span>
              <span className="ml-auto text-xs text-[var(--text-muted)]">
                {item.timestamp ? new Date(item.timestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—'}
              </span>
              {item.actor && (
                <span className="text-xs text-[var(--text-muted)]">by {item.actor}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
