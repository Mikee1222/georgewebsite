'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { APP_NAME } from '@/lib/constants';

function IconMail() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}

function IconEye({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    );
  }
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="32" strokeDashoffset="12" className="opacity-70" />
    </svg>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const [envMissing, setEnvMissing] = useState<string[] | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    Promise.all([
      fetch('/api/bootstrap-status', { credentials: 'include' }).then((r) => r.json()),
      fetch('/api/dev/env-check', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([bootstrap, env]) => {
        const users = (bootstrap as { hasUsers?: boolean }).hasUsers ?? false;
        setHasUsers(users);
        const missing = (env as { missing?: string[] } | null)?.missing;
        if (Array.isArray(missing) && missing.length > 0) {
          setEnvMissing(missing);
        }
        setChecking(false);
      })
      .catch(() => {
        setHasUsers(false);
        setChecking(false);
      });
  }, []);

  useEffect(() => {
    fetch('/api/version', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setVersion((d as { version?: string })?.version ?? null))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      if (res.status === 401) setError('Invalid email or password');
      else if (res.status === 403) setError('Account inactive');
      else if (res.status === 429) setError('Too many attempts. Try again later.');
      else setError('Something went wrong. Please try again.');
      setSubmitting(false);
      return;
    }
    setSuccess(true);
    setTimeout(() => {
      router.push('/home');
      router.refresh();
    }, 450);
  }

  if (checking) {
    return (
      <div className="auth-page-bg flex min-h-screen items-center justify-center p-4 sm:p-6">
        <div className="auth-page-sweep" aria-hidden />
        <p className="relative z-10 text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  return (
    <div className="auth-page-bg flex min-h-screen items-center justify-center p-4 py-8 sm:p-6 sm:py-12">
      <div className="auth-page-sweep" aria-hidden />
      <div className="auth-card auth-card-sweep relative shrink-0 px-7 py-8 sm:px-8 sm:py-8">
        <header className="auth-header-row mb-3 flex items-start justify-between gap-3">
          <div className="auth-title-block">
            <h1 className="auth-title-line text-2xl font-semibold leading-tight tracking-tight text-[var(--text)] sm:text-3xl">
              Agency Financial
            </h1>
            <div className="auth-title-line auth-title-os text-2xl font-semibold leading-tight tracking-tight text-[var(--text)] sm:text-3xl">
              OS
            </div>
          </div>
          <span className="auth-badge shrink-0 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-white/80 shadow-[0_0_12px_rgba(168,85,247,0.2)]">
            Encrypted session
          </span>
        </header>

        <div className="auth-content-grid flex flex-col gap-4">
          <p className="auth-subheader text-xs font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">
            Secure access to PnL and ops
          </p>

          {envMissing && envMissing.length > 0 && (
            <div className="auth-error" role="alert">
              <IconAlert />
              <span>
                Missing env: {envMissing.join(', ')}. Use .env.local and run npm run start:local. See SETUP.md.
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form flex flex-col gap-4">
            <div className="auth-field">
              <label htmlFor="email" className="auth-label mb-1.5 block">
                Email
              </label>
              <div className={`auth-input-wrap ${error ? 'auth-input-error' : ''}`}>
                <span className="auth-input-icon-left flex h-4 w-4 shrink-0 items-center justify-center">
                  <IconMail />
                </span>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </div>
            </div>
            <div className="auth-field">
              <label htmlFor="password" className="auth-label mb-1.5 block">
                Password
              </label>
              <div className={`auth-input-wrap ${error ? 'auth-input-error' : ''}`}>
                <span className="auth-input-icon-left flex h-4 w-4 shrink-0 items-center justify-center">
                  <IconLock />
                </span>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                />
                <span className="auth-input-icon-right flex h-4 w-4 shrink-0 items-center justify-center">
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <IconEye open={showPassword} />
                  </button>
                </span>
              </div>
            </div>
            {error && (
              <div className="auth-error" role="alert">
                <IconAlert />
                <span>{error}</span>
              </div>
            )}
            <button
              type="submit"
              disabled={submitting}
              className={`auth-btn-primary flex w-full items-center justify-center gap-2 ${success ? 'auth-btn-success' : ''}`}
            >
              {submitting ? (
                <>
                  <Spinner />
                  <span>Signing in…</span>
                </>
              ) : success ? (
                <>
                  <IconCheck />
                  <span>Signed in</span>
                </>
              ) : (
                'Sign in'
              )}
            </button>
            {hasUsers === false && (
              <p className="text-center">
                <Link
                  href="/setup"
                  className="text-xs text-[var(--muted)] hover:text-[var(--purple-500)] transition-colors"
                >
                  First time here? Create admin
                </Link>
              </p>
            )}
          </form>

          <hr className="auth-divider my-0 border-0 border-t border-white/10" />

          <footer className="auth-footer text-center">
            <p className="text-[11px] font-medium tracking-[0.08em] text-white/50">
              {APP_NAME} · Secure session
              {version && <span className="ml-1 text-[9px] opacity-70">v{version}</span>}
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}
