// Fix pass 14, Group A — Henshin probe (updated for the fix-14 architecture).
//
// The Henshin toggle changed the button state but the rendered model stayed
// the human girl. This probe drives the REAL parameter pipeline headless
// (no WebGL2 on this VM, so no pixels) and proves — or disproves — that a
// Param3 write reaches the drawables the stage renders:
//
//   * the real .moc3 + real Cubism Core (public/live2d/*)
//   * the real pixi-live2d-display Cubism4InternalModel (the object the
//     stage renders), with the real Idle motion, real Henshin expression
//     and real physics attached
//   * the component's EXACT new Param3 drive (Live2DModel.tsx, fix pass
//     14): an `afterMotionUpdate` hook on the internal model eases Param3
//     toward the persisted form on every model update — the app-ticker
//     tick NO LONGER writes Param3 (it keeps presets + mouth only)
//   * the Automator's exact update dance (internalModel.update: motion,
//     saveParameters, expression, eyeBlink, focus, breath, physics,
//     core update, loadParameters), in both ticker phase orders
//
// It also simulates the fix-pass-13 warm remount (both tickers stopped,
// then resumed, with the warm path's explicit Param3 re-apply) in both
// forms, and the real @pixi/ticker stop()/start() lifecycle with a
// requestAnimationFrame polyfill.
//
// Usage: node --preserve-symlinks scripts/fix14-henshin-probe.mjs
//   (preserve-symlinks is needed because this worktree's node_modules is
//   a symlink to home-disk storage; without it @pixi/* resolution breaks.)
// Exit 0 = all checks pass.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pub = join(root, 'public', 'live2d')
const read = (p) => readFileSync(join(pub, p))
const readJson = (p) => JSON.parse(readFileSync(join(pub, p), 'utf8'))

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

// ---------------------------------------------------------------------------
// 0. Real Cubism Core (the same file the site serves from /live2d/).
//    The Emscripten build picks its environment from `window`: it must be
//    loaded BEFORE any window shim exists, or it wants `document`.
// ---------------------------------------------------------------------------
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
    await new Promise((r) => setTimeout(r, 100))
  }
}
check('Cubism Core loads + wasm runtime ready', coreReady)

// Browser shims for the pixi.js import (only after the core picked Node).
globalThis.window = globalThis
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'node', gpu: undefined },
  configurable: true,
})
globalThis.self = globalThis
globalThis.document = { createElement: () => ({ getContext: () => null, style: {} }) }

const PIXI = await import('pixi.js')
const live2d = await import('pixi-live2d-display/cubism4')
const { CubismMoc, Cubism4ModelSettings, Cubism4InternalModel, CubismPhysics } = live2d
check('real pixi.js + pixi-live2d-display/cubism4 import', !!PIXI.Ticker?.shared && !!Cubism4InternalModel)

// ---------------------------------------------------------------------------
// 1. Build the real internal model from the real files (no textures: the
//    probe never draws, it reads the drawables the renderer would draw).
// ---------------------------------------------------------------------------
const settingsJson = readJson('nekomi/Furry.model3.json')
// ModelSettings requires the settings URL (Live2DModel.from passes it);
// the file itself has none.
settingsJson.url = '/live2d/nekomi/Furry.model3.json'
const settings = new Cubism4ModelSettings(settingsJson)
const mocBytes = read('nekomi/Furry.moc3')
const coreModel = CubismMoc.create(mocBytes).createModel()
const internal = new Cubism4InternalModel(coreModel, settings, {})
try {
  internal.physics = CubismPhysics.create(readJson('nekomi/Furry.physics3.json'))
  check('real physics attached (Furry.physics3.json)', !!internal.physics)
} catch (e) {
  check('real physics attached (Furry.physics3.json)', false, String(e))
}
const idleJson = readJson('nekomi/Idle.motion3.json')
// NOTE: the model3.json puts Motions at TOP level, but
// CubismModelSettingsJson reads json.FileReferences.Motions — so in the
// real flow settings.motions is undefined and model.motion('Idle') is a
// no-op. The Idle file itself is still real; drive it from the top-level
// entry, exactly as the file declares it.
const idle = internal.motionManager.createMotion(idleJson, 'Idle', settingsJson.Motions.Idle[0])
internal.motionManager._startMotion(idle)
check(
  'settings.motions is undefined (model3.json puts Motions top-level, not under FileReferences)',
  settings.motions === undefined,
)
check(
  'settings.expressions is undefined (same top-level placement)',
  settings.expressions === undefined,
)
check(
  'real flow has NO expression manager (manager only created when settings.expressions exists)',
  internal.motionManager.expressionManager === undefined,
)
const idleMotionStarted = await internal.motionManager.startRandomMotion('Idle')
check(
  "model.motion('Idle') is a no-op in the real flow (no motion definitions)",
  idleMotionStarted === false,
  `startRandomMotion('Idle') resolved ${idleMotionStarted}`,
)
const henshinJson = readJson('nekomi/Henshin.exp3.json')
// A standalone manager built from the file's own top-level Expressions,
// so the .exp3 file itself can still be tested (section 3 applies it
// through the library's own update path).
const { Cubism4ExpressionManager } = live2d
const expressionManager = new Cubism4ExpressionManager(
  { ...settings, expressions: settingsJson.Expressions, name: 'Furry' },
  {},
)

