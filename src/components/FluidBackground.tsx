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
 * Fix pass 10: the sim runs on coarse-pointer devices (phones) too.
 * Fix pass 4 froze it to a static gradient on phones — the
 * `coarsePointer` early returns below — because the URL bar
 * showing/hiding while scrolling changes the viewport height, and
 * every resize re-initialised the sim's framebuffers, so the
 * background jumped. That is fixed at the source instead: fluid.ts
 * now ignores small height-only resizes (URL-bar wobble, see
 * shouldApplyResize), so the freeze is gone and the animated fluid
 * runs on phones, at lower resolution / fewer pressure iterations /
 * 1x DPR / slower ambient splats (see resolveFluidConfig in fluid.ts).
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
