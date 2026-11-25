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
 * When a walk ends the loop writes the idle state (tick 0), so the
 * panel returns to "Vita est prête…" instead of going stale on a
 * "Marche…" line — and resetWalkStatus() below does the same when a
 * reading ends.
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
  /** Walk trigger nonce (VrmModel walkTick); 0 before any walk, and 0
      again once the walk has ended (idle) — the panel shows
      "Vita est prête…" while tick is 0. */
  tick: number
  /** Stepping knee angle in degrees, read BACK live from the VRM's
      RAW leg bones after humanoid.update() (fix pass 8) — the true
      3D bend, 0 = straight, ~62° at full bend with the pass-8
      constants. The cloud-browser check reads it as DOM text, so the
      walk is provable without devtools. The pass-7 version read the
      NORMALIZED nodes right after the walk wrote them, so it reported
      the commanded angle (57°, and up to 115° with a drifted base)
      even when the rendered legs were straight. */
  kneeDeg: number
}

let walkStatus: WalkStatus = { walking: false, step: 0, steps: 4, x: 0, tick: 0, kneeDeg: 0 }
const walkListeners = new Set<(s: WalkStatus) => void>()

function sameWalkStatus(a: WalkStatus, b: WalkStatus): boolean {
  return (
    a.walking === b.walking &&
    a.step === b.step &&
    a.steps === b.steps &&
    Math.round(a.x * 100) === Math.round(b.x * 100) &&
    a.tick === b.tick &&
    // Knee angle quantised to 5°: the panel shows the live angle
    // without re-rendering 60 times a second during the ramp.
    Math.round(a.kneeDeg / 5) === Math.round(b.kneeDeg / 5)
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

/**
 * Fix pass 8: a reading has ended — the panel's line goes back to
 * "Vita est prête — choisissez une catégorie." instead of showing a
 * stale "Arrivée · x …" forever (tick stayed > 0 after the first
 * walk, so the ready line could never come back). Only the walk
 * state resets; the lateral position is kept, so she stays standing
 * where she walked to.
 */
export function resetWalkStatus(): void {
  const next: WalkStatus = { ...walkStatus, walking: false, step: 0, tick: 0, kneeDeg: 0 }
  if (sameWalkStatus(next, walkStatus)) return
  walkStatus = next
  walkListeners.forEach((cb) => {
    try {
      cb(walkStatus)
    } catch {
      // A status listener must never break the caller.
    }
  })
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
