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

export function emitBookCategory(catId: string): void {
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
