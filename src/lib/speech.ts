/**
 * Live speaking via the browser's built-in speechSynthesis.
 *
 * Deepgram TTS is OFFLINE (stored key still returns 401) and the freellm
 * brain is DOWN — neither is used or claimed here. The browser voice is
 * the honest live-speaking path until those come back: pick a French
 * (`fr-FR`) voice when the device has one, else the default voice.
 *
 * Lip-sync (fix pass 10): speechSynthesis exposes NO audio stream, so
 * there is no real RMS to tap (unlike the YuriOS AnalyserNode path in
 * avatarBridge.ts, which needs an AudioContext source). The mouth is
 * driven by src/lib/speechViseme.ts — a word-timed vowel clock
 * (layer2d A/I/U/E/O shapes) built from the spoken text itself.
 * The old driver was a free-running pseudo-random envelope that only
 * started from `utter.onstart`, and on Chrome Android the utterance
 * events are the broken part: `onboundary` NEVER fires there (MDN:
 * "The `boundary` event does not fire as expected", Chromium bugs
 * 1122143 / 40715888) and `onstart`/`onend` are unreliable — so the
 * voice played while the mouth never moved. The new driver therefore
 * never trusts the events: the clock starts/stops by POLLING
 * `speechSynthesis.speaking` every frame, and `onboundary` is only
 * an opportunistic re-anchor when it does fire (desktop Chrome).
 * A watchdog closes the mouth if speech never starts (voice missing
 * or blocked), so it never flaps silently. Nekomi (Live2D) reads the
 * same avatarBridge value, so her mouth moves with the voice.
 *
 * Fix pass 13 — open-loop fallback: that watchdog was the bug. In
 * browsers where speech never starts (no voices installed / headless
 * — the pixel check heard "Nothing played" in 12 s), the clock never
 * started and the 2500 ms watchdog killed the tick, so the mouth
 * stayed 0 for the whole reading even though the reading timer ran
 * and the "Lecture en cours…" panel was up. Now, if the engine has
 * not reported speaking within ~800 ms of queueing, the clock starts
 * ANYWAY (open-loop mode) and runs until the word-timed beats are
 * done — the clock is timed from the text itself, so it is the
 * correct fallback when audio is unavailable. If the engine DOES
 * start later, the clock restarts from now (re-sync to the real
 * audio) and switches back to engine mode. The kill-watchdog is
 * gone: it can never kill an open-loop run.
 *
 * Fix pass 15 — the event kill fix 14 missed: the no-audio browser
 * does NOT sit in the fix-13 shape (speaking false, no events). It
 * raises `speaking` for the queued utterance, so the poll starts the
 * clock in engine mode, then rejects the utterance at ~100-150 ms
 * (onerror + onend, no audio ever played) — and fix 14's
 * `endIfSpoken` ended the run on that event because visemeStarted
 * was already true. One ~50 ms blip, then a dead mouth for the whole
 * reply (scripts/fix15-mouth-probe.mjs scenarios E/E2 reproduce it).
 * An event now ends a run only after >= 1000 ms of real audio since
 * onstart; anything earlier falls back to open-loop. Plus a
 * stuck-engine grace in the poll: beats done + engine still claiming
 * speaking 2 s later ends the run instead of spinning the tick
 * forever.
 */

import { avatarBridge, smoothMouthOpen } from './avatarBridge'
import { SpeechViseme } from './speechViseme'

let muted = false
let speaking = false
let raf = 0
/** Fix pass 16: true while a tickSpeaking rAF callback is queued —
    the tick is driven from TWO sources now (rAF + the interval
    below), so the rAF chain must be scheduled at most once. */
let rafPending = false
/** Fix pass 16: the setInterval id driving tickSpeaking alongside
    rAF (0 = no interval running). Created in speak(), cleared in
    endSpeaking(). */
let tickInterval: ReturnType<typeof setInterval> | 0 = 0
/** Fix pass 16: the interval period. ~50 ms (20 Hz) samples the
    ~2-3 Hz viseme envelope far above its Nyquist rate, so the bridge
    tracks the envelope even when rAF is starved to ~0.4 fps. */
const TICK_INTERVAL_MS = 50
let prevMouth = 0
let lastT = 0
let cachedVoices: SpeechSynthesisVoice[] = []
/** The utterance + viseme of the line currently being spoken. */
let viseme: SpeechViseme | null = null
let visemeStarted = false
let speakQueuedAt = 0
/** Fix pass 13: true while the viseme clock runs open-loop (started
    without the engine reporting speaking, because audio never
    started). In this mode the run ends when the beats are done,
    regardless of the engine flag; if the engine starts later the
    clock re-syncs and this flips back to false (engine mode). */
