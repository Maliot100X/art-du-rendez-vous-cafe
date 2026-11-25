/**
 * Avatar bridge — the typed link between the voice client and the Live2D
 * stage. One small shared object, not a global hack: the voice client
 * writes mouth-openness / mic level / expression into it, the Live2D
 * component reads it once per render frame, and the chat UI reads the mic
 * level for its meter.
 *
 * Lip-sync shape follows the YuriOS VisemeDriver pattern (Apache-2.0,
 * adapted — not copied): an AnalyserNode (fftSize 512) taps the agent's
 * TTS playback before the gain node, so mouth and voice read the same
 * samples and cannot drift. RMS -> gain 5.0 -> amp^0.7 curve, silence
 * gate 0.04, weight cap 0.7, fast attack (50/s) / slower release (30/s).
 *
 * Expression presets follow the YuriOS Live2D avatar.js pattern: a name
 * maps to Cubism parameters (ParamMouthForm, ParamEyeLSmile/RSmile,
 * ParamBrowLY/RY) and the stage eases toward them. The Nekomi rig may
 * not expose every parameter — the stage sets each one defensively and
 * ignores absent params.
 *
 * Architecture reference for the one-stage-many-formats idea: airi (MIT)
 * `packages/stage-ui/src/components/scenes/Stage.vue` (stage entry —
 * there is no RendererStage.vue) and its Live2D `Model.vue` plugin
 * pipeline, where lip-sync is a final-stage motion plugin. Here the
 * pipeline is the Pixi ticker in Live2DModel.tsx: ease expression,
 * then override ParamMouthOpenY with the live mouth value.
 */

export type AvatarExpression =
  | 'neutral'
  | 'happy'
  | 'tender'
  | 'sad'
  | 'surprised'
  | 'shy'
  | 'thinking'
  | 'playful'

/** YuriOS viseme constants (see header). */
export const VISEME = {
  FFT_SIZE: 512,
  SILENCE_GATE: 0.04,
  WEIGHT_CAP: 0.7,
  CURVE: 0.7,
  ATTACK_PER_SECOND: 50,
  RELEASE_PER_SECOND: 30,
  GAIN: 5.0,
} as const

/** Expression name -> Cubism parameter targets (YuriOS PRESETS shape). */
export const EXPRESSION_PRESETS: Record<AvatarExpression, Record<string, number>> = {
  neutral: { ParamMouthForm: 0.3, ParamEyeLSmile: 0, ParamEyeRSmile: 0, ParamBrowLY: 0, ParamBrowRY: 0 },
  happy: { ParamMouthForm: 1.0, ParamEyeLSmile: 0.6, ParamEyeRSmile: 0.6, ParamBrowLY: 0.3, ParamBrowRY: 0.3 },
  tender: { ParamMouthForm: 0.6, ParamEyeLSmile: 0.4, ParamEyeRSmile: 0.4, ParamBrowLY: -0.1, ParamBrowRY: -0.1 },
  sad: { ParamMouthForm: -0.8, ParamEyeLSmile: 0, ParamEyeRSmile: 0, ParamBrowLY: -0.6, ParamBrowRY: -0.6 },
  surprised: { ParamMouthForm: 0.0, ParamEyeLSmile: 0, ParamEyeRSmile: 0, ParamBrowLY: 1.0, ParamBrowRY: 1.0 },
  shy: { ParamMouthForm: 0.2, ParamEyeLSmile: 0.3, ParamEyeRSmile: 0.3, ParamBrowLY: -0.3, ParamBrowRY: -0.3 },
  thinking: { ParamMouthForm: -0.2, ParamEyeLSmile: 0, ParamEyeRSmile: 0, ParamBrowLY: 0.2, ParamBrowRY: -0.2 },
  playful: { ParamMouthForm: 0.9, ParamEyeLSmile: 0.5, ParamEyeRSmile: 0.2, ParamBrowLY: 0.4, ParamBrowRY: 0.1 },
}

export function rmsOf(timeDomain: Float32Array): number {
  let sum = 0
  for (let i = 0; i < timeDomain.length; i++) sum += timeDomain[i] * timeDomain[i]
  return Math.sqrt(sum / Math.max(1, timeDomain.length))
}

