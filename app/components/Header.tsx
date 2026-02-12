'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { APP_NAME } from '@/lib/constants';

export default function Header({
  onMenuClick,
  onSidebarToggle,
  sidebarOpen = true,
  showMenuButton = false,
}: {
  onMenuClick?: () => void;
  onSidebarToggle?: () => void;
  sidebarOpen?: boolean;
  showMenuButton?: boolean;
}) {
  const router = useRouter();
  const toggle = onSidebarToggle ?? onMenuClick;

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-white/[0.04] px-4 py-3 md:px-6 md:py-4 backdrop-blur-xl">
      <div className="flex items-center gap-3 min-w-0">
        {showMenuButton && toggle && (
          <button
            type="button"
            onClick={toggle}
            aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/90 transition-colors hover:bg-white/10 hover:border-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple-500)]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-0)]"
          >
            {sidebarOpen ? (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5 7.5M3 12h18" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            )}
          </button>
        )}
        <span className="text-sm md:text-base font-semibold tracking-wide text-white/95 truncate">
          {APP_NAME}
        </span>
      </div>
      <button
        type="button"
        onClick={handleLogout}
        aria-label="Sign out"
        className="shrink-0 flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] bg-gradient-to-r from-white/[0.08] to-white/[0.02] px-2.5 py-2 md:px-4 md:py-2 text-sm font-medium text-white/90 shadow-sm transition-all duration-200 hover:border-[var(--purple-500)]/50 hover:bg-white/10 hover:shadow-[0_0_20px_rgba(168,85,247,0.12)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple-500)]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-0)] active:scale-[0.98] active:border-[var(--purple-500)]/30 disabled:opacity-50 disabled:pointer-events-none disabled:scale-100"
      >
        <LogOut className="h-4 w-4 shrink-0" aria-hidden />
        <span className="hidden md:inline">Sign out</span>
      </button>
    </header>
  );
}
