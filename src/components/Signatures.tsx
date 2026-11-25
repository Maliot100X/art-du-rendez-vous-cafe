import {useEffect, useRef} from 'react';
import {formatPrice, signatures} from '../content';
import {createSignaturesScene} from '../gl/signaturesScene';
import {createRemap} from '../lib/timeRemap';
import {clamp, pinProgress} from '../lib/math';
import {onFrame} from '../lib/scroll';
import {bagStore} from '../lib/bag';
import {useReducedMotion} from '../hooks/useReducedMotion';

/** Scroll → station (0..3) with a hold on each drink: NAÏADE's speed-ramp engine again. */
const REMAP = createRemap(
  [
    [0, 0],
    [0.1, 0],
    [0.24, 1],
    [0.36, 1],
    [0.5, 2],
    [0.62, 2],
    [0.76, 3],
    [1, 3],
  ],
  3,
);

const NOTES = ['Mousse de lait, chantilly maison, cacao', 'Apérol, prosecco, soda, rondelle d’orange', 'Trappiste d’Orval, servie dans son calice', 'Crème de cassis, mousseux bien frais'];

export function Signatures() {
  const reduced = useReducedMotion();
  const root = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const countRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const section = root.current!;
    let scene: ReturnType<typeof createSignaturesScene> | null = null;
    try {
      scene = createSignaturesScene(canvasRef.current!, {reduced});
    } catch (err) {
      console.warn('WebGL unavailable for signatures', err);
    }
    let head = 0;
    let last = performance.now();
    let lastCount = -1;
    const off = onFrame((now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const {p, rect, vh} = pinProgress(section);
      if (rect.bottom < 0 || rect.top > vh || !scene) return;
      const target = REMAP.at(p);
      const diff = target - head;
      const step = Math.max(0.6, Math.abs(diff) * 4) * dt;
      head = Math.abs(diff) <= step ? target : head + Math.sign(diff) * step;
      scene.render(head);
      labelRefs.current.forEach((el, i) => {
        if (!el) return;
        const near = clamp(1 - Math.abs(head - i) * 1.6);
        const a = scene!.project(i);
        el.style.transform = `translate3d(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0)`;
        el.style.opacity = near.toFixed(3);
        el.style.pointerEvents = near > 0.6 ? 'auto' : 'none';
      });
      const c = Math.round(head);
      if (c !== lastCount && countRef.current) {
        lastCount = c;
        countRef.current.textContent = `0${c + 1}`;
      }
    });
    return () => {
      off();
      scene?.dispose();
    };
  }, [reduced]);

  return (
    <section ref={root} id="signatures" aria-labelledby="sig-title" className="relative h-[520svh] bg-ink">
      <div className="sticky top-0 h-svh overflow-clip">
        <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_45%,transparent_60%,rgb(20_8_4/0.45))]" />
        <div className="pointer-events-none absolute top-0 left-0 px-5 pt-[clamp(84px,12vh,120px)] md:px-10">
          <p className="label text-gold-light">Signatures · au comptoir</p>
          <h2 id="sig-title" className="display mt-3 text-[clamp(40px,4.6vw,80px)] text-cream">
            Quatre verres <em className="text-gold-light">de la maison</em>
          </h2>
          <p className="label mt-4 text-cream/50">
            <span ref={countRef} className="text-cream">
              01
            </span>{' '}
            / 04 · scroll pour passer au suivant
          </p>
        </div>
        {signatures.map((d, i) => (
          <div
            key={d.id}
            ref={(el) => {
              labelRefs.current[i] = el;
            }}
            className="absolute top-0 left-0 z-10"
            style={{opacity: 0}}
          >
            <span className="absolute -top-1.5 -left-1.5 size-3 rounded-full bg-gold-light shadow-[0_0_14px_3px_rgb(217_166_80/0.8)]" />
            <svg className="absolute top-0 left-0 overflow-visible" width="90" height="60" aria-hidden>
              <path d="M0 0 L50 -50 L90 -50" fill="none" stroke="rgb(226 189 118 / 0.75)" strokeWidth="1" />
            </svg>
            <div className="absolute top-[-92px] left-[90px] w-[250px] rounded-2xl border border-cream/15 bg-ink/55 px-4 py-3 text-cream shadow-[0_20px_50px_-20px_rgb(0_0_0/0.6)] backdrop-blur-md">
              <p className="label text-gold-light">N°0{i + 1} · {d.name.en}</p>
              <p className="mt-1 flex items-baseline justify-between gap-3">
                <span className="display text-[24px] leading-tight">{d.name.fr}</span>
                <span className="text-[15px] whitespace-nowrap text-gold-light tabular-nums">{formatPrice(d.fromPrice)}</span>
              </p>
              <p className="mt-1 text-[12px] text-cream/55">{NOTES[i]}</p>
              <button
                type="button"
                onClick={() => {
                  bagStore.add(d.id, 1);
                  bagStore.flash(d.id);
                }}
                className="glint label mt-3 w-full rounded-full bg-gold py-2.5 text-ink"
              >
                <span className="relative z-10">Ajouter</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