let openLoop = false
/** Fix pass 13: how long to wait for the real engine before falling
    back to open-loop. A normal engine starts well within this, so on
    a real phone the clock still starts from the real audio (no
    visible lead); only when audio truly never starts does open-loop
    take over. */
const OPEN_LOOP_AFTER_MS = 800
/** Fix pass 15: an utterance event may end a run only after real audio
    has played for at least this long since onstart fired. Chrome
    raises `speechSynthesis.speaking` for a merely QUEUED utterance,
    so the poll can start the clock in engine mode before any audio
    plays — and a no-voice / no-audio engine then rejects the utterance
    almost at once (onerror + onend at ~100-150 ms). Ending the run on
    that event killed the mouth for the whole reply (probe E/E2:
    one ~50 ms blip, then dead). `onstart` firing is the witness that
    audio really started, and even then only a meaningful stretch of
    it counts: a sub-second start-then-error is a failed start, not
    speech, and falls back to open-loop instead. */
const MIN_AUDIBLE_MS = 1000
/** Fix pass 15: if the beats are done but the engine still claims
    speaking this long later (utterance queued forever, no audio, no
    event), end the run instead of spinning the tick forever. The
    mouth is already 0 at that point, so nothing visible changes. */
const STUCK_ENGINE_GRACE_MS = 2000
/** Fix pass 15: performance.now() of the last utter.onstart (null
    until one fires). Presence proves the engine really started;
    absence proves nothing (Android often never fires it). */
let engineStartAtMs: number | null = null
/** Fix pass 15: performance.now() when the beats first reported done
    while the engine still claimed speaking (null otherwise). */
let beatsDoneAtMs: number | null = null
/** Fix pass 10: hold the utterance so Chrome cannot garbage-collect
    it mid-speech (a known cause of dropped `onend`). */
let utterRef: SpeechSynthesisUtterance | null = null

/** The utterance currently held (GC root) — for debugging. */
export function getActiveUtterance(): SpeechSynthesisUtterance | null {
  return utterRef
}

function loadVoices(): SpeechSynthesisVoice[] {
  if (!('speechSynthesis' in window)) return []
  const voices = window.speechSynthesis.getVoices()
  if (voices.length > 0) cachedVoices = voices
  return cachedVoices
}

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** French voice first, else the device default. */
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = loadVoices()
  if (voices.length === 0) return null
  const fr = voices.find((v) => v.lang.toLowerCase().startsWith('fr'))
  return fr ?? voices.find((v) => v.default) ?? voices[0] ?? null
}

/**
 * Viseme tick — runs on requestAnimationFrame from the moment speak()
 * queues the utterance. It never trusts utterance events: every frame
 * it polls `speechSynthesis.speaking` (the real engine state, even
 * when `onstart`/`onend` never fire on Android) to start the viseme
 * clock, sample the mouth, and stop when the voice is really done.
 * Fix pass 13: if the engine never reports speaking within
 * OPEN_LOOP_AFTER_MS, the clock starts anyway (open-loop) so the
 * mouth moves during readings even with no audio at all.
 *
 * Fix pass 16: the tick is ALSO driven by a ~50 ms setInterval
 * (see TICK_INTERVAL_MS, started in speak()). The whole mouth chain
 * was rAF-gated, and in a no-audio headless/cloud browser the page
 * renders at ~0.3-2 fps — rAF fired 5-6 times in a 13 s reply
 * window, so the ~2-3 Hz viseme envelope was sampled at ~0.3 Hz and
 * aliased to a mostly-closed staircase: the bridge held one random
 * sample for seconds and the model re-baked just as rarely, so a
 * 10-12 s pixel sample saw an essentially frozen closed mouth. The
 * interval samples the envelope at 20 Hz regardless of frame rate
 * (timers fire at ~3.6 Hz even in that environment — still 10x the
 * rAF rate — and at 50 ms the tick itself is cheap). rAF stays a
 * driver too, so a real phone at 60 fps is unchanged: the tick is
 * time-based (performance.now + clamped dt), so running it from
 * both sources only samples more often, never double-advances.
 * The rAF chain is guarded by rafPending so the two drivers never
 * stack duplicate rAF callbacks.
 */
