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
 * Fix pass 19 — the fix-18 cloud check (06:34–06:42 CET) split:
 * VENIR now drifts (PASS) but ACCUEIL is effectively static in 22 s
 * (mean change 0.72–2.51, 0–2.1% of pixels changed, golden dots in
 * identical positions). Diagnosis, from the code (not a guess):
 * - NOT a mount problem: the background mounts ONCE at the app root
 *   (App.tsx) and is identical on every tab, and fix 18's own VM
 *   probe measured the pan advancing on Home too (65.7 px / 32 s).
 * - The pan was too slow for the field it moves: 120 s cycle is
 *   ~2 px/s, ~42 px in 22 s, and the field is 6 big soft dim splats
 *   (SPLAT_RADIUS 0.35, dye ×0.16) over smooth underlay gradients —
 *   a 42 px shift of a field that varies over 200–400 px scales
 *   changes most pixels by only a few levels. Fix 18's own probe
 *   documented that meanAbsDiff/corr cannot separate pre-fix from
 *   post-fix on this field (pre-fix control 0.721 / corr 0.978).
 * - Home hides most of the field: the hero's intro panel (bg-ink/85
 *   + blur), the full-bleed opaque photo frame and the giant title
 *   cover most of the first viewport, so the fluid shows only in thin
 *   gutters/gaps — while VENIR is text-only and mostly bare fluid.
 *   Same pan, same field, different visible area: that is the split.
 * - The "golden dots in identical positions" are the HeroDust motes,
 *   a separate Home-only component: its whole cloud only rotates
 *   sin(t*0.05)*0.08 rad and bobs sin(t*0.12)*0.25 — individual motes
 *   never translate, so in 22 s they are effectively static. That is
 *   a HeroDust item, not a fluid item; this pass does not touch it
 *   (flagged in the fix-19 report for the coordinator).
 * Fix 19 (this pass, FluidBackground only):
 * - Pan 120 s → 30 s, travel ±6vw/±4vh → ±8vw/±5vh (oversize
 *   114% → 118%, inset -9%): ~10 px/s, ~220 px in 22 s — still a
 *   slow drift, but 5x the displacement rate, so a shift now spans
 *   the field's own spatial scale instead of sampling next-door
 *   pixels.
 * - Dye ×0.16 → ×0.30 (fluid.ts generateColor): ~90% brighter glow,
 *   still dark (max ~83/59/22 over near-black) so text stays legible,
 *   but the panning pattern now has real contrast to move.
 * - Sixteen drifting ember motes inside the panning wrapper (CSS,
 *   compositor-driven, wall-clock, 16–26 s cycles, 150–260 px travel):
 *   small bright amber/ember/teal dots that sweep the gutters and
 *   gaps on Home and the open areas on VENIR, each crossing a pixel
 *   changes it by tens of levels. They ride the pan AND their own
 *   motion, so they cannot be phase-locked to it.
 * Reduced motion: the component returns the static gradient and the
 * mote/drift animations are killed by the media query as well.
 *
 * Fix pass 18 (superseded by the above — kept for history): the fix-17
 * cloud pixel check proved the sim is NOT the problem and NOT the
 * solution either. Diagnosis (scripts/fix18-fluid-probe.mjs header):
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
/**
 * Fix 19 — drifting ember motes. Sixteen small bright dots in the café
 * palette, spread over the whole viewport (corners included), each on
 * its own compositor-driven cycle (16–26 s, 150–260 px travel). They
 * live INSIDE the panning wrapper, so they ride the pan AND their own
 * motion. A mote crossing a pixel changes it by tens of levels, which
 * is what makes the drift read on real pixels in the thin gutters and
 * gaps where Home actually shows the background. Soft radial glow,
 * slow and sparse — embers, not UI.
 */
const MOTES: ReadonlyArray<{
  left: string
  top: string
  size: number
  color: string
  dx: number
  dy: number
  dur: string
  delay: string
}> = [
  { left: '6%', top: '12%', size: 11, color: '232,163,61', dx: 220, dy: 90, dur: '18s', delay: '0s' },
  { left: '18%', top: '68%', size: 13, color: '217,93,57', dx: -190, dy: -120, dur: '22s', delay: '-6s' },
  { left: '28%', top: '22%', size: 9, color: '242,193,78', dx: 160, dy: 140, dur: '16s', delay: '-3s' },
  { left: '38%', top: '78%', size: 12, color: '46,125,107', dx: -240, dy: 80, dur: '24s', delay: '-11s' },
  { left: '48%', top: '10%', size: 10, color: '232,163,61', dx: 200, dy: -70, dur: '20s', delay: '-8s' },
  { left: '58%', top: '62%', size: 14, color: '217,93,57', dx: -170, dy: 130, dur: '26s', delay: '-14s' },
  { left: '68%', top: '28%', size: 9, color: '242,193,78', dx: 230, dy: -110, dur: '17s', delay: '-5s' },
  { left: '78%', top: '72%', size: 12, color: '232,163,61', dx: -210, dy: -90, dur: '23s', delay: '-9s' },
  { left: '88%', top: '18%', size: 11, color: '46,125,107', dx: 180, dy: 120, dur: '19s', delay: '-2s' },
  { left: '12%', top: '42%', size: 8, color: '242,193,78', dx: -150, dy: 160, dur: '21s', delay: '-7s' },
  { left: '92%', top: '48%', size: 13, color: '217,93,57', dx: -260, dy: 60, dur: '25s', delay: '-12s' },
  { left: '45%', top: '45%', size: 10, color: '232,163,61', dx: 190, dy: -140, dur: '18s', delay: '-4s' },
  // Fix 19b — the first probe run showed the bottom-right corner reading
  // weak on both tabs (Home BR 0.59–0.76, VENIR BR ~0.05): no mote
  // visited it and its dye is dim. Four more motes cover the bottom
  // band and the right edge, so every corner region has a mover.
  { left: '88%', top: '82%', size: 13, color: '217,93,57', dx: -240, dy: -100, dur: '20s', delay: '-10s' },
  { left: '68%', top: '88%', size: 11, color: '242,193,78', dx: 200, dy: -120, dur: '22s', delay: '-15s' },
  { left: '30%', top: '88%', size: 12, color: '46,125,107', dx: -180, dy: -140, dur: '24s', delay: '-6s' },
  { left: '95%', top: '65%', size: 10, color: '232,163,61', dx: -220, dy: 90, dur: '19s', delay: '-13s' },
]

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
      <div className="fluid-motes absolute inset-0" aria-hidden="true">
        {MOTES.map((m, i) => (
          <span
            key={i}
            className="fluid-mote"
            style={{
              left: m.left,
              top: m.top,
              width: m.size,
              height: m.size,
              background: `radial-gradient(circle, rgba(${m.color},0.9), rgba(${m.color},0.35) 45%, transparent 70%)`,
              ['--dx' as string]: `${m.dx}px`,
              ['--dy' as string]: `${m.dy}px`,
              animationDuration: m.dur,
              animationDelay: m.delay,
            }}
          />
        ))}
      </div>
    </div>
  )
}
