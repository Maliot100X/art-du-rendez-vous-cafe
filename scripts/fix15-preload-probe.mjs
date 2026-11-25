// Fix pass 15 — boot preload of the PARSED Live2D model.
// The fix-3 prewarm only fills the HTTP cache; the first Agent mount
// still paid the whole Live2DModel.from() parse in series (~5 s).
// This probe checks, statically + with the real libraries in Node
// (no WebGL2 on this VM, so no pixels and no real render timing):
//   * App starts the parsed-model preload at boot (idle, after first
//     paint), skipped on save-data/2G
//   * the preload parses with autoUpdate:false (no background ticker
//     work while parked) and chains after the byte prewarm (no parallel
//     double download), and a failure clears the shared promise
//   * the first mount JOINS the shared in-flight promise instead of a
//     second from() — one parse per page lifetime — and re-enables
//     autoUpdate once the model is on a stage
//   * a mount cancelled mid-load parks the shared model instead of
//     destroying it, and dropWarmStage clears the promise with the
//     cache (a destroyed model is never re-served)
//   * the fix-13 warm cache + fix-14 Henshin re-apply are untouched
//   * RUNTIME: the real .moc3 parses with the real Cubism Core and no
//     PIXI Application / WebGL context, and the real Automator parks
//     (autoUpdate:false adds no shared-ticker listener) and re-enables
// Usage: node --preserve-symlinks scripts/fix15-preload-probe.mjs
//   (preserve-symlinks is needed because this worktree's node_modules
//   is a symlink to home-disk storage; without it @pixi/* resolution
//   breaks.) Exit 0 = all checks pass.
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pub = join(root, 'public', 'live2d')
const modelSrc = readFileSync(join(root, 'src/components/Live2DModel.tsx'), 'utf8')
const appSrc = readFileSync(join(root, 'src/App.tsx'), 'utf8')

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

// Brace-match helper: extract the body of the first `{ ... }` starting at idx.
function braceBody(text, openIdx) {
  let depth = 0
  for (let i = openIdx; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(openIdx, i + 1)
    }
  }
  return ''
}

// --- measured asset sizes (not guessed) ---
const sizes = {}
for (const p of [
  'live2dcubismcore.min.js',
  'nekomi/Furry.model3.json',
  'nekomi/Furry.moc3',
  'nekomi/texture_00.png',
  'nekomi/texture_01.png',
  'nekomi/Furry.physics3.json',
  'nekomi/Idle.motion3.json',
  'nekomi/Nodd.motion3.json',
]) {
  sizes[p] = statSync(join(pub, p)).size
}
const total = Object.values(sizes).reduce((a, b) => a + b, 0)
console.log(
  `INFO  model assets: moc3=${sizes['nekomi/Furry.moc3']}B textures=${sizes['nekomi/texture_00.png'] + sizes['nekomi/texture_01.png']}B (1024x2048 RGBA each, ~8MB decoded each) core=${sizes['live2dcubismcore.min.js']}B total-live2d=${total}B`,
)

// --- (a) boot preload entry point exists ---
check('preloadLive2dModel exported from Live2DModel.tsx', /export function preloadLive2dModel\(\)/.test(modelSrc))
check(
  'preload builds the model parked (autoUpdate: false)',
  /Live2DModel\.from\(MODEL_URL, \{ autoUpdate: false \}\)/.test(modelSrc),
)
check(
  'preload chains after the byte prewarm (no parallel double download)',
  (() => {
    const idx = modelSrc.indexOf('export function preloadLive2dModel')
    const body = braceBody(modelSrc, modelSrc.indexOf('{', idx))
    return /preloadLive2d\(\)/.test(body) && /live2dPreloadPromise/.test(body) && /\.then\(\(\) => preloadModelOnce\(\)\)/.test(body)
  })(),
)
check(
  'preload failure clears the shared promise (mount can retry fresh)',
  (() => {
    const idx = modelSrc.indexOf('export function preloadLive2dModel')
    const body = braceBody(modelSrc, modelSrc.indexOf('{', idx))
    return /preloadedModelPromise = null/.test(body)
  })(),
)
check(
  'shared parsed-model promise declared module-level',
  /let preloadedModelPromise: Promise<Live2DModelType> \| null = null/.test(modelSrc),
)

