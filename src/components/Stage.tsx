import {useEffect, useRef} from 'react';
import {clamp, pinProgress, range} from '../lib/math';
import {onFrame} from '../lib/scroll';
import {CARDS, HERO_OUT, OUTRO_IN, REMAP, cardAmount, holdAmount} from '../lib/timeline';
import {products} from '../content';
import {createCafeScene, type CafeScene} from '../gl/cafeScene';
import {useReducedMotion} from '../hooks/useReducedMotion';
import {HeroCopy} from './HeroCopy';
import {ProductCard} from './ProductCard';
import {Outro} from './Outro';
import {ChapterRail} from './ChapterRail';
import {Hotspot} from './Hotspot';

type Props = {onProgress: (loaded: number) => void};

/**
 * NAÏADE's Stage engine, kept line for line where it matters: one pinned
 * 1500svh section, the playhead chasing the remapped scroll target (never
 * slower than real time), slide-in cards with an inner stagger, hero type
 * blurring away, outro lines rising out of masks and the chapter rail.
 *
 * What changed is the picture: instead of cover-cropping a decoded WebP frame
 * into a 2D canvas, each tick hands the playhead to a live three.js scene.
 * The card "region" that used to steer the crop now shifts the camera's view
 * offset so the cup stays centred in the free space, and NAÏADE's lean-in zoom
 * becomes camera.zoom.
 */
