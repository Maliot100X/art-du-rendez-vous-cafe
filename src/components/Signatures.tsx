import {useEffect, useRef, type CSSProperties} from 'react';
import {formatPrice, signatures} from '../content';
import {StretchEngine} from '../gl/stretch';
import {bagStore} from '../lib/bag';
import {useReveals} from '../hooks/useReveals';
import type {Drink} from '../data/store.js';

const BLEED = 70; // px the stretched photo may spill past its frame

/** One drink photo on Otis's taffy engine: grab, pull, let go and it snaps back. */
function StretchCard({drink, i}: {drink: Drink; i: number}) {
  const host = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const el = host.current!;
    const canvas = canvasRef.current!;
    const img = imgRef.current!;
    let engine: StretchEngine | null = null;
    let cancelled = false;
    const downs = new Map<number, {t: number; x: number; y: number; moved: number; u: number; v: number}>();

    const layout = () => {
      if (!engine) return;
      const w = el.clientWidth + BLEED * 2;
      const h = el.clientHeight + BLEED * 2;
      engine.resize(w, h, Math.min(2, window.devicePixelRatio || 1), {x: BLEED, y: BLEED, w: el.clientWidth, h: el.clientHeight});
    };
    const local = (ev: PointerEvent) => {
      const c = canvas.getBoundingClientRect();
      return {x: ev.clientX - c.left, y: ev.clientY - c.top};
    };
    const onDown = (ev: PointerEvent) => {
      if (!engine) return;
      const p = local(ev);
      const at = engine.pick(p.x, p.y);
      if (!at) return;
      ev.preventDefault();
      el.setPointerCapture(ev.pointerId);
      engine.grab(ev.pointerId, at.u, at.v, p.x, p.y);
      downs.set(ev.pointerId, {t: performance.now(), x: p.x, y: p.y, moved: 0, u: at.u, v: at.v});
    };
    const onMove = (ev: PointerEvent) => {
      const d = downs.get(ev.pointerId);
      if (!d || !engine) return;
      const p = local(ev);
      d.moved = Math.max(d.moved, Math.hypot(p.x - d.x, p.y - d.y));
      engine.drag(ev.pointerId, p.x, p.y);
    };
    const onUp = (ev: PointerEvent) => {
      const d = downs.get(ev.pointerId);
      if (!d || !engine) return;
      downs.delete(ev.pointerId);
      engine.release(ev.pointerId);
      if (performance.now() - d.t < 240 && d.moved < 8) engine.poke(d.u, d.v);
    };

    const ready = img.complete && img.naturalWidth ? Promise.resolve() : new Promise<void>((r) => img.addEventListener('load', () => r(), {once: true}));
    let io: IntersectionObserver | null = null;
    ready.then(() => {
      if (cancelled) return;
      try {
        engine = new StretchEngine(canvas, img);
        el.classList.add('is-live');
      } catch {
        return; // the <img> stays as the content
      }
      layout();
      // Say hello once, the first time the card comes into view.
      io = new IntersectionObserver(([en]) => {
        if (!en.isIntersecting) return;
        io?.disconnect();
        window.setTimeout(() => engine?.poke(0.5, 0.35, 0.7), 300 + i * 220);
      }, {threshold: 0.5});
      io.observe(el);
    });
    const ro = new ResizeObserver(layout);
    ro.observe(el);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      cancelled = true;
      ro.disconnect();
      io?.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      engine?.destroy();
    };
  }, [i]);

  const add = () => {
    bagStore.add(drink.id, 1);
    bagStore.flash(drink.id);
  };

  return (
    <li data-reveal style={{'--d': `${i * 110}ms`} as CSSProperties} className="group">
      <div ref={host} data-stretch={drink.id} className="stretch relative aspect-[3/4] [&.is-live>img]:opacity-0">
        <img ref={imgRef} src={drink.img.l} alt={drink.name.fr} width={drink.img.w} height={drink.img.h} className="absolute inset-0 h-full w-full rounded-[22px] object-cover" />
        <canvas
          ref={canvasRef}
          aria-hidden
          className="pointer-events-none absolute z-10"
          style={{left: -BLEED, top: -BLEED, width: `calc(100% + ${BLEED * 2}px)`, height: `calc(100% + ${BLEED * 2}px)`}}
        />
        <span className="label pointer-events-none absolute top-3 left-4 z-20 text-cream/90">0{i + 1}</span>
      </div>
      <div className="mt-4 flex items-start justify-between gap-3">
        <div>
          <p className="display text-[clamp(24px,2vw,32px)] text-cream">{drink.name.fr}</p>
          <p className="mt-1 text-[12.5px] text-cream/50">{drink.name.en}</p>
        </div>
        <p className="display text-[clamp(22px,1.8vw,28px)] whitespace-nowrap text-gold-light tabular-nums">{formatPrice(drink.fromPrice)}</p>
      </div>
      <button type="button" onClick={add} className="glint label mt-4 w-full rounded-full border border-cream/20 py-3 text-cream transition-colors hover:border-gold hover:text-gold-light">
        <span className="relative z-10">Ajouter</span>
      </button>
    </li>
  );
}

export function Signatures() {
  const ref = useReveals<HTMLElement>();
  return (
    <section ref={ref} id="signatures" aria-labelledby="sig-title" className="relative overflow-hidden bg-ink-2 px-5 py-[clamp(80px,14vh,160px)] md:px-10">
      <div className="mx-auto max-w-[1680px]">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p data-reveal className="label text-gold-light">Signatures · attrapez, étirez</p>
            <h2 id="sig-title" data-reveal style={{'--d': '80ms'} as CSSProperties} className="display mt-4 text-[clamp(48px,7vw,120px)] text-cream">
              Quatre verres, <em className="text-gold-light">à pleines mains</em>
            </h2>
          </div>
          <p data-reveal style={{'--d': '160ms'} as CSSProperties} className="max-w-[34ch] text-[14px] leading-[1.6] text-cream/60">
            Saisissez une photo et tirez : elle s’étire comme du caramel, puis revient en place. Le prix est celui de la carte.
          </p>
        </div>
        <ul className="mt-[clamp(40px,7vh,80px)] grid grid-cols-2 gap-x-5 gap-y-12 md:grid-cols-4 md:gap-x-8">
          {signatures.map((d, i) => (
            <StretchCard key={d.id} drink={d} i={i} />
          ))}
        </ul>
      </div>
    </section>
  );
}
