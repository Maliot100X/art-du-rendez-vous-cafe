// FIX PASS 14, GROUP C — measure the REAL Nekomi mouth in the .moc3.
// Uses the shipped Cubism Core (public/live2d/live2dcubismcore.min.js)
// in Node — pure model math, no WebGL. Answers two questions:
//  (1) AMPLITUDE: how many screen px does ParamMouthOpenY move the
//      mouth art at the site's fit scale? (mouth=0 vs 0.7 vs 1.0)
//  (2) PIPELINE: does the stage's exact write pattern (setParam AFTER
//      model.update(), vertices baked in update()) ever show the
//      viseme value on screen, or is it lost before the render?
// Run: node scripts/fix14-mouth-measure.mjs  (exit 0 = measurements done)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..'

// Emscripten core needs a browser-ish global; stub the minimum.
globalThis.document = { currentScript: null, createElement: () => ({ style: {} }), documentElement: {}, getElementsByTagName: () => [] }
globalThis.window = globalThis
globalThis.self = globalThis

const src = fs.readFileSync(path.join(root, 'public/live2d/live2dcubismcore.min.js'), 'utf8')
const mod = { exports: {} }
new Function('module', 'exports', 'require', src + ';module.exports=Live2DCubismCore;')(mod, mod.exports, (await import('node:module')).createRequire(import.meta.url))
const Core = mod.exports
// Wasm instantiation is async inside the Emscripten runtime; wait until
// a call works.
for (let i = 0; i < 100; i++) {
  try { Core.Version.csmGetVersion(); break } catch { await new Promise((r) => setTimeout(r, 50)) }
}
console.log('core version:', Core.Version.csmGetVersion(), 'moc version:', Core.Version.csmGetLatestMocVersion())

const mocBuf = fs.readFileSync(path.join(root, 'public/live2d/nekomi/Furry.moc3'))
const moc = Core.Moc.fromArrayBuffer(mocBuf.buffer.slice(mocBuf.byteOffset, mocBuf.byteOffset + mocBuf.byteLength))
if (!moc) { console.error('FAIL: moc did not load'); process.exit(1) }
console.log('moc version:', Core.Version.csmGetMocVersion(moc._ptr, mocBuf.byteLength))
const model = Core.Model.fromMoc(moc)
console.log('canvas:', JSON.stringify({ w: model.canvasinfo.CanvasWidth, h: model.canvasinfo.CanvasHeight, ppu: model.canvasinfo.PixelsPerUnit, origin: [model.canvasinfo.CanvasOriginX, model.canvasinfo.CanvasOriginY] }))

const P = model.parameters
console.log(`parameters: ${P.count}`)
const idxOf = (id) => P.ids.indexOf(id)
const mouthIdx = idxOf('ParamMouthOpenY')
const formIdx = idxOf('ParamMouthForm')
for (const id of ['ParamMouthOpenY', 'ParamMouthForm', 'Param3', 'ParamBreath']) {
  const i = idxOf(id)
  console.log(`  ${id}: idx=${i} min=${P.minimumValues[i]} default=${P.defaultValues[i]} max=${P.maximumValues[i]} current=${P.values[i]}`)
}
console.log('drawables:', model.drawables.count)
const mouthDraw = model.drawables.ids
  .map((id, i) => ({ id, i }))
  .filter((d) => /mouth|kuchi|口/i.test(d.id))
console.log('mouth drawables:', JSON.stringify(mouthDraw))
console.log('all drawable ids:', JSON.stringify(model.drawables.ids))

