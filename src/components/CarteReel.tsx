import {useEffect, useRef, useState} from 'react';
import {categories, drinks, formatPrice} from '../content';
import {sizeLabel, type Drink} from '../data/store.js';
import {bagStore} from '../lib/bag';
import {pinProgress, range} from '../lib/math';
import {onFrame, scrollToY} from '../lib/scroll';
import {go} from '../lib/router';
import {createCarteScene} from '../gl/carteScene';

/**
 * La carte, in 3D. SELENE's pinned-reel mechanics (pin, scroll → position,
 * counter, progress, category index) now drive a three.js carousel wheel of
 * all 59 drinks (gl/carteScene.ts) under the same look/sky as the hero.
 * The focused drink gets a glass detail card with every size and price.
 */

const SECTION_VH = 1100;
const N = drinks.length;
const priceText = (d: Drink) => d.priceList.map((p) => (p.key ? `${sizeLabel(p.key, 'fr')} ${formatPrice(p.value)}` : formatPrice(p.value))).join(' · ');

function add(d: Drink) {
  bagStore.add(d.id, 1);
  bagStore.flash(d.id);
}

export function CarteReel() {
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const catRefs = useRef<HTMLButtonElement[]>([]);
  const [focus, setFocus] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let scene: ReturnType<typeof createCarteScene> | null = null;
    try {
      scene = createCarteScene(canvas, {
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        drinks,
        catName: (d) => categories[d.categoryIndex].title.fr,
        price: priceText,
        onPick: add,
      });
    } catch {
      document.documentElement.classList.add('no-webgl');
    }
    let pos = 0;
    let lastCat = -1;
    let lastI = -1;
    const off = onFrame(() => {
      const root = rootRef.current;
      if (!root || !scene) return;
      const {p, rect, vh} = pinProgress(root);
      if (rect.bottom < 0 || rect.top > vh) return;
      const k = range(p, 0.03, 0.97);
      pos += (k * (N - 1) - pos) * 0.12; // playhead chase
      const wide = window.innerWidth >= 768;
      scene.render(pos, wide ? window.innerWidth * 0.14 : 0);
      const i = Math.round(pos);
      barRef.current!.style.transform = `scaleX(${k})`;
      if (i !== lastI) {
        lastI = i;
        countRef.current!.textContent = String(i + 1).padStart(2, '0');
        setFocus(i);
      }
      const cat = drinks[i].categoryIndex;
      if (cat !== lastCat) {
        lastCat = cat;
        catRefs.current.forEach((b, j) => b.toggleAttribute('data-on', j === cat));
      }
    });
    return () => {
      off();
      scene?.dispose();
    };
  }, []);

  const jumpTo = (i: number) => {
    const root = rootRef.current;
    if (!root) return;
    const p = 0.03 + (i / (N - 1)) * 0.94;
    const top = root.getBoundingClientRect().top + window.scrollY;
    scrollToY(top + p * (root.offsetHeight - window.innerHeight), false);
  };
  const jump = (ci: number) => jumpTo(drinks.findIndex((d) => d.categoryIndex === ci));
  const d = drinks[focus];

  return (
    <section ref={rootRef} id="carte" aria-labelledby="carte-title" className="relative" style={{height: `${SECTION_VH}svh`}}>
      <div className="sticky top-0 h-svh overflow-clip">
        <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-hidden="true" />

        <div className="relative z-10 m-4 mt-20 max-w-[30rem] rounded-[22px] border border-cream/15 bg-ink/55 p-5 backdrop-blur-md md:absolute md:top-1/2 md:left-8 md:m-0 md:w-[26vw] md:-translate-y-1/2 md:p-7">
          <p className="label text-gold-light">La carte · {N} boissons · prix en euros</p>
          <h2 id="carte-title" className="display mt-3 text-[clamp(34px,3.8vw,68px)] text-cream">
            Du premier café <em className="text-gold-light">au dernier verre</em>
          </h2>
          <ul className="mt-5 flex flex-wrap gap-2 md:flex-col md:gap-1.5">
            {categories.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  ref={(el) => {
                    if (el) catRefs.current[i] = el;
                  }}
                  onClick={() => jump(i)}
                  className="group flex items-baseline gap-3 text-left text-cream/55 transition-colors hover:text-cream data-[on]:text-cream max-md:rounded-full max-md:border max-md:border-cream/15 max-md:px-3 max-md:py-1 max-md:data-[on]:border-gold"
                >
                  <span className="label text-gold/70 group-data-[on]:text-gold-light max-md:hidden">0{i + 1}</span>
                  <span className="text-[12px] md:text-[15px]">{c.title.fr}</span>
                  <span className="label text-cream/35 max-md:hidden">
                    {c.count} · dès {formatPrice(c.from)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex items-center gap-4 font-mono text-[11px] tracking-[0.14em] text-cream/60 uppercase max-md:hidden" aria-hidden="true">
            <span>
              <span ref={countRef} className="text-cream">
                01
              </span>{' '}
              / {N}
            </span>
            <span className="relative h-px w-32 bg-cream/15">
              <span ref={barRef} className="absolute inset-0 origin-left bg-gold" style={{transform: 'scaleX(0)'}} />
            </span>
          </div>
          <a href="#/livre" onClick={go('/livre')} className="glint label mt-6 inline-block rounded-full bg-gold px-5 py-3 text-ink max-md:hidden">
            <span className="relative z-10">Feuilleter le livre →</span>
          </a>
        </div>

        {/* focused drink: glass detail card */}
        <div className="absolute right-4 bottom-6 left-4 z-10 flex items-center justify-between gap-4 rounded-[20px] border border-cream/15 bg-ink/60 px-5 py-4 text-cream backdrop-blur-md md:right-8 md:bottom-10 md:left-auto md:w-[22rem]" aria-live="polite">
          <div>
            <p className="label text-gold-light">
              {String(focus + 1).padStart(2, '0')} · {categories[d.categoryIndex].title.fr}
            </p>
            <p className="mt-1 font-display text-[22px] leading-tight">{d.name.fr}</p>
            <p className="mt-1 text-[14px] text-cream/75 tabular-nums">{priceText(d)}</p>
          </div>
          <button type="button" onClick={() => add(d)} className="shrink-0 rounded-full bg-cream px-4 py-2 text-[13px] font-medium text-ink transition-transform hover:scale-105">
            Ajouter
          </button>
        </div>

        {/* full accessible list of the 59 drinks with exact prices */}
        <ol className="sr-only">
          {drinks.map((x, i) => (
            <li key={x.id} data-drink={x.id}>
              <button type="button" onClick={() => jumpTo(i)}>
                {x.name.fr} — {priceText(x)}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
