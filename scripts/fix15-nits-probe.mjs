// Fix pass 15, Group 5 — minor-nits probe.
//
// Three cheap fixes, one probe (node, no network, no pixels — this VM
// has no WebGL2, so (c) is proven on drawable opacities, the same
// values the renderer draws, not on rendered frames):
//
//   (a) "Couper la voix" on LA CARTE: the MenuGuide panel header's
//       mute button is named "Couper la voix" while unmuted, so it
//       was present before any reading started. It must render only
//       while a reading is active (reading mirrored from the
//       module-level store). Static: the button JSX sits inside a
//       `guide.reading && (...)` gate, and no other ungated
//       "Couper la voix" remains in the panel. Dynamic: the real
//       store reports no reading before startReading and a live
//       reading after it — the exact value the gate reads.
//   (b) Chat thinking flag: the old send() cleared `answering` in a
//       .finally(), one microtask after the .then() appended the
//       reply — one committed render showed the reply AND "Nekomi
//       réfléchit…" with the input disabled. The fix clears the flag
//       in the SAME .then() batch as the reply append. Static: the
//       code path (order-sensitive). Dynamic: a promise-microtask
//       model of the two shapes proves the old shape commits
//       reply+thinking together and the new shape commits once.
//   (c) Henshin morph: measured on the real .moc3 + Cubism Core, the
//       rig crossfades the two forms' opacities linearly over Param3
//       0.3–0.7 (below 0.3 the human face reads, above 0.7 the furry
//       face reads, between them both sets are semi-transparent —
//       at 0.5 both 0.5: the featureless wash). The shipped easing
//       constants are READ OUT OF Live2DModel.tsx (not hardcoded),
//       simulated frame by frame, and driven through the real model:
//       wash frames must be few and the value must land exactly on
//       the readable end (0/1), unlike the old 0.12 no-snap ease.
//
// Usage: node --preserve-symlinks scripts/fix15-nits-probe.mjs
//   (preserve-symlinks is needed because this worktree's node_modules
//   is a symlink to home-disk storage; without it @pixi/* resolution
//   breaks.)
// Exit 0 = all checks pass.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

const guide = read('src/components/MenuGuide.tsx')
const agent = read('src/components/Agent.tsx')
const live2d = read('src/components/Live2DModel.tsx')

// ---------------------------------------------------------------------
// (a) "Couper la voix" renders only while a reading is active.
// ---------------------------------------------------------------------

// A1 — the panel header's mute button (the one named "Couper la voix"
// while unmuted) is gated on guide.reading. Find the button's
// aria-label and walk back to the nearest gate: the gate must open
// before the button and close after it.
{
  const panel = guide.slice(guide.indexOf('export function MenuGuidePanel'))
  const btnIdx = panel.indexOf("aria-label={guide.muted ? 'Activer la voix' : 'Couper la voix'}")
  check('A1a header mute button found in MenuGuidePanel', btnIdx !== -1)
  if (btnIdx !== -1) {
    const gateIdx = panel.lastIndexOf('{guide.reading && (', btnIdx)
    const closeIdx = panel.indexOf(')}', btnIdx)
    // The gate that wraps the button must open before it; the button's
    // own closing paren is the first ')}' after it.
    const gateOpensBeforeButton = gateIdx !== -1 && gateIdx < btnIdx
    // No other '{guide.reading && (' may sit between the gate and the
    // button (that would mean the button belongs to a different gate —
    // the stop-button block — not the header gate).
    const between = gateIdx === -1 ? '' : panel.slice(gateIdx, btnIdx)
    const singleGate = (between.match(/\{guide\.reading && \(/g) ?? []).length === 1
    check('A1b mute button is inside a {guide.reading && (...)} gate', gateOpensBeforeButton && singleGate, `gate@${gateIdx} button@${btnIdx}`)
    check('A1c gate closes after the button', closeIdx !== -1 && closeIdx > btnIdx)
  }
}

// A2 — every remaining "Couper la voix" in the panel is inside a
// reading gate: the stop button lives in the `{guide.reading && ...}`
// indicator block (it already did), and the header button is gated
// by A1. Count occurrences outside comments: exactly two (header
// aria-label + stop-button text), both gated.
{
  const panel = guide.slice(guide.indexOf('export function MenuGuidePanel'))
  const code = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])(\/\/.*)$/gm, '$1')
  const occurrences = [...code.matchAll(/Couper la voix/g)].length
  check('A2a exactly two "Couper la voix" in the panel (header + stop)', occurrences === 2, `found=${occurrences}`)
  // The stop button text sits between the indicator gate (the gate
  // before 'Lecture en cours…') and its close.
  const lectureIdx = code.indexOf('Lecture en cours…')
  const indicatorIdx = lectureIdx === -1 ? -1 : code.lastIndexOf('{guide.reading && (', lectureIdx)
  const stopIdx = code.indexOf('Couper la voix', code.indexOf('guide.stopReading'))
  check('A2b stop button is inside the reading-indicator gate', indicatorIdx !== -1 && stopIdx > lectureIdx, `gate@${indicatorIdx} lecture@${lectureIdx} stop@${stopIdx}`)
}

