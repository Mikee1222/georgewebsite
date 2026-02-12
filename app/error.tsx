'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.error('[error boundary]', error?.message, error?.digest);
    }
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 text-white p-6">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-zinc-400 text-sm max-w-md text-center">{error?.message ?? 'An error occurred'}</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
      >
        Try again
      </button>
    </div>
  );
}
