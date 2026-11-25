import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import * as THREE from 'three';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { BOOK, CAFE, MENU, VISIT } from '../content';
import { gsap, GSAP_EASE_SILK } from '../lib/motion';
import { useReducedMotion } from '../lib/scroll';
import {
  LEAF_COUNT,
  PAGE_H,
  PAGE_W,
  buildLeaves,
  drawPage,
  loadImage,
  spreadLabel,
} from '../lib/bookPages';

/**
 * Le livre de la carte — a real 3D page-flip book.
 *
 * Eight leaves, each a Three.js plane (24 segments) bent with a belly
 * mid-turn and rotated around the spine by a GSAP tween on the silk
 * curve — geometry that actually deforms in 3D space, not a CSS fake.
 * Every face is a canvas texture drawn from content.ts MENU, so the
 * prices in the book are the prices in the menu, never retyped.
 *
 * Phone: the book frames one page at a time (camera fits a single
 * page, the book is shifted so the right page is centred); desktop
 * frames the whole spread. The swipe uses `touch-action: pan-y` plus
 * a directional lock — a vertical swipe still scrolls the page, only
 * a clearly horizontal swipe turns a leaf. Phase 2's `touch-action:
 * none` trap is deliberately not repeated.
 *
 * prefers-reduced-motion (or no WebGL2) → the same spreads as static
 * DOM pages, same controls, no animation. The render loop only runs
 * while a flip is tweening or on resize — no idle rAF.
 */

const PAGE_W_UNITS = 1;
const PAGE_H_UNITS = PAGE_H / PAGE_W;
const MARGIN = 0.22;

interface LeafRuntime {
  group: THREE.Group;
  geometry: THREE.PlaneGeometry;
  base: Float32Array;
}

interface ThreeBook {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  book: THREE.Group;
  leaves: LeafRuntime[];
  textures: THREE.CanvasTexture[];
  canvases: HTMLCanvasElement[];
  applyFlip: (value: number) => void;
  render: () => void;
  layout: () => void;
  dispose: () => void;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export default function MenuBook() {
  const reducedMotion = useReducedMotion();
  const [flipped, setFlipped] = useState(0);
  const [webglFailed, setWebglFailed] = useState(false);
  const [singlePage, setSinglePage] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 640,
  );
  const stageRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef(0);
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  const threeRef = useRef<ThreeBook | null>(null);
  const singlePageRef = useRef(singlePage);
  singlePageRef.current = singlePage;

  const staticMode = reducedMotion || webglFailed;

  const goTo = useCallback(
    (target: number) => {
      const next = Math.max(0, Math.min(LEAF_COUNT, target));
      setFlipped(next);
      const three = threeRef.current;
      if (!three || staticMode) return;
      const from = flipRef.current;
      if (from === next) return;
      tweenRef.current?.kill();
      const proxy = { v: from };
      tweenRef.current = gsap.to(proxy, {
        v: next,
        duration: 0.55 + 0.35 * Math.abs(next - from),
        ease: GSAP_EASE_SILK,
        overwrite: true,
        onUpdate: () => {
          flipRef.current = proxy.v;
          three.applyFlip(proxy.v);
          three.render();
        },
        onComplete: () => {
          flipRef.current = next;
        },
      });
    },
    [staticMode],
  );