function bboxOf(drawableIndex) {
  const v = model.drawables.vertexPositions[drawableIndex]
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < v.length; i += 2) {
    if (v[i] < minX) minX = v[i]
    if (v[i] > maxX) maxX = v[i]
    if (v[i + 1] < minY) minY = v[i + 1]
    if (v[i + 1] > maxY) maxY = v[i + 1]
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
}
function setAllDefault() {
  for (let i = 0; i < P.count; i++) P.values[i] = P.defaultValues[i]
}
function allBboxes() {
  return model.drawables.ids.map((id, i) => ({ id, i, b: bboxOf(i) }))
}
// Which drawables does ParamMouthOpenY move at all? Diff bboxes 0 -> 1.
// CONTROL first: ParamAngleX must move drawables (validates the method);
// if the control moves nothing, the HEAP views are stale, not the rig.
function diffFor(paramId, v0, v1, label) {
  const pi = idxOf(paramId)
  setAllDefault(); P.values[pi] = v0; model.update()
  const a = allBboxes()
  setAllDefault(); P.values[pi] = v1; model.update()
  const b = allBboxes()
  console.log(`  [${label}] write-back check: set ${v1}, read back ${P.values[pi]}`)
  const moved = a.map((x, k) => {
    const c = b[k].b
    return { id: x.id, i: x.i, dcy: Math.abs(c.cy - x.b.cy), dh: Math.abs(c.h - x.b.h), dw: Math.abs(c.w - x.b.w), cy: x.b.cy, h: x.b.h, w: x.b.w, maxD: Math.max(Math.abs(c.cy - x.b.cy), Math.abs(c.h - x.b.h), Math.abs(c.w - x.b.w)) }
  }).filter((m) => m.maxD > 0.001).sort((x, y) => y.maxD - x.maxD)
  console.log(`  [${label}] drawables moved (delta > 0.001 units = 3 canvas px): ${moved.length}`)
  for (const m of moved.slice(0, 8)) console.log(`    ${m.id} (idx ${m.i}): cy=${(m.cy*3000).toFixed(0)}px h=${(m.h*3000).toFixed(0)}px w=${(m.w*3000).toFixed(0)}px | dcy=${(m.dcy*3000).toFixed(1)}px dh=${(m.dh*3000).toFixed(1)}px dw=${(m.dw*3000).toFixed(1)}px`)
  return moved
}
const control = diffFor('ParamAngleX', 0, 30, 'CONTROL ParamAngleX 0->30')
const mouthMoved = diffFor('ParamMouthOpenY', 0, 1, 'ParamMouthOpenY 0->1')
const formMoved = diffFor('ParamMouthForm', 0, 1, 'ParamMouthForm 0->1')
const moved = mouthMoved
console.log(`drawables moved by mouth 0->1 (delta > 0.001 units): ${moved.length}`)
for (const m of moved) console.log(`  ${m.id} (idx ${m.i}): cy=${(m.cy*3000).toFixed(0)}px h=${(m.h*3000).toFixed(0)}px w=${(m.w*3000).toFixed(0)}px | dcy=${(m.dcy*3000).toFixed(1)}px dh=${(m.dh*3000).toFixed(1)}px dw=${(m.dw*3000).toFixed(1)}px`)
const d = moved[0] ?? null
if (!d) {
  // No drawable is driven by ParamMouthOpenY at all. Locate the mouth
  // ART by position (face band: mouth 0.489-0.559 from canvas top ->
  // core y in [-177, +33], centre x near 0) and report it, then stop:
  // there is no amplitude to measure and no pipeline to simulate.
  setAllDefault(); model.update()
  const all = allBboxes()
  const inBand = all.filter((x) => x.b.cy > -0.06 && x.b.cy < 0.02 && Math.abs(x.b.cx) < 0.14)
    .sort((a, b) => b.b.w - a.b.w)
  console.log('\ndrawables in the mouth band (core y -200..60, |cx|<400):')
  for (const x of inBand.slice(0, 10)) console.log(`  ${x.id} (idx ${x.i}): cx=${(x.b.cx*3000).toFixed(0)}px cy=${(x.b.cy*3000).toFixed(0)}px w=${(x.b.w*3000).toFixed(0)}px h=${(x.b.h*3000).toFixed(0)}px`)
  console.log('\nCONCLUSION: ParamMouthOpenY drives NO drawable in this .moc3.')
  console.log('MEASUREMENTS DONE')
  process.exit(0)
}
console.log(`\n--- amplitude on drawable ${d.i} (${d.id}) ---`)
const results = {}
for (const mv of [0, 0.3, 0.66, 0.7, 1.0]) {
  setAllDefault()
  P.values[mouthIdx] = mv
  model.update()
  const b = bboxOf(d.i)
  results[mv] = b
  const hPx = b.h * 3000
  console.log(`  mouth=${mv.toFixed(2)} bbox h=${hPx.toFixed(1)} canvas px (w=${(b.w * 3000).toFixed(1)}px, cy=${(b.cy * 3000).toFixed(1)}px) -> on-screen h: desktop480=${(hPx * 0.238).toFixed(1)}px phone340=${(hPx * 0.168).toFixed(1)}px`)
}
const h0 = results[0].h * 3000, h07 = results[0.7].h * 3000, h10 = results[1.0].h * 3000
console.log(`  OPENING DELTA (bbox height): 0->0.7 = +${(h07 - h0).toFixed(1)} canvas px = ${((h07 - h0) * 0.238).toFixed(1)}px desktop / ${((h07 - h0) * 0.168).toFixed(1)}px phone; 0->1.0 = +${(h10 - h0).toFixed(1)} canvas px = ${((h10 - h0) * 0.238).toFixed(1)}px desktop`)

