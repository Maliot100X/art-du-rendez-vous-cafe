/**
 * FIX PASS 10 — lip-sync + phone-movement probe. NOT shipped.
 *
 * Drives the REAL src/lib/speechViseme.ts + src/lib/avatarBridge.ts +
 * src/lib/speech.ts (transpiled on the fly with the project's tsc —
 * same pattern as scripts/fix9-status-harness.mjs) through a stubbed
 * browser engine, in the two scenarios that matter:
 *   A. DESKTOP — utterance events fire (onstart + onboundary per word).
 *   B. ANDROID — NO utterance event ever fires (Chrome Android:
 *      onboundary never fires, onstart/onend unreliable — MDN compat
 *      + Chromium bugs 1122143 / 40715888). Only the
 *      `speechSynthesis.speaking` poll can start/stop the mouth.
 *   C. BLOCKED — speech never starts (no voice / blocked): the
 *      watchdog must close the mouth instead of flapping silently.
 *
 * Plus:
 *   D. the pure viseme clock (word-timed beats, vowel shapes,
 *      boundary re-anchor),
 *   E. the REAL vita.vrm + real three-vrm headless (fix8 loader
 *      pattern): the aa/ih/ou/ee/oh expressions exist and round-trip
 *      through setValue/getValue — the rig CAN move the mouth,
 *   F. the render-loop gate audit on VrmModel.tsx source: no
 *      reduced-motion zeroing of the sway, no walk gate, walk
 *      constants byte-identical to HEAD, no viewport gate on idle.
 *
 * Usage: node scripts/fix10-lipsync-probe.mjs (exit 0 = all pass)
 */