export function Stage({onProgress}: Props) {
  const reduced = useReducedMotion();
  const root = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const outroRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const hotRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const section = root.current!;
    const canvas = canvasRef.current!;
    let scene: CafeScene | null = null;
    try {
      scene = createCafeScene(canvas, {reduced, onProgress});
    } catch (err) {
      console.warn('WebGL unavailable, showing the poster instead.', err);
      section.classList.add('no-webgl');
      onProgress(1);
    }

    const mobile = () => window.innerWidth < 768;

    // ---- per-frame state ------------------------------------------------
    let playhead = 0;
    let last = performance.now();
    const cardE = [0, 0, 0];
    const heroEls = () => Array.from(heroRef.current?.querySelectorAll<HTMLElement>('[data-out]') ?? []);
    let heroNodes = heroEls();
    let heroK = -1;
    let outroK = -1;
    let railState = '';

    const styleCard = (el: HTMLElement, e: number, side: 'left' | 'right', isMobile: boolean) => {
      const off = (1 - e) * 100;
      el.style.transform = isMobile
        ? `translate3d(0, ${off}%, 0)`
        : `translate3d(${side === 'left' ? -off : off}%, 0, 0)`;
      el.style.visibility = e < 0.002 ? 'hidden' : 'visible';
      el.style.pointerEvents = e > 0.6 ? 'auto' : 'none';
      el.querySelectorAll<HTMLElement>('[data-k]').forEach((n, i) => {
        const t = clamp((e - 0.3 - i * 0.06) / 0.45);
        n.style.opacity = String(t);
        n.style.transform = `translate3d(0, ${(1 - t) * 22}px, 0)`;
      });
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const {p: u, rect} = pinProgress(section);
      const onScreen = rect.bottom > 0 && rect.top < window.innerHeight;
      const isMobile = mobile();

      // Playhead chases the remapped target but never slower than real time.
      const target = REMAP.at(u);
      const diff = target - playhead;
      const step = Math.max(1.25, Math.abs(diff) * 3.2) * dt;
      const prev = playhead;
      playhead = Math.abs(diff) <= step ? target : playhead + Math.sign(diff) * step;
      const velocity = Math.abs(playhead - prev) / Math.max(dt, 1e-3); // film-seconds per second

      // Cards
      let active = -1;
      let activeE = 0;
      CARDS.forEach((w, i) => {
        const e = cardAmount(u, w);
        if (e !== cardE[i]) {
          cardE[i] = e;
          const el = cardRefs.current[i];
          if (el) styleCard(el, e, w.side, isMobile);
        }
        if (e > activeE) {
          activeE = e;
          active = i;
        }
      });

      // Hero copy blurs away in a stagger.
      const hk = range(u, HERO_OUT[0], HERO_OUT[1]);
      if (hk !== heroK) {
        heroK = hk;
        if (!heroNodes.length) heroNodes = heroEls();
        const stagger = 0.4 / Math.max(1, heroNodes.length - 1);
        heroNodes.forEach((n, i) => {
          const k = clamp((hk - i * stagger) / 0.6);
          n.style.opacity = String(1 - k);
          n.style.filter = k > 0.001 ? `blur(${(k * 14).toFixed(2)}px)` : 'none';
          n.style.transform = `translate3d(0, ${(-k * 26).toFixed(1)}px, 0)`;
        });
        if (heroRef.current) heroRef.current.style.visibility = hk >= 1 ? 'hidden' : 'visible';
      }

      // Outro lines rise out of their masks.
      const ok = range(u, OUTRO_IN[0], OUTRO_IN[1]);
      if (ok !== outroK && outroRef.current) {
        outroK = ok;
        outroRef.current.style.visibility = ok <= 0 ? 'hidden' : 'visible';
        outroRef.current.querySelectorAll<HTMLElement>('[data-line]').forEach((n, i) => {
          const t = clamp((ok - i * 0.18) / 0.7);
          const e = 1 - Math.pow(1 - t, 3);
          n.style.transform = `translate3d(0, ${(1 - e) * 110}%, 0)`;
        });
      }

      // Chapter rail
      const chapter = u < 0.12 || u > 0.9 ? -1 : u < 0.39 ? 0 : u < 0.63 ? 1 : 2;
      const fill = range(u, 0.12, 0.88);
      const rs = `${chapter}|${fill.toFixed(3)}`;
      if (rs !== railState && railRef.current) {
        railState = rs;
        const rail = railRef.current;
        rail.style.opacity = chapter < 0 ? '0' : '1';
        rail.style.setProperty('--fill', fill.toFixed(4));
        rail.querySelectorAll<HTMLElement>('[data-ch]').forEach((n, i) => n.toggleAttribute('data-on', i === chapter));
      }

      if (!onScreen || !scene) return;

      // Region left for the scene once a card is in (was the film crop rect).
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      let shiftX = 0;
      let shiftY = 0;
      if (active >= 0) {
        const card = cardRefs.current[active];
        if (isMobile) {
          shiftY = -((card?.offsetHeight ?? H * 0.66) * activeE) / 2;
        } else {
          const cw = (card?.offsetWidth ?? W * 0.42) * activeE;
          shiftX = (CARDS[active].side === 'left' ? cw : -cw) / 2;
        }
      }

      // Lean in while a card is open, plus a slow drift through each hold.
      const hold = active >= 0 ? holdAmount(u, CARDS[active]) : 0;
      const zoom = 1 + 0.06 * activeE + 0.035 * hold * activeE;

      scene.render({t: playhead, vel: velocity, shiftX, shiftY, zoom, dim: ok});

      // Visor-style hotspot pinned to the cup's rim while the hero is up.
      const hot = hotRef.current;
      if (hot) {
        const show = 1 - range(u, 0, HERO_OUT[1] * 0.7);
        hot.style.opacity = show.toFixed(3);
        hot.style.visibility = show <= 0.01 ? 'hidden' : 'visible';
        if (show > 0.01) {
          const a = scene.project([1.05, 1.52, 0.75]);
          hot.style.transform = `translate3d(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0)`;
        }
      }
    };

    const off = onFrame(tick);
    const onResize = () => cardE.fill(-1);
    window.addEventListener('resize', onResize);
    return () => {
      off();
      scene?.dispose();
      window.removeEventListener('resize', onResize);
    };
  }, [onProgress, reduced]);

  return (
    <section ref={root} id="film" aria-label="Le film du café" className="relative h-[1500svh] max-md:h-[1300svh]">
      <div className="sticky top-0 h-svh overflow-hidden bg-ink">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-pan-y" aria-hidden />
        {/* Lens falloff + a floor of shadow for the type */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_45%,transparent_58%,rgb(20_8_4/0.45))]"
        />
        <Hotspot ref={hotRef} />
        <HeroCopy ref={heroRef} />
        <Outro ref={outroRef} />
        {products.map((p, i) => (
          <ProductCard
            key={p.id}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            product={p}
            side={CARDS[i].side}
          />
        ))}
        <ChapterRail ref={railRef} />
      </div>
    </section>
  );
}
