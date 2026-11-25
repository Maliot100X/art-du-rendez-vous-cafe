import {useEffect, useMemo, useRef, useState} from 'react';
import {categories, drinks, formatPrice} from '../content';
import {sizeLabel} from '../data/store.js';
import {createBookScene, paginate} from '../gl/bookScene';
import type {Host} from '../gl/host';
import {clamp, pinProgress} from '../lib/math';
import {onFrame} from '../lib/scroll';
import {startAgent, type Agent} from '../lib/voice';
import {useReducedMotion} from '../hooks/useReducedMotion';
import {L2DHost, type L2DHandle} from './L2DHost';

const USE_VRM = typeof location !== 'undefined' && new URLSearchParams(location.search).get('host') === 'vrm';

/**
 * Le livre: the whole carte as a 3D book on the bar (gl/bookScene.ts) with a
 * VRM host behind it. Entering the section opens it through a Visor-style
 * circular mask; the camera dollies in; drag/swipe, arrows or the buttons
 * turn the pages. The host greets, glances at turning pages, follows the
 * cursor, and can talk (Deepgram agent, server-side token).
 */
export function Livre() {
  const reduced = useReducedMotion();
  const root = useRef<HTMLElement>(null);
  const maskRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<ReturnType<typeof createBookScene> | null>(null);
  const hostRef = useRef<Host | null>(null);
  const voiceRef = useRef<Agent | null>(null);
  const l2dRef = useRef<L2DHandle>(null);
  const pages = useMemo(() => paginate(categories), []);
  const [spread, setSpread] = useState(0);
  const [ready, setReady] = useState(false);
  const [say, setSay] = useState('');
  const [voice, setVoice] = useState('');

  const lineFor = (s: number) => {
    if (s === 0) return 'Bonjour ! Je vous ouvre la carte ?';
    const p = pages[2 * s] ?? pages[2 * s - 1];
    const c = (pages[2 * s - 1]?.cat ?? p?.cat) || null;
    if (!c) return s === 1 ? `${drinks.length} boissons, du premier café au dernier verre.` : 'Santé, et à très vite !';
    return `${c.title.fr} : ${c.count} à la carte, dès ${formatPrice(c.from)}.`;
  };

  useEffect(() => {
    const fmt = {price: (n: number) => formatPrice(n), size: (k: string | null) => sizeLabel(k, 'fr'), total: drinks.length, address: 'Rue des Artistes 1A · 1020 Laeken · Bruxelles'};
    let scene: ReturnType<typeof createBookScene> | null = null;
    try {
      scene = createBookScene(canvasRef.current!, {
        reduced,
        vrm: USE_VRM,
        pages,
        drinks,
        fmt,
        onHost: (h) => {
          hostRef.current = h;
          (window as unknown as {__host: Host}).__host = h;
          setReady(true);
        },
        onPageChange: (s) => {
          if (!USE_VRM) setReady(true);
          setSpread(s);
          const line = lineFor(s);
          setSay(line);
          if (!voiceRef.current) hostRef.current?.speak(Math.min(3, 0.9 + line.length * 0.035));
        },
      });
      sceneRef.current = scene;
    } catch (err) {
      console.warn('WebGL unavailable for the book', err);
    }
    const born = performance.now();
    let greeted = false;
    let autoOpened = false;
    const off = onFrame(() => {
      const el = root.current;
      if (!el || !scene) return;
      const {p, rect, vh} = pinProgress(el);
      if (rect.bottom < 0 || rect.top > vh) return;
      const tIn = clamp((performance.now() - born - 300) / 1600);
      const enter = clamp(1 - rect.top / vh) * (1 - Math.pow(1 - tIn, 3));
      const r = 6 + enter * 104;
      if (maskRef.current) maskRef.current.style.clipPath = enter >= 1 ? 'none' : `circle(${r}% at 50% 55%)`;
      if (enter >= 1 && !greeted && hostRef.current) {
        greeted = true;
        hostRef.current.wave();
        hostRef.current.speak(2);
      }
      if (p > 0.25 && !autoOpened && scene.target === 0) {
        autoOpened = true;
        scene.go(1);
      }
      scene.render(enter + p * 0.6);
    });
    const onKey = (e: KeyboardEvent) => {
      const el = root.current;
      if (!el || !scene) return;
      const r = el.getBoundingClientRect();
      if (r.top > 10 || r.bottom < window.innerHeight - 10) return;
      if (e.key === 'ArrowRight') scene.go(Math.round(scene.target) + 1);
      if (e.key === 'ArrowLeft') scene.go(Math.round(scene.target) - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      off();
      window.removeEventListener('keydown', onKey);
      voiceRef.current?.stop();
      scene?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const S = pages.length / 2;
  const go = (d: number) => sceneRef.current?.go(Math.round(sceneRef.current.target) + d);
  const toggleVoice = async () => {
    if (voiceRef.current) {
      voiceRef.current.stop();
      voiceRef.current = null;
      setVoice('');
      return;
    }
    try {
      voiceRef.current = await startAgent({mic: true, onLevel: (v) => hostRef.current?.setMouth(v), onState: setVoice, onText: (_r, t) => setSay(t), onStream: (st) => !USE_VRM && !!l2dRef.current?.attachVoice(st)});
    } catch {
      setVoice('voix indisponible');
    }
  };
  const left = pages[2 * spread - 1];
  const label = spread === 0 ? 'Couverture' : `Pages ${2 * spread}–${2 * spread + 1}${left?.cat ? ' · ' + left.cat.title.fr : ''}`;

  return (
    <section ref={root} id="livre" aria-labelledby="livre-title" className="relative" style={{height: '320svh'}}>
      <div ref={maskRef} className="sticky top-0 h-svh overflow-clip" style={{clipPath: 'circle(6% at 50% 55%)'}}>
        <canvas ref={canvasRef} className="absolute inset-0 size-full touch-pan-y cursor-grab active:cursor-grabbing" aria-hidden="true" />

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between px-5 pt-20 md:px-10 md:pt-24">
          <div className="on-sky text-cream">
            <p className="label text-gold-light">Le livre · {drinks.length} boissons · 7 rubriques</p>
            <h2 id="livre-title" className="display mt-2 text-[clamp(34px,4.2vw,72px)]">
              La carte, <em className="text-gold-light">page à page</em>
            </h2>
          </div>
        </div>

        {!USE_VRM && <L2DHost ref={l2dRef} className="absolute bottom-0 left-[-4%] h-[78svh] w-[44vw] max-md:left-[-18%] max-md:h-[52svh] max-md:w-[90vw]" />}

        {/* host speech bubble */}
        <div
          className={`pointer-events-none absolute top-[24%] left-[4%] max-w-[17rem] rounded-[18px] rounded-bl-[4px] border border-cream/20 bg-ink/65 px-4 py-3 text-[14px] text-cream backdrop-blur-md transition-opacity duration-500 md:top-[30%] md:left-[8%] ${say && ready ? 'opacity-100' : 'opacity-0'}`}
          aria-live="polite"
        >
          <span className="label mb-1 block text-gold-light">Nori · votre hôte</span>
          {say}
        </div>

        <div className="absolute inset-x-0 bottom-6 flex flex-wrap items-center justify-center gap-3 px-4 md:bottom-10">
          <button type="button" onClick={() => go(-1)} disabled={spread === 0} className="grid size-11 place-items-center rounded-full border border-cream/25 bg-ink/60 text-cream backdrop-blur transition disabled:opacity-30" aria-label="Page précédente">
            ←
          </button>
          <span className="label min-w-[13rem] rounded-full border border-cream/15 bg-ink/60 px-4 py-3 text-center text-cream backdrop-blur" aria-live="polite">
            {label}
          </span>
          <button type="button" onClick={() => go(1)} disabled={spread >= S - 1} className="grid size-11 place-items-center rounded-full border border-cream/25 bg-ink/60 text-cream backdrop-blur transition disabled:opacity-30" aria-label="Page suivante">
            →
          </button>
          <button type="button" onClick={toggleVoice} className="rounded-full bg-cream px-4 py-3 text-[13px] font-medium text-ink transition-transform hover:scale-105">
            {voiceRef.current ? `Raccrocher · ${voice}` : voice || 'Parler à l’hôte'}
          </button>
        </div>
        <p className="label pointer-events-none absolute bottom-24 w-full text-center text-cream/60 md:bottom-28">Glissez pour tourner les pages</p>
      </div>
    </section>
  );
}
