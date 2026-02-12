'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Scrolls to top on route change (pathname change). Uses window + document
 * so it works when the document/body is the scroll container (no custom scroll div).
 * Safe for Next.js App Router.
 */
export default function ScrollToTop() {
  const pathname = usePathname();

  useEffect(() => {
    // Next.js often batches updates; requestAnimationFrame ensures layout has run
    const id = requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      if (typeof document !== 'undefined') {
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }
    });
    return () => cancelAnimationFrame(id);
  }, [pathname]);

  return null;
}
