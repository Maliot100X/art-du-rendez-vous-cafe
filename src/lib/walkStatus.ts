/**
 * Live walk status (fix pass 6) — a tiny module-level store so the
 * Menu panel can show what Vita's legs are doing without devtools.
 *
 * The cloud-browser check cannot open devtools, so the walk must be
 * observable from the page itself: VrmModel's render loop writes the
 * live state every frame ({walking, step, x, tick}) and MenuVitaPanel
 * subscribes and renders it as plain DOM text ("Marche… pas 2/4 ·
 * x +0.14" / "Arrivée · x +0.14"). Same subscribe/get pattern as
 * getLive2dProgress/subscribeLive2dProgress in Live2DModel.tsx.
 *
 * The store notifies only when a displayed field changes (walking,
 * step, tick, or x rounded to the centimetre), so the 60 fps writes
 * from the render loop do not re-render the panel 60 times a second.
 * The last state persists at rest, so the check can read "Arrivée"
 * after the walk has finished too.
 */

export interface WalkStatus {
  /** True while a walk cycle is running. */
  walking: boolean
  /** 1-based step while walking (0 at rest). */
  step: number
  /** Steps per walk (4 — VrmModel STEP_COUNT). */
  steps: number
  /** Lateral group position in metres (WALK_LEFT -0.08 / WALK_RIGHT +0.14). */
  x: number
  /** Walk trigger nonce (VrmModel walkTick); 0 before any walk. */
  tick: number
}

let walkStatus: WalkStatus = { walking: false, step: 0, steps: 4, x: 0, tick: 0 }
const walkListeners = new Set<(s: WalkStatus) => void>()

function sameWalkStatus(a: WalkStatus, b: WalkStatus): boolean {
  return (
    a.walking === b.walking &&
    a.step === b.step &&
    a.steps === b.steps &&
    Math.round(a.x * 100) === Math.round(b.x * 100) &&
    a.tick === b.tick
  )
}

export function setWalkStatus(next: WalkStatus): void {
  if (sameWalkStatus(next, walkStatus)) return
  walkStatus = { ...next }
  walkListeners.forEach((cb) => {
    try {
      cb(walkStatus)
    } catch {
      // A status listener must never break the render loop.
    }
  })
}

export function getWalkStatus(): WalkStatus {
  return { ...walkStatus }
}

export function subscribeWalkStatus(cb: (s: WalkStatus) => void): () => void {
  walkListeners.add(cb)
  try {
    cb(walkStatus)
  } catch {
    // Ignore a throwing listener.
  }
  return () => {
    walkListeners.delete(cb)
  }
}
