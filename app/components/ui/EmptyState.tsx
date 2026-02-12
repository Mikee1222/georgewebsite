'use client';

export default function EmptyState({
  title,
  description,
  ctaText,
  onCta,
  icon,
  action,
  className = '',
}: {
  title: string;
  description?: string;
  ctaText?: string;
  onCta?: () => void;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`card-hero rounded-2xl border border-white/10 bg-white/5 px-8 py-14 text-center shadow-lg shadow-black/30 backdrop-blur-xl ${className}`}
    >
      {icon && <div className="mb-4 flex justify-center text-white/50">{icon}</div>}
      <p className="text-lg font-semibold tracking-tight text-white/95">{title}</p>
      {description && <p className="mt-2 max-w-md mx-auto text-sm text-white/55 leading-relaxed">{description}</p>}
      {(action || (ctaText && onCta)) && (
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {action}
          {ctaText && onCta && (
            <button
              type="button"
              onClick={onCta}
              className="rounded-xl border border-[var(--purple-500)]/50 bg-[var(--purple-500)]/20 px-5 py-2.5 text-sm font-medium text-white/95 transition-all duration-200 hover:bg-[var(--purple-500)]/30 hover:shadow-[0_0_20px_rgba(168,85,247,0.2)] focus:ring-2 focus:ring-[var(--purple-500)]/40"
            >
              {ctaText}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
