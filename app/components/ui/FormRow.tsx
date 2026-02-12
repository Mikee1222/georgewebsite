'use client';

export default function FormRow({
  label,
  required,
  error,
  children,
  className = '',
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="glass-label">
        {label}
        {required && <span className="text-white/50"> *</span>}
      </label>
      {children}
      {error && <p className="text-xs text-[var(--red)]">{error}</p>}
    </div>
  );
}
