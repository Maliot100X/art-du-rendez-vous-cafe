/**
 * FIX PASS 15, GROUP 1 — mouth chain probe. NOT shipped.
 *
 * Root cause under test (see src/lib/speech.ts, fix pass 15):
 * fix 13/14 proved the open-loop fallback works when the engine NEVER
 * reports speaking (speaking stays false, no events at all — scenario B
 * below) and when speak() throws or an error fires before the clock
 * starts. What they never simulated is the shape a no-voice / no-audio
 * browser actually produces: Chrome raises `speechSynthesis.speaking`
 * for a merely QUEUED utterance, before any audio plays — so the poll
 * in tickSpeaking() starts the clock in ENGINE mode — and then the
 * engine rejects the utterance almost at once (onerror + onend at
 * ~100-150 ms, no audio ever played). The old `endIfSpoken` ended the
 * run from that event whenever `visemeStarted && !openLoop`, which is
 * exactly this shape: the tick died ~150 ms in, before the mouth had
 * visibly opened, and nothing restarted it. Pixels: zero movement for
 * the whole 12 s reply, no audio heard. Scenario E reproduces it.
 * Scenario E2 is the same kill with onstart also firing (started, then
 * failed instantly — under 1 s of real audio): the old code killed the
 * run there too, because it trusted the event, not audible time.
 *
 * The fix: an utterance event may end a run only after real audio has
 * played for a meaningful stretch (>= 1000 ms since onstart fired);
 * otherwise the run falls back to open-loop and the poll ends it when
 * the beats are done. Plus a stuck-engine grace: if the beats are done
 * but the engine still claims speaking 2 s later (queued forever, no
 * audio), the run ends instead of spinning the tick forever.
 *
 * Drives the REAL src/lib/speechViseme.ts + src/lib/avatarBridge.ts +
 * src/lib/speech.ts (transpiled on the fly with the project's tsc —
 * same pattern as scripts/fix14-mouth-probe.mjs) through a stubbed
 * browser engine, and through the same faithful stage simulation as
 * fix 14 (FakeCoreModel/FakeInternalModel + the real .moc3 mouth
 * curve from scripts/fix14-mouth-measure.mjs; ArtMesh13 height vs
 * ParamMouthOpenY: 0 -> 60.6, 0.3 -> 88.0, 0.66 -> 120.9, 0.7 -> 124.6,
 * 1.0 -> 152.0 canvas px). "Visibly open" = rendered >= 88 px.
 *
 * Real line: CHARACTER.greetings.agent — the actual reply text served
 * on AGENT ('Bonjour ! Je suis Nekomi, ...').
 *
 * Scenarios:
 *   E. SPURIOUS-START-THEN-ERROR — speaking flips true at ~80 ms
 *      (queued), NO onstart, onerror + onend at ~150 ms, speaking
 *      back false. THE fix-15 break: old code kills the run here.
 *   E2. START-THEN-INSTANT-ERROR — onstart fires at ~80 ms, onerror +
 *      onend at ~150 ms (under 1 s of audio). Old code kills it too.
 *   B. NEVER-STARTS — speaking stays false, no events (fix 13 case;
 *      the shape the task names). Must still open-loop.
 *   A. PROMPT-START — engine speaks at ~80 ms, onend at the true end.
 *      Regression: the mouth must start from the real audio and end
 *      closed — the event rule must not break the normal case.
 *   C. SPEAK-THROWS — speechSynthesis.speak() throws synchronously.
 *   D. IMMEDIATE-ERROR (speaking false) — onerror + onend at ~100 ms
 *      while speaking never becomes true (fix 14 case).
 *   G. STUCK-SPEAKING — onstart at ~80 ms, speaking stays true
 *      forever, no onend. The mouth must move AND the run must end
 *      (grace) instead of spinning the tick forever.
 *
 * Usage: node scripts/fix15-mouth-probe.mjs (exit 0 = all pass)
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEXT =
  'Bonjour ! Je suis Nekomi, l’agent de l’Art du Rendez-Vous. Dites-moi ce qui vous ferait plaisir — je connais toute la carte et je peux préparer votre commande.'

// ---------------------------------------------------------------- transpile
const outDir = mkdtempSync(path.join(tmpdir(), 'fix15-'))
execFileSync(path.join(root, 'node_modules', '.bin', 'tsc'), [
  path.join(root, 'src', 'lib', 'speechViseme.ts'),
  path.join(root, 'src', 'lib', 'avatarBridge.ts'),
  path.join(root, 'src', 'lib', 'speech.ts'),
  '--ignoreConfig',
  '--target', 'es2022',
  '--module', 'esnext',
  '--moduleResolution', 'bundler',
  '--outDir', outDir,
  '--skipLibCheck',
], { stdio: 'inherit' })
{
  const p = path.join(outDir, 'speech.js')
  writeFileSync(
    p,
    readFileSync(p, 'utf8')
      .replaceAll("from './avatarBridge'", "from './avatarBridge.js'")
      .replaceAll("from './speechViseme'", "from './speechViseme.js'"),
  )
}

// ------------------------------------------------------------- fake browser
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
globalThis.SpeechSynthesisUtterance = class {
  constructor(text) {
    this.text = text
    this.lang = ''
    this.voice = null
    this.rate = 1
    this.pitch = 1
    this.onstart = null
    this.onboundary = null
    this.onend = null
    this.onerror = null
  }
}
// The stub engine does nothing on its own: every scenario drives
// `speaking` and the utterance events explicitly, so the shape under
// test is exactly the shape named (no hidden defaults).
function makeSynth(behavior) {
  return {
    speaking: false,
    getVoices: () => [],
    addEventListener: () => {},
    cancel: () => {},
    speak(u) {
      if (behavior === 'throws') throw new Error('speechSynthesis unavailable')
      this._utter = u
    },
    _utter: null,
  }
}
let synth = makeSynth('never-starts')
globalThis.window = { speechSynthesis: synth }
const setSynth = (behavior) => {
  synth = makeSynth(behavior)
  globalThis.window.speechSynthesis = synth
  return synth
}

// ------------------------------------------------- stage harness (real .moc3 curve)
const MOUTH_CURVE = [[0, 60.6], [0.3, 88.0], [0.66, 120.9], [0.7, 124.6], [1.0, 152.0]]
function mouthHeight(v) {
  const x = Math.max(0, Math.min(1, v))
  for (let i = 1; i < MOUTH_CURVE.length; i++) {
    if (x <= MOUTH_CURVE[i][0]) {
      const [x0, y0] = MOUTH_CURVE[i - 1]
      const [x1, y1] = MOUTH_CURVE[i]
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
  }
  return MOUTH_CURVE[MOUTH_CURVE.length - 1][1]
}
class FakeCoreModel {
  constructor() {
    this.values = { ParamMouthOpenY: 0 }
    this.saved = { ParamMouthOpenY: 0 }
    this.renderedHeight = mouthHeight(0)
  }
  setParameterValueById(id, value, weight = 1) {
    if (id !== 'ParamMouthOpenY') return
    const prev = this.values[id] ?? 0
    this.values[id] = prev * (1 - weight) + value * weight
  }
  getParameterValueById(id) {
    return this.values[id] ?? -1
  }
  saveParameters() { this.saved = { ...this.values } }
  loadParameters() { this.values = { ...this.saved } }
  update() { this.renderedHeight = mouthHeight(this.values.ParamMouthOpenY) }
}
class FakeInternalModel {
  constructor(core) {
    this.core = core
    this.listeners = new Map()
  }
  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, [])
    this.listeners.get(event).push(fn)
  }
  emit(event) {
    for (const fn of this.listeners.get(event) ?? []) fn()
  }
  // The verified Cubism4InternalModel.update() order.
  update() {
    this.core.saveParameters()
    this.emit('beforeModelUpdate')
    this.core.update() // bake
    this.core.loadParameters()
  }
}

// ------------------------------------------------------------- probe helpers
let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const countUpCrossings = (series, level) => {
  let n = 0
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1] < level && series[i] >= level) n++
  }
  return n
}
const OPEN_PX = 88 // rendered height at mouth 0.3 — "visibly open"

const bridgeMod = await import(path.join(outDir, 'avatarBridge.js'))
const speechMod = await import(path.join(outDir, 'speech.js'))
const { avatarBridge } = bridgeMod
const { speak, stopSpeaking, shortenForSpeech } = speechMod
const { SpeechViseme } = await import(path.join(outDir, 'speechViseme.js'))

const short = shortenForSpeech(TEXT)
const DUR_MS = new SpeechViseme(short, 1).totalSeconds * 1000
console.log(`line: ${short.length} chars, beats ${new SpeechViseme(short, 1).beats.length}, ${DUR_MS.toFixed(0)} ms`)
console.log(`open threshold: rendered >= ${OPEN_PX} canvas px (~${(OPEN_PX * 0.238).toFixed(0)} px desktop / ${(OPEN_PX * 0.168).toFixed(0)} px phone)`)

/**
 * One run: speak TEXT under a scripted engine shape, while the stage
 * harness ticks at ~60 fps with the fixed beforeModelUpdate placement.
 * `script` is [[delayMs, fn(synth, utter)]] run after speak().
 * Returns bridge + rendered series.
 */
