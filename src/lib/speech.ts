/**
 * Live speaking via the browser's built-in speechSynthesis.
 *
 * Deepgram TTS is OFFLINE (stored key still returns 401) and the freellm
 * brain is DOWN — neither is used or claimed here. The browser voice is
 * the honest live-speaking path until those come back: pick a French
 * (`fr-FR`) voice when the device has one, else the default voice.
 *
 * Honest lip-sync limit: speechSynthesis exposes NO audio stream, so
 * there is no real RMS to tap (unlike the YuriOS AnalyserNode path in
 * avatarBridge.ts, which needs an AudioContext source). While speaking,
 * the mouth is driven by a speech-timed syllabic envelope — amplitude
 * shaped through the same YuriOS constants (gain 5.0, amp^0.7 curve,
 * 0.04 gate, 0.7 cap, fast attack / slower release via shapeMouthOpen)
 * — so mouth and voice stay in sync in TIME, even though the amplitude
 * is synthesised, not measured. Both stages (VRM + Live2D) read the same
 * avatarBridge value, so they move together.
 */

import { avatarBridge, shapeMouthOpen } from './avatarBridge'

let muted = false
let speaking = false
let raf = 0
let prevMouth = 0
let lastT = 0
let cachedVoices: SpeechSynthesisVoice[] = []

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

/** Syllabic envelope: bursts of 3–5 syllables/second with short pauses. */
function envelope(tSeconds: number): number {
  // Pseudo-random gate from time — deterministic, no Math.random in the loop.
  const syllable = Math.floor(tSeconds * 3.7)
  const gate = (Math.sin(syllable * 12.9898) * 43758.5453) % 1
  const paused = Math.abs(gate) < 0.16
  const amp = paused ? 0.12 : 0.32 + 0.45 * Math.abs(Math.sin(tSeconds * 7.3)) * (0.6 + 0.4 * Math.sin(tSeconds * 2.7))
  return amp
}

function tickSpeaking(startedAt: number) {
  const now = performance.now()
  const dt = Math.min(Math.max((now - lastT) / 1000, 0), 0.1)
  lastT = now
  const t = (now - startedAt) / 1000
  // shapeMouthOpen expects raw RMS (it applies gain 5.0 itself).
  prevMouth = shapeMouthOpen(envelope(t) / 5, prevMouth, dt)
  avatarBridge.setMouthOpen(prevMouth)
  raf = requestAnimationFrame(() => tickSpeaking(startedAt))
}

function stopEnvelope() {
  cancelAnimationFrame(raf)
  prevMouth = 0
  avatarBridge.setMouthOpen(0)
}

function endSpeaking() {
  if (!speaking) return
  speaking = false
  stopEnvelope()
  avatarBridge.setSpeaking(false)
  avatarBridge.setExpression('neutral')
}

/** Keep spoken lines short — long chat text is read in full on screen. */
export function shortenForSpeech(text: string, maxChars = 200): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= maxChars) return clean
  const cut = clean.slice(0, maxChars)
  const sentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return (sentenceEnd > 60 ? cut.slice(0, sentenceEnd + 1) : `${cut}…`).trim()
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
  utter.onstart = () => {
    speaking = true
    lastT = performance.now()
    prevMouth = 0
    avatarBridge.setExpression('happy')
    avatarBridge.setSpeaking(true)
    raf = requestAnimationFrame(() => tickSpeaking(performance.now()))
  }
  utter.onend = endSpeaking
  utter.onerror = endSpeaking
  try {
    window.speechSynthesis.speak(utter)
  } catch {
    endSpeaking()
  }
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
