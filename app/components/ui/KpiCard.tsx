'use client';

export default function KpiCard({
  label,
  value,
  subtext,
  className = '',
  valueClassName = '',
}: {
  label: string;
  value: React.ReactNode;
  subtext?: string;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-[var(--glass-border)] bg-[var(--glass)] p-5 shadow-[var(--shadow-sm)] backdrop-blur-xl ${className}`}
      style={{
        background: 'var(--glass)',
        boxShadow: 'var(--shadow-sm), 0 0 0 1px rgba(0,0,0,0.05)',
      }}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
        {label}
      </p>
      <p className={`mt-1 tabular-nums text-xl font-semibold text-[var(--text)] ${valueClassName ?? ''}`}>
        {value}
      </p>
      {subtext != null && subtext !== '' && (
        <p className="mt-0.5 text-xs text-[var(--muted)]">{subtext}</p>
      )}
    </div>
  );
}