  /* ---- Three.js book: built once, disposed on unmount. ---- */
  useEffect(() => {
    if (reducedMotion) return;
    const stage = stageRef.current;
    if (!stage) return;

    let cancelled = false;
    let three: ThreeBook | null = null;
    let ro: ResizeObserver | null = null;

    const init = async () => {
      // Wait for the brand fonts (or 2.5s, whichever first) so the canvas
      // pages are drawn in Bodoni / Martian Mono, not a fallback.
      try {
        await Promise.race([
          Promise.all([
            document.fonts.load('700 96px "Bodoni Moda Variable"'),
            document.fonts.load('italic 400 38px "Bodoni Moda Variable"'),
            document.fonts.load('500 30px "Martian Mono"'),
            document.fonts.load('400 30px "Albert Sans Variable"'),
            document.fonts.ready,
          ]),
          new Promise((resolve) => window.setTimeout(resolve, 2500)),
        ]);
      } catch {
        /* fall back to whatever loaded */
      }
      if (cancelled) return;

      const leaves = buildLeaves();
      const pages = leaves.flatMap((leaf) => [leaf.front, leaf.back]);
      const images = new Map<string, HTMLImageElement | null>();

      // One canvas + texture per page face.
      const canvases = pages.map(() => {
        const canvas = document.createElement('canvas');
        canvas.width = PAGE_W;
        canvas.height = PAGE_H;
        return canvas;
      });
      const drawAll = () => {
        pages.forEach((page, i) => {
          const ctx = canvases[i].getContext('2d');
          if (ctx) drawPage(ctx, page, images);
        });
      };
      drawAll();

      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        if (!cancelled) setWebglFailed(true);
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      stage.appendChild(renderer.domElement);
      renderer.domElement.setAttribute('aria-hidden', 'true');
      renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;';

      const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      const textures = canvases.map((canvas) => {
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = maxAniso;
        return tex;
      });

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
      scene.add(new THREE.AmbientLight(0xffffff, 0.95));
      const key = new THREE.DirectionalLight(0xfff2dd, 1.1);
      key.position.set(2, 3, 4);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xdfe8ff, 0.35);
      fill.position.set(-3, 1, 2);
      scene.add(fill);

      const book = new THREE.Group();
      scene.add(book);

      const leafRuntimes: LeafRuntime[] = leaves.map((_, i) => {
        const geometry = new THREE.PlaneGeometry(PAGE_W_UNITS, PAGE_H_UNITS, 24, 1);
        const base = new Float32Array((geometry.attributes.position as THREE.BufferAttribute).array);
        const frontTex = textures[2 * i];
        const backTex = textures[2 * i + 1];
        // The back mesh is rotated π around Y, which mirrors its texture —
        // mirror it back so the text reads correctly.
        backTex.wrapS = THREE.RepeatWrapping;
        backTex.repeat.x = -1;
        backTex.offset.x = 1;
        const frontMat = new THREE.MeshStandardMaterial({ map: frontTex, roughness: 0.85, metalness: 0 });
        const backMat = new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.85, metalness: 0 });
        const group = new THREE.Group();
        const front = new THREE.Mesh(geometry, frontMat);
        front.position.x = PAGE_W_UNITS / 2;
        const back = new THREE.Mesh(geometry, backMat);
        back.rotation.y = Math.PI;
        back.position.x = PAGE_W_UNITS / 2;
        group.add(front, back);
        book.add(group);
        return { group, geometry, base };
      });

      const applyFlip = (value: number) => {
        leafRuntimes.forEach((leaf, i) => {
          const p = clamp01(value - i);
          const phi = p * Math.PI;
          leaf.group.rotation.y = -phi;
          // Curl belly, peaking mid-turn — the page bends, it doesn't
          // just rotate. sin(π·u) is symmetric, so the shared front/back
          // geometry bends the same way on both faces.
          const belly = 0.085 * Math.sin(Math.PI * p);
          const pos = leaf.geometry.attributes.position as THREE.BufferAttribute;
          for (let v = 0; v < pos.count; v++) {
            const bx = leaf.base[v * 3];
            const u = (bx + PAGE_W_UNITS / 2) / PAGE_W_UNITS;
            pos.setZ(v, belly * Math.sin(Math.PI * u));
          }
          pos.needsUpdate = true;
          leaf.geometry.computeVertexNormals();
          // Stacking: flipped leaves pile on the left (later = higher),
          // unflipped pile on the right (current page on top); the leaf
          // mid-turn lifts above both stacks.
          const turning = p > 0 && p < 1;
          leaf.group.position.z =
            (i < value ? i : LEAF_COUNT - i) * 0.004 + (turning ? 0.06 * Math.sin(Math.PI * p) : 0);
        });
        // Centre the cover / back cover when closed; on a phone the open
        // book is framed on its right page only.
        const closedFront = 1 - clamp01(value);
        const closedBack = clamp01(value - (LEAF_COUNT - 1));
        const single = singlePageRef.current;
        book.position.x =
          (-PAGE_W_UNITS / 2) * closedFront +
          (PAGE_W_UNITS / 2) * closedBack +
          (single && value > 0 && value < LEAF_COUNT ? -PAGE_W_UNITS / 2 : 0);
      };

