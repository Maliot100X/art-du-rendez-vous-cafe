import { useEffect, useRef, useState } from 'react'
import { createFluid } from '../lib/fluid'
import { useReducedMotion } from '../lib/scroll'
import './FluidBackground.css'

/**
 * Fluid background — the PavelDoGreat stable-fluids sim (see src/lib/fluid.ts)
 * as a fixed full-viewport canvas behind the whole page, in the café
 * palette (amber / gold / ember / teal on near-black). Pointer movement
 * stirs it; a slow ambient splat keeps it alive with no input.
 *
 * Fix pass 15: the background was effectively STATIC on desktop
 * (measured: mean pixel change 0.27/255 over 14.8s in a fixed region,
 * bokeh dots in identical positions). The sim was stepping — it was
 * the steady state that was empty: DENSITY_DISSIPATION 0.3 erased
 * the opening splats in ~5s of sim time and the only sustaining
 * input was one weak random splat every 2.4s, and hover never stirred
 * (every hover move reset prev=pos, so delta was always 0). Fixed in
 * fluid.ts: slower dissipation, 1–2 wandering ambient emitters laying
 * a continuous dye trail, hover stirs, and window.__fluidDebug
 * (frames / lastStepAt / fps / splat counts) so the next pixel check
 * can confirm stepping. The CSS fallback below was also too soft and
 * slow to register on pixels (0.33/255, 0.00% >10 in the top-right
 * region over 8s) — its cycles are now ~2x faster with ~1.6x larger
 * travel and tighter gradients (see FluidBackground.css).
 *
 * Failure can never blank the page (the lesson of the Hero R3F canvas):
 * - prefers-reduced-motion → static gradient, no canvas at all. This
 *   is the ONLY case that ever shows a still background on the Home tab.
 * - WebGL context creation / shader / FBO failure → the init throws,
 *   the component swaps to the ANIMATED CSS fallback (moving coloured
 *   blobs in the same café palette) — never a flat static gradient.
 * - Context loss after init → onFatal swaps to the animated fallback.
 * - The static gradient is also rendered *under* the canvas, so there
 *   is never a black flash while the sim warms up, and a lost context
 *   reveals the gradient instead of black.
 * - The component itself is wrapped in an ErrorBoundary in App as well.
 *
 * Mobile perf: the sim runs at lower resolution with fewer pressure
 * iterations (see fluid.ts), the loop pauses while the tab is hidden,
 * and the canvas is `pointer-events: none` — it can never block a tap.
 * Touch drags still stir the fluid: input is window-level Pointer
 * Events, and the canvas never takes events.
 */
export function FluidFallback({ animated = false }: { animated?: boolean }) {
  if (!animated) {
    return <div className="fluid-fallback pointer-events-none fixed inset-0 z-0" aria-hidden="true" />
  }
  return (
    <div className="fluid-animated-fallback pointer-events-none fixed inset-0 z-0" aria-hidden="true">
      <span className="fluid-blob fluid-blob--amber" />
      <span className="fluid-blob fluid-blob--teal" />
      <span className="fluid-blob fluid-blob--ember" />
      <span className="fluid-blob fluid-blob--moss" />
    </div>
  )
}

export default function FluidBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  const reducedMotion = useReducedMotion()
  // Coarse pointer (phones/tablets) no longer disables the sim — it
  // only selects the low-cost mobile config inside createFluid.
  const coarsePointer =
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

  useEffect(() => {
    if (reducedMotion) return
    const canvas = canvasRef.current
    if (!canvas) return
    let destroy: (() => void) | undefined
    try {
      destroy = createFluid(canvas, {
        mobile:
          coarsePointer ||
          (typeof window !== 'undefined' && window.innerWidth < 768),
        onFatal: () => setFailed(true),
      })
    } catch {
      setFailed(true)
    }
    return () => destroy?.()
  }, [reducedMotion, coarsePointer])

  // Reduced motion: static gradient, no canvas, no animation.
  if (reducedMotion) return <FluidFallback />
  // WebGL unavailable / failed: coloured ANIMATED CSS fallback, never static.
  if (failed) return <FluidFallback animated />

  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
      <div className="fluid-fallback absolute inset-0" />
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
    </div>
  )
}
