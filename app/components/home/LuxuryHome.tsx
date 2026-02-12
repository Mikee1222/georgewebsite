'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getCurrentMonthKey } from '@/lib/months';
import CeoToolsCard from '@/app/components/home/CeoToolsCard';

function openExternalApp(appUrl: string, webUrl: string) {
  window.location.href = appUrl;
  const t = setTimeout(() => {
    if (document.visibilityState === 'visible') {
      window.open(webUrl, '_blank');
    }
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }, 700);
  const onVisibilityChange = () => {
    clearTimeout(t);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
}

/** Paste real Spotify track ID from open.spotify.com/track/XXXXX */
const SPOTIFY_HER_EYES_TRACK_ID = '0placeholder';
const SPOTIFY_HER_EYES_APP_URL = `spotify:track:${SPOTIFY_HER_EYES_TRACK_ID}`;
const SPOTIFY_HER_EYES_WEB_URL = `https://open.spotify.com/track/${SPOTIFY_HER_EYES_TRACK_ID}`;
const TELEGRAM_RESOLVE_DOMAIN = 'your_handle';
const TELEGRAM_APP_URL = `tg://resolve?domain=${TELEGRAM_RESOLVE_DOMAIN}`;
const TELEGRAM_WEB_URL = 'https://t.me/';
const REVOLUT_APP_URL = 'revolut://';
const REVOLUT_WEB_URL = 'https://revolut.com/';
const REVOLUT_BUSINESS_APP_URL = 'revolutbusiness://';
const REVOLUT_BUSINESS_WEB_URL = 'https://www.revolut.com/business/';

function ShortcutButton({
  label,
  appUrl,
  webUrl,
  icon,
  isPlaying,
  onAfterClick,
}: {
  label: string;
  appUrl: string;
  webUrl: string;
  icon?: React.ReactNode;
  isPlaying?: boolean;
  onAfterClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        openExternalApp(appUrl, webUrl);
        onAfterClick?.();
      }}
      className="home-shortcut-btn flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] text-sm font-medium text-white/90 transition-[transform,box-shadow,background] duration-200 hover:bg-white/[0.06] hover:shadow-[0_4px_12px_rgba(0,0,0,0.25)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple-500)]/30 active:scale-[0.98]"
    >
      {icon}
      <span className="home-shortcut-label">{label}</span>
      {isPlaying && (
        <span className="home-shortcut-playing flex h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--green)] shadow-[0_0_6px_var(--green)]" aria-hidden />
      )}
    </button>
  );
}

const IDENTITY_PAIRS = [
  { name: 'ELPAPADON', label: 'FOUNDER' },
  { name: 'GEORGE', label: 'BOSS' },
] as const;
const TOGGLE_INTERVAL_MS = 30_000;
const SWEEP_DURATION_MS = 1_100;
const TEXT_SWAP_AT_MS = Math.round(SWEEP_DURATION_MS * 0.5);

