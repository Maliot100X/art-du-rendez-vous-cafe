import {useEffect, useRef} from 'react';
import {drinks} from '../content';
import {onFrame} from '../lib/scroll';

/**
 * Mage-UI "parallax grid" (MIT), re-done in CSS 3D: all 59 drink photos in
 * five columns on a plane tilted into the scene, each column sliding at its own
 * speed and direction with the scroll, so the wall shears in depth.
 */
const COLS = 5;
export function ParallaxWall() {
  const root = useRef<HTMLElement>(null);
  const cols = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(
    () =>
      onFrame(() => {
        const el = root.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) return;
        const k = (innerHeight - r.top) / (innerHeight + r.height); // 0..1 through the viewport
        cols.current.forEach((c, i) => {
          if (!c) return;
          const speed = [-1, 0.6, -0.4, 0.9, -0.7][i];
          c.style.transform = `translate3d(0, ${((k - 0.5) * speed * 520).toFixed(1)}px, 0)`;
        });
      }),
    [],
  );
  const per = Math.ceil(drinks.length / COLS);
  return (
    <section ref={root} aria-label="Le mur des boissons" className="relative h-[140svh] overflow-hidden">
      <div className="absolute inset-0 [perspective:1400px]">
        <div className="absolute inset-[-25%_-10%] flex justify-center gap-5 [transform:rotateX(28deg)_rotateZ(-10deg)] [transform-style:preserve-3d]">
          {Array.from({length: COLS}, (_, c) => (
            <div key={c} ref={(el) => {
              cols.current[c] = el;
            }} className="flex w-[clamp(140px,16vw,260px)] flex-col gap-5 will-change-transform">
              {[...drinks.slice(c * per, (c + 1) * per), ...drinks.slice(c * per, (c + 1) * per)].map((d, i) => (
                <figure key={`${d.id}${i}`} className="relative overflow-hidden rounded-[18px] shadow-[0_40px_80px_-30px_rgb(0_0_0/0.7)]">
                  <img src={d.img.s} alt={i < per ? d.name.fr : ''} loading="lazy" className="aspect-[3/4] w-full object-cover" />
                  <figcaption className="label absolute inset-x-2 bottom-2 rounded-full bg-ink/60 px-2.5 py-1 text-cream backdrop-blur">{d.name.fr}</figcaption>
                </figure>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_50%,transparent_30%,rgb(42_16_9/0.85))]" />
      <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center">
        <p className="label text-gold-light">Le mur</p>
        <p className="display mt-2 text-[clamp(44px,7vw,120px)] text-[#fff6ea] drop-shadow-[0_10px_40px_rgb(0_0_0/0.6)]">
          59 <em className="text-gold-light">boissons</em>
        </p>
      </div>
    </section>
  );
}
