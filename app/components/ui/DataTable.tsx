'use client';

import EmptyState from './EmptyState';

/**
 * Shared table: header row bg-white/6, text-white/80, uppercase; body rows hover:bg-white/5, border-t border-white/10.
 * When rows.length === 0, shows EmptyState only (no table shell).
 */
export function TableWithEmpty<T>({
  headers,
  rows,
  emptyTitle,
  emptyDescription,
  numericColumns = [],
  renderRow,
  className = '',
}: {
  headers: React.ReactNode[];
  rows: T[];
  emptyTitle: string;
  emptyDescription?: string;
  numericColumns?: number[];
  renderRow: (row: T, i: number) => React.ReactNode;
  className?: string;
}) {
  if (!rows.length) {
    return (
      <div className={className}>
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </div>
    );
  }
  return (
    <div className={`rounded-2xl border border-white/10 overflow-hidden bg-white/5 shadow-lg shadow-black/30 backdrop-blur-xl ${className}`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead>
            <tr className="border-b border-white/10 bg-white/6">
              {headers.map((cell, i) => (
                <th
                  key={i}
                  className={`py-3 px-4 text-xs font-semibold uppercase tracking-wider text-white/80 ${
                    (numericColumns ?? []).includes(i) ? 'text-right' : 'text-left'
                  }`}
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {rows.map((row, i) => renderRow(row, i))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