export default function LuxuryHome() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sweepActive, setSweepActive] = useState(false);
  const [identityJustSwapped, setIdentityJustSwapped] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [monthKey, setMonthKey] = useState('');
  const [modelCount, setModelCount] = useState<number | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [spotifyPlaying, setSpotifyPlaying] = useState(false);
  const spotifyPlayingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const swapRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pathname = usePathname();

  useEffect(() => {
    setMonthKey(getCurrentMonthKey());
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [mounted]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const runSweep = () => {
    setIdentityJustSwapped(false);
    setSweepActive(true);
    if (swapRef.current) clearTimeout(swapRef.current);
    if (resetRef.current) clearTimeout(resetRef.current);
    swapRef.current = setTimeout(() => {
      setCurrentIndex((i) => (i + 1) % IDENTITY_PAIRS.length);
      setIdentityJustSwapped(true);
    }, TEXT_SWAP_AT_MS);
    resetRef.current = setTimeout(() => {
      setSweepActive(false);
      setIdentityJustSwapped(false);
    }, SWEEP_DURATION_MS);
  };

  useEffect(() => {
    if (reducedMotion) return;
    runSweep();
    intervalRef.current = setInterval(runSweep, TOGGLE_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (swapRef.current) clearTimeout(swapRef.current);
      if (resetRef.current) clearTimeout(resetRef.current);
    };
  }, [reducedMotion]);

  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const [modelsRes, membersRes] = await Promise.all([
          fetch('/api/models', { credentials: 'include' }),
          fetch('/api/team-members', { credentials: 'include' }),
        ]);
        const models = modelsRes.ok ? await modelsRes.json() : [];
        const members = membersRes.ok ? await membersRes.json() : [];
        setModelCount(Array.isArray(models) ? models.length : 0);
        setMemberCount(Array.isArray(members) ? members.length : 0);
        setLastRefresh(new Date());
      } catch {
        setModelCount(null);
        setMemberCount(null);
      }
    };
    fetchCounts();
  }, []);

  const identity = IDENTITY_PAIRS[currentIndex];
  const cardClass = `lux-hero-card card-hero rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 sm:p-8 shadow-[0_4px_24px_rgba(0,0,0,0.4)] backdrop-blur-[16px] overflow-hidden ${sweepActive ? 'lux-hero-sweep-active' : ''}`;

  const formatMonth = (key: string) => {
    if (!key) return '—';
    const [y, m] = key.split('-');
    const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1);
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  const timeOptionsDesktop: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  const timeOptionsMobile: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };

  return (
    <div className="flex w-full min-w-0 max-w-[100%] flex-col items-stretch justify-start gap-6 md:max-w-none">
      {/* Hero: full-width on mobile; no fixed height or bottom positioning */}
      <div className={`${cardClass} relative w-full min-w-0 max-w-[100%] lux-hero-home md:max-w-none`}>
        {sweepActive && (
          <div className="lux-hero-sweep-overlay" aria-hidden />
        )}
        <p className="lux-hero-eyebrow absolute left-6 top-6 sm:left-8 sm:top-8" aria-hidden>
          AGENCY CONTROL PANEL
        </p>
        <div className="lux-hero lux-hero-home-inner relative z-10 flex flex-col items-center gap-3 pt-4 pb-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:pt-14 sm:pb-6">
          <h1 className="lux-hero-title lux-hero-greeting order-1 text-center sm:order-none sm:text-left">WELCOME BACK</h1>
          <div
            key={identity.name}
            className={`lux-hero-identity order-2 flex flex-col items-center sm:items-end sm:justify-center ${identityJustSwapped ? 'lux-identity-sweep' : ''}`}
          >
            <p className="lux-hero-primary-name text-center sm:text-right">{identity.name}</p>
            <p className="lux-hero-secondary-label text-center sm:text-right">{identity.label}</p>
          </div>
        </div>
      </div>

      {/* Three luxury cards: single column on mobile, 3 columns on md+ */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Today: desktop no seconds, mobile with seconds + optional pulse */}
        <div className="card-premium w-full min-w-0 max-w-[100%] rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 sm:p-6 backdrop-blur-[16px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] md:max-w-none">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">
            Today
          </p>
          <p className="mt-2 text-base font-semibold text-white/90 sm:text-lg">
            {formatMonth(monthKey)}
          </p>
          <p className="mt-1 text-sm tabular-nums text-white/60 sm:text-sm">
            {!mounted ? (
              '—'
            ) : now === null ? (
              '—'
            ) : (
              <>
                <span className="hidden sm:inline">{now.toLocaleTimeString([], timeOptionsDesktop)}</span>
                <span className="home-time-mobile inline sm:hidden">{now.toLocaleTimeString([], timeOptionsMobile)}</span>
              </>
            )}
          </p>
        </div>

        {/* Quick Actions: sidebar accent, hover lift no glow; mobile 2 per row */}
        <div className="card-premium w-full min-w-0 max-w-[100%] rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 sm:p-6 backdrop-blur-[16px] md:max-w-none">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">
            Quick Actions
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Link
              href="/models"
              className={`home-quick-action ${pathname === '/models' ? 'active' : ''}`}
            >
              Models
            </Link>
            <Link
              href="/payments"
              className={`home-quick-action ${pathname === '/payments' ? 'active' : ''}`}
            >
              Payments
            </Link>
            <Link
              href="/team"
              className={`home-quick-action ${pathname === '/team' ? 'active' : ''}`}
            >
              Members
            </Link>
          </div>
        </div>

        {/* Health */}
        <div className="card-premium w-full min-w-0 max-w-[100%] rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 sm:p-6 backdrop-blur-[16px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] md:max-w-none">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">
            Health
          </p>
          <p className="mt-2 text-sm text-white/80">
            {modelCount != null && memberCount != null ? (
              <>
                {modelCount} models · {memberCount} members
              </>
            ) : (
              '—'
            )}
          </p>
          <p className="mt-1 text-xs text-white/50">
            {lastRefresh
              ? `Refreshed ${lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : '—'}
          </p>
        </div>
      </div>

      {/* CEO Tools + Shortcuts: single column on mobile, 3 columns on md+ */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="w-full min-w-0 max-w-[100%] md:col-span-2 md:max-w-none">
          <CeoToolsCard />
        </div>
        <div className="card-premium flex w-full min-w-0 max-w-[100%] flex-col rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 sm:p-6 backdrop-blur-[16px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] md:max-w-none">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">
            Shortcuts
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <ShortcutButton
              label="Spotify"
              appUrl={SPOTIFY_HER_EYES_APP_URL}
              webUrl={SPOTIFY_HER_EYES_WEB_URL}
              isPlaying={spotifyPlaying}
              onAfterClick={() => {
                if (spotifyPlayingRef.current) clearTimeout(spotifyPlayingRef.current);
                setSpotifyPlaying(true);
                spotifyPlayingRef.current = setTimeout(() => {
                  setSpotifyPlaying(false);
                  spotifyPlayingRef.current = null;
                }, 8000);
              }}
            />
            <ShortcutButton label="Telegram" appUrl={TELEGRAM_APP_URL} webUrl={TELEGRAM_WEB_URL} />
            <ShortcutButton label="Revolut" appUrl={REVOLUT_APP_URL} webUrl={REVOLUT_WEB_URL} />
            <ShortcutButton label="Revolut Business" appUrl={REVOLUT_BUSINESS_APP_URL} webUrl={REVOLUT_BUSINESS_WEB_URL} />
          </div>
        </div>
      </div>
    </div>
  );
}
