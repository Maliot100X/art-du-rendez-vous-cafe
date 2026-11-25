/**
 * Fix pass 14 — module-level reading store for Nekomi's menu guide.
 *
 * ROOT CAUSE (see src/components/MenuGuide.tsx before this pass): the
 * reading lived in the menu hook's local state — `reading` useState,
 * `readingRef`, `pendingOpenRef`, `replyArrivedRef` and the
 * `readingTimerRef` setTimeout — plus a useEffect cleanup that
 * cleared the timer, stopped the voice and dropped the pending
 * big-book open when the hook unmounted. App.tsx mounts ONLY the
 * active tab (MenuTab unmounts the moment the visitor leaves LA
 * CARTE), so leaving mid-reading killed the timer callback, the
 * pending open and the downstream book flip — and with no flip there
 * was no bookEvents emit for the Agent tab to replay, hence no
 * Bières log entry even after 40+ s, and the spoken line reset to the
 * greeting on the next mount (local `line` state).
 *
 * This store is the same pattern as the chat persistence in
 * Agent.tsx (module-level state + subscription): it outlives every
 * tab-shell unmount, so a reading started on LA CARTE still finishes
 * on its timer, still fires its pending big-book open (which switches
 * the visitor to the Livre tab — the existing pending-open flow, not
 * a new behaviour) and still produces the book flip the Agent log
 * entry replays from. A full page reload still resets it.
 *
 * Rules kept from fix pass 13:
 * - No auto-reading on a category tab tap — readings start ONLY from
 *   an explicit ask ("Demander à la barmaid", a chat ask naming a
 *   category, an item tap). This store never starts a reading itself.
 * - Nonce guard: a timer (or a late brain reply) only acts when its
 *   nonce is still the live reading's nonce, so a newer reading
 *   supersedes an older one and a stop cannot be undone by a stale
 *   callback.
 * - "Couper la voix" (stopReading) cancels everything at once: the
 *   timer, the voice (via the registered speech stopper), the pending
 *   open and the indicator.
 * - The finish handler and the speech stopper are registered by the
 *   hook and deliberately NEVER unregistered on unmount — the handler
 *   is App's stable `openBook`, valid for the whole page lifetime, and
 *   the reading must be able to finish after its hook is gone.
 *
 * No React, no window access at import time and no imports at all, so
 * this module is importable from a plain node probe (see
 * scripts/fix14-reading-probe.mjs). Timers use the global setTimeout,
 * which is the browser's setTimeout on the page.
 */

/** One reading aloud: the asked category, a trigger nonce, and the
    estimated spoken seconds (the timer ends it). */
export interface ReadingState {
  categoryId: string
  nonce: number
  seconds: number
}

type Listener = () => void
type FinishHandler = (catId: string) => void
type SpeechStopper = () => void

const listeners = new Set<Listener>()

/** The reading currently in progress (null when she is not reading). */
let reading: ReadingState | null = null
/** The guide line currently shown (null until the hook first sets it). */
let guideLine: string | null = null
/** Big-book tab switch waiting on a reading to finish. */
let pendingOpen: string | null = null
/** The brain's reply has arrived for the pending chat question. */
let replyArrived = false
/** The timer that ends the current reading (replaces the VRM's
    onReadingEnd). Its nonce guards against a stale timer firing
    after a newer reading started or a stop. */
let timer: ReturnType<typeof setTimeout> | null = null
/** Fired on a finished reading with a pending open — App's openBook. */
let finishHandler: FinishHandler | null = null
/** Called by stopReading to silence the voice (speech.stopSpeaking). */
let speechStopper: SpeechStopper | null = null

function notify(): void {
  listeners.forEach((cb) => {
    try {
      cb()
    } catch {
      // One bad subscriber must not break the reading.
    }
  })
}

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

/** Subscribe to reading / line changes; returns an unsubscribe. */
export function subscribeReadingStore(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function getReading(): ReadingState | null {
  return reading
}

export function getGuideLine(): string | null {
  return guideLine
}

/** Show a guide line (and mirror it into the mounted hook, if any). */
export function setGuideLine(text: string): void {
  guideLine = text
  notify()
}

export function getPendingOpen(): string | null {
  return pendingOpen
}

export function setPendingOpen(catId: string | null): void {
  pendingOpen = catId
}

export function getReplyArrived(): boolean {
  return replyArrived
}

export function setReplyArrived(value: boolean): void {
  replyArrived = value
}

/**
 * Register the finish handler. Deliberately NOT unregistered on
 * unmount: the reading must still open the book after its hook is
 * gone, and the handler (App's stable openBook) stays valid for the
 * whole page lifetime. A later mount simply re-registers the same
 * function.
 */
export function registerReadingFinishHandler(fn: FinishHandler | null): void {
  finishHandler = fn
}

/** Register the voice stopper (same no-unregister rule as above). */
export function registerSpeechStopper(fn: SpeechStopper | null): void {
  speechStopper = fn
}

/**
 * The reading is over: fire the pending big-book open, then clear the
 * indicator. A pending open fires only once the brain's reply has
 * arrived — if the timer runs out first, the end is held: the reading
 * clears but the pending open stays, and the reply re-times the
 * reading (startReading below) whose own finish then opens the book.
 */
function finishReading(nonce: number): void {
  if (reading?.nonce !== nonce) return
  timer = null
  const pending = pendingOpen
  reading = null
  notify()
  if (pending !== null && replyArrived) {
    pendingOpen = null
    try {
      finishHandler?.(pending)
    } catch {
      // A failing open must not leave the indicator stuck.
    }
  }
}

/** Start a reading: state + timer, both keyed by the same nonce. */
export function startReading(catId: string, seconds: number): number {
  const nonce = Date.now()
  clearTimer()
  reading = { categoryId: catId, nonce, seconds }
  notify()
  timer = setTimeout(() => finishReading(nonce), seconds * 1000)
  return nonce
}

/**
 * Stop the current reading (timer + voice + pending open + indicator)
 * at once. This is "Couper la voix" — and the only way a reading is
 * cancelled. Leaving the tab does NOT call this.
 */
export function stopReading(): void {
  clearTimer()
  pendingOpen = null
  replyArrived = false
  reading = null
  notify()
  try {
    speechStopper?.()
  } catch {
    // Stopping the voice must not break the stop itself.
  }
}
