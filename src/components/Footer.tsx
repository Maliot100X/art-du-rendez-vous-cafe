import {useEffect, useRef, type CSSProperties} from 'react';
import {address, brand, cafe, footer} from '../content';
import {useFitText} from '../hooks/useFitText';
import {useReveals} from '../hooks/useReveals';
import {useReducedMotion} from '../hooks/useReducedMotion';

/**
 * "Venir" + footer. NAÏADE's footer skeleton (reveal columns, fit-to-width
 * wordmark) over a live WebGL-Fluid "cream pour" (vendored MIT simulation,
 * café palette) that you can stir with the cursor.
 */
export function Footer() {
  const ref = useReveals<HTMLElement>();
  const word = useFitText<HTMLSpanElement>();
  const fluidRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const canvas = fluidRef.current!;
    let stop: (() => void) | undefined;
    let cancelled = false;
    // Only spin the simulation up once the footer is near.
    const io = new IntersectionObserver(
      async ([en]) => {
        if (!en.isIntersecting) return;
        io.disconnect();
        const {startFluid} = await import('../gl/fluid.js');
        if (cancelled) return;
        try {
          stop = startFluid(canvas, {
            SIM_RESOLUTION: 128,
            DYE_RESOLUTION: 512,
            CAPTURE_RESOLUTION: 512,
            DENSITY_DISSIPATION: 0.9,
            VELOCITY_DISSIPATION: 0.6,
            PRESSURE: 0.3,
            PRESSURE_ITERATIONS: 16,
            CURL: 18,
            SPLAT_RADIUS: 0.28,
            SPLAT_FORCE: 5000,
            SHADING: true,
            COLORFUL: false,
            COLOR_UPDATE_SPEED: 10,
            PAUSED: false,
            BACK_COLOR: {r: 15, g: 36, b: 27},
            TRANSPARENT: false,
            BLOOM: false,
            BLOOM_ITERATIONS: 8,
            BLOOM_RESOLUTION: 256,
            BLOOM_INTENSITY: 0.8,
            BLOOM_THRESHOLD: 0.6,
            BLOOM_SOFT_KNEE: 0.7,
            SUNRAYS: false,
            SUNRAYS_RESOLUTION: 196,
            SUNRAYS_WEIGHT: 1.0,
            RANDOM_COLORS: false,
            CAFE_PALETTE: true,
            SPLAT_HUE: 0,
          });
        } catch (err) {
          console.warn('Fluid background unavailable', err);
        }
      },
      {rootMargin: '50% 0px'},
    );
    io.observe(canvas);
    return () => {
      cancelled = true;
      io.disconnect();
      stop?.();
    };
  }, [reduced]);

  return (
    <footer ref={ref} id="venir" className="relative overflow-hidden bg-ink px-5 pt-[clamp(80px,14vh,160px)] pb-8 text-cream md:px-10">
      <canvas ref={fluidRef} aria-hidden className="absolute inset-0 h-full w-full opacity-90" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(15_36_27/0.85),rgb(15_36_27/0.25)_45%,rgb(15_36_27/0.7))]" />
      <div className="pointer-events-none relative mx-auto max-w-[1680px] [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
        <div className="grid gap-12 md:grid-cols-12">
          <div data-reveal className="md:col-span-6">
            <p className="label text-gold-light">Venir · on vous attend</p>
            <p className="display mt-4 text-[clamp(44px,5.6vw,96px)]">
              Rue des Artistes <em className="text-gold-light">1A</em>
            </p>
            <p className="mt-4 text-[15px] text-cream/70">
              {address.line} · {address.city}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={address.maps} target="_blank" rel="noreferrer" className="glint label rounded-full bg-gold px-6 py-3.5 text-ink">
                <span className="relative z-10">Itinéraire</span>
              </a>
              <a href={`tel:${address.phone}`} className="label rounded-full border border-cream/30 px-6 py-3.5 text-cream hover:border-gold hover:text-gold-light">
                {address.phoneDisplay}
              </a>
            </div>
          </div>
          <div data-reveal style={{'--d': '90ms'} as CSSProperties} className="md:col-span-3">
            <p className="label text-cream/40">Horaires</p>
            <dl className="mt-4 space-y-2.5 text-[14px]">
              {footer.hours.map(([d, h]) => (
                <div key={d} className="flex justify-between gap-6 border-b border-cream/10 pb-2.5">
                  <dt className="text-cream/70">{d}</dt>
                  <dd className="tabular-nums">{h}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div data-reveal style={{'--d': '180ms'} as CSSProperties} className="md:col-span-3">
            <p className="label text-cream/40">Accès</p>
            <ul className="mt-4 space-y-2.5 text-[13.5px] text-cream/75">
              {footer.transit.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <p className="mt-6 text-[13px] text-cream/55">
              ★ {cafe.rating.value} · {cafe.rating.count} avis Google
            </p>
          </div>
        </div>

        <div className="mt-[clamp(56px,10vh,120px)]" aria-hidden>
          <span ref={word} className="display inline-block leading-[0.8] whitespace-nowrap text-cream">
            Rendez-<em className="text-gold-light">Vous</em>
          </span>
        </div>

        <div className="mt-8 flex flex-col gap-3 border-t border-cream/10 pt-6 text-[11.5px] text-cream/40 md:flex-row md:justify-between">
          <p>
            © 2026 {brand.name} Café · {address.line}, {address.city}
          </p>
          <p className="max-w-[60ch]">{footer.note}</p>
        </div>
      </div>
    </footer>
  );
}