/**
 * Shape one RMS sample into a mouth-openness value in [0, 0.7].
 * Pure function so the shaping is testable without an AudioContext.
 */
export function shapeMouthOpen(rms: number, previous: number, dtSeconds: number): number {
  const dt = Math.min(Math.max(dtSeconds, 0), 0.1)
  let target = Math.pow(Math.min(1, rms * VISEME.GAIN), VISEME.CURVE)
  if (target < VISEME.SILENCE_GATE) target = 0
  target = Math.min(target, VISEME.WEIGHT_CAP)
  const rate = target > previous ? VISEME.ATTACK_PER_SECOND : VISEME.RELEASE_PER_SECOND
  const next = previous + (target - previous) * Math.min(1, rate * dt)
  return next < 0.001 ? 0 : next
}

/**
 * Mouth shape of the beat being spoken (layer2d A/I/U/E/O pattern,
 * src/lib/speechViseme.ts). `null` = no vowel right now (between
 * words, or the scalar-only RMS path, which stages into 'aa').
 */
export type MouthVowel = 'a' | 'i' | 'u' | 'e' | 'o'

/**
 * Ease an already-shaped mouth target (0..0.7, e.g. from the
 * speech-viseme clock) with the same YuriOS attack/release rates —
 * no gain/curve, so the vowel openness values arrive undistorted.
 * Used by the speechSynthesis path; the Deepgram RMS path keeps
 * shapeMouthOpen above.
 */
export function smoothMouthOpen(target: number, previous: number, dtSeconds: number): number {
  const dt = Math.min(Math.max(dtSeconds, 0), 0.1)
  const clamped = Math.max(0, Math.min(VISEME.WEIGHT_CAP, target))
  const rate = clamped > previous ? VISEME.ATTACK_PER_SECOND : VISEME.RELEASE_PER_SECOND
  const next = previous + (clamped - previous) * Math.min(1, rate * dt)
  return next < 0.001 ? 0 : next
}

export interface AvatarBridgeState {
  expression: AvatarExpression
  speaking: boolean
}

type AvatarBridgeListener = (state: AvatarBridgeState) => void

/**
 * Shared, typed bridge. Mouth-openness and mic level change every frame,
 * so they are polled (getMouthOpen / getMicLevel) rather than pushed —
 * pushing them would re-render React 60 times a second. Only expression
 * and speaking changes notify listeners.
 */
export class AvatarBridge {
  private mouthOpen = 0
  private mouthVowel: MouthVowel | null = null
  private micLevel = 0
  private expression: AvatarExpression = 'neutral'
  private speaking = false
  private listeners = new Set<AvatarBridgeListener>()

  subscribe(listener: AvatarBridgeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit() {
    const state: AvatarBridgeState = { expression: this.expression, speaking: this.speaking }
    this.listeners.forEach((fn) => fn(state))
  }

  setMouthOpen(value: number) {
    this.mouthOpen = Math.max(0, Math.min(1, value))
  }

  getMouthOpen(): number {
    return this.mouthOpen
  }

  /** Current vowel shape for the mouth (fix pass 10 viseme). */
  setMouthVowel(vowel: MouthVowel | null) {
    this.mouthVowel = vowel
  }

  getMouthVowel(): MouthVowel | null {
    return this.mouthVowel
  }

  setMicLevel(value: number) {
    this.micLevel = Math.max(0, Math.min(1, value))
  }

  getMicLevel(): number {
    return this.micLevel
  }

  setExpression(name: AvatarExpression) {
    if (name === this.expression) return
    this.expression = name
    this.emit()
  }

  getExpression(): AvatarExpression {
    return this.expression
  }

  setSpeaking(speaking: boolean) {
    if (speaking === this.speaking) return
    this.speaking = speaking
    this.emit()
  }

  isSpeaking(): boolean {
    return this.speaking
  }

  reset() {
    this.mouthOpen = 0
    this.mouthVowel = null
    this.micLevel = 0
    this.setExpression('neutral')
    this.setSpeaking(false)
  }
}

/** The single bridge instance shared by the voice client and the stage. */
export const avatarBridge = new AvatarBridge()
