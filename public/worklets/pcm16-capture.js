/**
 * pcm16-capture — AudioWorklet processor for the café voice agent.
 *
 * Takes the microphone stream, resamples it to 16 kHz mono PCM16 (the
 * format Deepgram's Voice Agent API expects for `linear16` input) and
 * posts the bytes to the main thread. It also posts a throttled mic RMS
 * level so the UI meter and the avatar bridge can show the real input
 * level without a second AnalyserNode on the mic path.
 *
 * Loaded with `audioContext.audioWorklet.addModule('/worklets/pcm16-capture.js')`.
 * If AudioWorklet is unavailable the voice client reports a clear
 * `worklet-unsupported` state instead of silently falling back.
 *
 * Resampling is a simple linear interpolation between input samples —
 * good enough for speech at 16 kHz, and it keeps the processor free of
 * any dependency. Output is chunked at ~100 ms (1600 samples) so the
 * WebSocket gets steady frames.
 */

const TARGET_RATE = 16000
const CHUNK_SAMPLES = 1600 // 100 ms at 16 kHz

class Pcm16CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._ratio = sampleRate / TARGET_RATE
    this._carry = 0 // fractional read position into the current input block
    this._prev = 0 // last input sample, for interpolation across blocks
    this._hasPrev = false
    this._out = new Int16Array(CHUNK_SAMPLES)
    this._outLen = 0
    this._levelAcc = 0
    this._levelCount = 0
    this._framesSinceLevel = 0
  }

  _flush() {
    if (this._outLen === 0) return
    const chunk = this._out.slice(0, this._outLen)
    this.port.postMessage({ type: 'audio', data: chunk.buffer }, [chunk.buffer])
    this._outLen = 0
  }

  _pushSample(value) {
    const clamped = Math.max(-1, Math.min(1, value))
    this._out[this._outLen++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
    if (this._outLen >= CHUNK_SAMPLES) this._flush()
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0 || !input[0]) return true
    const channel = input[0]

    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i]
      this._levelAcc += sample * sample
      this._levelCount++

      // Emit one resampled output sample each time the read position
      // crosses an input-sample boundary, interpolating linearly.
      while (this._carry < 1) {
        const prev = this._hasPrev ? this._prev : sample
        const value = prev + (sample - prev) * this._carry
        this._pushSample(value)
        this._carry += this._ratio
      }
      this._carry -= 1
      this._prev = sample
      this._hasPrev = true
    }

    this._framesSinceLevel++
    if (this._framesSinceLevel >= 6 && this._levelCount > 0) {
      const rms = Math.sqrt(this._levelAcc / this._levelCount)
      this.port.postMessage({ type: 'level', rms })
      this._levelAcc = 0
      this._levelCount = 0
      this._framesSinceLevel = 0
    }
    return true
  }
}

registerProcessor('pcm16-capture', Pcm16CaptureProcessor)
