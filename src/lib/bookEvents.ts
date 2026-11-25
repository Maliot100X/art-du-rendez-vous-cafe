/**
 * Book -> agent event bus (tiny typed emitter, no dependency).
 *
 * The MenuBook (wired by another worker) calls `emitBookCategory(catId)`
 * when a leaf lands on a category. The Agent subscribes with
 * `onBookCategory` and reacts: a short chat message + spoken line
 * describing that category from src/content.ts MENU data.
 *
 * One event, one string, no React involved — either side can be mounted,
 * unmounted or rebuilt independently and nothing breaks.
 */

export type BookCategoryListener = (catId: string) => void

const listeners = new Set<BookCategoryListener>()

/**
 * Last category the book landed on, remembered at module level. The
 * Agent tab is unmounted while the book flips (tab shell), so a flip's
 * event would otherwise be lost — the Agent reads this on mount and
 * reacts to the latest flip when its tab opens.
 */
let lastEmitted: string | null = null

export function getLastBookCategory(): string | null {
  return lastEmitted
}

export function emitBookCategory(catId: string): void {
  lastEmitted = catId
  listeners.forEach((cb) => {
    try {
      cb(catId)
    } catch {
      // One bad listener must not break the book flip.
    }
  })
}

export function onBookCategory(cb: BookCategoryListener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