// A3 — dynamic: the real store is the gate's source of truth. Before
// any reading there is nothing to cut; startReading makes the gate
// true; stopReading makes it false again.
{
  const tmpDir = mkdtempSync(join(homedir(), '.cache', 'fix15-nits-probe-'))
  let store
  try {
    execFileSync(
      join(root, 'node_modules', '.bin', 'tsc'),
      [
        'src/lib/readingStore.ts',
        '--outDir', tmpDir,
        '--module', 'esnext',
        '--target', 'es2022',
        '--moduleResolution', 'bundler',
        '--skipLibCheck',
        '--ignoreConfig',
      ],
      { cwd: root, stdio: 'pipe' },
    )
    store = await import(pathToFileURL(join(tmpDir, 'readingStore.js')).href)
  } catch (err) {
    console.log(`FAIL  A3 setup — could not transpile/import the store: ${err.message}`)
    failures += 1
  }
  if (store) {
    check('A3a no reading before any start (gate reads false)', store.getReading() === null)
    store.startReading('bieres', 5)
    check('A3b reading live after start (gate reads true)', store.getReading()?.categoryId === 'bieres')
    store.stopReading()
    check('A3c no reading after stop (gate reads false again)', store.getReading() === null)
    // The hook mirrors exactly this value (fix 14): the gate reads the
    // store, it does not keep its own copy.
    check(
      'A3d hook mirrors the store (useState initialised from getReading + subscribe)',
      guide.includes('useState<ReadingState | null>(() => getReading())') &&
        guide.includes('subscribeReadingStore(() => {'),
    )
  }
  rmSync(tmpDir, { recursive: true, force: true })
}

// A4 — the mute toggle itself still works (toggleMute + stopReading
// wiring untouched) and the button is NOT rendered by App's Livre
// reading panel on LA CARTE (that panel is the book tab's own).
check(
  'A4 toggleMute / stopReading wiring untouched',
  guide.includes('onClick={guide.toggleMute}') && guide.includes('onClick={guide.stopReading}'),
)

// ---------------------------------------------------------------------
// (b) Thinking flag clears exactly when the reply lands.
// ---------------------------------------------------------------------

