import { useEffect, useRef, useState } from 'react'
import { createFluid } from '../lib/fluid'
import { useReducedMotion } from '../lib/scroll'

/**
 * Fluid background — the PavelDoGreat stable-fluids sim (see src/lib/fluid.ts)
 * as a fixed full-viewport canvas behind the whole page, in the café
 * palette (amber / gold / ember / teal on near-black). Pointer movement
 * stirs it; a slow ambient splat keeps it alive with no input.
 *
 * Failure can never blank the page (the lesson of the Hero R3F canvas):
 * - prefers-reduced-motion → static gradient, no canvas at all.
 * - WebGL context creation / shader / FBO failure → the init throws,
 *   the component swaps to the static gradient.
 * - Context loss after init → onFatal swaps to the gradient.
 * - The gradient is also rendered *under* the canvas, so there is never
 *   a black flash while the sim warms up, and a lost context reveals the
 *   gradient instead of black.
 * - The component itself is wrapped in an ErrorBoundary in App as well.
 *
 * Mobile perf: the sim runs at lower resolution with fewer pressure
 * iterations (see fluid.ts), the loop pauses while the tab is hidden,
 * and the canvas is `pointer-events: none` — it can never block a tap.
 */
export function FluidFallback() {
  return <div className="fluid-fallback pointer-events-none fixed inset-0 z-0" aria-hidden="true" />
}

export default function FluidBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    if (reducedMotion) return
    const canvas = canvasRef.current
    if (!canvas) return
    let destroy: (() => void) | undefined
    try {
      destroy = createFluid(canvas, {
        mobile:
          typeof window !== 'undefined' &&
          (window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768),
        onFatal: () => setFailed(true),
      })
    } catch {
      setFailed(true)
    }
    return () => destroy?.()
  }, [reducedMotion])

  if (reducedMotion || failed) return <FluidFallback />

  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
      <div className="fluid-fallback absolute inset-0" />
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
    </div>
  )
}
