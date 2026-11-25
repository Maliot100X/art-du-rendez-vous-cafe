import Lenis from 'lenis';
import { ScrollTrigger } from './motion';

/**
 * One rAF loop for the whole page. Lenis advances first, then ScrollTrigger
 * is told the scroll position moved, then every scroll-driven component
 * reads its own rect and writes styles directly — nothing here goes through
 * React state, so scrolling never re-renders. Still exactly one loop:
 * ScrollTrigger does not run its own ticker here.
 */

type Tick = (time: number) => void;

const subscribers = new Set<Tick>();
let lenis: Lenis | null = null;

export function startScroll(reducedMotion: boolean): () => void {
  if (!reducedMotion) {
    lenis = new Lenis({ lerp: 0.09, smoothWheel: true, wheelMultiplier: 0.9 });
  }

  // Font swaps shift layout; re-measure every ScrollTrigger once they land.
  if (typeof document !== 'undefined' && document.fonts) {
    document.fonts.ready.then(() => ScrollTrigger.refresh()).catch(() => undefined);
  }

  let raf = 0;
  const loop = (time: number) => {
    lenis?.raf(time);
    ScrollTrigger.update();
    subscribers.forEach((fn) => fn(time));
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    lenis?.destroy();
    lenis = null;
  };
}

export function onFrame(fn: Tick): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/** Smooth-scrolls to an in-page hash like `#carte`, or to the top for `#top`. */
export function scrollToHash(hash: string) {
  const target = document.querySelector<HTMLElement>(hash);
  if (target === null) return;
  if (lenis) {
    lenis.scrollTo(target, { duration: 1.6 });
  } else {
    target.scrollIntoView();
  }
  history.replaceState(null, '', hash);
}

export function useReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
