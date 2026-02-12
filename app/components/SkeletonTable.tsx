'use client';

interface SkeletonTableProps {
  /** Number of header columns (including frozen month column if any) */
  cols?: number;
  /** Number of body rows */
  rows?: number;
  /** If true, first column is frozen (wider label style) */
  hasFrozenCol?: boolean;
}

export default function SkeletonTable({
  cols = 10,
  rows = 6,
  hasFrozenCol = false,
}: SkeletonTableProps) {
  const headerCols = hasFrozenCol ? 1 + cols - 1 : cols;
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] shadow-[var(--shadow-sm)]">
      <table className="w-full min-w-[800px] border-collapse">
        <thead>
          <tr>
            {Array.from({ length: headerCols }).map((_, i) => (
              <th
                key={i}
                className={`border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2.5 text-left ${
                  hasFrozenCol && i === 0 ? 'sticky left-0 z-10' : ''
                }`}
              >
                <div
                  className="h-3 w-12 animate-pulse rounded bg-[var(--border)]"
                  style={{ maxWidth: i === 0 && hasFrozenCol ? 64 : 48 }}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, rowIdx) => (
            <tr
              key={rowIdx}
              className={
                rowIdx % 2 === 0
                  ? 'bg-[rgba(255,255,255,0.02)]'
                  : undefined
              }
            >
              {Array.from({ length: headerCols }).map((_, colIdx) => (
                <td
                  key={colIdx}
                  className={`border-b border-[var(--border-subtle)] px-3 py-2.5 ${
                    hasFrozenCol && colIdx === 0 ? 'sticky left-0 z-[1]' : ''
                  }`}
                >
                  <div
                    className="h-4 w-14 animate-pulse rounded bg-[var(--surface-elevated)]"
                    style={{
                      maxWidth: hasFrozenCol && colIdx === 0 ? 80 : 56,
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
