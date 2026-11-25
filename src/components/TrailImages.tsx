import {useEffect, useRef} from 'react';
import {drinks} from '../content';
import {gsap} from '../lib/motion';

/**
 * Mage-UI "trailing image" (MIT), re-done with GSAP: moving the cursor across
 * the host element drops drink photos along the path; each pops in tilted,
 * drifts with the motion and falls away. Pooled nodes, no React re-renders.
 */
export function TrailImages({hostSelector, every = 90}: {hostSelector: string; every?: number}) {
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = document.querySelector<HTMLElement>(hostSelector);
    const el = layer.current;
    if (!host || !el || matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse)').matches) return;
    const pool = Array.from({length: 14}, () => {
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.className = 'pointer-events-none absolute top-0 left-0 w-[clamp(110px,10vw,170px)] aspect-[3/4] rounded-[14px] object-cover opacity-0 shadow-[0_30px_60px_-20px_rgb(0_0_0/0.6)]';
      el.appendChild(img);
      return img;
    });
    let k = 0;
    let n = 0;
    let last: {x: number; y: number} | null = null;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (last && Math.hypot(x - last.x, y - last.y) < every) return;
      const dx = last ? x - last.x : 0;
      const dy = last ? y - last.y : 0;
      last = {x, y};
      const img = pool[k++ % pool.length];
      img.src = drinks[n++ % drinks.length].img.s;
      gsap.killTweensOf(img);
      gsap.set(img, {x: x - 70, y: y - 90, rotate: gsap.utils.random(-14, 14), scale: 0.6, opacity: 0, zIndex: k});
      gsap
        .timeline()
        .to(img, {opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2)'})
        .to(img, {x: `+=${dx * 0.6}`, y: `+=${dy * 0.6}`, duration: 0.9, ease: 'power3.out'}, 0)
        .to(img, {opacity: 0, y: '+=60', scale: 0.85, duration: 0.6, ease: 'power2.in'}, 0.9);
    };
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', () => (last = null));
    return () => {
      host.removeEventListener('pointermove', onMove);
      pool.forEach((p) => p.remove());
    };
  }, [hostSelector, every]);
  return <div ref={layer} aria-hidden="true" className="pointer-events-none absolute inset-0 z-[5] overflow-hidden" />;
}