function tickSpeaking() {
  const now = performance.now()
  const dt = Math.min(Math.max((now - lastT) / 1000, 0), 0.1)
  lastT = now
  const synth = window.speechSynthesis
  const engineSpeaking = synth ? synth.speaking : false

  // Start the clock the moment the engine is really speaking —
  // `onstart` may never fire (Android), so the poll is the trigger.
  if (!visemeStarted && engineSpeaking && viseme) {
    viseme.start(now)
    visemeStarted = true
    openLoop = false
    speaking = true
    avatarBridge.setExpression('happy')
    avatarBridge.setSpeaking(true)
  } else if (!visemeStarted && viseme && now - speakQueuedAt >= OPEN_LOOP_AFTER_MS) {
    // Fix pass 13 — open-loop fallback: the engine never started
    // (no voices / headless / blocked). Start the word-timed clock
    // anyway and keep it running until the beats are done. The old
    // 2500 ms kill-watchdog lived here and is deliberately gone:
    // it must never kill an open-loop run.
    viseme.start(now)
    visemeStarted = true
    openLoop = true
    speaking = true
    avatarBridge.setExpression('happy')
    avatarBridge.setSpeaking(true)
  } else if (visemeStarted && openLoop && engineSpeaking && viseme) {
    // Fix pass 13 — re-sync: the engine started late while
    // open-loop was running. The real audio is at its beginning,
    // so restart the clock from now and switch back to engine mode.
    viseme.restart(now)
    openLoop = false
  }

  if (visemeStarted && viseme) {
    const frame = viseme.sample(now)
    prevMouth = smoothMouthOpen(frame.mouth, prevMouth, dt)
    avatarBridge.setMouthOpen(prevMouth)
    avatarBridge.setMouthVowel(frame.vowel)
    // End: in open-loop mode the beats finishing is enough (the
    // engine flag may never move); in engine mode keep the existing
    // end (beats done AND the engine quiet). The poll — not
    // `onend` — is what closes the mouth on Android.
    // Fix pass 15: if the beats are done but the engine still claims
    // speaking, it is stuck (queued forever, no audio, no event) —
    // end after the grace instead of spinning the tick forever.
    if (frame.done) {
      if (openLoop || !engineSpeaking) {
        endSpeaking()
        return
      }
      if (beatsDoneAtMs === null) beatsDoneAtMs = now
      else if (now - beatsDoneAtMs >= STUCK_ENGINE_GRACE_MS) {
        endSpeaking()
        return
      }
    } else {
      beatsDoneAtMs = null
    }
  }
  // NOTE: no kill-watchdog here any more (fix pass 13). Before the
  // 800 ms open-loop start the tick simply keeps polling; after it
  // the clock runs until the beats finish.

  // Keep polling while an utterance is in flight — the loop must NOT
  // stop on `speaking` (still false while the voice is queued, and
  // the poll is exactly what notices it starting). endSpeaking()
  // clears `viseme`, which is what stops the loop.
  // Fix pass 16: schedule the next rAF through the guard — the
  // interval driver below also calls tickSpeaking, and without the
  // guard each interval tick would queue another rAF chain.
  if (viseme !== null) scheduleRaf()
}

/** Fix pass 16: queue one tickSpeaking rAF callback, at most one
    pending at a time. Called from tickSpeaking() itself and from
    speak() (first frame); the setInterval driver does not go through
    here — it calls tickSpeaking() directly on its own schedule. */
function scheduleRaf() {
  if (rafPending) return
  rafPending = true
  raf = requestAnimationFrame(() => {
    rafPending = false
    tickSpeaking()
  })
}

function stopEnvelope() {
  cancelAnimationFrame(raf)
  rafPending = false
  // Fix pass 16: stop the interval driver with the rAF driver — a
  // leaked interval would keep sampling a dead viseme forever.
  if (tickInterval) {
    clearInterval(tickInterval)
    tickInterval = 0
  }
  prevMouth = 0
  avatarBridge.setMouthOpen(0)
  avatarBridge.setMouthVowel(null)
}

function endSpeaking() {
  if (!speaking && !viseme) return
  speaking = false
  stopEnvelope()
  avatarBridge.setSpeaking(false)
  avatarBridge.setExpression('neutral')
  viseme = null
  visemeStarted = false
  openLoop = false
  engineStartAtMs = null
  beatsDoneAtMs = null
  utterRef = null
}

/** Keep spoken lines short — long chat text is read in full on screen. */
export function shortenForSpeech(text: string, maxChars = 200): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= maxChars) return clean
  const cut = clean.slice(0, maxChars)
  const sentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return (sentenceEnd > 60 ? cut.slice(0, sentenceEnd + 1) : `${cut.slice(0, maxChars - 1)}…`).trim()
}

