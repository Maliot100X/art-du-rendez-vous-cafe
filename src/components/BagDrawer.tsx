import {useEffect, useState} from 'react';
import {drinks, formatPrice} from '../content';
import {bagCount, bagStore, useBag, useBagOpen, useFlash} from '../lib/bag';
import {navigate} from '../lib/router';

/** Slide-in bag on the right, plus the small toast that confirms each add. */
export function BagDrawer() {
  const bag = useBag();
  const open = useBagOpen();
  const flash = useFlash();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!flash) return;
    const p = drinks.find((x) => x.id === flash.id);
    setToast(p ? p.name.fr : 'votre boisson');
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && bagStore.setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const lines = drinks.filter((p) => bag[p.id]);
  const subtotal = lines.reduce((a, p) => a + p.fromPrice * bag[p.id], 0);
  const count = bagCount(bag);

  return (
    <>
      {/* Toast */}
      <div
        role="status"
        className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 transition-all duration-700 ease-silk ${
          toast ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0'
        }`}
      >
        <div className="flex items-center gap-4 rounded-full bg-ink-2/90 py-2 pr-2 pl-5 text-cream shadow-[0_20px_60px_-15px_rgb(217_166_80/0.35)] ring-1 ring-gold/25 backdrop-blur-md">
          <span className="size-1.5 rounded-full bg-gold shadow-[0_0_12px_2px_rgb(217_166_80/0.8)]" />
          <span className="text-[13px] whitespace-nowrap">
            <span className="text-cream/55">Ajouté</span> {toast}
          </span>
          <button type="button" onClick={(e) => navigate('/commande', e)} className="label rounded-full bg-cream px-4 py-2 text-ink">
            Commande
          </button>
        </div>
      </div>

      {/* Scrim */}
      <div
        aria-hidden
        onClick={() => bagStore.setOpen(false)}
        className={`fixed inset-0 z-50 bg-ink/60 backdrop-blur-[2px] transition-opacity duration-700 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      />

      <aside
        aria-label="Votre commande"
        aria-hidden={!open}
        data-lenis-prevent
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-[460px] flex-col bg-ink-2 text-cream transition-transform duration-[900ms] ease-drawer ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-cream/10 px-7 py-6">
          <p className="display text-[34px]">
            Votre <em className="text-gold">commande</em>
          </p>
          <button type="button" onClick={() => bagStore.setOpen(false)} className="label text-cream/60 hover:text-cream">
            Fermer ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-7 py-4">
          {lines.length === 0 ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <p className="display text-[40px] text-cream/80">
                  Tasse <em>vide.</em>
                </p>
                <p className="mt-3 text-[13px] text-cream/45">Rien encore — choisissez une boisson dans le film ou la carte.</p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-cream/10">
              {lines.map((p) => (
                <li key={p.id} className="flex gap-4 py-5">
                  <div className="size-24 shrink-0 overflow-hidden rounded-2xl bg-ink-3">
                    <img src={p.img.s} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="label text-cream/40">{p.category}</p>
                    <p className="display mt-1 text-[24px]">
                      {p.name.fr}
                    </p>
                    <p className="mt-1 text-[12px] text-cream/45">{p.name.en}</p>
                    <div className="mt-auto flex items-center justify-between pt-3">
                      <div className="label flex items-center rounded-full border border-cream/15 text-cream/70">
                        <button type="button" aria-label="Moins" className="px-3 py-1.5" onClick={() => bagStore.set(p.id, bag[p.id] - 1)}>
                          −
                        </button>
                        <span className="w-4 text-center tabular-nums">{bag[p.id]}</span>
                        <button type="button" aria-label="Plus" className="px-3 py-1.5" onClick={() => bagStore.set(p.id, bag[p.id] + 1)}>
                          +
                        </button>
                      </div>
                      <p className="text-[14px] tabular-nums">{formatPrice(p.fromPrice * bag[p.id])}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-cream/10 px-7 pt-5 pb-7">
          <div className="flex items-baseline justify-between">
            <p className="label text-cream/50">
              Total · {count} boisson{count === 1 ? '' : 's'}
            </p>
            <p className="display text-[30px] tabular-nums">{formatPrice(subtotal)}</p>
          </div>
          <p className="mt-1 text-[11.5px] text-cream/35">À régler au comptoir. Prix de la carte, service compris.</p>
          <button
            type="button"
            disabled={!lines.length}
            onClick={(e) => {
              bagStore.setOpen(false);
              navigate('/commande', e);
            }}
            className="glint label mt-5 h-13 w-full rounded-full bg-gold py-4 text-ink transition-opacity disabled:opacity-30"
          >
            <span className="relative z-10">Commander au comptoir</span>
          </button>
          <p className="mt-3 text-center text-[10.5px] text-cream/30">Ou commandez de vive voix auprès de Nori, onglet Commande.</p>
        </div>
      </aside>
    </>
  );
}
