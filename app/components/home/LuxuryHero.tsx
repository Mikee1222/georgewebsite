'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const NAMES = ['boss', 'elpapadon'] as const;
const TOGGLE_INTERVAL_MS = 45000;

export default function LuxuryHero() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sweeping, setSweeping] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [sheenDone, setSheenDone] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onSweepEnd = useCallback(() => {
    setCurrentIndex((i) => (i + 1) % NAMES.length);
    setSweeping(false);
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
      setSweeping(true);
    }, TOGGLE_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [reducedMotion]);

  useEffect(() => {
    const t = setTimeout(() => setSheenDone(true), 1200);
    return () => clearTimeout(t);
  }, []);

  const cardClass = `lux-hero-card card-hero rounded-2xl border border-white/10 bg-white/5 p-8 sm:p-10 shadow-lg shadow-black/30 backdrop-blur-xl ${!sheenDone ? 'lux-hero-sheen' : ''}`;

  if (reducedMotion) {
    return (
      <div className={cardClass}>
        <div className="lux-hero">
          <p className="lux-hero-eyebrow">agency control panel</p>
          <h1 className="lux-hero-title">welcome back</h1>
          <p className="lux-hero-line lux-hero-line-static">{NAMES[1]}</p>
        </div>
      </div>
    );
  }

  const current = NAMES[currentIndex];
  const next = NAMES[(currentIndex + 1) % NAMES.length];

  return (
    <div className={cardClass}>
      <div className="lux-hero">
        <p className="lux-hero-eyebrow">agency control panel</p>
        <h1 className="lux-hero-title">welcome back</h1>
        <div className="lux-hero-line-wrap">
          <span className="lux-hero-glow" aria-hidden />
          <span className="lux-hero-line lux-hero-line-bottom">{current}</span>
          {sweeping && (
            <span
              className="lux-hero-line lux-hero-line-overlay"
              onAnimationEnd={onSweepEnd}
            >
              {next}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