const raw = coreModel.getModel()
const drawableIndex = (id) => raw.drawables.ids.indexOf(id)
const opacity = (id) => raw.drawables.opacities[drawableIndex(id)]
const FURRY_IDS = ['FURRY_Tongue', 'FURRY_Neck', 'ArtMesh8', 'ArtMesh48']
const HUMAN_IDS = ['Tongue', 'Nose', 'ArtMesh54', 'ArtMesh75']
const param3 = () => coreModel.getParameterValueById('Param3')
const furryVisible = () => FURRY_IDS.every((id) => opacity(id) > 0.9)
const humanVisible = () => HUMAN_IDS.every((id) => opacity(id) > 0.9)

// ---------------------------------------------------------------------------
// 2. The component's Param3 drive, exactly as fixed (fix pass 14).
//    `formRef` stands in for the module-level lastHenshinForm; the hook
//    is attached ONCE at cold init to the internal model (which the warm
//    cache keeps), eases the module-level param3Current toward the form
//    on every model update, and writes it via setParameterValueById.
//    The app-ticker tick mirrors the fixed component: presets + mouth
//    only — it must NOT move Param3 on its own.
// ---------------------------------------------------------------------------
const NEUTRAL = { ParamMouthForm: 0.3, ParamEyeLSmile: 0, ParamEyeRSmile: 0, ParamBrowLY: 0, ParamBrowRY: 0 }
const formRef = { current: 'human' }
let param3Current = 0
let current = { ...NEUTRAL }
const setParam = (id, value) => {
  try {
    coreModel.setParameterValueById(id, value)
  } catch {
    // Param absent on this rig — ignore (same guard as the component).
  }
}
function writeParam3(value) {
  setParam('Param3', value)
}
let hookFires = 0
function applyHenshin() {
  hookFires += 1
  const target = formRef.current === 'furry' ? 1 : 0
  param3Current += (target - param3Current) * 0.12
  writeParam3(param3Current)
}
check('internalModel exposes .on at runtime (the .d.ts lacks it — see component cast)', typeof internal.on === 'function')
internal.on('afterMotionUpdate', applyHenshin)
const unapplyHenshin = () => {
  try {
    internal.off('afterMotionUpdate', applyHenshin)
  } catch {
    // Already gone — nothing to free.
  }
}
function tick() {
  // Fixed component tick: presets + mouth only, NO Param3 write.
  for (const key of Object.keys(NEUTRAL)) {
    const from = current[key] ?? 0
    current[key] = from + (NEUTRAL[key] - from) * 0.15
    setParam(key, current[key])
  }
  setParam('ParamMouthOpenY', 0)
}
let nowMs = 0
function modelUpdate() {
  nowMs += 16.67
  internal.update(16.67, nowMs)
}
function runFrames(n, order) {
  for (let i = 0; i < n; i++) {
    if (order === 'tick-first') {
      tick()
      modelUpdate()
    } else {
      modelUpdate()
      tick()
    }
  }
}

// Baseline: human at rest, Idle playing.
runFrames(30, 'tick-first')
check('baseline human: Param3 ~0, human drawables visible', param3() < 0.05 && humanVisible(), `param3=${param3().toFixed(2)}`)
check('baseline human: furry drawables hidden', FURRY_IDS.every((id) => opacity(id) < 0.05))
check('hook fires once per model update', hookFires === 30, `hookFires=${hookFires}`)

