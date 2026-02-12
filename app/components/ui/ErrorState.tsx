'use client';

export default function ErrorState({
  title,
  description,
  requestId,
  className = '',
}: {
  title: string;
  description?: string;
  requestId?: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/5 p-5 py-10 text-center shadow-lg shadow-black/30 backdrop-blur-xl ${className}`}
    >
      <p className="text-base font-semibold text-white">{title}</p>
      {description && <p className="mt-2 text-sm text-white/90">{description}</p>}
      {requestId && (
        <p className="mt-3 font-mono text-xs text-white/70">Request ID: {requestId}</p>
      )}
    </div>
  );
}