async function run(behavior, script, waitMs) {
  stopSpeaking()
  await sleep(120)
  const core = new FakeCoreModel()
  const internal = new FakeInternalModel(core)
  const setParam = (id, value) => {
    try { core.setParameterValueById(id, value) } catch { /* absent param */ }
  }
  // The exact writeMouth Live2DModel.tsx makes, including the
  // __nekomiDebug read-back proxy (mouthWritten): the value read back
  // from the core right after writing it.
  let lastWritten = -1
  let maxWritten = -1
  const writeMouth = () => {
    const value = avatarBridge.getMouthOpen()
    setParam('ParamMouthOpenY', value)
    lastWritten = core.getParameterValueById('ParamMouthOpenY')
    if (lastWritten > maxWritten) maxWritten = lastWritten
  }
  internal.on('beforeModelUpdate', writeMouth)
  const series = []
  const t0 = performance.now()
  const sampler = setInterval(() => {
    series.push({
      t: performance.now() - t0,
      bridge: avatarBridge.getMouthOpen(),
      written: lastWritten,
      rendered: core.renderedHeight,
      speaking: avatarBridge.isSpeaking(),
    })
  }, 50)
  const ticker = setInterval(() => { internal.update() }, 16)
  setSynth(behavior)
  speak(short)
  const utter = synth._utter
  const timers = script.map(([delay, fn]) => setTimeout(() => fn(synth, utter), delay))
  await sleep(waitMs)
  for (const t of timers) clearTimeout(t)
  clearInterval(sampler)
  clearInterval(ticker)
  const tail = { bridge: avatarBridge.getMouthOpen(), rendered: core.renderedHeight, speaking: avatarBridge.isSpeaking() }
  stopSpeaking()
  return { series, tail, maxWritten }
}