// B1 — code path (order-sensitive): inside send()'s askBrain .then(),
// setAnswering(false) comes AFTER the reply append (setMessages) and
// BEFORE speak — same synchronous batch, so one render shows the
// reply with the indicator gone. No .finally() clears it a microtask
// later any more.
{
  const sendStart = agent.indexOf('const send = (text: string) => {')
  const sendEnd = agent.indexOf('\n  }\n', sendStart)
  const send = sendStart === -1 || sendEnd === -1 ? '' : agent.slice(sendStart, sendEnd)
  // Strip comments for the code checks below: the fix comment itself
  // legitimately names ".finally()" in prose.
  const sendCode = send.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])(\/\/.*)$/gm, '$1')
  check('B1a send() block found', send.length > 0)
  if (send.length > 0) {
    const appendIdx = send.indexOf('setMessages((prev) => [...prev, { role: \'bot\'')
    const clearIdx = send.indexOf('setAnswering(false)', appendIdx)
    const speakIdx = send.indexOf('speak(reply.text)', clearIdx)
    const finallyIdx = sendCode.indexOf('.finally(')
    check(
      'B1b setAnswering(false) is inside .then(), after the reply append',
      appendIdx !== -1 && clearIdx !== -1 && clearIdx > appendIdx,
      `append@${appendIdx} clear@${clearIdx}`,
    )
    check('B1c clear happens before speak (same batch as the append)', speakIdx !== -1 && clearIdx < speakIdx)
    check('B1d no .finally() clears the flag a microtask later', finallyIdx === -1)
    check(
      'B1e a .catch still clears the flag if the handler itself throws (input never stuck disabled)',
      send.includes('.catch(() => setAnswering(false))'),
    )
    check('B1f answering still set true at send start + input still disabled while answering',
      send.includes('setAnswering(true)') &&
        agent.includes('disabled={answering}') &&
        agent.includes('{answering && ('),
    )
  }
}

// B2 — dynamic mechanism check (real promise microtasks): a "commit"
// happens at each microtask boundary. Old shape (.then append,
// .finally clear) commits reply+thinking together; new shape (.then
// append+clear) commits exactly once, reply without thinking.
{
  const commits = (shape) =>
    new Promise((resolve) => {
      let messages = 0
      let answering = true
      const seen = []
      const commit = () => seen.push({ messages, answering })
      const ask = Promise.resolve('reply')
      if (shape === 'old') {
        ask
          .then(() => {
            messages += 1
            commit() // microtask 1: reply rendered, thinking still up
          })
          .finally(() => {
            answering = false
            commit() // microtask 2: thinking clears
          })
          .then(() => resolve(seen))
      } else {
        ask
          .then(() => {
            messages += 1
            answering = false // same batch as the append
            commit() // single commit: reply in, thinking out
          })
          .then(() => resolve(seen))
      }
    })
  const oldCommits = await commits('old')
  const newCommits = await commits('new')
  check(
    'B2a OLD shape commits reply WITH thinking still up (the reported nit)',
    oldCommits.length === 2 && oldCommits[0].messages === 1 && oldCommits[0].answering === true,
    `commits=${JSON.stringify(oldCommits)}`,
  )
  check(
    'B2b NEW shape commits exactly once: reply in, thinking out together',
    newCommits.length === 1 && newCommits[0].messages === 1 && newCommits[0].answering === false,
    `commits=${JSON.stringify(newCommits)}`,
  )
  await sleep(0)
}

// ---------------------------------------------------------------------
// (c) Henshin morph: Param3 easing stays in the readable band.
// ---------------------------------------------------------------------

// C0 — read the SHIPPED easing out of Live2DModel.tsx (never hardcode
// the constants in the probe — the probe must fail if the source
// drifts from what it asserts).
const easeMatch = live2d.match(/param3Current \+= \(target - param3Current\) \* ([0-9.]+)/)
const snapMatch = live2d.match(/if \(Math\.abs\(target - param3Current\) < ([0-9.]+)\) param3Current = target/)
const factor = easeMatch ? parseFloat(easeMatch[1]) : NaN
const snapEps = snapMatch ? parseFloat(snapMatch[1]) : NaN
check('C0a shipped ease factor read from source', Number.isFinite(factor), `factor=${easeMatch?.[1]}`)
check('C0b shipped snap epsilon read from source', Number.isFinite(snapEps), `snap=${snapMatch?.[1]}`)
check('C0c ease lives in the afterMotionUpdate hook (fix 14 path, not the ticker)',
  live2d.includes("internalModelEmitter.on('afterMotionUpdate', applyHenshin)"))

