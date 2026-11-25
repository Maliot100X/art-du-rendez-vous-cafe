import {type Ref} from 'react';
import {address, brand, formatPrice, hero, products} from '../content';
import {openStatus} from '../data/store.js';
import {go} from '../lib/router';
import {scrollToY} from '../lib/scroll';

/** Halcyon 'hold' swatches: pick what's in the cup → the film glides to that hold. */
const SWATCHES = [
  {label: 'Latte', color: 'radial-gradient(circle at 35% 35%, #f3e2c4, #b98a5a)', p: 0.33},
  {label: 'Chocolat', color: 'radial-gradient(circle at 35% 35%, #8a4a2a, #3a1a0c)', p: 0.57},
  {label: 'Irish', color: 'radial-gradient(circle at 35% 35%, #f5ead6 0 38%, #2a140a 40%)', p: 0.81},
];
const hold = (p: number) => {
  const film = document.getElementById('film');
  if (!film) return;
  const top = film.getBoundingClientRect().top + window.scrollY;
  scrollToY(top + p * (film.offsetHeight - window.innerHeight), false);
};

/**
 * The hero's DOM type, kept minimal (NAÏADE's HeroCopy layout): the café's
 * name itself is set *inside* the 3D scene behind the cup, so here there is
 * only a kicker, one readable line with the CTAs bottom left, and a compact
 * teaser bottom right. Every `[data-out]` node is blurred away by the Stage.
 */
export function HeroCopy({ref}: {ref?: Ref<HTMLDivElement>}) {
  const latte = products[0];
  const s = openStatus();
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-10">
      <h1 className="sr-only">
        {brand.name} Café — {address.line}, {address.city}
      </h1>
      <div
        data-out
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(55%_40%_at_0%_100%,rgb(42_16_9/0.75),transparent_75%),radial-gradient(40%_30%_at_100%_100%,rgb(42_16_9/0.6),transparent_75%)]"
      />

      <div className="absolute inset-x-0 top-0 mx-auto max-w-[1680px] px-5 pt-[clamp(88px,13vh,130px)] md:px-10">
        <p data-out className="on-sky label flex items-center gap-3 text-cream/70">
          <span className={`size-1.5 rounded-full ${s.open ? 'bg-[#7fd18b] shadow-[0_0_10px_2px_rgb(127_209_139/0.7)]' : 'bg-cream/40'}`} />
          {s.open ? `Ouvert${s.until && !s.allNight ? ` jusqu'à ${s.until}` : ''}` : 'Fermé pour l’instant'} · {hero.kicker}
        </p>
      </div>

      <div className="relative mx-auto flex h-full max-w-[1680px] items-end justify-between gap-10 px-5 pb-8 md:px-10 md:pb-12">
        <div className="max-w-[36ch]">
          <p data-out className="text-[14px] leading-[1.55] text-cream/80 md:text-[15px]">
            {hero.line}
          </p>
          <div data-out className="pointer-events-auto mt-5 flex flex-wrap gap-3">
            <a href="#/carte" onClick={go('/carte')} className="glint label rounded-full bg-gold px-6 py-3.5 text-ink">
              <span className="relative z-10">Voir la carte · 59 boissons</span>
            </a>
            <a href="#/venir" onClick={go('/venir')} className="label rounded-full border border-cream/30 px-6 py-3.5 text-cream hover:border-gold hover:text-gold-light">
              Venir
            </a>
          </div>
        </div>
        <div data-out className="flex shrink-0 items-center gap-4 max-md:hidden">
          <div className="text-right">
            <p className="label text-cream/55">Dans la tasse · N°{latte.index}</p>
            <p className="mt-1.5 text-[14px] font-medium text-cream">{latte.name.join(' ')}</p>
            <p className="display mt-1 text-[24px] text-gold-light">{formatPrice(latte.price)}</p>
            <div className="pointer-events-auto mt-3 flex justify-end gap-2" role="group" aria-label="Dans la tasse">
              {SWATCHES.map((w) => (
                <button key={w.label} type="button" onClick={() => hold(w.p)} title={w.label} aria-label={`Voir le ${w.label}`} className="size-7 rounded-full ring-1 ring-cream/40 transition-transform hover:scale-115 hover:ring-gold-light" style={{background: w.color}} />
              ))}
            </div>
          </div>
          <div className="size-[96px] overflow-hidden rounded-[22px] ring-1 ring-gold/30 shadow-[0_24px_60px_-18px_rgb(217_166_80/0.35)]">
            <img src={latte.image} alt="" className="h-full w-full object-cover" />
          </div>
        </div>
      </div>
      <p data-out aria-hidden className="label absolute bottom-6 left-1/2 -translate-x-1/2 text-cream/45 max-md:hidden">
        Scroll · tournez autour de la tasse
      </p>
    </div>
  );
}
