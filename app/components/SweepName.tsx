'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const NAMES = ['boss', 'elpapadon'] as const;
const TOGGLE_INTERVAL_MS = 30000;

export default function SweepName() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showOverlay, setShowOverlay] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onAnimationEnd = useCallback(() => {
    setCurrentIndex((i) => (i + 1) % NAMES.length);
    setShowOverlay(false);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    intervalRef.current = setInterval(() => {
      setShowOverlay(true);
    }, TOGGLE_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [reducedMotion]);

  if (reducedMotion) {
    return <span className="sweep-name-text">{NAMES[1]}</span>;
  }

  const current = NAMES[currentIndex];
  const next = NAMES[(currentIndex + 1) % NAMES.length];

  return (
    <span className="sweep-name-wrap relative inline-block">
      <span className="sweep-name-text sweep-name-bottom">{current}</span>
      {showOverlay && (
        <span
          className="sweep-name-overlay absolute inset-0 overflow-hidden"
          onAnimationEnd={onAnimationEnd}
        >
          <span className="sweep-name-text block">{next}</span>
        </span>
      )}
    </span>
  );
}
