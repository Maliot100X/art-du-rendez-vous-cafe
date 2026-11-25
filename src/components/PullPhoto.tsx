import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { HERO } from '../content';
import { useReducedMotion } from '../lib/scroll';
import { EASE_SILK_CSS } from '../lib/motion';
import { PullEngine } from '../lib/pullEngine';

type Props = {
  src: string;
  alt: string;
};

/**
 * The hero photo as an interactive otis-style shader canvas.
 *
 * The visitor grabs the bar photo and pulls it — the 128x128 grid mesh
 * stretches under the finger with a gaussian falloff and snaps back on a
 * damped spring (see src/lib/pullEngine.ts). Pointer events cover mouse
 * and touch; `touch-action: none` on the hit layer is what makes the
 * grab work on a phone instead of the browser stealing the touch as a
 * scroll — the trade-off is that a swipe starting on the photo grabs
 * instead of scrolling; the page still scrolls from everywhere else.
 *
 * Graceful degradation, otis pattern: no WebGL2 (or a failed image) →
 * the static <img>. prefers-reduced-motion → the static <img>, no warp.
 * The render loop pauses off-screen via IntersectionObserver.
 */
export default function PullPhoto({ src, alt }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PullEngine | null>(null);
  const [failed, setFailed] = useState(false);
  const [pulled, setPulled] = useState(false);
  const reducedMotion = useReducedMotion();

  const showCanvas = !failed && !reducedMotion;

  useEffect(() => {
    if (reducedMotion) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let engine: PullEngine | null = null;
    let disposed = false;
    let io: IntersectionObserver | null = null;
    let ro: ResizeObserver | null = null;

    const layout = () => {
      if (!engine) return;
      const w = wrap.offsetWidth;
      const h = wrap.offsetHeight;
      if (w === 0 || h === 0) return;
      engine.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
      engine.setStage({ x: 0, y: 0, w, h });
    };

    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (disposed) return;
      try {
        engine = new PullEngine(canvas, img);
      } catch {
        setFailed(true);
        return;
      }
      engineRef.current = engine;
      layout();
      engine.start();
      io = new IntersectionObserver(([entry]) => {
        if (!engine) return;
        if (entry.isIntersecting) engine.start();
        else engine.stop();
      });
      io.observe(canvas);
      ro = new ResizeObserver(layout);
      ro.observe(wrap);
    };
    img.onerror = () => setFailed(true);
    img.src = src;

    return () => {
      disposed = true;
      io?.disconnect();
      ro?.disconnect();
      engine?.destroy();
      engineRef.current = null;
    };
  }, [src, reducedMotion]);

  // Pointer coords in canvas CSS px. The hero parallax transform scales
  // this whole frame while scrolling, so the raw rect must be corrected
  // back by the rect/offset ratio — otherwise the grab point drifts
  // from the finger as the frame scales.
  const local = (ev: ReactPointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width / Math.max(1, canvas.offsetWidth);
    const sy = rect.height / Math.max(1, canvas.offsetHeight);
    return { x: (ev.clientX - rect.left) / sx, y: (ev.clientY - rect.top) / sy };
  };

  const onDown = (ev: ReactPointerEvent) => {
    const engine = engineRef.current;
    if (!engine) return;
    const p = local(ev);
    const at = engine.pick(p.x, p.y);
    if (!at) return;
    ev.preventDefault();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    engine.grab(ev.pointerId, at.u, at.v, p.x, p.y);
    setPulled(true);
  };

  const onMove = (ev: ReactPointerEvent) => {
    const engine = engineRef.current;
    if (!engine) return;
    const p = local(ev);
    engine.drag(ev.pointerId, p.x, p.y);
  };

  const onUp = (ev: ReactPointerEvent) => {
    engineRef.current?.release(ev.pointerId);
  };

  if (!showCanvas) {
    return (
      <img src={src} alt={alt} fetchPriority="high" className="absolute inset-0 h-full w-full object-cover" />
    );
  }

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />
      <div
        ref={hitRef}
        role="img"
        aria-label="La photo du bar. Tirez-la pour la déformer, relâchez pour la voir revenir."
        className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
      <p
        aria-hidden
        className="pointer-events-none absolute bottom-4 right-4 rounded-full border border-white/25 bg-black/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/90 backdrop-blur transition-opacity duration-1000 sm:bottom-6 sm:right-6"
        style={{ opacity: pulled ? 0 : 1, transitionTimingFunction: EASE_SILK_CSS }}
      >
        {HERO.pullHint} ↕
      </p>
    </div>
  );
}
