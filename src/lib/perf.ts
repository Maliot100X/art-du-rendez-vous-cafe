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
