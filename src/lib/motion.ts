/**
 * GSAP + ScrollTrigger layer (GSAP 3.12, free standard licence).
 *  - Lenis drives the scroll; ScrollTrigger updates on every Lenis scroll.
 *  - SplitTitle.tsx: mojito-cocktail's split-letter title entrance.
 *  - clipTitles(): spylt's ClipPathTitle — a polygon clip that opens with scrub.
 */
import {gsap} from 'gsap';
import {ScrollTrigger} from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);
// QA hook: ?qa exposes gsap so screenshot scripts can freeze mid-animation
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('qa')) (window as unknown as {__gsap: typeof gsap}).__gsap = gsap;
export {gsap, ScrollTrigger};

export function clipTitles(root: ParentNode = document) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tweens: gsap.core.Tween[] = [];
  root.querySelectorAll<HTMLElement>('[data-clip]').forEach((el) => {
    if (reduced) return;
    tweens.push(
      gsap.fromTo(
        el,
        {clipPath: 'polygon(50% 0%, 50% 0%, 50% 100%, 50% 100%)', opacity: 0},
        {clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)', opacity: 1, ease: 'circ.out', scrollTrigger: {trigger: el, start: 'top 95%', end: 'top 60%', scrub: 0.5}},
      ),
    );
  });
  return () => tweens.forEach((t) => t.scrollTrigger?.kill() || t.kill());
}