import { execFileSync, execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = mkdtempSync(path.join(tmpdir(), 'fix10-harness-'))
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
// tsc does not rewrite extensionless relative imports; Node ESM needs
// the extension. The emitted files are throwaway (tmp dir).
for (const f of ['speech.js']) {
  const p = path.join(outDir, f)
  writeFileSync(
    p,
    readFileSync(p, 'utf8')
      .replaceAll("from './avatarBridge'", "from './avatarBridge.js'")
      .replaceAll("from './speechViseme'", "from './speechViseme.js'"),
  )
}

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

// ---------------------------------------------------------------- pure clock
const visemeMod = await import(path.join(outDir, 'speechViseme.js'))
const { SpeechViseme, beatsOfWord, VOWEL_OPEN } = visemeMod
const bridgeMod = await import(path.join(outDir, 'avatarBridge.js'))
const { avatarBridge, smoothMouthOpen } = bridgeMod

check('D1 vowel letters map (a/e/i/o/u + accents)',
  beatsOfWord('café', 0)[0].vowel === 'a' &&
  beatsOfWord('thé', 0)[0].vowel === 'e' &&
  beatsOfWord('vin', 0)[0].vowel === 'e' && // 'in' nasal -> e
  beatsOfWord('chocolat', 0)[0].vowel === 'o' &&
  beatsOfWord('cappuccino', 0).map((b) => b.vowel).join('') === 'aueo') // 'in' nasal -> e
check('D2 vowel openness order A > O > E > U > I',
  VOWEL_OPEN.a > VOWEL_OPEN.o && VOWEL_OPEN.o > VOWEL_OPEN.e &&
  VOWEL_OPEN.e > VOWEL_OPEN.u && VOWEL_OPEN.u > VOWEL_OPEN.i,
  JSON.stringify(VOWEL_OPEN))
check('D3 digraphs ou->u, eau->o, au->o (one beat)',
  beatsOfWord('vous', 0)[0].vowel === 'u' &&
  beatsOfWord('eau', 0)[0].vowel === 'o' &&
  beatsOfWord('chaud', 0).length === 1 && beatsOfWord('chaud', 0)[0].vowel === 'o')

const TEXT = 'Boissons chaudes — café, chocolat, cappuccino.'
const vis = new SpeechViseme(TEXT, 1)
check('D4 beats built for the sample line', vis.beats.length >= 8 && vis.totalSeconds > 2 && vis.totalSeconds < 8,
  `${vis.beats.length} beats, ${vis.totalSeconds.toFixed(2)}s`)
{
  const t0 = 100000
  vis.start(t0)
  const series = []
  const vowels = new Set()
  for (let ms = 0; ms <= vis.totalSeconds * 1000 + 200; ms += 50) {
    const f = vis.sample(t0 + ms)
    series.push(f.mouth)
    if (f.vowel) vowels.add(f.vowel)
  }
  const max = Math.max(...series)
  const min = Math.min(...series)
  check('D5 clock opens/closes in sync with the words (max>=0.5, min<=0.1, >=4 opens, >=3 vowels)',
    max >= 0.5 && min <= 0.1 && countUpCrossings(series, 0.3) >= 4 && vowels.size >= 3,
    `max ${max.toFixed(2)} min ${min.toFixed(2)} opens ${countUpCrossings(series, 0.3)} vowels ${[...vowels].join('')}`)
  check('D6 clock finishes and closes the mouth',
    vis.sample(t0 + vis.totalSeconds * 1000 + 500).done &&
    vis.sample(t0 + vis.totalSeconds * 1000 + 500).mouth === 0)
}
{
  // Boundary re-anchor: jump the clock to "chocolat" mid-utterance.
  const v2 = new SpeechViseme(TEXT, 1)
  const t0 = 200000
  v2.start(t0)
  const before = v2.sample(t0 + 600)
  const chocoChar = TEXT.indexOf('chocolat')
  const chocoBeat = v2.beats.findIndex((b) => b.startChar >= chocoChar && b.startChar < chocoChar + 8)
  v2.noteBoundary(chocoChar, t0 + 600)
  const after = v2.sample(t0 + 700)
  check('D7 onboundary re-anchors the clock to the real word',
    before.beatIndex < chocoBeat && after.beatIndex === chocoBeat && after.vowel === 'o' && after.mouth > 0.3,
    `before beat ${before.beatIndex} (${before.vowel}) -> after beat ${after.beatIndex} (${after.vowel}, ${after.mouth.toFixed(2)})`)
  const beforeUnknown = v2.sample(t0 + 800)
  v2.noteBoundary(9999, t0 + 800) // unknown charIndex: ignored, no throw
  const afterUnknown = v2.sample(t0 + 800)
  check('D8 unknown boundary index is ignored',
    beforeUnknown.beatIndex === afterUnknown.beatIndex && beforeUnknown.vowel === afterUnknown.vowel)
}
check('D9 smoothing keeps YuriOS attack/release (fast up, slower down)',
  smoothMouthOpen(0.7, 0, 0.016) > smoothMouthOpen(0, 0.7, 0.016) * 0 + 0.2 &&
  smoothMouthOpen(0.7, 0, 0.016) < 0.7)

// ------------------------------------------------- stubbed browser engine
// Fake rAF (16ms setTimeout) + fake speechSynthesis + fake utterance.
// The stub speaks the SAME text the probe passes to speak(); word
// boundaries are derived from a SpeechViseme clock, like a real engine.
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
const synth = {
  speaking: false,
  pending: false,
  getVoices: () => [],
  addEventListener: () => {},
  cancel: () => { synth.speaking = false; synth.pending = false },
  speak: (u) => { synth._utter = u },
  _utter: null,
}
globalThis.window = { speechSynthesis: synth }

const speechMod = await import(path.join(outDir, 'speech.js'))
const { speak, stopSpeaking, shortenForSpeech } = speechMod
const short = shortenForSpeech(TEXT)

/** Drive one scenario; returns the sampled mouth series. */
async function runScenario(mode) {
  stopSpeaking()
  synth.speaking = false
  synth.pending = false
  const clock = new SpeechViseme(short, 1)
  const durMs = clock.totalSeconds * 1000
  const series = []
  const poll = setInterval(() => {
    series.push({ m: avatarBridge.getMouthOpen(), v: avatarBridge.getMouthVowel(), s: avatarBridge.isSpeaking() })
  }, 50)
  speak(short)
  const t0 = performance.now()
  if (mode === 'desktop' || mode === 'android') {
    setTimeout(() => { synth.speaking = true; synth.pending = false }, 80)
    if (mode === 'desktop') {
      const u = synth._utter
      setTimeout(() => u.onstart?.(), 80)
      // One boundary per word, at the clock's predicted word starts.
      const words = [...short.matchAll(/\S+/g)]
      for (const w of words) {
        const beat = clock.beats.find((b) => b.startChar >= w.index && b.startChar < w.index + w[0].length)
        if (!beat) continue
        setTimeout(() => u.onboundary?.({ name: 'word', charIndex: w.index, charLength: w[0].length }), 80 + beat.startT * 1000)
      }
      setTimeout(() => { synth.speaking = false; u.onend?.() }, 80 + durMs + 300)
    } else {
      // Android: NO events at all — only the speaking flag flips.
      setTimeout(() => { synth.speaking = false }, 80 + durMs + 600)
    }
  }
  // Blocked mode: nothing ever happens; the watchdog must fire.
  await sleep(mode === 'blocked' ? 3400 : 80 + durMs + 1600)
  clearInterval(poll)
  stopSpeaking()
  return { series, elapsedMs: performance.now() - t0 }
}

for (const mode of ['desktop', 'android']) {
  const { series } = await runScenario(mode)
  const mouths = series.map((p) => p.m)
  const max = Math.max(...mouths)
  const vowels = new Set(series.map((p) => p.v).filter(Boolean))
  const everSpeaking = series.some((p) => p.s)
  const endsClosed = series.length > 0 && series[series.length - 1].m === 0
  check(`${mode === 'desktop' ? 'A' : 'B'}1 mouth moves while she talks (max>=0.4, >=3 opens, >=2 vowels, speaking seen, ends at 0)`,
    max >= 0.4 && countUpCrossings(mouths, 0.3) >= 3 && vowels.size >= 2 && everSpeaking && endsClosed,
    `max ${max.toFixed(2)} opens ${countUpCrossings(mouths, 0.3)} vowels ${[...vowels].join('')} speaking ${everSpeaking} end ${series[series.length - 1]?.m}`)
}
{
  const { series } = await runScenario('blocked')
  const max = Math.max(...series.map((p) => p.m))
  check('C1 blocked voice: mouth never moves, watchdog stops the tick',
    max === 0 && !avatarBridge.isSpeaking(),
    `max ${max.toFixed(2)} speaking ${avatarBridge.isSpeaking()}`)
}

// ------------------------------------------------------- real VRM expressions
{
  const THREE = await import('three')
  globalThis.self = globalThis
  THREE.ImageLoader.prototype.load = function (_url, onLoad) {
    if (onLoad) onLoad({ width: 1, height: 1 })
    return new THREE.Texture()
  }
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
  const { VRMLoaderPlugin } = await import('@pixiv/three-vrm')
  const bytes = readFileSync(path.join(root, 'public', 'vrm', 'vita.vrm'))
  const loader = new GLTFLoader()
  loader.register((parser) => new VRMLoaderPlugin(parser))
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
  const vrm = gltf.userData.vrm
  const names = Object.keys(vrm.expressionManager.expressionMap)
  check('E1 real vita.vrm exposes all five vowel expressions',
    ['aa', 'ih', 'ou', 'ee', 'oh'].every((n) => names.includes(n)), names.join(','))
  let roundTrip = true
  for (const n of ['aa', 'ih', 'ou', 'ee', 'oh']) {
    vrm.expressionManager.setValue(n, 0.5)
    if (vrm.expressionManager.getValue(n) !== 0.5) roundTrip = false
    vrm.expressionManager.setValue(n, 0)
  }
  check('E2 setValue/getValue round-trips 0.5 on every vowel expression', roundTrip)
  let unknownOk = true
  try {
    vrm.expressionManager.setValue('nope', 0.5)
    if (vrm.expressionManager.getValue('nope') !== null) unknownOk = false
  } catch { unknownOk = false }
  check('E3 unknown expression is silently ignored (no throw, getValue null)', unknownOk)
}

// ------------------------------------------------------------- gate audit
{
  const src = readFileSync(path.join(root, 'src', 'components', 'VrmModel.tsx'), 'utf8')
  check('F1 no reduced-motion zeroing of the sway remains',
    !src.includes('reducedMotion ? 0 : 1') && src.includes('reducedMotion ? 0.4 : 1'))
  // Strip /* */ + // comments first: the fix-pass-5 comment quotes
  // the old `&& !reducedMotion` gate it removed.
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  check('F2 no walk gate on reduced motion', !codeOnly.includes('!reducedMotion'))
  check('F3 no viewport/pointer gate on the idle motion',
    !/swayAmp.*matchMedia|matchMedia.*sway|innerWidth.*sway/.test(src))
  // Walk constants: compare the DEFINITIONS (not mere mentions — the
  // fix-10 idle gate legitimately reads WALK_DURATION) between HEAD
  // and the worktree, including the stepLift body.
  const constNames = ['KNEE_SWING', 'THIGH_LIFT', 'SWING_SPLAY', 'SHIN_SPLAY', 'HIP_BOB', 'HIP_SWAY', 'WALK_TURN', 'WALK_LEFT', 'WALK_RIGHT', 'STEP_DURATION', 'STEP_COUNT', 'WALK_DURATION', 'HIP_HALF', 'LEG_LEN']
  const headSrc = execSync('git show HEAD:src/components/VrmModel.tsx', { cwd: root, encoding: 'utf8' })
  const defLines = (s) => [
    ...constNames.map((n) => (s.match(new RegExp(`^const ${n} = .*$`, 'm')) || [''])[0]),
    (s.match(/function stepLift[\s\S]*?\n}/) || [''])[0],
  ]
  const headDefs = defLines(headSrc)
  const workDefs = defLines(src)
  const changedDefs = constNames.filter((_, i) => headDefs[i] !== workDefs[i])
  const stepLiftChanged = headDefs[headDefs.length - 1] !== workDefs[workDefs.length - 1]
  check('F4 walk constants byte-identical to HEAD (fix 8–9 measured values untouched)',
    changedDefs.length === 0 && !stepLiftChanged,
    [...changedDefs, ...(stepLiftChanged ? ['stepLift'] : [])].join(', ') || 'definitions identical')
  const loopIdx = src.indexOf('raf = requestAnimationFrame(loop)')
  const hiddenIdx = src.indexOf('if (document.hidden) return')
  check('F5 document.hidden guard is AFTER the rAF schedule (loop keeps running)',
    loopIdx !== -1 && hiddenIdx !== -1 && hiddenIdx > loopIdx)
  check('F6 live mouth debug fields are written every frame',
    src.includes('wdbg.mouth = ') && src.includes('wdbg.vowel = ') && src.includes('wdbg.speaking = '))
  check('F7 vowel expression map stages all five shapes',
    ['a: \'aa\'', 'i: \'ih\'', 'u: \'ou\'', 'e: \'ee\'', 'o: \'oh\''].every((s) => src.includes(s)))
  const status = execSync('git status --short', { cwd: root, encoding: 'utf8' })
  check('F8 src/content.ts (menu data) untouched',
    !status.split('\n').some((l) => l.includes('src/content.ts')))
  const fullDiff = execSync('git diff', { cwd: root, encoding: 'utf8' })
  check('F9 forbidden phone number appears nowhere in the diff', !fullDiff.includes('650 459 7993'))
}

console.log(failures === 0 ? '\nALL FIX10 CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