// Also: does ParamMouthForm change anything visible at open 0.7?
setAllDefault(); P.values[mouthIdx] = 0.7; P.values[formIdx] = 1.0; model.update()
console.log(`  mouth=0.7 + MouthForm=1.0: bbox h=${(bboxOf(d.i).h * 3000).toFixed(1)}px w=${(bboxOf(d.i).w * 3000).toFixed(1)}px`)

// --- (2) PIPELINE: the stage's exact write pattern, frame by frame.
// Framework CubismModel.update() per frame (pixi-live2d-display
// Cubism4InternalModel.update): motion (Idle: breath only, skipped
// here) -> saveParameters -> expression/eyeBlink/focus/breath/physics
// (none touches the mouth) -> model.update() [bakes vertices] ->
// loadParameters [restores saved values]. The stage tick then runs
// (app.ticker, NORMAL, after the Automator) and setParams the NEW
// bridge value; render draws the baked vertices. Simulate 10 frames
// of a viseme series and report the RENDERED (baked) mouth height.
console.log('\n--- pipeline: stage write pattern vs viseme series ---')
const viseme = [0, 0.25, 0.55, 0.66, 0.4, 0.15, 0.5, 0.62, 0.2, 0]
let saved = new Float32Array(P.count)
function saveParameters() { saved.set(P.values) }
function loadParameters() { P.values.set(saved) }
setAllDefault(); model.update()
for (let f = 0; f < viseme.length; f++) {
  // Automator update (shared ticker): save -> update (bake) -> load.
  saveParameters()
  model.update() // bakes vertices from P.values (last frame's write)
  loadParameters()
  const renderedH = bboxOf(d.i).h * 3000 // canvas px, what the render draws this frame
  // Stage tick (app ticker, after Automator, before render): new value.
  P.values[mouthIdx] = viseme[f]
  console.log(`  frame ${f}: bridge writes ${viseme[f].toFixed(2)} -> rendered bbox h=${renderedH.toFixed(1)} canvas px (prev frame's value: ${f === 0 ? 0 : viseme[f - 1].toFixed(2)})`)
}
// Contrast: write BEFORE update (the fix direction) — rendered = current.
console.log('--- contrast: write BEFORE model.update() ---')
setAllDefault(); model.update()
for (let f = 0; f < 4; f++) {
  saveParameters()
  P.values[mouthIdx] = viseme[f + 2]
  model.update()
  loadParameters()
  console.log(`  frame ${f}: bridge ${viseme[f + 2].toFixed(2)} -> rendered bbox h=${(bboxOf(d.i).h * 3000).toFixed(1)} canvas px`)
}
console.log('\nMEASUREMENTS DONE')