// C1 — the readable band, measured on the REAL model (same harness as
// the fix14 henshin probe: real .moc3 + Cubism Core + internal model
// + Idle motion; no textures, no WebGL2 — opacities are the values the
// renderer draws).
const pub = join(root, 'public', 'live2d')
const readPub = (p) => readFileSync(join(pub, p))
const readPubJson = (p) => JSON.parse(readFileSync(join(pub, p), 'utf8'))
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary')
globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64')
globalThis.__dirname = '/tmp'
vm.runInThisContext(readFileSync(join(pub, 'live2dcubismcore.min.js'), 'utf8'), {
  filename: 'live2dcubismcore.min.js',
})
let coreReady = false
for (let i = 0; i < 100 && !coreReady; i++) {
  try {
    globalThis.Live2DCubismCore.Version.csmGetVersion()
    coreReady = true
  } catch {
    await sleep(100)
  }
}
check('C1a Cubism Core loads', coreReady)
globalThis.window = globalThis
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', gpu: undefined }, configurable: true })
globalThis.self = globalThis
globalThis.document = { createElement: () => ({ getContext: () => null, style: {} }) }

await import('pixi.js')
const live2dLib = await import('pixi-live2d-display/cubism4')
const { CubismMoc, Cubism4ModelSettings, Cubism4InternalModel, CubismPhysics } = live2dLib
const settingsJson = readPubJson('nekomi/Furry.model3.json')
settingsJson.url = '/live2d/nekomi/Furry.model3.json'
const settings = new Cubism4ModelSettings(settingsJson)
const coreModel = CubismMoc.create(readPub('nekomi/Furry.moc3')).createModel()
const internal = new Cubism4InternalModel(coreModel, settings, {})
internal.physics = CubismPhysics.create(readPubJson('nekomi/Furry.physics3.json'))
const idle = internal.motionManager.createMotion(readPubJson('nekomi/Idle.motion3.json'), 'Idle', settingsJson.Motions.Idle[0])
internal.motionManager._startMotion(idle)
const raw = coreModel.getModel()
const opacity = (id) => raw.drawables.opacities[raw.drawables.ids.indexOf(id)]
// Fix14 probe's stable readability sets (blink-proof).
const FURRY_IDS = ['FURRY_Tongue', 'FURRY_Neck', 'ArtMesh8', 'ArtMesh48']
const HUMAN_IDS = ['Tongue', 'Nose', 'ArtMesh54', 'ArtMesh75']
const furryReads = () => FURRY_IDS.every((id) => opacity(id) > 0.9)
const humanReads = () => HUMAN_IDS.every((id) => opacity(id) > 0.9)
let nowMs = 0
const modelUpdate = () => {
  nowMs += 16.67
  internal.update(16.67, nowMs)
}
const setP3 = (v) => coreModel.setParameterValueById('Param3', v)

const band = {}
for (const v of [0.3, 0.35, 0.5, 0.65, 0.7]) {
  setP3(v)
  modelUpdate()
  band[v] = { human: humanReads(), furry: furryReads() }
}
check('C1b Param3 0.30: human reads, furry hidden (readable end)', band[0.3].human && !band[0.3].furry, JSON.stringify(band[0.3]))
check('C1c Param3 0.50: NEITHER form reads (the wash band exists)', !band[0.5].human && !band[0.5].furry, JSON.stringify(band[0.5]))
check('C1d Param3 0.70: furry reads, human hidden (readable end)', band[0.7].furry && !band[0.7].human, JSON.stringify(band[0.7]))
check('C1e band edges 0.35 / 0.65 are also unreadable (wash is 0.3–0.7, not a point)',
  !band[0.35].human && !band[0.35].furry && !band[0.65].human && !band[0.65].furry)