function summarize(label, { series, tail, maxWritten }) {
  const bridges = series.map((p) => p.bridge)
  const rendered = series.map((p) => p.rendered)
  const maxBridge = Math.max(...bridges, 0)
  const maxRendered = Math.max(...rendered, 0)
  const opens = countUpCrossings(rendered, OPEN_PX)
  const firstOpen = series.find((p) => p.rendered >= OPEN_PX)
  console.log(
    `  ${label}: max bridge ${maxBridge.toFixed(2)} | max written ${maxWritten.toFixed(2)} | max rendered ${maxRendered.toFixed(1)} canvas px (${(maxRendered * 0.238).toFixed(1)} px desktop) | opens ${opens} | first open ${firstOpen ? `${Math.round(firstOpen.t)} ms` : 'never'} | end rendered ${tail.rendered.toFixed(1)} px, bridge ${tail.bridge.toFixed(2)}, speaking ${tail.speaking}`,
  )
  return { maxBridge, maxRendered, opens, maxWritten, tail }
}

const WAIT = 800 + DUR_MS + 2000

// ------------------------------------------------- E: THE fix-15 break
{
  // speaking flips true (queued) at ~80 ms, NO onstart; onerror +
  // onend at ~150 ms; speaking back false. No audio ever played.
  const r = await run('never-starts', [
    [80, (s) => { s.speaking = true }],
    [150, (s, u) => { s.speaking = false; u?.onerror?.(); u?.onend?.() }],
  ], WAIT)
  const s = summarize('E spurious-start-then-error (hook)', r)
  check('E1 spurious-start-then-error: mouth visibly opens anyway (max rendered>=100px, >=3 opens, ends closed)',
    s.maxRendered >= 100 && s.opens >= 3 && r.tail.rendered <= 70 && r.tail.bridge === 0,
    `max ${s.maxRendered.toFixed(1)}px opens ${s.opens} end ${r.tail.rendered.toFixed(1)}px`)
  check('E2 spurious-start-then-error: the ParamMouthOpenY read-back moves with the bridge (max written>0.3)',
    s.maxWritten > 0.3,
    `max written ${s.maxWritten.toFixed(2)}`)
}

// ------------------------------------------------- E2: onstart, then instant error
{
  const r = await run('never-starts', [
    [80, (s, u) => { s.speaking = true; u?.onstart?.() }],
    [150, (s, u) => { s.speaking = false; u?.onerror?.(); u?.onend?.() }],
  ], WAIT)
  const s = summarize('E2 start-then-instant-error (hook)', r)
  check('E2 start-then-instant-error: mouth visibly opens anyway (error <1 s after start must not kill the run)',
    s.maxRendered >= 100 && s.opens >= 3 && r.tail.rendered <= 70 && r.tail.bridge === 0,
    `max ${s.maxRendered.toFixed(1)}px opens ${s.opens} end ${r.tail.rendered.toFixed(1)}px`)
}

