import {useEffect, useRef} from 'react';
import {SplitTitle} from './SplitTitle';
import {address, cafe, footer} from '../content';
import {openStatus} from '../data/store.js';
import {createMapScene} from '../gl/mapScene';
import {pinProgress} from '../lib/math';
import {onFrame} from '../lib/scroll';
import {useReducedMotion} from '../hooks/useReducedMotion';

/** Venir: a 3D map of the corner by Bockstael, then address, hours, transit. */
export function Venir() {
  const reduced = useReducedMotion();
  const root = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const s = openStatus();

  useEffect(() => {
    let m: ReturnType<typeof createMapScene> | null = null;
    try {
      m = createMapScene(canvasRef.current!, {reduced, lat: cafe.geo.lat, lng: cafe.geo.lng});
    } catch (err) {
      console.warn('WebGL unavailable for the map', err);
    }
    let k = 0;
    const off = onFrame(() => {
      const el = root.current;
      if (!el || !m) return;
      const {p, rect, vh} = pinProgress(el);
      if (rect.bottom < 0 || rect.top > vh) return;
      k += (p - k) * 0.08;
      m.render(k);
    });
    return () => {
      off();
      m?.dispose();
    };
  }, [reduced]);

  return (
    <section ref={root} id="venir-map" aria-labelledby="venir-title" className="relative" style={{height: '200svh'}}>
      <div className="sticky top-0 h-svh overflow-clip">
        <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-hidden="true" />
        <div className="relative z-10 mx-auto flex h-full max-w-[1680px] flex-col justify-between px-5 pt-24 pb-8 md:px-10 md:pt-28 md:pb-12">
          <div>
            <p className="label text-gold-light">Venir · Laeken, Bruxelles</p>
            <SplitTitle as="h1" id="venir-title" className="display mt-2 text-[clamp(36px,4.6vw,80px)] text-[#fff6ea]" text="Rue des Artistes" em="1A" />
          </div>
          <div className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 [&>div]:w-[82vw] [&>div]:shrink-0 [&>div]:snap-center md:[&>div]:w-auto">
            <div data-glow className="rounded-[20px] border border-cream/15 bg-ink/65 p-5 text-cream backdrop-blur-md">
              <p className="label text-gold-light">Adresse</p>
              <p className="mt-2 text-[16px]">{address.line}</p>
              <p className="text-[14px] text-cream/60">{address.city}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href={address.maps} target="_blank" rel="noreferrer" className="label rounded-full bg-gold px-4 py-2.5 text-ink">
                  Itinéraire
                </a>
                <a href={`tel:${address.phone}`} className="label rounded-full border border-cream/30 px-4 py-2.5">
                  {address.phoneDisplay}
                </a>
              </div>
            </div>
            <div data-glow className="rounded-[20px] border border-cream/15 bg-ink/65 p-5 text-cream backdrop-blur-md">
              <p className="label flex items-center gap-2 text-gold-light">
                <span className={`size-1.5 rounded-full ${s.open ? 'bg-[#7fd18b]' : 'bg-cream/40'}`} /> Horaires · {s.open ? 'ouvert' : 'fermé'}
              </p>
              <dl className="mt-2 space-y-1 text-[15px]">
                {footer.hours.map(([d, h]) => (
                  <div key={d} className="flex justify-between gap-4">
                    <dt className="text-cream/70">{d}</dt>
                    <dd className="tabular-nums">{h}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div data-glow className="rounded-[20px] border border-cream/15 bg-ink/65 p-5 text-cream backdrop-blur-md">
              <p className="label text-gold-light">Transports</p>
              <ul className="mt-2 space-y-1 text-[14px] text-cream/80">
                {footer.transit.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <p className="label mt-3 text-cream/40">Carte © OpenStreetMap</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
