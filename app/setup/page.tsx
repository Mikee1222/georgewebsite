'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { APP_NAME } from '@/lib/constants';

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function IconMail() {
  return (
    <svg className="auth-input-icon h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg className="auth-input-icon h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
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

export default function SetupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [envMissing, setEnvMissing] = useState<string[] | null>(null);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/bootstrap-status', { credentials: 'include' }).then((r) => r.json()),
      fetch('/api/dev/env-check', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([bootstrap, env]) => {
        if ((bootstrap as { hasUsers?: boolean }).hasUsers) {
          router.replace('/login');
          return;
        }
        const missing = (env as { missing?: string[] } | null)?.missing;
        if (Array.isArray(missing) && missing.length > 0) {
          setEnvMissing(missing);
        }
        setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [router]);

  useEffect(() => {
    fetch('/api/version', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setVersion((d as { version?: string })?.version ?? null))
      .catch(() => {});
  }, []);

  function validate(): string | null {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return 'Email is required';
    if (!EMAIL_RE.test(trimmed)) return 'Please enter a valid email address';
    if (!password) return 'Password is required';
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
    }
    if (password !== confirmPassword) return 'Passwords do not match';
    return null;
  }

  const mismatch = password !== '' && confirmPassword !== '' && password !== confirmPassword;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const msg = validate();
    if (msg) {
      setError(msg);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 404) {
          router.replace('/login');
          return;
        }
        setError(data.error ?? 'Something went wrong. Please try again.');
        setSubmitting(false);
        return;
      }
      router.replace('/models');
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <div className="auth-page-bg flex items-center justify-center p-4 sm:p-6">
        <p className="text-sm text-[var(--text-muted)]">Checking…</p>
      </div>
    );
  }

  return (
    <div className="auth-page-bg flex items-center justify-center p-4 sm:p-6">
      <div className="auth-card p-6 sm:p-8">
        <header className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text)] sm:text-2xl">
            {APP_NAME}
          </h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Secure access to PnL and forecasts
          </p>
        </header>

        {envMissing && envMissing.length > 0 && (
          <div className="auth-error mb-4" role="alert">
            <IconAlert />
            <span>
              Missing env: {envMissing.join(', ')}. Use .env.local and run npm run start:local. See SETUP.md.
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="setup-email" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
              Email
            </label>
            <div className="auth-input-wrap">
              <IconMail />
              <input
                id="setup-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="admin@example.com"
              />
            </div>
          </div>
          <div>
            <label htmlFor="setup-password" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
              Password
            </label>
            <div className="auth-input-wrap">
              <IconLock />
              <input
                id="setup-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              />
            </div>
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              Minimum {MIN_PASSWORD_LENGTH} characters
            </p>
          </div>
          <div>
            <label htmlFor="setup-confirm" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
              Confirm password
            </label>
            <div
              className={`auth-input-wrap ${mismatch ? '!border-[var(--red)]' : ''}`}
            >
              <IconLock />
              <input
                id="setup-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                placeholder="Repeat password"
              />
            </div>
            {mismatch && (
              <p className="mt-1 flex items-center gap-1 text-[10px] text-[var(--red)]" role="alert">
                <IconAlert />
                Passwords do not match
              </p>
            )}
          </div>
          {error && (
            <div className="auth-error" role="alert">
              <IconAlert />
              <span>{error}</span>
            </div>
          )}
          <button
            type="submit"
            disabled={submitting || mismatch}
            className="btn-primary w-full rounded-xl px-4 py-3 text-sm font-medium disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create admin account'}
          </button>
          <p className="text-center">
            <Link
              href="/login"
              className="text-xs text-[var(--text-muted)] hover:text-[var(--accent)]"
            >
              Already initialized? Go to login
            </Link>
          </p>
        </form>

        <footer className="mt-6 border-t border-[var(--border-subtle)] pt-4 text-center text-[10px] text-[var(--text-muted)]">
          Secured access
          {version && <span> · v{version}</span>}
        </footer>
      </div>
    </div>
  );
}
