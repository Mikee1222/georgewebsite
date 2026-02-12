'use client';

export default function Toolbar({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 md:p-5 shadow-2xl shadow-black/40 backdrop-blur-xl ${className}`}
    >
      {children}
    </div>
  );
}
