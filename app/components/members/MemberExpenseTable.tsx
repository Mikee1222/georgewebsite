'use client';

import { formatEurFull, formatMonthLabel } from '@/lib/format';
import SmartSelect from '@/app/components/ui/SmartSelect';

export interface MemberExpenseRow {
  id: string;
  category: string;
  amount: number;
  description: string;
  vendor?: string;
  date?: string;
  month_key: string;
  created_by: string;
  department: string;
}

export interface MemberExpenseTableProps {
  entries: MemberExpenseRow[];
  monthOptions: { id: string; month_key: string; month_name: string }[];
  selectedMonthId: string;
  onMonthChange: (monthId: string) => void;
  canManage: boolean;
  onAddExpense?: () => void;
  onDelete?: (id: string) => void;
  loading?: boolean;
}

export default function MemberExpenseTable({
  entries,
  monthOptions,
  selectedMonthId,
  onMonthChange,
  canManage,
  onAddExpense,
  onDelete,
  loading,
}: MemberExpenseTableProps) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)]/95 p-5 shadow-lg backdrop-blur-sm">
        <div className="animate-pulse space-y-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-10 rounded bg-[var(--surface-elevated)]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)]/95 p-5 shadow-lg backdrop-blur-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="glass-label">Month</label>
          <SmartSelect
            value={selectedMonthId}
            onChange={onMonthChange}
            options={monthOptions.map((m) => ({ value: m.id, label: formatMonthLabel(m.month_key) || m.month_key }))}
            placeholder="Select month"
            disabled={monthOptions.length === 0}
          />
        </div>
        {canManage && onAddExpense && (
          <button
            type="button"
            onClick={onAddExpense}
            className="btn-primary rounded-lg px-4 py-2 text-sm font-medium"
          >
            Add expense
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">
          {selectedMonthId ? 'No expenses for this month.' : 'Select a month to view expenses.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-left text-xs font-medium uppercase text-[var(--text-muted)]">
                <th className="py-2">Category</th>
                <th className="py-2">Department</th>
                <th className="py-2 text-right">Amount</th>
                <th className="py-2">Description</th>
                <th className="py-2">Date</th>
                <th className="py-2">Created by</th>
                {canManage && <th className="w-20 py-2" />}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-[var(--border-subtle)]/50 hover:bg-[var(--surface-elevated)]/30">
                  <td className="py-2 text-[var(--text)]">{e.category}</td>
                  <td className="py-2 text-[var(--text)]">{e.department}</td>
                  <td className="py-2 text-right tabular-nums text-[var(--text)]">{formatEurFull(e.amount)}</td>
                  <td className="max-w-[200px] truncate py-2 text-[var(--text-muted)]">{e.description || '—'}</td>
                  <td className="py-2 text-[var(--text-muted)]">{e.date || '—'}</td>
                  <td className="py-2 text-[var(--text-muted)]">{e.created_by || '—'}</td>
                  {canManage && onDelete && (
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => onDelete(e.id)}
                        className="text-xs text-[var(--red)] hover:underline"
                      >
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
  );
}
