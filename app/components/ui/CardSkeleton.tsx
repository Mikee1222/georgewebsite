'use client';

export default function CardSkeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/30 backdrop-blur-xl ${className}`}
    >
      <div className="h-3 w-20 animate-pulse rounded bg-white/20" />
      <div className="mt-3 h-7 w-24 animate-pulse rounded bg-white/15" style={{ animationDelay: '50ms' }} />
    </div>
  );
}
