import {useEffect, useState} from 'react';
import {brand} from '../content';
import {bagCount, useBag, useFlash} from '../lib/bag';
import {ROUTES, go, useRoute} from '../lib/router';

/** Top bar with the six tabs; active tab underlined; full-screen menu on mobile. */
export function Nav() {
  const bag = useBag();
  const flash = useFlash();
  const route = useRoute();
  const count = bagCount(bag);
  const [bump, setBump] = useState(0);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (flash) setBump(flash.at);
  }, [flash]);
  useEffect(() => setMenu(false), [route]);

  return (
    <header className="fixed inset-x-0 top-0 z-40 text-[#fff6ea]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#2a0f06]/55 to-transparent" />
      <div className="relative mx-auto flex h-16 max-w-[1680px] items-center justify-between px-5 md:h-20 md:px-10">
        <a href="#/" onClick={go('/')} className="flex items-baseline gap-3" aria-label={`${brand.name} — accueil`}>
          <span className="display text-[20px] md:text-[22px]">
            Art du <em className="text-gold-light">Rendez-Vous</em>
          </span>
          <span className="label text-[#fff6ea]/60 max-lg:hidden">Café · Laeken</span>
        </a>

        <nav className="flex items-center gap-7 max-md:hidden" aria-label="Principal">
          {ROUTES.filter((r) => r.path !== '/commande').map((r) => (
            <a
              key={r.path}
              href={`#${r.path}`}
              onClick={go(r.path)}
              aria-current={route === r.path ? 'page' : undefined}
              className="group relative text-[13px] tracking-[0.02em] text-[#fff6ea]/75 transition-colors hover:text-white aria-[current=page]:text-white"
            >
              {r.label}
              <span className={`absolute -bottom-1.5 left-0 h-[1.5px] w-full origin-right scale-x-0 bg-gold-light transition-transform duration-500 ease-silk group-hover:origin-left group-hover:scale-x-100 group-aria-[current=page]:scale-x-100 ${route === r.path ? 'vt-underline' : ''}`} />
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <button type="button" onClick={() => window.dispatchEvent(new Event('finder:open'))} className="label flex items-center gap-2 rounded-full border border-[#fff6ea]/20 px-3 py-2 text-[#fff6ea]/75 transition hover:text-white max-lg:hidden" aria-label="Rechercher (⌘K)">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="5" /><path d="m11 11 3.5 3.5" /></svg>
            ⌘K
          </button>
          <a
            href="#/commande"
            onClick={go('/commande')}
            aria-current={route === '/commande' ? 'page' : undefined}
            className="label flex items-center gap-2 rounded-full border border-[#fff6ea]/30 px-3.5 py-2 text-[#fff6ea] backdrop-blur transition hover:bg-[#fff6ea]/10 aria-[current=page]:border-gold-light aria-[current=page]:text-gold-light"
            aria-label={`Commande, ${count} boisson${count === 1 ? '' : 's'}`}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M3 5.5h10l-.8 8.5H3.8L3 5.5Z" />
              <path d="M5.6 5.5V4.4a2.4 2.4 0 0 1 4.8 0v1.1" />
            </svg>
            <span className="max-sm:hidden">Commande</span>
            <span key={bump} className={`inline-block tabular-nums ${bump ? 'bump' : ''}`}>
              ({count})
            </span>
          </a>
          <button type="button" onClick={() => setMenu((m) => !m)} className="grid size-10 place-items-center md:hidden" aria-label="Menu" aria-expanded={menu}>
            <span className={`block h-px w-5 bg-current transition ${menu ? 'translate-y-[3px] rotate-45' : ''}`} />
            <span className={`-mt-4 block h-px w-5 bg-current transition ${menu ? '-translate-y-[3px] -rotate-45 mt-0' : ''}`} />
          </button>
        </div>
      </div>

      {menu && (
        <nav className="fixed inset-0 top-16 z-30 flex flex-col gap-2 bg-[#2a0f06]/92 px-6 pt-8 backdrop-blur-lg md:hidden" aria-label="Menu mobile">
          {ROUTES.map((r, i) => (
            <a key={r.path} href={`#${r.path}`} onClick={go(r.path)} aria-current={route === r.path ? 'page' : undefined} className="display flex items-baseline gap-4 py-2 text-[40px] text-[#fff6ea]/80 aria-[current=page]:text-gold-light">
              <span className="label text-gold/70">0{i + 1}</span>
              {r.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