      const render = () => {
        renderer.render(scene, camera);
      };

      const layout = () => {
        const w = stage.clientWidth;
        const h = stage.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        const single = w < 640;
        if (single !== singlePageRef.current) {
          singlePageRef.current = single;
          setSinglePage(single);
        }
        const aspect = w / h;
        const framedW = (single ? PAGE_W_UNITS : PAGE_W_UNITS * 2) + MARGIN;
        const framedH = PAGE_H_UNITS + MARGIN;
        const halfFovTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const dist = Math.max(
          framedH / 2 / halfFovTan,
          framedW / 2 / (halfFovTan * aspect),
        );
        camera.aspect = aspect;
        camera.position.set(0, 0, dist);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        applyFlip(flipRef.current);
        render();
      };

      const dispose = () => {
        tweenRef.current?.kill();
        ro?.disconnect();
        leafRuntimes.forEach((leaf) => leaf.geometry.dispose());
        textures.forEach((tex) => tex.dispose());
        renderer.dispose();
        if (renderer.domElement.parentElement === stage) {
          stage.removeChild(renderer.domElement);
        }
      };

      three = { renderer, scene, camera, book, leaves: leafRuntimes, textures, canvases, applyFlip, render, layout, dispose };
      threeRef.current = three;

      // Category photos arrive after the first draw — redraw the intro
      // pages that use them and push the new pixels to the GPU.
      const srcs = [...new Set(MENU.map((c) => c.image))];
      void Promise.all(
        srcs.map(async (src) => {
          const img = await loadImage(src);
          if (cancelled) return;
          images.set(src, img);
          pages.forEach((page, i) => {
            if (page.kind === 'intro' && page.category.image === src) {
              const ctx = canvases[i].getContext('2d');
              if (ctx) drawPage(ctx, page, images);
              textures[i].needsUpdate = true;
            }
          });
          three?.render();
        }),
      );