export function speak(text: string): void {
  if (!isSpeechSupported() || muted) return
  const short = shortenForSpeech(text)
  if (!short) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    // cancel() throwing must not break the chat.
  }
  endSpeaking()
  const utter = new SpeechSynthesisUtterance(short)
  const voice = pickVoice()
  if (voice) utter.voice = voice
  utter.lang = voice?.lang ?? 'fr-FR'
  utter.rate = 1
  utter.pitch = 1.05
  // The viseme clock is built from the exact text being spoken.
  viseme = new SpeechViseme(short, utter.rate)
  visemeStarted = false
  openLoop = false
  engineStartAtMs = null
  beatsDoneAtMs = null
  speakQueuedAt = performance.now()
  utterRef = utter
  utter.onstart = () => {
    // Fix pass 15: onstart firing is the witness that the engine
    // really started playing audio (its absence proves nothing —
    // Android often never fires it — but its presence is reliable).
    // Recorded before the branches below, so endIfSpoken can tell a
    // real start from a merely queued utterance.
    engineStartAtMs = performance.now()
    // Opportunistic start — the poll in tickSpeaking() is the real
    // trigger (Android often never fires this).
    if (viseme && !visemeStarted) {
      viseme.start(performance.now())
      visemeStarted = true
      openLoop = false
      speaking = true
      lastT = performance.now()
      prevMouth = 0
      avatarBridge.setExpression('happy')
      avatarBridge.setSpeaking(true)
    } else if (viseme && visemeStarted && openLoop) {
      // Fix pass 13: the engine fired onstart late while open-loop
      // was running — re-sync the clock to the real audio now (the
      // poll would catch this on the next frame too; this is the
      // same switch, just one frame earlier).
      viseme.restart(performance.now())
      openLoop = false
    }
  }
  utter.onboundary = (e) => {
    // Desktop Chrome only — never fires on Android. When it does,
    // it re-anchors the clock to the real word being spoken.
    if (e.name === 'word') viseme?.noteBoundary(e.charIndex, performance.now())
  }
  // Fix pass 14: an utterance event must never kill a run whose
  // audio never started. On an engine where speech never starts (no
  // voices / headless / blocked) the utterance can fire onerror (or
  // onend) immediately — the old unconditional endSpeaking() here
  // killed the tick before the 800 ms open-loop start, so the mouth
  // stayed shut for the whole line even though fix 13's fallback
  // existed. Only an engine that really spoke may end the run from
  // its event; a never-started / open-loop run is ended by the poll
  // in tickSpeaking() when its beats are done.
  // Fix pass 15: the fix-14 guard (`visemeStarted && !openLoop`) was
  // not enough. Chrome raises `speechSynthesis.speaking` for a
  // merely QUEUED utterance, so the poll starts the clock in engine
  // mode before any audio plays — and a no-voice engine then rejects
  // the utterance at ~100-150 ms. The event arrived with
  // visemeStarted true and openLoop false, so the run died ~150 ms
  // in (probe E: one ~50 ms blip, then dead for the whole reply).
  // An event may therefore end a run only after real audio played
  // for at least MIN_AUDIBLE_MS since onstart; anything earlier is a
  // failed start, and the run falls back to open-loop (the clock
  // keeps its start time — only the end rule changes) so the mouth
  // still runs the beats. If onstart never fired at all, no audible
  // time can have elapsed, so the same fallback applies — the poll
  // ends the run when the beats are done.
  const endIfSpoken = () => {
    const now = performance.now()
    if (engineStartAtMs !== null && now - engineStartAtMs >= MIN_AUDIBLE_MS) {
      endSpeaking()
      return
    }
    if (visemeStarted && !openLoop) openLoop = true
  }
  utter.onend = endIfSpoken
  utter.onerror = endIfSpoken
  try {
    window.speechSynthesis.speak(utter)
  } catch {
    // Fix pass 14: speak() throwing (no engine at all) must not kill
    // the run either — fall through and start the poll tick below, so
    // the open-loop clock still runs the beats and the mouth moves.
  }
  // Start the poll tick at once — it, not `onstart`, notices the
  // voice starting and drives the mouth from the first frame.
  // Fix pass 16: TWO drivers now. rAF (scheduleRaf) is the driver
  // when frames flow; the ~50 ms interval is the driver when they
  // don't (headless/cloud browsers at ~0.4 fps — see the tickSpeaking
  // header). Both call the same time-based tick, so a 60 fps phone
  // just samples more often. The interval is cleared in
  // stopEnvelope() (via endSpeaking), so it never outlives the run.
  lastT = performance.now()
  prevMouth = 0
  scheduleRaf()
  tickInterval = setInterval(tickSpeaking, TICK_INTERVAL_MS)
}

export function stopSpeaking(): void {
  if (!isSpeechSupported()) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    // Ignore.
  }
  endSpeaking()
}

export function setSpeechMuted(value: boolean): void {
  muted = value
  if (value) stopSpeaking()
}

export function isSpeechMuted(): boolean {
  return muted
}

// Voices load asynchronously in most browsers — warm the cache early so
// the first speak() already has a French voice to pick.
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  loadVoices()
  window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices)
}
