/**
 * Performance budgets — one place, so every WebGL stage caps the same way.
 *
 * Pixel ratio: phones render at 1.0, desktops at 1.5. The old cap of 2.0
 * made the VRM / book / Live2D stages draw 4x the pixels of a 1.0 canvas
 * on a 3x phone screen, for no visible gain on a 390px stage — that is a
 * large part of why the site felt laggy on Minir's phone. The fluid sim
 * already capped at 1.0 / 1.5 (see fluid.ts); the stages now match it.
 */

export function isPhoneViewport(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 640
  )
}

/** Max devicePixelRatio any stage may use: 1.0 on phones, 1.5 on desktop. */
export function pixelRatioCap(): number {
  return isPhoneViewport() ? 1 : 1.5
}

/**
 * Run a callback when the browser is idle (after first paint), with a
 * timeout fallback so it still runs on busy pages. Used for the heavy
 * model prewarm (fix pass 3): the VRM / Live2D bytes start loading
 * only once the first paint is done, never competing with it.
 */
export function runWhenIdle(cb: () => void, timeoutMs = 2500): void {
  if (typeof window === 'undefined') return
  const ric = (
    window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    }
  ).requestIdleCallback
  if (typeof ric === 'function') ric(cb, { timeout: timeoutMs })
  else window.setTimeout(cb, 1200)
}

/**
 * True when the visitor asked the browser to save data, or is on a
 * 2G-class connection — speculative heavy preloads (14 MB VRM) are
 * skipped then; hovering the tab still warms on demand.
 */
export function shouldDeferHeavyPreload(): boolean {
  if (typeof navigator === 'undefined') return false
  const conn = (
    navigator as unknown as {
      connection?: { saveData?: boolean; effectiveType?: string }
    }
  ).connection
  return conn?.saveData === true || conn?.effectiveType === '2g'
}
