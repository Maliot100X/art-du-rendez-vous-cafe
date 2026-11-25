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
 */

import { avatarBridge, smoothMouthOpen } from './avatarBridge'
import { SpeechViseme } from './speechViseme'

let muted = false
let speaking = false
let raf = 0
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
    if (frame.done && (openLoop || !engineSpeaking)) {
      endSpeaking()
      return
    }
  }
  // NOTE: no kill-watchdog here any more (fix pass 13). Before the
  // 800 ms open-loop start the tick simply keeps polling; after it
  // the clock runs until the beats finish.

  // Keep polling while an utterance is in flight — the loop must NOT
  // stop on `speaking` (still false while the voice is queued, and
  // the poll is exactly what notices it starting). endSpeaking()
  // clears `viseme`, which is what stops the loop.
  if (viseme !== null) raf = requestAnimationFrame(tickSpeaking)
}

function stopEnvelope() {
  cancelAnimationFrame(raf)
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
  speakQueuedAt = performance.now()
  utterRef = utter
  utter.onstart = () => {
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
  utter.onend = endSpeaking
  utter.onerror = endSpeaking
  try {
    window.speechSynthesis.speak(utter)
  } catch {
    endSpeaking()
    return
  }
  // Start the poll tick at once — it, not `onstart`, notices the
  // voice starting and drives the mouth from the first frame.
  lastT = performance.now()
  prevMouth = 0
  raf = requestAnimationFrame(tickSpeaking)
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
