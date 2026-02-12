'use client';

export default function GlassCard({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`glass-card rounded-2xl border border-white/10 bg-white/8 p-5 shadow-2xl shadow-black/40 backdrop-blur-xl ${className}`}>
      {children}
    </div>
  );
}