// --- (b) App starts it at boot, idle, after first paint ---
check(
  'App boot effect calls preloadLive2dModel()',
  /void import\('\.\/components\/Live2DModel'\)\s*\n\s*\.then\(\(m\) => m\.preloadLive2dModel\(\)\)/.test(appSrc),
)
check(
  'App boot preload runs on idle (never blocks first paint)',
  (() => {
    const idx = appSrc.indexOf('m.preloadLive2dModel()')
    const effIdx = appSrc.lastIndexOf('useEffect', idx)
    const idleIdx = effIdx === -1 ? -1 : appSrc.indexOf('runWhenIdle(', effIdx)
    return idx !== -1 && effIdx !== -1 && idleIdx !== -1 && idleIdx < idx
  })(),
)
check(
  'App boot preload still skipped on save-data / 2G',
  /if \(shouldDeferHeavyPreload\(\)\) return/.test(appSrc),
)
check(
  'hover/focus path stays bytes-only (no parse on hover)',
  /function prewarmForTab\(id: TabId\): void \{\n\s*if \(id === 'agent'\) prewarmLive2d\(\)/.test(appSrc),
)

// --- (c) first mount JOINS the shared promise — one parse per page ---
check(
  'mount captures the shared promise before loading',
  /const preloaded = preloadedModelPromise/.test(modelSrc),
)
check(
  'mount awaits the shared promise (joins in-flight preload)',
  /model = await preloaded/.test(modelSrc),
)
check(
  'mount re-enables autoUpdate once the model is on a stage',
  /model\.automator\.autoUpdate = true/.test(modelSrc),
)
check(
  'old unconditional cold from() is gone (no second parse path)',
  !/const model = \(await Live2DModel\.from\(MODEL_URL\)\)/.test(modelSrc),
)
check(
  'from() is called only in the preload + fallback branches (single load)',
  (modelSrc.match(/Live2DModel\.from\(MODEL_URL/g) ?? []).length === 3,
  `${(modelSrc.match(/Live2DModel\.from\(MODEL_URL/g) ?? []).length} call sites (preload + 2 fallbacks)`,
)

// --- (d) shared model is never destroyed out from under the promise ---
check(
  'cancelled mount parks the shared model (autoUpdate = false) instead of destroying it',
  (() => {
    const idx = modelSrc.indexOf('if (reusedPreload)')
    const cancelIdx = modelSrc.lastIndexOf('if (cancelled)', idx)
    if (idx === -1 || cancelIdx === -1) return false
    const body = braceBody(modelSrc, modelSrc.indexOf('{', cancelIdx))
    return /model\.automator\.autoUpdate = false/.test(body) && /model\.destroy\(\)/.test(body)
  })(),
)
check(
  'dropWarmStage clears the shared promise with the cache',
  (() => {
    const idx = modelSrc.indexOf('function dropWarmStage')
    const body = braceBody(modelSrc, modelSrc.indexOf('{', idx))
    return /preloadedModelPromise = null/.test(body)
  })(),
)

// --- (e) warm cache (fix 13) + Henshin re-apply (fix 14) untouched ---
check(
  'warm cache still published after the model is built',
  /warmStage = \{ app, model, canvas, unsubscribe,?[^}]*\}/.test(modelSrc),
)
check(
  "status still initialises from cache presence (warm return never shows placeholder)",
  /useState<[^>]*>\(\(\) =>\s*warmStage \? 'ready' : 'loading',?\s*\)/.test(modelSrc),
)
check('warm path still re-applies the Henshin form on remount', /writeParam3\(stage\.model, param3Current\)/.test(modelSrc))
check('afterMotionUpdate Henshin hook still attached at cold init', /internalModelEmitter\.on\('afterMotionUpdate', applyHenshin\)/.test(modelSrc))

// ---------------------------------------------------------------------------
// Runtime: real Cubism Core + real pixi-live2d-display in Node.
// (1) The .moc3 parses with NO PIXI Application and NO WebGL context —
//     the exact work the boot preload moves off the first mount.
// (2) The real Automator parks with autoUpdate:false (no shared-ticker
//     listener, shared ticker never starts) and re-enables exactly like
//     the mount does — the cold path's state.
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
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
globalThis.window = globalThis
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'node', gpu: undefined },
  configurable: true,
})
globalThis.self = globalThis
globalThis.document = { createElement: () => ({ getContext: () => null, style: {} }) }

const PIXI = await import('pixi.js')
// The component publishes the imported PIXI module globally BEFORE
// cubism4 evaluates / the model is built — mirror that exactly.
globalThis.PIXI = PIXI
const live2d = await import('pixi-live2d-display/cubism4')
const { CubismMoc, Live2DModel } = live2d
check('real pixi.js + pixi-live2d-display/cubism4 import', !!PIXI.Ticker?.shared && !!Live2DModel)

// (1) moc3 parse, timed, with no Application and no WebGL context.
const mocBytes = readFileSync(join(pub, 'nekomi/Furry.moc3'))
const t0 = performance.now()
const moc = CubismMoc.create(mocBytes)
const coreModel = moc.createModel()
const parseMs = performance.now() - t0
console.log(`INFO  real .moc3 parse (core only, no app, no WebGL): ${parseMs.toFixed(1)} ms for ${mocBytes.length} bytes`)
check('real .moc3 parses with no PIXI Application / WebGL context', !!coreModel && parseMs < 5000, `${parseMs.toFixed(1)} ms`)
check(
  'parsed model exposes the Param3 rig the stage drives',
  coreModel.getModel().parameters.ids.includes('Param3'),
)

// (2) Automator park / re-enable with the real library.
check('shared ticker not started before any model exists', PIXI.Ticker.shared.started === false)
const parked = new Live2DModel({ autoUpdate: false })
check('preloaded model is parked (automator.autoUpdate === false)', parked.automator.autoUpdate === false)
check(
  'parked model starts NO shared-ticker loop (no background update work)',
  PIXI.Ticker.shared.started === false,
)
parked.automator.autoUpdate = true
check('mount re-enable works (automator.autoUpdate === true)', parked.automator.autoUpdate === true)
check('re-enabled model runs on the shared ticker (cold path state)', PIXI.Ticker.shared.started === true)
parked.automator.autoUpdate = false
check('cancelled mount can park it again (automator.autoUpdate === false)', parked.automator.autoUpdate === false)
const cold = new Live2DModel()
check('default-constructed model auto-updates (cold path state)', cold.automator.autoUpdate === true)
try {
  cold.automator.autoUpdate = false
  parked.destroy()
  cold.destroy()
} catch {
  // Cleanup only — the checks above already ran.
}

console.log(failures === 0 ? '\nfix15-preload-probe: ALL CHECKS PASSED' : `\nfix15-preload-probe: ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
