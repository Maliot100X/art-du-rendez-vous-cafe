/**
 * Speech-timed viseme engine — the mouth driver for browser
 * speechSynthesis readings (fix pass 10). It drives Nekomi's Live2D
 * mouth (ParamMouthOpenY) via avatarBridge — it is NOT VRM-only, so
 * it stays after the VRM removal: without it, Nekomi's mouth would
 * never move during read-aloud replies.
 *
 * WHY THIS EXISTS: speechSynthesis exposes NO audio stream, so the
 * YuriOS AnalyserNode/RMS path (avatarBridge.ts, used by the Deepgram
 * voice agent) cannot work here. The old driver hid that with a
 * free-running pseudo-random "syllabic" envelope that started ONLY
 * from `utter.onstart` — and on Chrome Android the utterance events
 * are the broken part:
 *   - `onboundary` does NOT fire on Chrome Android at all
 *     (MDN compat: "The `boundary` event does not fire as expected",
 *     Chromium bugs 1122143 / 40715888; word boundaries fire on
 *     Safari macOS and Windows Chrome, not on Linux/Android).
 *   - `onstart`/`onend` are listed as supported but are unreliable
 *     in practice on Android (utterances speak while their events
 *     never arrive), so a driver gated on `onstart` never starts —
 *     the voice plays and the mouth stays shut. That is the
 *     lip-sync complaint: the audio worked, the envelope never ran.
 *
 * DESIGN (event-independent first, events as correction):
 * 1. The spoken text is split into vowel beats (layer2d A/I/U/E/O
 *    pattern: one mouth shape per vowel nucleus — A wide open,
 *    O round, E mid, U small-round, I narrow). Each beat gets a
 *    predicted duration from a French speaking rate (~12.5 chars/s
 *    at rate 1.0), so the mouth has a word-timed clock from the
 *    moment speech is queued — no event needed.
 * 2. The clock is STARTED by polling `speechSynthesis.speaking`
 *    (speech.ts's tick), not by `onstart` — the property reflects
 *    the real engine state even when the events never fire.
 * 3. When `onboundary` DOES fire (desktop Chrome), it re-anchors
 *    the clock to the real word (charIndex -> beat), correcting
 *    any prediction drift at every word boundary.
 * 4. The clock is STOPPED by polling too: when the beats are done
 *    AND `speechSynthesis.speaking` is false, the mouth closes.
 *    Fix pass 13: if the engine never starts, the clock starts
 *    open-loop ~800 ms after queueing and stops when the beats are
 *    done — the old 2500 ms kill-watchdog that closed the mouth
 *    before it ever opened is gone; see speech.ts.
 *
 * Pure + testable: no `window`, no `speechSynthesis` in here — the
 * caller owns the clock (performance.now) and the speaking poll.
 * See scripts/fix10-lipsync-probe.mjs for the runtime proof.
 */

/** One mouth shape per vowel, layer2d A/I/U/E/O pattern. */
export type MouthVowel = 'a' | 'i' | 'u' | 'e' | 'o'

/**
 * Target mouth openness per vowel (0..0.7, the YuriOS weight cap):
 * A widest, O round, E mid, U small-round, I narrowest.
 */
export const VOWEL_OPEN: Record<MouthVowel, number> = {
  a: 0.7,
  e: 0.55,
  i: 0.34,
  o: 0.62,
  u: 0.42,
} as const

/** French speaking rate at utterance rate 1.0 (chars per second). */
export const CHARS_PER_SECOND = 12.5
/** Silence gap inserted between words (seconds). */
export const WORD_GAP_SECONDS = 0.04

export interface VisemeBeat {
  vowel: MouthVowel
  /** Start/end in predicted seconds from the utterance start. */
  startT: number
  endT: number
  /** Char span of this beat inside the spoken text. */
  startChar: number
  endChar: number
}

