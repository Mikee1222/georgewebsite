'use client';

/**
 * Shared chart wrapper for Recharts. Fixes:
 * - Explicit height + width so chart scales to container
 * - overflow: visible so bars/curves are not clipped
 * - Chart area on top z-index (no overlay covering chart)
 * - No overflow-hidden/transform on chart container (avoids canvas clipping)
 */
export default function ChartCard({
  title,
  children,
  className = '',
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] ${className}`}
      style={{ overflow: 'visible' }}
    >
      {title && (
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {title}
        </h3>
      )}
      <div
        className="relative z-10 w-full min-h-[280px] overflow-visible"
        style={{ minHeight: 280 }}
      >
        {children}
      </div>
    </div>
  );
}