// ------------------------------------------------- B: never-starts (task shape)
{
  const r = await run('never-starts', [], WAIT)
  const s = summarize('B never-starts / open-loop (hook)', r)
  check('B1 never-starts: mouth visibly opens via open-loop (max rendered>=100px, >=3 opens, ends closed)',
    s.maxRendered >= 100 && s.opens >= 3 && r.tail.rendered <= 70 && r.tail.bridge === 0,
    `max ${s.maxRendered.toFixed(1)}px opens ${s.opens} end ${r.tail.rendered.toFixed(1)}px`)
  check('B2 never-starts: first opening only after the ~800 ms fallback',
    (() => {
      const first = r.series.find((p) => p.rendered >= OPEN_PX)
      return first !== undefined && first.t >= 700 && first.t <= 2000
    })(),
    `first open at ${r.series.find((p) => p.rendered >= OPEN_PX)?.t?.toFixed(0) ?? 'never'} ms`)
}

// ------------------------------------------------- A: prompt-start (normal)
{
  const r = await run('never-starts', [
    [80, (s, u) => { s.speaking = true; u?.onstart?.() }],
    [80 + DUR_MS + 600, (s, u) => { s.speaking = false; u?.onend?.() }],
  ], 80 + DUR_MS + 2000)
  const s = summarize('A prompt-start (hook)', r)
  check('A1 prompt-start: mouth visibly opens from the real audio (max rendered>=100px, >=3 opens, ends closed)',
    s.maxRendered >= 100 && s.opens >= 3 && r.tail.rendered <= 70 && r.tail.bridge === 0,
    `max ${s.maxRendered.toFixed(1)}px opens ${s.opens} end ${r.tail.rendered.toFixed(1)}px`)
  check('A2 prompt-start: first opening well before the 800 ms fallback',
    (() => {
      const first = r.series.find((p) => p.rendered >= OPEN_PX)
      return first !== undefined && first.t < 700
    })(),
    `first open at ${r.series.find((p) => p.rendered >= OPEN_PX)?.t?.toFixed(0) ?? 'never'} ms`)
}

// ------------------------------------------------- C: speak() throws
{
  const r = await run('throws', [], WAIT)
  const s = summarize('C speak() throws (hook)', r)
  check('C1 speak-throws: mouth visibly opens anyway (open-loop survives the throw)',
    s.maxRendered >= 100 && s.opens >= 3 && r.tail.rendered <= 70,
    `max ${s.maxRendered.toFixed(1)}px opens ${s.opens} end ${r.tail.rendered.toFixed(1)}px`)
}

// ------------------------------------------------- D: immediate error, speaking false
{
  const r = await run('never-starts', [
    [100, (s, u) => { u?.onerror?.(); u?.onend?.() }],
  ], WAIT)
  const s = summarize('D immediate onerror+onend, speaking false (hook)', r)
  check('D1 immediate-error: mouth visibly opens anyway (event no longer kills the run)',
    s.maxRendered >= 100 && s.opens >= 3 && r.tail.rendered <= 70,
    `max ${s.maxRendered.toFixed(1)}px opens ${s.opens} end ${r.tail.rendered.toFixed(1)}px`)
}

// ------------------------------------------------- G: stuck-speaking grace
{
  const r = await run('never-starts', [
    [80, (s, u) => { s.speaking = true; u?.onstart?.() }],
    // No onend, speaking stays true forever.
  ], 80 + DUR_MS + 4000)
  const s = summarize('G stuck-speaking (hook)', r)
  check('G1 stuck-speaking: mouth moves during the beats (max rendered>=100px, >=3 opens)',
    s.maxRendered >= 100 && s.opens >= 3,
    `max ${s.maxRendered.toFixed(1)}px opens ${s.opens}`)
  check('G2 stuck-speaking: the run still ends (grace) instead of spinning forever — ends closed, bridge speaking false',
    r.tail.rendered <= 70 && r.tail.bridge === 0 && r.tail.speaking === false,
    `end rendered ${r.tail.rendered.toFixed(1)}px bridge ${r.tail.bridge.toFixed(2)} speaking ${r.tail.speaking}`)
}

console.log(failures === 0 ? '\nALL FIX15 CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