// The tick alone must NOT move Param3 any more (the hook is the writer):
// toggle the form, run the tick 30x with NO model update, assert nothing
// changed — then run model updates and assert it converges.
formRef.current = 'furry'
for (let i = 0; i < 30; i++) tick()
check('tick alone does not move Param3 (hook owns the form)', param3() < 0.05, `param3=${param3().toFixed(2)}`)

// Toggle to furry, tick-first phase (app ticker before shared ticker).
runFrames(60, 'tick-first')
check(
  'tick-first: hook eases Param3 to ~1 and furry drawables visible after 60 frames',
  param3() > 0.95 && furryVisible(),
  `param3=${param3().toFixed(2)} FURRY_Tongue=${opacity('FURRY_Tongue').toFixed(2)} Nose=${opacity('Nose').toFixed(2)}`,
)
check('tick-first: human drawables hidden in furry form', HUMAN_IDS.every((id) => opacity(id) < 0.05))

// Toggle back to human, reverse phase (shared ticker before app ticker).
formRef.current = 'human'
runFrames(60, 'update-first')
check(
  'update-first: hook returns Param3 to ~0 and human drawables visible after 60 frames',
  param3() < 0.05 && humanVisible(),
  `param3=${param3().toFixed(2)}`,
)
check('update-first: furry drawables hidden in human form', FURRY_IDS.every((id) => opacity(id) < 0.05))

// ---------------------------------------------------------------------------
// 3. Expression path: model.expression('Henshin') + resetExpression().
//    In production the manager is absent (section 1), so this section
//    wires the standalone manager into the exact slot the library uses
//    (motionManager.expressionManager, applied inside internal.update
//    after saveParameters) — the only deviation from production is that
//    the manager exists at all. It proves the .exp3 file itself works.
// ---------------------------------------------------------------------------
expressionManager.expressions[0] = expressionManager.createExpression(
  henshinJson,
  settingsJson.Expressions[0],
)
const expressionOk = await expressionManager.setExpression('Henshin')
check("expressionManager.setExpression('Henshin') resolves true (pre-loaded file)", expressionOk === true)
internal.motionManager.expressionManager = expressionManager
formRef.current = 'furry'
runFrames(60, 'tick-first')
check('expression active: furry drawables visible', furryVisible(), `param3=${param3().toFixed(2)}`)
expressionManager.resetExpression()
formRef.current = 'human'
runFrames(60, 'tick-first')
check('resetExpression + human tick: human drawables visible again', humanVisible() && param3() < 0.05, `param3=${param3().toFixed(2)}`)
internal.motionManager.expressionManager = undefined

// ---------------------------------------------------------------------------
// 4. Warm remount (fix pass 13 + fix pass 14 re-apply): both tickers
//    stopped across a tab leave, then resumed. The hook lives on the
//    cached internal model, so it survives — and the warm path writes
//    the current eased Param3 straight into the cached core on return,
//    so the first frame after the return already shows the form.
// ---------------------------------------------------------------------------
formRef.current = 'furry'
runFrames(60, 'tick-first')
check('pre-remount: furry form showing', furryVisible() && param3() > 0.95, `param3=${param3().toFixed(2)}`)
// Tab away: no tick, no model update for 30 simulated frames.
for (let i = 0; i < 30; i++) nowMs += 16.67
// Warm path re-apply: write the current eased value into the cached core.
writeParam3(param3Current)
check('warm re-apply writes the current form immediately (before any update)', param3() > 0.95, `param3=${param3().toFixed(2)}`)
runFrames(60, 'tick-first')
check(
  'warm remount, furry persisted: hook keeps driving Param3, no re-play needed',
  furryVisible() && param3() > 0.95,
  `param3=${param3().toFixed(2)}`,
)
// Form changed DURING the gap (lastHenshinForm persisted; the hook reads
// it live on the next model update).
formRef.current = 'human'
for (let i = 0; i < 30; i++) nowMs += 16.67
writeParam3(param3Current)
runFrames(60, 'tick-first')
check('warm remount, form flipped during gap: human showing', humanVisible() && param3() < 0.05, `param3=${param3().toFixed(2)}`)
formRef.current = 'furry'
for (let i = 0; i < 30; i++) nowMs += 16.67
writeParam3(param3Current)
runFrames(60, 'tick-first')
check('warm remount, flipped back during gap: furry showing', furryVisible() && param3() > 0.95, `param3=${param3().toFixed(2)}`)
// dropWarmStage removes the hook: after removal, toggling must NOT move
// Param3 any more (the hook was the writer).
unapplyHenshin()
formRef.current = 'human'
runFrames(60, 'tick-first')
check('hook removed (dropWarmStage): form no longer driven', param3() > 0.95, `param3=${param3().toFixed(2)}`)
// Re-attach for the real-ticker phase below (a fresh cold init would do this).
internal.on('afterMotionUpdate', applyHenshin)
formRef.current = 'furry'

