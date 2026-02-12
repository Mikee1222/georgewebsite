'use client';

export default function SkeletonKpiBar() {
  return (
    <div
      className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] px-5 py-4"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="mb-3 h-3 w-24 animate-pulse rounded bg-[var(--surface-elevated)]" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i}>
            <div className="mb-1 h-3 w-20 animate-pulse rounded bg-[var(--surface-elevated)]" />
            <div className="h-6 w-16 animate-pulse rounded bg-[var(--surface-elevated)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
