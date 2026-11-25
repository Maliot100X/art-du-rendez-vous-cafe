/**
 * FIX PASS 14, GROUP C — mouth chain probe. NOT shipped.
 *
 * Drives the REAL src/lib/speechViseme.ts + src/lib/avatarBridge.ts +
 * src/lib/speech.ts (transpiled on the fly with the project's tsc —
 * same pattern as scripts/fix13-viseme-probe.mjs) through a stubbed
 * browser engine, and through a faithful simulation of the Live2D
 * stage's mouth write — the exact setParam call Live2DModel.tsx makes
 * (`setParam('ParamMouthOpenY', bridge.getMouthOpen())`), placed where
 * the fixed component places it (the internal model's
 * `beforeModelUpdate` event, emitted synchronously inside
 * Cubism4InternalModel.update() immediately before coreModel.update()
 * — the bake), with the OLD app-ticker-after-the-bake placement kept
 * as a comparison mode.
 *
 * The stage simulation is faithful, not the real PIXI app (this VM has
 * no WebGL2): it replicates the framework sequence verified in
 * node_modules/pixi-live2d-display/dist/cubism4.js —
 *   motion (Idle: ParamBreath only) -> saveParameters ->
 *   expression/eyeBlink/focus/breath/physics (none touches the mouth)
 *   -> emit('beforeModelUpdate') -> coreModel.update() [bake] ->
 *   loadParameters
 * — and the bake itself uses the REAL mouth response measured from the
 * shipped .moc3 with the Cubism Core (scripts/fix14-mouth-measure.mjs):
 * ArtMesh13 bbox height vs ParamMouthOpenY:
 *   0 -> 60.6, 0.3 -> 88.0, 0.66 -> 120.9, 0.7 -> 124.6, 1.0 -> 152.0
 * canvas px (piecewise-linear between points). Screen px on the site's
 * fit: canvas px x 0.238 (480 px desktop stage) / x 0.168 (340 px phone
 * stage). "Visibly open" = rendered height >= 88 canvas px (the 0.3
 * level, ~21 px desktop / ~15 px phone of mouth art).
 *
 * Real line: CHARACTER.greetings.agent — the actual reply text served
 * on AGENT ('Bonjour ! Je suis Nekomi, ...').
 *
 * Scenarios (NEW fixed speech.ts):
 *   A. PROMPT-START — engine speaks at ~80 ms, as on a real phone.
 *   B. NEVER-STARTS — `speaking` stays false forever (fix 13 case).
 *   C. SPEAK-THROWS — speechSynthesis.speak() throws synchronously
 *      (no engine at all). OLD code returned before starting the tick.
 *   D. IMMEDIATE-ERROR — onerror + onend fire at ~100 ms, before the
 *      800 ms open-loop start, while `speaking` never becomes true.
 *      OLD code's unconditional endSpeaking() killed the run here.
 *   B-ticker — scenario B again with the OLD stage placement (write
 *      after the bake): both placements must render, the hook just
 *      removes the one-frame lag.
 * Old-code comparison: scenarios C and D are re-run against
 * HEAD:src/lib/speech.ts (git show) — they must show a dead mouth
 * (max bridge ~0, zero opens), proving those shapes were the break.
 *
 * Usage: node scripts/fix14-mouth-probe.mjs (exit 0 = all pass)
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
function transpile(speechSrc, outDir) {
  execFileSync(path.join(root, 'node_modules', '.bin', 'tsc'), [
    path.join(root, 'src', 'lib', 'speechViseme.ts'),
    path.join(root, 'src', 'lib', 'avatarBridge.ts'),
    speechSrc,
    '--ignoreConfig',
    '--target', 'es2022',
    '--module', 'esnext',
    '--moduleResolution', 'bundler',
    '--outDir', outDir,
    '--skipLibCheck',
  ], { stdio: 'inherit' })
  const p = path.join(outDir, 'speech.js')
  writeFileSync(
    p,
    readFileSync(p, 'utf8')
      .replaceAll("from './avatarBridge'", "from './avatarBridge.js'")
      .replaceAll("from './speechViseme'", "from './speechViseme.js'"),
  )
}
const newDir = mkdtempSync(path.join(tmpdir(), 'fix14-new-'))
transpile(path.join(root, 'src', 'lib', 'speech.ts'), newDir)
const oldDir = mkdtempSync(path.join(tmpdir(), 'fix14-old-'))
const oldSpeechSrc = path.join(oldDir, 'speech.ts')
writeFileSync(oldSpeechSrc, execFileSync('git', ['show', 'ce85faf:src/lib/speech.ts'], { cwd: root, encoding: 'utf8' }))
// The old speech.ts lives in the tmp dir, so its relative imports must
// resolve there too — copy the (unchanged) sibling libs alongside it.
for (const f of ['avatarBridge.ts', 'speechViseme.ts']) {
  writeFileSync(path.join(oldDir, f), readFileSync(path.join(root, 'src', 'lib', f), 'utf8'))
}
execFileSync(path.join(root, 'node_modules', '.bin', 'tsc'), [
  path.join(oldDir, 'speechViseme.ts'),
  path.join(oldDir, 'avatarBridge.ts'),
  oldSpeechSrc,
  '--ignoreConfig',
  '--target', 'es2022',
  '--module', 'esnext',
  '--moduleResolution', 'bundler',
  '--outDir', oldDir,
  '--skipLibCheck',
], { stdio: 'inherit' })
{
  const p = path.join(oldDir, 'speech.js')
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
function makeSynth(behavior) {
  return {
    speaking: false,
    getVoices: () => [],
    addEventListener: () => {},
    cancel: () => { /* the stub engine never speaks on cancel */ },
    speak: (u) => {
      if (behavior === 'throws') throw new Error('speechSynthesis unavailable')
      if (behavior === 'immediate-error') {
        setTimeout(() => u.onerror?.(), 100)
        setTimeout(() => u.onend?.(), 100)
      }
      if (behavior === 'prompt-start') {
        setTimeout(() => { synth.speaking = true; u.onstart?.() }, 80)
      }
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
// ArtMesh13 bbox height (canvas px) vs ParamMouthOpenY, measured with
// the Cubism Core — scripts/fix14-mouth-measure.mjs.
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
    // motion (Idle: ParamBreath only) — no mouth write
    this.core.saveParameters()
    // expression / eyeBlink / focus / breath / physics — none touches the mouth
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

async function loadSpeech(dir) {
  // No query strings: speech.js's own `from './avatarBridge.js'` must
  // resolve to the SAME module instance the harness reads — a query
  // would split the singleton in two and the harness would read 0.
  // newDir/oldDir are different paths, so the two versions stay apart.
  const bridgeMod = await import(path.join(dir, 'avatarBridge.js'))
  const speechMod = await import(path.join(dir, 'speech.js'))
  return { bridge: bridgeMod.avatarBridge, ...speechMod }
}

/**
 * One run: speak TEXT under `behavior`, while the stage harness ticks
 * at ~60 fps in `stageMode` ('hook' = fixed Live2DModel.tsx,
 * 'ticker' = old app-ticker-after-the-bake placement).
 * Returns bridge + rendered series.
 */
async function run({ bridge, speak, stopSpeaking, shortenForSpeech }, behavior, stageMode, waitMs) {
  stopSpeaking()
  await sleep(120)
  const core = new FakeCoreModel()
  const internal = new FakeInternalModel(core)
  // The exact setParam call Live2DModel.tsx makes, in both placements.
  const setParam = (id, value) => {
    try { core.setParameterValueById(id, value) } catch { /* absent param */ }
  }
  let lastWritten = -1
  const writeMouth = () => {
    const value = bridge.getMouthOpen()
    setParam('ParamMouthOpenY', value)
    lastWritten = core.getParameterValueById('ParamMouthOpenY')
  }
  if (stageMode === 'hook') internal.on('beforeModelUpdate', writeMouth)
  const series = []
  const t0 = performance.now()
  const sampler = setInterval(() => {
    series.push({
      t: performance.now() - t0,
      bridge: bridge.getMouthOpen(),
      written: lastWritten,
      rendered: core.renderedHeight,
      speaking: bridge.isSpeaking(),
    })
  }, 50)
  const ticker = setInterval(() => {
    internal.update() // shared-ticker model update (+ hook, if any)
    if (stageMode === 'ticker') writeMouth() // old: write after the bake
    // render draws core.renderedHeight
  }, 16)
  const short = shortenForSpeech(TEXT)
  setSynth(behavior)
  speak(short)
  if (behavior === 'prompt-start') {
    const { SpeechViseme } = await import(path.join(newDir, 'speechViseme.js'))
    const dur = new SpeechViseme(short, 1).totalSeconds * 1000
    setTimeout(() => { synth.speaking = false }, 80 + dur + 600)
  }
  await sleep(waitMs)
  clearInterval(sampler)
  clearInterval(ticker)
  const tail = { bridge: bridge.getMouthOpen(), rendered: core.renderedHeight, speaking: bridge.isSpeaking() }
  stopSpeaking()
  return { series, tail, short }
}

const newSpeech = await loadSpeech(newDir)
const oldSpeech = await loadSpeech(oldDir)
const { SpeechViseme } = await import(path.join(newDir, 'speechViseme.js'))
const short = newSpeech.shortenForSpeech(TEXT)
const DUR_MS = new SpeechViseme(short, 1).totalSeconds * 1000
console.log(`line: ${short.length} chars, beats ${new SpeechViseme(short, 1).beats.length}, ${DUR_MS.toFixed(0)} ms`)
console.log(`open threshold: rendered >= ${OPEN_PX} canvas px (~${(OPEN_PX * 0.238).toFixed(0)} px desktop / ${(OPEN_PX * 0.168).toFixed(0)} px phone)`)

function summarize(label, { series, tail }) {
  const bridges = series.map((p) => p.bridge)
  const rendered = series.map((p) => p.rendered)
  const maxBridge = Math.max(...bridges, 0)
  const maxRendered = Math.max(...rendered, 0)
  const opens = countUpCrossings(rendered, OPEN_PX)
  const firstOpen = series.find((p) => p.rendered >= OPEN_PX)
  const speakingWindow = series.filter((p) => p.speaking)
  const meanRendered = speakingWindow.length
    ? speakingWindow.reduce((a, p) => a + p.rendered, 0) / speakingWindow.length
    : 0
  console.log(
    `  ${label}: max bridge ${maxBridge.toFixed(2)} | max rendered ${maxRendered.toFixed(1)} canvas px (${(maxRendered * 0.238).toFixed(1)} px desktop) | mean rendered while speaking ${meanRendered.toFixed(1)} px | opens ${opens} | first open ${firstOpen ? `${Math.round(firstOpen.t)} ms` : 'never'} | end rendered ${tail.rendered.toFixed(1)} px, bridge ${tail.bridge.toFixed(2)}, speaking ${tail.speaking}`,
  )
  return { maxBridge, maxRendered, opens, meanRendered, tail }
}

// ------------------------------------------------------- NEW code scenarios
const WAIT = 800 + DUR_MS + 2000
{
  const r = await run(newSpeech, 'prompt-start', 'hook', 80 + DUR_MS + 2000)
  const s = summarize('A prompt-start (hook)', r)
  check('A1 prompt-start: mouth visibly opens (max rendered>=100px, >=3 opens, ends closed)',
    s.maxRendered >= 100 && s.opens >= 3 && r.tail.rendered <= 70 && r.tail.bridge === 0,
    `max ${s.maxRendered.toFixed(1)}px opens ${s.opens} end ${r.tail.rendered.toFixed(1)}px`)
}
{
  const r = await run(newSpeech, 'never-starts', 'hook', WAIT)
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
{
  const r = await run(newSpeech, 'never-starts', 'ticker', WAIT)
  const s = summarize('B-ticker never-starts (OLD stage placement)', r)
  check('B3 old stage placement also renders (one-frame lag, not a freeze) — hook is hardening, not the sole fix',
    s.maxRendered >= 100 && s.opens >= 3,
    `max ${s.maxRendered.toFixed(1)}px opens ${s.opens}`)
}
{
  const r = await run(newSpeech, 'throws', 'hook', WAIT)
  const s = summarize('C speak() throws (hook)', r)
  check('C1 speak-throws: mouth visibly opens anyway (open-loop survives the throw)',
    s.maxRendered >= 100 && s.opens >= 3 && r.tail.rendered <= 70,
    `max ${s.maxRendered.toFixed(1)}px opens ${s.opens} end ${r.tail.rendered.toFixed(1)}px`)
}
{
  const r = await run(newSpeech, 'immediate-error', 'hook', WAIT)
  const s = summarize('D immediate onerror+onend (hook)', r)
  check('D1 immediate-error: mouth visibly opens anyway (event no longer kills the run)',
    s.maxRendered >= 100 && s.opens >= 3 && r.tail.rendered <= 70,
    `max ${s.maxRendered.toFixed(1)}px opens ${s.opens} end ${r.tail.rendered.toFixed(1)}px`)
}

// ------------------------------------------------------- OLD code comparison
{
  const r = await run(oldSpeech, 'throws', 'hook', 4000)
  const s = summarize('OLD C speak() throws', r)
  check('OLD-C old speech.ts dies on throw (max bridge ~0, zero opens) — the break, reproduced',
    s.maxBridge < 0.05 && s.opens === 0,
    `max bridge ${s.maxBridge.toFixed(2)} opens ${s.opens}`)
}
{
  const r = await run(oldSpeech, 'immediate-error', 'hook', 4000)
  const s = summarize('OLD D immediate onerror+onend', r)
  check('OLD-D old speech.ts dies on immediate error (max bridge ~0, zero opens) — the break, reproduced',
    s.maxBridge < 0.05 && s.opens === 0,
    `max bridge ${s.maxBridge.toFixed(2)} opens ${s.opens}`)
}

console.log(failures === 0 ? '\nALL FIX14 CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