// ---------------------------------------------------------------------------
// 5. Real @pixi/ticker lifecycle: stop() on unmount, start() on warm
//    remount — with a real requestAnimationFrame loop. The app ticker
//    carries the component tick + render; the shared ticker carries the
//    model update (the Automator). Also documents the kill mechanism: a
//    listener that throws stops its ticker's RAF loop for good.
// ---------------------------------------------------------------------------
let lastRafError = null
globalThis.requestAnimationFrame = (cb) =>
  setTimeout(() => {
    try {
      cb(performance.now())
    } catch (e) {
      lastRafError = e
    }
  }, 16)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const appTicker = new PIXI.Ticker()
const sharedTicker = PIXI.Ticker.shared
let renders = 0
let lastRenderParam3 = -1
let modelUpdates = 0
appTicker.add(() => {
  tick()
})
appTicker.add(
  () => {
    renders += 1
    lastRenderParam3 = param3()
  },
  null,
  PIXI.UPDATE_PRIORITY.LOW,
)
sharedTicker.add(() => {
  modelUpdates += 1
  internal.update(sharedTicker.deltaMS, performance.now())
})
appTicker.start()
formRef.current = 'human'
await sleep(500)
const rendersBeforeStop = renders
const updatesBeforeStop = modelUpdates
check('real tickers: app ticker renders + shared ticker updates the model', rendersBeforeStop > 5 && updatesBeforeStop > 5, `renders=${rendersBeforeStop} updates=${updatesBeforeStop}`)
check('real tickers: no listener threw during the run', lastRafError === null, lastRafError ? String(lastRafError) : '')

formRef.current = 'furry'
await sleep(700)
check(
  'real tickers: rendered frames converge to furry after toggle (hook-driven)',
  lastRenderParam3 > 0.9 && furryVisible(),
  `lastRenderParam3=${lastRenderParam3.toFixed(2)}`,
)

// Warm remount: unmount stops the app ticker; remount restarts it.
appTicker.stop()
const rendersAtStop = renders
await sleep(400)
check('real tickers: stop() halts renders while tab is away', renders === rendersAtStop, `renders=${renders} (was ${rendersAtStop})`)
appTicker.start()
await sleep(500)
check(
  'real tickers: start() resumes renders after warm remount, still furry',
  renders > rendersAtStop && lastRenderParam3 > 0.9 && furryVisible(),
  `renders=${renders} lastRenderParam3=${lastRenderParam3.toFixed(2)}`,
)
formRef.current = 'human'
await sleep(700)
check('real tickers: toggle back to human after remount renders human', lastRenderParam3 < 0.1 && humanVisible(), `lastRenderParam3=${lastRenderParam3.toFixed(2)}`)

// Kill mechanism, on a throwaway ticker (documents the failure mode).
const doomed = new PIXI.Ticker()
let doomedTicks = 0
doomed.add(() => {
  doomedTicks += 1
  if (doomedTicks === 3) throw new Error('simulated listener throw')
})
doomed.start()
await sleep(400)
const doomedFrozenAt = doomedTicks
await sleep(400)
check(
  'ticker kill mechanism: a throwing listener stops its ticker loop (no auto-recovery)',
  doomedTicks === doomedFrozenAt && doomedFrozenAt >= 3 && lastRafError?.message === 'simulated listener throw',
  `ticks=${doomedTicks} rafError=${lastRafError?.message}`,
)
doomed.destroy()
appTicker.destroy()

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
