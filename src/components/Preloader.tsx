import {useEffect, useRef, useState} from 'react';

/**
 * NAÏADE's curtain preloader: holds on the wordmark while the 3D scene builds
 * (renderer → studio environment → set → first rendered frame), then lifts
 * like a curtain. Gives up waiting after 6 s. Adds a norrav-style big
 * counter (technique re-implemented) that eases toward the real progress.
 */
export function Preloader({progress}: {progress: number}) {
  const [gone, setGone] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const done = progress >= 1 || timedOut;

  useEffect(() => {
    const t = window.setTimeout(() => setTimedOut(true), 6000);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setGone(true), 1600);
    return () => window.clearTimeout(t);
  }, [done]);

  const countRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let shown = 0;
    let raf = 0;
    const goal = done ? 1 : progress;
    const step = () => {
      shown += (goal - shown) * 0.12 + 0.002;
      if (shown > goal) shown = goal;
      if (countRef.current) countRef.current.textContent = String(Math.round(shown * 100)).padStart(3, '0');
      if (shown < goal) raf = requestAnimationFrame(step);
    };
    shown = Number(countRef.current?.textContent ?? 0) / 100;
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [progress, done]);

  if (gone) return null;

  return (
    <div
      aria-hidden
      data-preloader
      className={`fixed inset-0 z-[70] grid place-items-center bg-ink transition-[clip-path] delay-300 duration-[1200ms] ease-drawer ${
        done ? '[clip-path:inset(0_0_100%_0)]' : '[clip-path:inset(0_0_0_0)]'
      }`}
    >
      <div className="text-center">
        <p className="label text-gold-light">Café · Bar · Laeken</p>
        <p className="display mt-4 text-[clamp(44px,8vw,104px)] text-cream">
          Art du <em className="text-gold-light">Rendez-Vous</em>
        </p>
        <div className="mx-auto mt-6 h-px w-[min(240px,50vw)] overflow-hidden bg-cream/10">
          <div
            className="h-full origin-left bg-gold transition-transform duration-500 ease-silk"
            style={{transform: `scaleX(${done ? 1 : progress})`}}
          />
        </div>
        <p className="label mt-4 text-cream/40">Rue des Artistes 1A · 1020 Bruxelles</p>
      </div>
      <div className="absolute right-5 bottom-4 md:right-10 md:bottom-6">
        <span ref={countRef} className="display text-[clamp(72px,14vw,200px)] leading-none text-cream/90 tabular-nums">
          000
        </span>
        <span className="label ml-2 align-top text-cream/40">%</span>
      </div>
    </div>
  );
}
