import {useEffect, useRef} from 'react';
import {StretchEngine} from '../gl/stretch';

const BLEED = 90;

/**
 * Otis's taffy engine on a drink photo: grab anywhere and pull, the photo
 * draws out like toffee (gaussian grab falloff, tanh rubber band) and snaps
 * back with a wobble; a tap pokes it. Up to 4 pointers at once.
 * The canvas overhangs the photo by BLEED px so pulls can leave the frame.
 */
export function StretchPhoto({src, alt, className = ''}: {src: string; alt: string; className?: string}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const box = boxRef.current!;
    const canvas = canvasRef.current!;
    let eng: StretchEngine | null = null;
    let dead = false;
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    const size = () => {
      if (!eng) return;
      const {width: w, height: h} = box.getBoundingClientRect();
      eng.resize(w + BLEED * 2, h + BLEED * 2, Math.min(devicePixelRatio, 2), {x: BLEED, y: BLEED, w, h});
    };
    const local = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const downAt = new Map<number, [number, number, number]>();
    const down = (e: PointerEvent) => {
      if (!eng) return;
      const [x, y] = local(e);
      const hit = eng.pick(x, y);
      if (!hit) return;
      canvas.setPointerCapture(e.pointerId);
      downAt.set(e.pointerId, [x, y, performance.now()]);
      eng.grab(e.pointerId, hit.u, hit.v, x, y);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (!eng || !downAt.has(e.pointerId)) {
        // only claim the pointer over the photo, so the 3D wheel underneath keeps its clicks
        if (eng) {
          const [x, y] = local(e);
          canvas.style.cursor = eng.pick(x, y) ? 'grab' : '';
        }
        return;
      }
      const [x, y] = local(e);
      eng.drag(e.pointerId, x, y);
    };
    const up = (e: PointerEvent) => {
      const d0 = downAt.get(e.pointerId);
      if (!eng || !d0) return;
      downAt.delete(e.pointerId);
      eng.release(e.pointerId);
      const [x, y] = local(e);
      if (Math.hypot(x - d0[0], y - d0[1]) < 6 && performance.now() - d0[2] < 250) {
        const hit = eng.pick(x, y);
        if (hit) eng.poke(hit.u, hit.v, 0.35);
      }
    };
    img.onload = () => {
      if (dead) return;
      try {
        eng = new StretchEngine(canvas, img);
      } catch {
        return; // no WebGL2: the plain <img> fallback stays visible
      }
      box.dataset.ready = '';
      size();
      eng.poke(0.5, 0.2, 0.18); // a little hello wobble each time the drink changes
    };
    const ro = new ResizeObserver(size);
    ro.observe(box);
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    return () => {
      dead = true;
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      eng?.destroy();
      delete box.dataset.ready;
    };
  }, [src]);

  return (
    <div ref={boxRef} className={`group relative ${className}`} data-stretch>
      <img src={src} alt={alt} className="absolute inset-0 size-full rounded-[22px] object-cover transition-opacity group-data-[ready]:opacity-0" />
      <canvas
        key={src}
        ref={canvasRef}
        className="absolute touch-none"
        style={{left: -BLEED, top: -BLEED, width: `calc(100% + ${BLEED * 2}px)`, height: `calc(100% + ${BLEED * 2}px)`}}
        aria-hidden="true"
      />
    </div>
  );
}
