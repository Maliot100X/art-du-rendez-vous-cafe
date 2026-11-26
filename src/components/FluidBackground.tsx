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
 * Fix pass 18: the fix-17 cloud pixel check (03:24–03:33 CET) proved
 * the sim is NOT the problem and NOT the solution either. Diagnosis
 * (scripts/fix18-fluid-probe.mjs header + /tmp/fix18-diag.log):
 * - In a real browser the WebGL sim DOES render (SwiftShader WebGL 2.0,
 *   canvas mounts, fallback does not) — the CSS fallback is not what
 *   the check sees, so tuning the fallback cannot fix it.
 * - But the sim steps at ~0.5 fps at 1920x1000 in that browser, so
 *   22 s of wall time is ~11 frames = ~0.18 s of sim time. The
 *   wanderers (one emission per 54 frames) never fire and the opening
 *   splats barely move: the field is effectively frozen, and the
 *   15–36% pixel diff the check measured is the grain jitter, not
 *   the fluid. No sim-frame-gated tuning can ever fix a 22 s wall
 *   check at 0.5 fps — the drift has to run on WALL-CLOCK time.
 * - Even at full speed the dye does not translate coherently: over
 *   ~2 s of sim time the field decorrelates (corr(0,0) ≈ 0.00–0.10)
 *   because dye blooms and fades in place; new splats, not a moving
 *   pattern. So the fix is a slow compositor-driven PAN of the whole
 *   field: the wrapper (canvas + underlay) translates ±6vw/±4vh on a
 *   120 s linear alternate cycle — ~2 px/s at 1920 wide, ~42 px in
 *   22 s, ~115 px a minute — calm, but the marbled pattern visibly
 *   crosses the screen in every browser at any sim fps, with no input.
 *   The canvas
 *   and underlay are oversized to 114% (inset -7%) so the pan never
 *   exposes an edge (6vw < 7% of width, 4vh < 7% of height, at any
 *   aspect ratio). The sim itself is also nudged (fluid.ts) so the
 *   dye flows more on GPU browsers instead of only blooming in place.
 * - Reduced motion: the canvas never mounts, so there is nothing to
 *   pan; the animation is also killed by the media query below as
 *   belt-and-braces.
 *
 * Failure can never blank the page (the lesson of the Hero R3F canvas):
 * - prefers-reduced-motion → static gradient, no canvas at all. This
 *   is the ONLY case that ever shows a still background (on any tab).
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
    <div className="fluid-drift pointer-events-none fixed inset-0 z-0" aria-hidden="true">
      <div className="fluid-fallback fluid-underlay absolute" />
      <canvas ref={canvasRef} className="fluid-canvas absolute block" />
    </div>
  )
}
