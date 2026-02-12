const FALLBACK_DELAY_MS = 800;

/**
 * Attempts to open native app via deep link; falls back to web URL if app not installed.
 * 1) Sets window.location.href = appUrl (triggers app open)
 * 2) After 800ms, if page still visible, opens webUrl in new tab
 * 3) Clears timer on visibilitychange (app opened → browser hidden)
 */
export function openExternalApp({ appUrl, webUrl }: { appUrl: string; webUrl: string }): void {
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  const clearFallback = () => {
    if (fallbackTimer != null) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };

  const onVisibilityChange = () => {
    if (document.visibilityState !== 'visible') {
      clearFallback();
    }
  };

  document.addEventListener('visibilitychange', onVisibilityChange);

  fallbackTimer = setTimeout(() => {
    clearFallback();
    if (document.visibilityState === 'visible') {
      window.open(webUrl, '_blank', 'noopener,noreferrer');
    }
  }, FALLBACK_DELAY_MS);

  window.location.href = appUrl;
}
