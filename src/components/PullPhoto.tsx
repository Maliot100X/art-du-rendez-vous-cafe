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
 * damped spring (see src/lib/pullEngine.ts).
 *
 * Touch uses the MenuBook directional lock, NOT `touch-action: none`:
 * the hit layer is `touch-pan-y`, so a vertical swipe scrolls the page
 * natively and the browser claims it (pointercancel). Only a clearly
 * horizontal drag grabs the photo — a swipe starting on the hero can
 * never trap the visitor on the hero. The mouse grabs immediately on
 * pointerdown (no scroll conflict there).
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
  // In-flight touch gesture for the directional lock: the grab candidate
  // from pointerdown, armed only once the drag proves horizontal.
  const gestureRef = useRef<{ id: number; x: number; y: number; grab: { u: number; v: number } | null; active: boolean } | null>(null);
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
    // Mouse grabs immediately (no scroll conflict). Touch/pen waits for
    // the directional lock in onMove — a vertical swipe must scroll.
    if (ev.pointerType === 'mouse') {
      if (!at) return;
      ev.preventDefault();
      ev.currentTarget.setPointerCapture(ev.pointerId);
      engine.grab(ev.pointerId, at.u, at.v, p.x, p.y);
      setPulled(true);
      return;
    }
    gestureRef.current = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, grab: at, active: false };
  };

  const onMove = (ev: ReactPointerEvent) => {
    const engine = engineRef.current;
    if (!engine) return;
    const p = local(ev);
    const g = gestureRef.current;
    // Mouse: already grabbing from pointerdown, just drag.
    if (ev.pointerType === 'mouse') {
      engine.drag(ev.pointerId, p.x, p.y);
      return;
    }
    if (!g || g.id !== ev.pointerId) return;
    if (g.active) {
      engine.drag(ev.pointerId, p.x, p.y);
      return;
    }
    // Directional lock: only a clearly horizontal drag grabs the photo.
    // A vertical (or ambiguous) drag is left to the browser, which scrolls
    // the page and cancels this pointer for us.
    const dx = ev.clientX - g.x;
    const dy = ev.clientY - g.y;
    if (Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (!g.grab) {
        gestureRef.current = null;
        return;
      }
      ev.currentTarget.setPointerCapture(ev.pointerId);
      engine.grab(ev.pointerId, g.grab.u, g.grab.v, p.x, p.y);
      g.active = true;
      setPulled(true);
    }
  };

  const onUp = (ev: ReactPointerEvent) => {
    if (ev.pointerType !== 'mouse' && gestureRef.current?.id === ev.pointerId) {
      gestureRef.current = null;
    }
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
        className="absolute inset-0 cursor-grab touch-pan-y select-none active:cursor-grabbing"
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
        {HERO.pullHint} ↔
      </p>
    </div>
  );
}