      layout();
      ro = new ResizeObserver(layout);
      ro.observe(stage);
    };

    void init();
    return () => {
      cancelled = true;
      three?.dispose();
      threeRef.current = null;
    };
  }, [reducedMotion]);

  /* ---- Swipe with a directional lock (touch-action: pan-y). ---- */
  const swipeRef = useRef<{ x: number; y: number; done: boolean } | null>(null);
  const onPointerDown = (ev: ReactPointerEvent) => {
    swipeRef.current = { x: ev.clientX, y: ev.clientY, done: false };
  };
  const onPointerMove = (ev: ReactPointerEvent) => {
    const s = swipeRef.current;
    if (!s || s.done) return;
    const dx = ev.clientX - s.x;
    const dy = ev.clientY - s.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      s.done = true;
      goTo(flipped + (dx < 0 ? 1 : -1));
    }
  };
  const onPointerUp = (ev: ReactPointerEvent) => {
    const s = swipeRef.current;
    if (s && !s.done) {
      const dx = ev.clientX - s.x;
      const dy = ev.clientY - s.y;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        goTo(flipped + (dx < 0 ? 1 : -1));
      }
    }
    swipeRef.current = null;
  };
  const onKeyDown = (ev: ReactKeyboardEvent) => {
    if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      goTo(flipped + 1);
    } else if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      goTo(flipped - 1);
    } else if (ev.key === 'Home') {
      ev.preventDefault();
      goTo(0);
    } else if (ev.key === 'End') {
      ev.preventDefault();
      goTo(LEAF_COUNT);
    }
  };

  const category = flipped >= 1 && flipped <= MENU.length ? MENU[flipped - 1] : null;
  const stageAspect = singlePage
    ? `${(PAGE_W_UNITS + MARGIN).toFixed(2)} / ${(PAGE_H_UNITS + MARGIN).toFixed(2)}`
    : `${(PAGE_W_UNITS * 2 + MARGIN).toFixed(2)} / ${(PAGE_H_UNITS + MARGIN).toFixed(2)}`;

  return (
    <section id="livre" className="relative mx-auto max-w-[1400px] scroll-mt-24 px-4 py-16 sm:px-6 sm:py-24 md:py-36" aria-label="Le livre de la carte">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between" data-reveal>
        <div>
          <p className="font-mono text-label uppercase text-amber">{BOOK.eyebrow}</p>
          <h2 className="mt-3 font-display text-display text-bone">
            Feuilletez <span className="italic text-amber">la carte.</span>
          </h2>
        </div>
        <p className="max-w-md text-body text-bone/70">{BOOK.lede}</p>
      </div>

      {/* Stage — focusable region: arrows turn the pages. */}
      <div
        ref={stageRef}
        tabIndex={0}
        role="region"
        aria-label="Livre de la carte — flèches gauche et droite pour tourner les pages"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipeRef.current = null;
        }}
        className="relative mx-auto mt-12 w-full touch-pan-y select-none overflow-hidden"
        style={{
          maxWidth: singlePage ? 480 : 960,
          aspectRatio: stageAspect,
        }}
        data-reveal
      >
        {/* Soft glow behind the book (visor stage grammar). */}
        <div
          aria-hidden
          className="absolute inset-[-8%] rounded-full"
          style={{ background: 'radial-gradient(closest-side, rgba(232,163,61,0.14), transparent)' }}
        />
        {staticMode && (
          <div className="absolute inset-0">
            <StaticSpread flipped={flipped} category={category} />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="mt-8 flex flex-col items-center gap-4" data-reveal style={{ ['--d' as string]: '90ms' }}>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => goTo(flipped - 1)}
            disabled={flipped === 0}
            aria-label={BOOK.prevLabel}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-bone transition-all duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] hover:border-amber hover:text-amber disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-line disabled:hover:text-bone"
          >
            <ChevronLeft size={18} />
          </button>
          <p aria-live="polite" className="min-w-40 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-bone/80">
            {BOOK.pageLabel} {flipped + 1} {BOOK.ofLabel} {LEAF_COUNT + 1} — {spreadLabel(flipped)}
          </p>
          <button
            type="button"
            onClick={() => goTo(flipped + 1)}
            disabled={flipped === LEAF_COUNT}
            aria-label={BOOK.nextLabel}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-bone transition-all duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] hover:border-amber hover:text-amber disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-line disabled:hover:text-bone"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Progress segments — one per view (cover, 7 spreads, back). */}
        <div className="flex w-full max-w-xs gap-1.5" role="group" aria-label="Pages du livre">
          {Array.from({ length: LEAF_COUNT + 1 }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Aller à : ${spreadLabel(i)}`}
              aria-current={i === flipped}
              className={`h-1.5 flex-1 rounded-full transition-all duration-300 ease-[cubic-bezier(0.2,0.7,0.1,1)] ${
                i === flipped ? 'bg-amber' : 'bg-bone/20 hover:bg-bone/40'
              }`}
            />
          ))}
        </div>

        <p className="text-center font-mono text-[11px] uppercase tracking-[0.16em] text-mist">
          {staticMode
            ? reducedMotion
              ? BOOK.reducedMotionNote
              : BOOK.webglFallbackNote
            : `${BOOK.coverHint} · Flèches ← → au clavier`}
        </p>
      </div>
    </section>
  );
}

/**
 * Static spreads for reduced motion / no WebGL — the same pages as DOM,
 * same MENU data, same dotted leaders as the tabbed menu. No animation.
 */
function StaticSpread({
  flipped,
  category,
}: {
  flipped: number;
  category: (typeof MENU)[number] | null;
}) {
  if (flipped === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex h-full w-full max-w-md flex-col items-center justify-center rounded-[1.5rem] bg-ink-2 px-8 text-center ring-1 ring-line">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-amber">Bruxelles · Depuis toujours</p>
          <p className="mt-6 font-display text-5xl font-bold leading-none text-bone">
            ART DU
            <br />
            RENDEZ-VOUS
          </p>
          <p className="mt-2 font-display text-5xl italic text-amber">Café</p>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-bone/70">La carte des boissons</p>
          <p className="mt-2 text-sm text-bone/60">Sept familles, des prix affichés, rien d’autre.</p>
        </div>
      </div>
    );
  }
  if (flipped === LEAF_COUNT) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex h-full w-full max-w-md flex-col items-center justify-center rounded-[1.5rem] bg-ink-2 px-8 text-center ring-1 ring-line">
          <p className="font-display text-4xl font-bold leading-tight text-bone">
            ART DU
            <br />
            RENDEZ-VOUS
          </p>
          <p className="mt-1 font-display text-4xl italic text-amber">Café</p>
          <p className="mt-6 text-body text-bone/75">{CAFE.address}</p>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-amber">Horaires</p>
          {VISIT.hours.map((h) => (
            <p key={h.days} className="mt-1 text-sm text-bone/75">
              {h.days} — {h.time}
            </p>
          ))}
        </div>
      </div>
    );
  }
  if (!category) return null;
  return (
    <div className="grid h-full gap-4 overflow-y-auto md:grid-cols-2">
      {/* Left page — the category intro. */}
      <div className="overflow-hidden rounded-[1.5rem] bg-bone text-ink">
        <div className="relative h-44 sm:h-56">
          <img src={category.image} alt={category.imageAlt} className="h-full w-full object-cover" loading="lazy" />
          <div
            className="absolute inset-0"
            aria-hidden
            style={{ background: 'linear-gradient(180deg, transparent 55%, rgba(236,229,218,0.9))' }}
          />
        </div>
        <div className="p-6 sm:p-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#9a6a1a]">
            La carte — {String(MENU.indexOf(category) + 1).padStart(2, '0')} / {String(MENU.length).padStart(2, '0')}
          </p>
          <h3 className="mt-3 font-display text-4xl font-bold sm:text-5xl">{category.label}</h3>
          <p className="mt-3 font-display text-xl italic text-ink/75">{category.blurb}</p>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8a7d6c]">Les prix — page suivante →</p>
        </div>
      </div>
      {/* Right page — the items, dotted leaders, exact prices. */}
      <div className="rounded-[1.5rem] bg-bone p-6 text-ink sm:p-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#9a6a1a]">
          La carte — {String(MENU.indexOf(category) + 1).padStart(2, '0')} / {String(MENU.length).padStart(2, '0')}
        </p>
        <h3 className="mt-2 font-display text-3xl font-bold">{category.label}</h3>
        <ul className="mt-4">
          {category.items.map((item, i) => (
            <li key={item.name} className="flex items-baseline gap-2 border-b border-ink/10 py-2.5">
              <span className="font-mono text-[10px] text-[#8a7d6c]">{String(i + 1).padStart(2, '0')}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-base font-bold tracking-wide sm:text-lg">{item.name}</span>
                {item.note && (
                  <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-[#8a7d6c]">{item.note}</span>
                )}
              </span>
              <span className="hidden flex-1 border-b border-dotted border-ink/25 sm:block" aria-hidden />
              <span className="font-mono text-sm font-medium tabular-nums text-[#9a6a1a]">{item.price}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-[#8a7d6c]">Prix en euros, taxes comprises</p>
      </div>
    </div>
  );
}