/** French vowel letters (accented included) -> mouth shape. */
const VOWEL_LETTER: Record<string, MouthVowel> = {
  a: 'a',
  'à': 'a',
  'â': 'a',
  'ä': 'a',
  e: 'e',
  'é': 'e',
  'è': 'e',
  'ê': 'e',
  'ë': 'e',
  i: 'i',
  'î': 'i',
  'ï': 'i',
  y: 'i',
  o: 'o',
  'ô': 'o',
  'ö': 'o',
  u: 'u',
  'ù': 'u',
  'û': 'u',
  'ü': 'u',
}

/** French vowel digraphs -> mouth shape (nasals slightly closed). */
const VOWEL_DIGRAPH: Record<string, MouthVowel> = {
  ou: 'u',
  au: 'o',
  eau: 'o',
  ai: 'e',
  ei: 'e',
  an: 'a',
  en: 'a',
  on: 'o',
  in: 'e',
  un: 'e',
}

function isVowelLetter(ch: string): boolean {
  return ch in VOWEL_LETTER
}

/**
 * Split one word into vowel beats: each beat is a vowel nucleus
 * (letter or digraph) plus the consonants that follow it, up to the
 * next vowel. A word with no vowel gets a single neutral 'e' beat
 * (e.g. "psst" still opens the mouth a little instead of freezing).
 */
export function beatsOfWord(word: string, wordStartChar: number): VisemeBeat[] {
  const lower = word.toLowerCase()
  const nuclei: { index: number; len: number; vowel: MouthVowel }[] = []
  for (let i = 0; i < lower.length; ) {
    const tri = lower.slice(i, i + 3)
    const di = lower.slice(i, i + 2)
    if (tri === 'eau') {
      nuclei.push({ index: i, len: 3, vowel: 'o' })
      i += 3
    } else if (di in VOWEL_DIGRAPH) {
      nuclei.push({ index: i, len: 2, vowel: VOWEL_DIGRAPH[di] })
      i += 2
    } else if (isVowelLetter(lower[i])) {
      nuclei.push({ index: i, len: 1, vowel: VOWEL_LETTER[lower[i]] })
      i += 1
    } else {
      i += 1
    }
  }
  if (nuclei.length === 0) {
    return [
      {
        vowel: 'e',
        startT: 0,
        endT: 0,
        startChar: wordStartChar,
        endChar: wordStartChar + word.length,
      },
    ]
  }
  return nuclei.map((n, k) => {
    const nextStart = k + 1 < nuclei.length ? nuclei[k + 1].index : word.length
    return {
      vowel: n.vowel,
      startT: 0,
      endT: 0,
      startChar: wordStartChar + n.index,
      endChar: wordStartChar + nextStart,
    }
  })
}

/**
 * Build the beat clock for a whole utterance: beats in order, each
 * timed from its letter count at CHARS_PER_SECOND / rate, with a
 * short gap between words. Times are predicted seconds from the
 * utterance start; `noteBoundary` re-anchors them to reality.
 */
export function buildBeats(text: string, rate = 1): VisemeBeat[] {
  const beats: VisemeBeat[] = []
  const words = text.match(/\S+/g) ?? []
  let cursor = 0
  let t = 0
  const cps = CHARS_PER_SECOND * (rate || 1)
  for (const word of words) {
    const startChar = text.indexOf(word, cursor)
    cursor = startChar + word.length
    const wb = beatsOfWord(word, startChar)
    for (const b of wb) {
      const len = Math.max(1, b.endChar - b.startChar)
      const dur = Math.max(0.12, len / cps)
      beats.push({ ...b, startT: t, endT: t + dur })
      t += dur
    }
    t += WORD_GAP_SECONDS
  }
  return beats
}

export interface VisemeFrame {
  /** Mouth openness 0..0.7 (the YuriOS cap). */
  mouth: number
  /** Mouth shape of the beat being spoken, null between beats. */
  vowel: MouthVowel | null
  /** Index of the beat being spoken, -1 when idle/done. */
  beatIndex: number
  /** True once the last beat has ended. */
  done: boolean
}

