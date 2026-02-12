'use client';

import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--bg-0)] text-white p-6 overscroll-contain">
      <h1 className="text-xl font-semibold">404 – Page not found</h1>
      <p className="text-zinc-400 text-sm">The page you’re looking for doesn’t exist.</p>
      <Link
        href="/"
        className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
      >
        Go home
      </Link>
    </div>
  );
}
