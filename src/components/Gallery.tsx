import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Expand, X } from 'lucide-react';
import { GALLERY } from '../content';
import { EASE_SILK, gsap, GSAP_EASE_SILK } from '../lib/motion';

/**
 * Galerie — the café in pictures: the wide menu poster as a full-width
 * banner, then the four photos in a row, then the tall portrait poster
 * (the same code-built menu, vertical format for stories / sharing).
 * Tap / click opens a lightbox (visor modal grammar: dark overlay, big
 * frame, prev/next, Esc). Scroll reveal is the MenuSection GSAP pattern:
 * rows stagger in once via ScrollTrigger on the silk curve; reduced
 * motion skips it.
 */

const ALL = [GALLERY.poster, ...GALLERY.items, GALLERY.posterTall];

export default function Gallery() {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const reducedMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const posterRef = useRef<HTMLElement>(null);
  const gridCtx = useRef<ReturnType<typeof gsap.context> | null>(null);

  useEffect(() => {
    if (reducedMotion) return;
    gridCtx.current = gsap.context(() => {
      gsap.fromTo(
        '.gallery-item',
        { y: 28, autoAlpha: 0 },
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.9,
          ease: GSAP_EASE_SILK,
          stagger: 0.09,
          overwrite: 'auto',
          scrollTrigger: { trigger: posterRef.current, start: 'top 85%', once: true },
        },
      );
    }, sectionRef);
    return () => gridCtx.current?.revert();
  }, [reducedMotion]);

  const close = useCallback(() => setLightbox(null), []);
  const step = useCallback(
    (dir: 1 | -1) => setLightbox((cur) => (cur === null ? cur : (cur + dir + ALL.length) % ALL.length)),
    [],
  );

  // Lightbox keyboard: Esc closes, arrows step. Body scroll is locked
  // while the lightbox is open.
  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') close();
      else if (ev.key === 'ArrowRight') step(1);
      else if (ev.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightbox, close, step]);

  const current = lightbox === null ? null : ALL[lightbox];
  const lightboxTransition = { duration: reducedMotion ? 0 : 0.4, ease: EASE_SILK };

  return (
    <section id="galerie" ref={sectionRef} className="relative mx-auto max-w-[1400px] scroll-mt-24 px-4 py-16 sm:px-6 sm:py-24 md:py-36">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between" data-reveal>
        <div>
          <p className="font-mono text-label uppercase text-amber">{GALLERY.eyebrow}</p>
          <h2 className="mt-3 font-display text-display text-bone">
            Le café, <span className="italic text-amber">en images.</span>
          </h2>
        </div>
        <p className="max-w-md text-body text-bone/70">{GALLERY.lede}</p>
      </div>

      {/* The printed menu as a poster — full-width banner, tap to enlarge. */}
      <figure ref={posterRef} className="gallery-item group relative mt-12 cursor-pointer overflow-hidden rounded-[1.75rem]">
        <button
          type="button"
          onClick={() => setLightbox(0)}
          className="block w-full text-left"
          aria-label={`${GALLERY.poster.caption} — agrandir`}
        >
          <img
            src={GALLERY.poster.src}
            alt={GALLERY.poster.alt}
            loading="lazy"
            className="aspect-[16/9] w-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.2,0.7,0.1,1)] group-hover:scale-[1.02] sm:aspect-[21/9]"
          />
          <span className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-black/40 text-white backdrop-blur transition-colors duration-300 group-hover:border-amber group-hover:text-amber">
            <Expand size={16} />
          </span>
          <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-5 pt-12 sm:p-6">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-amber">La carte en affiche</span>
            <span className="mt-1 block font-display text-xl italic text-bone sm:text-2xl">{GALLERY.poster.caption}</span>
          </figcaption>
        </button>
      </figure>

      {/* The four photos. */}
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {GALLERY.items.map((item, i) => (
          <figure key={item.src} className="gallery-item group relative cursor-pointer overflow-hidden rounded-[1.5rem]">
            <button
              type="button"
              onClick={() => setLightbox(i + 1)}
              className="block w-full text-left"
              aria-label={`${item.caption} — agrandir`}
            >
              <img
                src={item.src}
                alt={item.alt}
                loading="lazy"
                className="aspect-[4/3] w-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.2,0.7,0.1,1)] group-hover:scale-[1.05]"
              />
              <span className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border border-white/25 bg-black/40 text-white opacity-0 backdrop-blur transition-opacity duration-300 group-hover:opacity-100">
                <Expand size={14} />
              </span>
              <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-4 pt-10">
                <span className="block font-display text-lg italic leading-tight text-bone">{item.caption}</span>
              </figcaption>
            </button>
          </figure>
        ))}
      </div>

      {/* The tall portrait poster — same code-built menu, vertical format. */}
      <figure className="gallery-item group relative mx-auto mt-4 w-full max-w-sm cursor-pointer overflow-hidden rounded-[1.5rem]">
        <button
          type="button"
          onClick={() => setLightbox(ALL.length - 1)}
          className="block w-full text-left"
          aria-label={`${GALLERY.posterTall.caption} — agrandir`}
        >
          <img
            src={GALLERY.posterTall.src}
            alt={GALLERY.posterTall.alt}
            loading="lazy"
            className="aspect-[9/16] w-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.2,0.7,0.1,1)] group-hover:scale-[1.02]"
          />
          <span className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border border-white/25 bg-black/40 text-white opacity-0 backdrop-blur transition-opacity duration-300 group-hover:opacity-100">
            <Expand size={14} />
          </span>
          <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-4 pt-10">
            <span className="block font-mono text-[11px] uppercase tracking-[0.16em] text-amber">Affiche verticale</span>
            <span className="mt-1 block font-display text-lg italic leading-tight text-bone">{GALLERY.posterTall.caption}</span>
          </figcaption>
        </button>
      </figure>

      {/* Lightbox */}
      <AnimatePresence>
        {current !== null && lightbox !== null && (
          <motion.div
            key="galerie-lightbox"
            className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-ink/95 p-4 backdrop-blur-xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={lightboxTransition}
            onClick={close}
            role="dialog"
            aria-modal="true"
            aria-label={current.caption}
          >
            <button
              type="button"
              onClick={close}
              aria-label={GALLERY.lightboxClose}
              className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-ink/60 text-bone transition-colors duration-300 hover:border-amber hover:text-amber"
            >
              <X size={18} />
            </button>
            <motion.figure
              key={current.src}
              className="w-full max-w-5xl"
              initial={reducedMotion ? false : { opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
              transition={lightboxTransition}
              onClick={(ev) => ev.stopPropagation()}
            >
              <img
                src={current.src}
                alt={current.alt}
                className="max-h-[78svh] w-full rounded-[1.5rem] object-contain"
              />
              <figcaption className="mt-4 flex items-center justify-between gap-4">
                <span className="font-display text-xl italic text-bone sm:text-2xl">{current.caption}</span>
                <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] text-mist">
                  {lightbox + 1} / {ALL.length}
                </span>
              </figcaption>
            </motion.figure>
            <div className="mt-6 flex items-center gap-3" onClick={(ev) => ev.stopPropagation()}>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label={GALLERY.lightboxPrev}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-bone transition-colors duration-300 hover:border-amber hover:text-amber"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label={GALLERY.lightboxNext}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-bone transition-colors duration-300 hover:border-amber hover:text-amber"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
