import {useEffect, useRef} from 'react';
import {categories, drinks, formatPrice} from '../content';
import {sizeLabel} from '../data/store.js';
import {bagStore} from '../lib/bag';
import {clamp, pinProgress, range} from '../lib/math';
import {onFrame, scrollToY} from '../lib/scroll';

/**
 * La carte, as SELENE's pinned reel (MissionLog.tsx): the section pins, the
 * reel of all 59 drinks slides sideways with the scroll, the card nearest the
 * focus line is lit while the rest dim back, each photo drifts against its
 * frame, and a counter + progress bar track the position. Added: the
 * category index on the left follows the reel and jumps to its first drink.
 */

const SECTION_VH = 1100;
const FOCUS = 0.62;

export function CarteReel() {
  const rootRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLOListElement>(null);
  const cardRefs = useRef<HTMLLIElement[]>([]);
  const imgRefs = useRef<HTMLImageElement[]>([]);
  const barRef = useRef<HTMLSpanElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const catRefs = useRef<HTMLButtonElement[]>([]);

  useEffect(() => {
    let lastP = -1;
    let lastCat = -1;
    return onFrame(() => {
      const root = rootRef.current;
      const track = trackRef.current;
      if (!root || !track) return;
      const {p, rect, vh} = pinProgress(root);
      if (rect.bottom < 0 || rect.top > vh) return;
      if (Math.abs(p - lastP) < 0.00005) return;
      lastP = p;

      const vw = window.innerWidth;
      const k = range(p, 0.03, 0.97);
      const travel = Math.max(0, track.offsetLeft + track.scrollWidth - vw * 0.94);
      track.style.transform = `translate3d(${-k * travel}px, 0, 0)`;

      let nearest = 0;
      let best = Infinity;
      cardRefs.current.forEach((card, i) => {
        const r = card.getBoundingClientRect();
        if (r.right < -vw * 0.2 || r.left > vw * 1.2) return; // off-screen: skip the style writes
        const off = (r.left + r.width / 2 - vw * FOCUS) / vw;
        const a = clamp(Math.abs(off) * 1.6);
        card.style.opacity = String(1 - a * 0.55);
        card.style.transform = `scale(${1 - a * 0.07})`;
        imgRefs.current[i].style.transform = `translate3d(${off * -60}px, 0, 0) scale(1.15)`;
        if (Math.abs(off) < best) {
          best = Math.abs(off);
          nearest = i;
        }
      });
      barRef.current!.style.transform = `scaleX(${k})`;
      countRef.current!.textContent = String(nearest + 1).padStart(2, '0');
      const cat = drinks[nearest].categoryIndex;
      if (cat !== lastCat) {
        lastCat = cat;
        catRefs.current.forEach((b, i) => b.toggleAttribute('data-on', i === cat));
      }
    });
  }, []);

  /** Scroll so the first drink of a category sits on the focus line. */
  const jump = (ci: number) => {
    const root = rootRef.current;
    const track = trackRef.current;
    if (!root || !track) return;
    const i = drinks.findIndex((d) => d.categoryIndex === ci);
    const vw = window.innerWidth;
    const card = cardRefs.current[i];
    const travel = Math.max(1, track.offsetLeft + track.scrollWidth - vw * 0.94);
    const want = clamp((track.offsetLeft + card.offsetLeft + card.offsetWidth / 2 - vw * FOCUS) / travel);
    const p = 0.03 + want * 0.94;
    const top = root.getBoundingClientRect().top + window.scrollY;
    scrollToY(top + p * (root.offsetHeight - window.innerHeight), false);
  };

  return (
    <section ref={rootRef} id="carte" aria-labelledby="carte-title" className="relative bg-ink" style={{height: `${SECTION_VH}svh`}}>
      <div className="sticky top-0 flex h-svh flex-col justify-center overflow-clip pt-16 md:flex-row md:items-center md:pt-0">
        <div className="relative z-10 shrink-0 px-5 md:w-[30vw] md:pr-10 md:pl-10">
          <p className="label text-gold-light">La carte · {drinks.length} boissons · prix en euros</p>
          <h2 id="carte-title" className="display mt-4 text-[clamp(44px,5.4vw,96px)] text-cream">
            Du premier café <em className="text-gold-light">au dernier verre</em>
          </h2>
          <ul className="mt-6 flex flex-wrap gap-2 md:mt-8 md:flex-col md:gap-1.5">
            {categories.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  ref={(el) => {
                    if (el) catRefs.current[i] = el;
                  }}
                  onClick={() => jump(i)}
                  className="group flex items-baseline gap-3 text-left text-cream/45 transition-colors hover:text-cream data-[on]:text-cream max-md:rounded-full max-md:border max-md:border-cream/15 max-md:px-3 max-md:py-1.5 max-md:data-[on]:border-gold"
                >
                  <span className="label text-gold/60 group-data-[on]:text-gold-light max-md:hidden">0{i + 1}</span>
                  <span className="text-[13px] md:text-[15px]">{c.title.fr}</span>
                  <span className="label text-cream/30 max-md:hidden">
                    {c.count} · dès {formatPrice(c.from)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-8 flex items-center gap-4 font-mono text-[11px] tracking-[0.14em] text-cream/60 uppercase max-md:hidden" aria-hidden="true">
            <span>
              <span ref={countRef} className="text-cream">
                01
              </span>{' '}
              / {drinks.length}
            </span>
            <span className="relative h-px w-32 bg-cream/15">
              <span ref={barRef} className="absolute inset-0 origin-left bg-gold" style={{transform: 'scaleX(0)'}} />
            </span>
          </div>
        </div>

        <ol ref={trackRef} className="mt-8 flex gap-5 pl-5 will-change-transform md:mt-0 md:gap-7 md:pl-0">
          {drinks.map((d, i) => (
            <li
              key={d.id}
              data-drink={d.id}
              ref={(el) => {
                if (el) cardRefs.current[i] = el;
              }}
              className="w-[62vw] shrink-0 origin-bottom sm:w-[40vw] md:w-[clamp(15rem,19vw,20rem)]"
            >
              <figure>
                <div className="relative aspect-[3/4] overflow-hidden rounded-[18px] bg-ink-2">
                  <img
                    ref={(el) => {
                      if (el) imgRefs.current[i] = el;
                    }}
                    src={d.img.s}
                    alt={d.name.fr}
                    width={480}
                    height={640}
                    decoding="async"
                    className="size-full object-cover will-change-transform"
                  />
                  <span className="label absolute top-3 left-3 rounded-full bg-ink/70 px-2.5 py-1 text-cream backdrop-blur">
                    {categories[d.categoryIndex].title.fr}
                  </span>
                  <button
                    type="button"
                    aria-label={`Ajouter ${d.name.fr}`}
                    onClick={() => {
                      bagStore.add(d.id, 1);
                      bagStore.flash(d.id);
                    }}
                    className="absolute right-3 bottom-3 grid size-10 place-items-center rounded-full bg-cream text-[20px] text-ink transition-transform hover:scale-110"
                  >
                    +
                  </button>
                </div>
                <figcaption className="mt-4 flex items-start justify-between gap-3">
                  <span className="flex gap-3">
                    <span className="font-mono text-[11px] text-gold-light">{String(i + 1).padStart(2, '0')}</span>
                    <span>
                      <span className="block text-[15px] font-medium text-cream">{d.name.fr}</span>
                      <span className="mt-1 block text-[12.5px] text-cream/50">{d.name.en}</span>
                    </span>
                  </span>
                  <span className="text-right whitespace-nowrap">
                    {d.priceList.map((pr) => (
                      <span key={pr.key ?? 'one'} className="block text-[15px] text-cream tabular-nums">
                        {pr.key && <span className="label mr-1.5 text-cream/40">{sizeLabel(pr.key, 'fr')}</span>}
                        {formatPrice(pr.value)}
                      </span>
                    ))}
                  </span>
                </figcaption>
              </figure>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
