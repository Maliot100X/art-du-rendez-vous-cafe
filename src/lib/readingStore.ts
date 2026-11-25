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
 *
 * Fix pass 16 — a finished reading stays finished. The pixel check
 * found a reading coming back after it had finished; the mechanism
 * (proven on pixels with a slow brain reply, see
 * scripts/fix16-reading-probe.mjs) is a LATE brain reply re-timing a
 * reading whose timer already fired: the reply handler re-started it
 * as if it were still live. Two holes made that possible here:
 * (1) finishReading HELD the pending open when the reply had not
 * arrived yet (the fix-14 "held end") — finished state that was
 * never cleared or expired, so a stale "chaudes is owed a book open"
 * lingered indefinitely; and it was dead state anyway, because the
 * nonce guard already refused every re-time after expiry, so the
 * held open could never deliver the book it was held for. (2) The
 * re-time guard lived in each CALLER (getReading()?.nonce checks in
 * MenuGuide), not in the store, so any consumer could re-start a
 * completed reading. Fix: completion is TERMINAL — finishReading
 * always clears the pending open and the reply flag — and the ONLY
 * way to re-time a reading is retimeReading(), which succeeds only
 * while the exact reading (nonce + category) is still live and
 * refuses everything else. A late reply can therefore update the
 * guide line (harmless text) but can never start, restart or extend
 * a reading that has finished or been stopped.
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
 * The reading is over — TERMINALLY (fix pass 16). The pending
 * big-book open fires only if the brain's reply had already arrived;
 * otherwise the open is dropped with the reading instead of being
 * held: the old "held end" kept a stale pending open forever, and it
 * could never fire anyway, because a late reply cannot re-time an
 * expired reading (see retimeReading) — so the held open only ever
 * looked like a reading still owed. A reading that ends without a
 * reply simply does not open the book, exactly as fix 14's T4a
 * asserted; the reply arriving later updates the guide line only.
 */
function finishReading(nonce: number): void {
  if (reading?.nonce !== nonce) return
  timer = null
  const pending = pendingOpen
  const arrived = replyArrived
  reading = null
  pendingOpen = null
  replyArrived = false
  notify()
  if (pending !== null && arrived) {
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
 * Re-time the reading a brain reply belongs to — the ONLY way a reply
 * may extend a reading (fix pass 16). Atomic: it succeeds only while
 * the exact reading that nonce started is still live (same nonce AND
 * same category); otherwise it changes nothing and returns false.
 * A reply that lands after the reading finished, was stopped, or was
 * superseded by a newer reading is therefore refused HERE, in the
 * store, instead of relying on each caller remembering to check the
 * nonce first — no consumer can resurrect a completed reading, not
 * even by calling startReading again with the old category, because
 * retime is the only re-time path and startReading is only ever
 * called for a NEW reading (button press, chat ask, item tap). The
 * re-timed reading keeps its nonce (it is still the same press's
 * reading, only longer), so a second late reply for the same press
 * is judged against the same identity.
 */
export function retimeReading(nonce: number, catId: string, seconds: number): boolean {
  if (reading === null || reading.nonce !== nonce || reading.categoryId !== catId) return false
  clearTimer()
  reading = { categoryId: catId, nonce, seconds }
  notify()
  timer = setTimeout(() => finishReading(nonce), seconds * 1000)
  return true
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
