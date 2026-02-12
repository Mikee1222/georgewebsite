'use client';

export default function TableSkeleton({
  rows = 5,
  cols = 4,
  className = '',
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/5 overflow-hidden shadow-lg shadow-black/30 backdrop-blur-xl ${className}`}
    >
      <div className="border-b border-white/10 bg-white/6 px-4 py-3">
        <div className="flex gap-4">
          {Array.from({ length: cols }).map((_, i) => (
            <div
              key={i}
              className="h-4 flex-1 max-w-[120px] animate-pulse rounded bg-white/20"
              style={{ animationDelay: `${i * 50}ms` }}
            />
          ))}
        </div>
      </div>
      <div className="divide-y divide-white/10">
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div key={rowIdx} className="flex gap-4 px-4 py-3">
            {Array.from({ length: cols }).map((_, colIdx) => (
              <div
                key={colIdx}
                className="h-4 flex-1 max-w-[100px] animate-pulse rounded bg-white/10"
                style={{ animationDelay: `${(rowIdx * cols + colIdx) * 40}ms` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
