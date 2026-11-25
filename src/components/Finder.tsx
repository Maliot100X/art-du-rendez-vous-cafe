import {useEffect, useMemo, useRef, useState} from 'react';
import {categories, drinks, formatPrice} from '../content';
import {bagStore} from '../lib/bag';
import {ROUTES, navigate, type RoutePath} from '../lib/router';

type Item = {kind: 'tab'; path: RoutePath; label: string} | {kind: 'drink'; id: string; label: string; sub: string; price: string; img: string};
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** ⌘K / Ctrl+K finder: jump to any tab, or find any of the 59 drinks and add it. */
export function Finder() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const all = useMemo<Item[]>(
    () => [
      ...ROUTES.map((r) => ({kind: 'tab' as const, path: r.path, label: r.label})),
      ...drinks.map((d) => ({kind: 'drink' as const, id: d.id, label: d.name.fr, sub: `${categories[d.categoryIndex].title.fr} · ${d.name.en}`, price: d.priceList.map((p) => formatPrice(p.value)).join(' / '), img: d.img.s})),
    ],
    [],
  );
  const list = useMemo(() => {
    const n = norm(q.trim());
    if (!n) return all.slice(0, 12);
    return all.filter((it) => norm(it.label + (it.kind === 'drink' ? ' ' + it.sub : '')).includes(n)).slice(0, 30);
  }, [q, all]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('finder:open', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('finder:open', onOpen);
    };
  }, []);
  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      setTimeout(() => input.current?.focus(), 30);
    }
  }, [open]);
  useEffect(() => setSel(0), [q]);

  const run = (it: Item) => {
    setOpen(false);
    if (it.kind === 'tab') navigate(it.path);
    else {
      bagStore.add(it.id, 1);
      bagStore.flash(it.id);
    }
  };
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-[#2a0f06]/55 px-4 pt-[12vh] backdrop-blur-sm" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Rechercher">
      <div className="w-full max-w-xl overflow-hidden rounded-[22px] border border-cream/15 bg-ink/90 text-cream shadow-[0_40px_120px_-30px_rgb(0_0_0/0.8)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-cream/10 px-5">
          <span className="label text-gold-light">⌘K</span>
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(list.length - 1, s + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === 'Enter' && list[sel]) run(list[sel]);
            }}
            placeholder="Une boisson, un onglet… « orval », « spritz », « venir »"
            className="h-14 flex-1 bg-transparent text-[16px] placeholder:text-cream/35 focus:outline-none"
            aria-label="Rechercher une boisson ou un onglet"
          />
        </div>
        <ul className="max-h-[52vh] overflow-y-auto p-2" role="listbox">
          {list.map((it, i) => (
            <li key={it.kind === 'tab' ? it.path : it.id} role="option" aria-selected={i === sel}>
              <button type="button" onMouseEnter={() => setSel(i)} onClick={() => run(it)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${i === sel ? 'bg-cream/10' : ''}`}>
                {it.kind === 'drink' ? <img src={it.img} alt="" className="size-9 rounded-lg object-cover" /> : <span className="grid size-9 place-items-center rounded-lg bg-gold/20 text-gold-light">↗</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px]">{it.label}</span>
                  <span className="label block truncate text-cream/40">{it.kind === 'drink' ? it.sub : 'Onglet'}</span>
                </span>
                <span className="label text-gold-light">{it.kind === 'drink' ? `${it.price} · Ajouter` : 'Ouvrir'}</span>
              </button>
            </li>
          ))}
          {!list.length && <li className="px-3 py-6 text-center text-[14px] text-cream/50">Rien trouvé.</li>}
        </ul>
      </div>
    </div>
  );
}