// C2 — simulate the SHIPPED easing (constants from C0) frame by frame
// against the measured band, at 60 fps and at phone-realistic 30 fps.
// Wash = Param3 strictly inside (0.3, 0.7).
function simulateEase(f, snap, label) {
  const out = {}
  for (const fps of [60, 30]) {
    let cur = 0
    let frames = 0
    let wash = 0
    let landed = -1
    while (frames < 600) {
      cur += (1 - cur) * f
      if (snap > 0 && Math.abs(1 - cur) < snap) cur = 1
      frames++
      if (cur > 0.3 && cur < 0.7) wash++
      // Landed: exactly 1 with a snap; ≥ 0.999 without one (the old
      // ease asymptotes and never writes exactly 1).
      if (landed === -1 && (cur === 1 || (snap === 0 && cur >= 0.999))) landed = frames
      if (landed !== -1) break
      if (cur < 0 || cur > 1) break
    }
    out[fps] = { frames, wash, landed, secondsToLand: landed === -1 ? null : landed / fps }
  }
  return out
}
const shipped = simulateEase(factor, snapEps, 'shipped')
const old = simulateEase(0.12, 0, 'old')
check('C2a shipped ease: ≤ 4 wash frames @60fps', shipped[60].wash <= 4, `wash=${shipped[60].wash}`)
check('C2b shipped ease: ≤ 4 wash frames @30fps', shipped[30].wash <= 4, `wash=${shipped[30].wash}`)
check('C2c shipped ease lands EXACTLY on 1 (snap holds the readable end)', shipped[60].landed !== -1 && shipped[30].landed !== -1, `landed@60=${shipped[60].landed} @30=${shipped[30].landed}`)
check('C2d shipped ease lands in ≤ 0.5s @30fps (old tail took ~1.8s)', shipped[30].secondsToLand !== null && shipped[30].secondsToLand <= 0.5, `land=${shipped[30].secondsToLand?.toFixed(2)}s`)
check('C2e shipped ease beats the old 0.12 ease on wash frames', shipped[60].wash < old[60].wash, `new=${shipped[60].wash} old=${old[60].wash}`)
check('C2f shipped ease beats the old 0.12 ease on landing time', shipped[60].landed < old[60].landed, `new=${shipped[60].landed}f old=${old[60].landed}f`)
// The morph must still BE a morph: it does not snap in 1–2 frames.
check('C2g still a gradual dissolve (lands no sooner than frame 8, not a snap)', shipped[60].landed >= 8, `landed=${shipped[60].landed}f`)

// C3 — drive the REAL model with the shipped easing through the real
// update path (hook shape: ease + write per model update) and read
// the drawables: furry visible + human hidden within 20 frames, and
// at most 4 frames where neither form reads.
{
  let cur = 0
  let frames = 0
  let washFrames = 0
  let firstFurryFrame = -1
  setP3(0)
  modelUpdate()
  while (frames < 60) {
    cur += (1 - cur) * factor
    if (Math.abs(1 - cur) < snapEps) cur = 1
    setP3(cur)
    modelUpdate()
    frames++
    if (!furryReads() && !humanReads()) washFrames++
    if (firstFurryFrame === -1 && furryReads()) firstFurryFrame = frames
    if (cur === 1 && furryReads()) break
  }
  check('C3a real model: furry reads within 20 frames of the shipped ease', firstFurryFrame !== -1 && firstFurryFrame <= 20, `firstFurryFrame=${firstFurryFrame}`)
  check('C3b real model: ≤ 4 wash frames on the real drawables', washFrames <= 4, `washFrames=${washFrames}`)
  check('C3c real model: human hidden once furry reads', HUMAN_IDS.every((id) => opacity(id) < 0.05), `Tongue=${opacity('Tongue').toFixed(2)} Nose=${opacity('Nose').toFixed(2)}`)
  check('C3d real model: Param3 landed exactly on 1.0', coreModel.getParameterValueById('Param3') === 1, `param3=${coreModel.getParameterValueById('Param3')}`)
}

console.log(failures === 0 ? '\nfix15-nits-probe: ALL CHECKS PASSED' : `\nfix15-nits-probe: ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
