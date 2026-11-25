import {useEffect, useRef, useState} from 'react';
import {SplitTitle} from './SplitTitle';
import {scene as sceneImg} from '../data/store.js';
import {createGalleryScene} from '../gl/galleryScene';
import {pinProgress, range} from '../lib/math';
import {onFrame} from '../lib/scroll';
import {useReducedMotion} from '../hooks/useReducedMotion';

const SHOTS: [string, string, string][] = [
  ['v1-facade', 'La façade', 'Rue des Artistes 1A, au coin de la gare de Bockstael'],
  ['g1-salle', 'La salle', 'Banquettes, miroirs et laiton'],
  ['a1-comptoir', 'Le comptoir', 'Là où tout commence, dès 8 h'],
  ['d1-matin', 'Le matin', 'Premier café, croissant, journal'],
  ['h1p-espresso', 'L’espresso', 'Serré, crème noisette'],
  ['g4-mains', 'Les mains', 'Latte art, tasse après tasse'],
  ['g5-pression', 'La pression', 'Bières belges à la tireuse'],
  ['d2-apero', 'L’apéro', 'Spritz, kir et planches'],
  ['g3-terrasse', 'La terrasse', 'Au soleil de Laeken'],
  ['d3-nuit', 'La nuit', 'Ouvert 24 h sur 24 le week-end'],
];

/** Galerie: a 3D walk past the café's photos (gl/galleryScene.ts). */
export function Galerie() {
  const reduced = useReducedMotion();
  const root = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cur, setCur] = useState(0);

  useEffect(() => {
    const shots = SHOTS.map(([n]) => {
      const s = sceneImg(n);
      return {src: s.l, w: s.w, h: s.h};
    });
    let g: ReturnType<typeof createGalleryScene> | null = null;
    try {
      g = createGalleryScene(canvasRef.current!, {reduced, shots});
    } catch (err) {
      console.warn('WebGL unavailable for the gallery', err);
    }
    let k = 0;
    let last = -1;
    const off = onFrame(() => {
      const el = root.current;
      if (!el || !g) return;
      const {p, rect, vh} = pinProgress(el);
      if (rect.bottom < 0 || rect.top > vh) return;
      k += (range(p, 0.02, 0.98) - k) * 0.1;
      const i = g.render(k);
      if (i !== last) {
        last = i;
        setCur(i);
      }
    });
    return () => {
      off();
      g?.dispose();
    };
  }, [reduced]);

  const [, title, note] = SHOTS[cur];
  return (
    <section ref={root} id="galerie" aria-labelledby="galerie-title" className="relative" style={{height: '900svh'}}>
      <div className="sticky top-0 h-svh overflow-clip">
        <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-x-0 top-0 px-5 pt-20 md:px-10 md:pt-24">
          <p className="label text-gold-light">Galerie · {SHOTS.length} vues du café</p>
          <SplitTitle as="h1" id="galerie-title" className="display mt-2 text-[clamp(36px,4.6vw,80px)] text-[#fff6ea]" text="Une promenade" em="au Rendez-Vous" />
        </div>
        <div className="pointer-events-none absolute bottom-8 left-5 max-w-sm rounded-[20px] border border-cream/15 bg-ink/60 px-5 py-4 text-cream backdrop-blur-md md:bottom-12 md:left-10" aria-live="polite">
          <p className="label text-gold-light">
            {String(cur + 1).padStart(2, '0')} / {SHOTS.length}
          </p>
          <p className="display mt-1 text-[28px]">{title}</p>
          <p className="mt-1 text-[14px] text-cream/70">{note}</p>
        </div>
        <p className="label pointer-events-none absolute right-5 bottom-8 text-[#fff6ea]/70 md:right-10 md:bottom-12">Faites défiler pour avancer</p>
      </div>
    </section>
  );
}
