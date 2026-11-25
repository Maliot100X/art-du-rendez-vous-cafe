import { useEffect } from 'react';

/**
 * Reveal system: `[data-reveal]` elements fade and rise once when they enter
 * the viewport. One-shot, staggered with `--d` (transition-delay). A
 * MutationObserver catches late mounts so nothing stays hidden.
 * Honours prefers-reduced-motion: reveals are instant.
 */
export function useReveal() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -5% 0px', threshold: 0.05 },
    );

    const observeAll = () => {
      document.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-in)').forEach((el) => io.observe(el));
    };
    observeAll();

    const mo = new MutationObserver(observeAll);
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);
}