function smoothstep(a: number, b: number, x: number): number {
  const s = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return s * s * (3 - 2 * s)
}

/**
 * The utterance clock. One instance per spoken line; the caller
 * (speech.ts) owns start/stop via the speaking poll.
 */
export class SpeechViseme {
  readonly beats: VisemeBeat[]
  readonly totalSeconds: number
  private startedAtMs: number | null = null
  /** Shift (ms) applied by boundary re-anchoring; 0 until one fires. */
  private shiftMs = 0

  constructor(text: string, rate = 1) {
    this.beats = buildBeats(text, rate)
    this.totalSeconds =
      this.beats.length > 0 ? this.beats[this.beats.length - 1].endT : 0
  }

  get started(): boolean {
    return this.startedAtMs !== null
  }

  start(nowMs: number): void {
    if (this.startedAtMs === null) {
      this.startedAtMs = nowMs
      this.shiftMs = 0
    }
  }

  /**
   * Fix pass 13: restart the clock from `nowMs`, even if already
   * started. Used when the engine starts speaking late while an
   * open-loop run is already going — the real audio is at its
   * beginning, so the mouth must re-sync to it, not keep the
   * predicted offset. Unlike `start()` (a no-op once started),
   * this always re-anchors and clears any boundary shift.
   */
  restart(nowMs: number): void {
    this.startedAtMs = nowMs
    this.shiftMs = 0
  }

  /**
   * A word boundary fired (desktop Chrome only — never on Android):
   * re-anchor the clock so the word starting at `charIndex` starts
   * NOW, correcting prediction drift. A boundary points at the
   * word's FIRST letter — usually a consonant, which belongs to no
   * beat (beats start at vowel nuclei) — so the anchor is the word's
   * first beat at/after that char, not the beat containing it.
   * Unknown indices are ignored.
   */
  noteBoundary(charIndex: number, nowMs: number): void {
    if (this.startedAtMs === null) return
    const beat =
      this.beats.find((b) => charIndex >= b.startChar && charIndex < b.endChar) ??
      this.beats.find((b) => b.startChar >= charIndex)
    if (!beat) return
    // Move the clock so this beat starts now.
    this.shiftMs = nowMs - (this.startedAtMs + beat.startT * 1000)
  }

  /** Mouth frame at `nowMs` (performance.now clock). */
  sample(nowMs: number): VisemeFrame {
    if (this.startedAtMs === null || this.beats.length === 0) {
      return { mouth: 0, vowel: null, beatIndex: -1, done: this.beats.length === 0 }
    }
    const tp = (nowMs - this.startedAtMs - this.shiftMs) / 1000
    if (tp < 0) return { mouth: 0, vowel: null, beatIndex: -1, done: false }
    const last = this.beats[this.beats.length - 1]
    if (tp >= last.endT) return { mouth: 0, vowel: null, beatIndex: -1, done: true }
    const idx = this.beats.findIndex((b) => tp >= b.startT && tp < b.endT)
    if (idx === -1) {
      // Between beats (word gap): mouth nearly closed.
      return { mouth: 0.04, vowel: null, beatIndex: -1, done: false }
    }
    const beat = this.beats[idx]
    const u = (tp - beat.startT) / Math.max(1e-6, beat.endT - beat.startT)
    // Attack fast, hold with a slight ripple (a second syllabic
    // wobble inside long beats), release before the next beat so the
    // mouth visibly closes between words instead of hanging open.
    const attack = smoothstep(0, 0.3, u)
    const release = 1 - smoothstep(0.72, 1, u)
    const ripple = 0.9 + 0.1 * Math.sin(u * Math.PI * 3)
    return {
      mouth: VOWEL_OPEN[beat.vowel] * attack * release * ripple,
      vowel: beat.vowel,
      beatIndex: idx,
      done: false,
    }
  }

  done(nowMs: number): boolean {
    return this.sample(nowMs).done
  }
}
