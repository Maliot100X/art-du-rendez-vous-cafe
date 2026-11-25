import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

/**
 * React.lazy with one retry on chunk-load failure.
 *
 * A lazy chunk failing to load (slow tunnel, dropped connection) throws
 * during render — without a boundary that unmounts the whole app into a
 * black page. The retry gives a transient network blip one second chance;
 * a persistent failure still surfaces through the panel ErrorBoundary,
 * which offers a manual retry instead of a black page.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  let attempts = 0
  const load = (): Promise<{ default: T }> =>
    factory().catch((err: unknown) => {
      attempts += 1
      if (attempts === 1) {
        // Resolve with the retry promise: the outer promise adopts its
        // state, so a second failure still rejects (and the panel
        // ErrorBoundary shows the retry UI).
        return new Promise<{ default: T }>((resolve) => {
          window.setTimeout(() => resolve(load()), 800)
        })
      }
      throw err
    })
  return lazy(load)
}
