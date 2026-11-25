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

  // Lazy chunks mount below the fold and change the document height by
  // thousands of px; every ScrollTrigger created before they existed
  // measures wrong until a refresh. Debounced, section-adds only.
  let refreshTimer: number | null = null;
  const mo =
    typeof MutationObserver !== 'undefined'
      ? new MutationObserver((records) => {
          const addedSection = records.some((r) =>
            [...r.addedNodes].some(
              (n) =>
                n instanceof HTMLElement &&
                (n.tagName === 'SECTION' || n.querySelector('section') !== null),
            ),
          );
          if (!addedSection) return;
          if (refreshTimer !== null) window.clearTimeout(refreshTimer);
          refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 250);
        })
      : null;
  mo?.observe(document.body, { childList: true, subtree: true });

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
    mo?.disconnect();
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);
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

/** The nav pill height the scroll target should clear. */
const SCROLL_OFFSET = 96;

/**
 * Smooth-scrolls to an in-page hash like `#carte`, or to the top for `#top`.
 *
 * Two failure modes this guards against (both measured on the live site):
 * 1. The target section is a lazy chunk that has not mounted yet — the
 *    old code returned silently and the tap did nothing. Now it waits
 *    for the element to appear (up to 6 s) and then scrolls.
 * 2. The target's offset moves while the glide runs (chunks / images /
 *    fonts still landing shift the document by thousands of px). After
 *    the glide, if the target is still more than 80 px from where it
 *    should be and the visitor has not scrolled away meanwhile, it
 *    glides once more to the corrected position.
 */
export function scrollToHash(hash: string) {
  history.replaceState(null, '', hash);
  if (hash === '#top') {
    if (lenis) lenis.scrollTo(0, { duration: 1.2 });
    else window.scrollTo({ top: 0 });
    return;
  }

  const scrollToEl = (el: HTMLElement) => {
    // No explicit offset: every section carries scroll-mt-24 (96px) and
    // Lenis honours scroll-margin — passing offset -96 as well landed
    // the target 192px down (measured), showing the previous section's
    // tail under the nav.
    const go = () => {
      if (lenis) lenis.scrollTo(el, { duration: 1.6 });
      else el.scrollIntoView();
    };
    go();
    // Re-assert the landing once, shortly after the glide should have
    // finished. Bounded: a single correction, only when the visitor has
    // not taken over the scroll themselves. Threshold 40px: font swaps
    // above the target grow the hero + menu by ~69px during a 1.6s
    // glide, and a 68px drift used to slip under the old 80px bar —
    // leaving the previous section's tail (e.g. Visit's "ÉTAPE")
    // peeking under the nav after landing on the agent.
    const glideEndY = el.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET;
    window.setTimeout(() => {
      const drift = el.getBoundingClientRect().top - SCROLL_OFFSET;
      const userTookOver = Math.abs(window.scrollY - glideEndY) > 120;
      if (Math.abs(drift) > 40 && !userTookOver) {
        if (lenis) lenis.scrollTo(el, { duration: 0.7 });
        else window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET });
      }
    }, 1900);
  };

  const target = document.querySelector<HTMLElement>(hash);
  if (target !== null) {
    scrollToEl(target);
    return;
  }

  // Target not mounted yet (lazy chunk in flight): wait for it.
  const mo = new MutationObserver(() => {
    const el = document.querySelector<HTMLElement>(hash);
    if (el === null) return;
    mo.disconnect();
    window.clearTimeout(timeout);
    scrollToEl(el);
  });
  mo.observe(document.body, { childList: true, subtree: true });
  const timeout = window.setTimeout(() => mo.disconnect(), 6000);
}

export function useReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
