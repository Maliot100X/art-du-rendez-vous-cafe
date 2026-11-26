/**
 * FIX PASS 19 — mouth probe (real browser, REAL SCREENSHOTS as proof).
 *
 * Why this probe exists: fix 13-18 all "passed" on the VM on
 * bridge/baked-geometry numbers, and fix 18 even passed on in-page
 * readback pixels — yet the cloud pixel check failed FIVE straight
 * times (fix 18 cloud check 06:34-06:42 CET: 32 screenshot samples
 * over ~32 s during two live replies, dark-pixel fraction 0.0% in
 * every sample, same thin closed smile; NO audio in 35 s). The
 * fix-18 during-reply pixel proof was READBACK (drawImage from the
 * canvas), never a screenshot taken during a reply — screenshots
 * were only ever used on HELD states. This probe closes that exact
 * gap: it proves the mouth opens on REAL SCREENSHOT pixels, both
 * held (forced control) and during a live reply (screenshot series).
 *
 * Checks (exit 1 on any FAIL):
 *   0. SERVED ASSET — local preview serves THIS worktree's dist.
 *   1. STAGE + SINGLE MODEL — stage ready; exactly one Live2D
 *      canvas is displayed; elementFromPoint at the mouth coords
 *      hits the Live2D canvas (no opaque overlay covers the mouth);
 *      form + Param3 recorded.
 *   2. SPEECH ENV (honest report, not gated on audio): speechSynthesis
 *      present, voices count, mute button state, speak() calls + events.
 *   3. BASELINE — closed screenshot reads closed (dipMin > 184,
 *      darkNarrow120 <= 0.005) and the readback agrees.
 *   4. FORCED-OPEN CONTROL (a) — force 1.0, screenshot, release,
 *      screenshot; the two mouth ROIs must VISIBLY DIFFER (pixel
 *      diff: mean abs diff + changed-pixel fraction reported) AND
 *      the forced shot must read open (dipMin <= 184) AND the
 *      released shot must read closed again. This is the control
 *      that proves the screenshot channel CAN see an open mouth.
 *   5. LIVE REPLY SERIES (b) — ask a question in the Agent chat,
 *      then take a series of REAL screenshots during the reply.
 *      PASS requires at least one screenshot requested while the
 *      bridge is >= 0.45 (reply speaking) to read open on pixels
 *      (dipMin <= 184 or darkNarrow120 >= 0.01) AND to differ from
 *      the closed baseline. The in-page readback ring (250 ms) is
 *      kept as the dense timeline so a closed screenshot can be
 *      attributed honestly: if the ring shows the mouth open for
 *      the whole reply while every screenshot reads closed, that
 *      is reported as SCREENSHOT-CHANNEL STALENESS (captured frames
 *      are pre/post-reply), NOT as a mouth pass — and the fix must
 *      then make the open state screenshot-catchable.
 *   6. BRIDGE/BAKED — bridge peaks >= 0.45 during the reply and the
 *      baked mouth peaks > 100 (the old fix-18 numbers, kept as a
 *      cross-check, never as proof on their own).
 *   7. CLOSE — bridge back to 0 and baked mouth <= 75 after reply.
 *   8. REPLY — a bot bubble carrying the spoken reply text appears.
 *
 * Method: vite preview of this worktree's dist on a local port
 * (never :4173), Playwright chrome-headless-shell 1255 +
 * SwiftShader WebGL2, real chat message to #agent, real
 * speechSynthesis path (0 voices here: the open-loop fallback is
 * the driver under test, per the task). Message send avoids
 * Playwright actionability waits (native setter + Enter).
 *
 * Usage: FIX19_PORT=4182 node scripts/fix19-mouth-probe.mjs
 *   (exit 0 = all pass; screenshots + stats in /tmp/fix19-mouth-probe)
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.FIX19_PORT ?? 4182)
const OUT = process.env.FIX19_OUT ?? '/tmp/fix19-mouth-probe'
mkdirSync(OUT, { recursive: true })
const CHROME =
  process.env.FIX19_CHROME ??
  `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`

let failures = 0
let skips = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const skip = (name, detail = '') => {
  console.log(`SKIP  ${name}${detail ? ` — ${detail}` : ''}`)
  skips++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let chromium
{
  try {
    chromium = (await import('playwright-core')).chromium
  } catch { /* not installed in the worktree */ }
  if (!chromium) {
    const dirs = [
      process.env.FIX19_PLAYWRIGHT,
      path.join(process.env.HOME, 'workspace/.fix15-tools/node_modules'),
      '/tmp/fix16-driver/node_modules',
    ].filter(Boolean)
    for (const dir of dirs) {
      try {
        const req = createRequire(path.join(dir, 'package.json'))
        const mod = req('playwright-core')
        if (mod?.chromium) { chromium = mod.chromium; break }
      } catch { /* next */ }
    }
  }
  if (!chromium) {
    console.log('FAIL  playwright-core not resolvable')
    process.exit(1)
  }
}
let sharp
try {
  sharp = (await import('sharp')).default
} catch {
  console.log('FAIL  sharp not resolvable (worktree node_modules)')
  process.exit(1)
}

// ------------------------------------------------- build + serve this worktree
const distIndex = readFileSync(path.join(root, 'dist/index.html'), 'utf8')
const distAsset = distIndex.match(/assets\/index-[^"']+\.js/)?.[0]
if (!distAsset) {
  console.log('FAIL  dist/index.html has no index asset — run npm run build first')
  process.exit(1)
}
const preview = spawn(
  'node_modules/vite/bin/vite.js',
  ['preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: root, stdio: 'pipe' },
)
let previewOut = ''
preview.stdout.on('data', (d) => { previewOut += d })
preview.stderr.on('data', (d) => { previewOut += d })
const base = `http://127.0.0.1:${PORT}`
try {
  let servedHtml = ''
  for (let i = 0; i < 30; i++) {
    try {
      servedHtml = await (await fetch(`${base}/`)).text()
      if (servedHtml.includes(distAsset)) break
      servedHtml = ''
    } catch { /* not up yet */ }
    await sleep(500)
  }
  check('served asset is this worktree dist', servedHtml.includes(distAsset),
    servedHtml ? `served index references ${distAsset}` : `preview did not answer on ${PORT}:\n${previewOut.slice(-500)}`)
  if (!servedHtml.includes(distAsset)) throw new Error('preview did not serve this dist')
} catch (e) {
  preview.kill()
  console.log('FAIL  preview:', String(e).slice(0, 300))
  process.exit(1)
}

// ------------------------------------------------- browser + recorders
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--force-device-scale-factor=1', '--disable-dev-shm-usage'],
})
process.on('uncaughtException', async (e) => {
  console.log('UNCAUGHT', String(e).slice(0, 300))
  try { await browser.close() } catch { /* already closed */ }
  preview.kill()
  process.exit(1)
})
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))

await page.addInitScript(() => {
  window.__series = []
  window.__speakLog = []
  setInterval(() => {
    const d = window.__nekomiDebug ?? {}
    window.__series.push({
      t: Math.round(performance.now()),
      bridge: d.mouthBridge ?? null,
      written: d.mouthWritten ?? null,
      bboxH: d.mouthBboxH ?? null,
      bake: d.bakeCount ?? null,
      speaking: window.speechSynthesis ? window.speechSynthesis.speaking : null,
      voices: window.speechSynthesis ? window.speechSynthesis.getVoices().length : null,
    })
  }, 50)
  try {
    const ss = window.speechSynthesis
    const origSpeak = ss.speak.bind(ss)
    ss.speak = (u) => {
      const rec = { text: u.text, t0: performance.now(), events: [] }
      window.__speakLog.push(rec)
      for (const ev of ['onstart', 'onend', 'onerror', 'onboundary']) {
        const orig = u[ev]
        if (typeof orig === 'function') {
          u[ev] = (...args) => {
            rec.events.push([ev, Math.round(performance.now() - rec.t0), args[0]?.error ?? args[0]?.name ?? ''])
            return orig(...args)
          }
        }
      }
      try { return origSpeak(u) } catch (e) { rec.events.push(['speak-threw', 0, String(e)]); throw e }
    }
  } catch (e) { window.__speakLog.push({ initError: String(e) }) }

  // In-page pixel ring buffer (fix 18): samples the Live2D canvas
  // mouth ROI every 250 ms via drawImage readback, read out ONCE at
  // the end — the dense during-reply timeline a screenshot series
  // cannot provide (screenshot round-trips are 25-60 s here).
  window.__rbRing = []
  window.__rbSample = () => {
    try {
      const d = window.__nekomiDebug ?? {}
      const canvas = [...document.querySelectorAll('canvas')].find(c => { const r = c.getBoundingClientRect(); return r.width < window.innerWidth || r.height < window.innerHeight })
      if (!canvas) return
      const r = canvas.getBoundingClientRect()
      const sx = canvas.width / r.width
      const sy = canvas.height / r.height
      const cx = (d.mouthScreenPx?.[0] ?? 226)
      const cy = (d.mouthScreenPx?.[1] ?? 364)
      const c2 = document.createElement('canvas')
      c2.width = 120
      c2.height = 50
      const ctx = c2.getContext('2d')
      ctx.drawImage(canvas, (cx - 60) * sx, (cy - 25) * sy, 120 * sx, 50 * sy, 0, 0, 120, 50)
      const { data } = ctx.getImageData(0, 0, 120, 50)
      const lum = (i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      let nonZero = 0
      const rowMean = []
      for (let y = 0; y < 50; y++) {
        let s = 0
        for (let x = 25; x < 95; x++) s += lum((y * 120 + x) * 4)
        rowMean.push(s / 70)
      }
      let dipMin = Infinity
      for (const v of rowMean) if (v < dipMin) dipMin = v
      let lt120 = 0
      for (let y = 13; y < 37; y++) for (let x = 30; x < 90; x++) {
        if (lum((y * 120 + x) * 4) < 120) lt120++
      }
      for (let i = 0; i < 120 * 50; i++) if (data[i * 4 + 3] > 0) nonZero++
      window.__rbRing.push({
        t: Math.round(performance.now()),
        nonZeroPx: nonZero,
        dipMin: Math.round(dipMin),
        darkNarrow120: +(lt120 / 1440).toFixed(4),
        bridge: d.mouthBridge ?? -1,
        bboxH: d.mouthBboxH ?? -1,
        bake: d.bakeCount ?? -1,
        speakT0: (window.__speakLog ?? [])[0]?.t0 ?? null,
      })
      if (window.__rbRing.length > 1200) window.__rbRing.splice(0, window.__rbRing.length - 1200)
    } catch (e) { /* never break the page */ }
  }
  setInterval(() => window.__rbSample(), 250)
})

// ---- lip-dip + dark-fraction on a screenshot mouth crop (fix 16/18
// calibration: closed dipMin 187-198, forced 0.5 -> 160-181; closed
// darkNarrow120 0.0000, forced 0.5 -> 0.0146-0.029).
const READBACK_DIP_OPEN = 182
const SHOT_DIP_OPEN = 184
async function lipDip(buf, crop) {
  const { data, info } = await sharp(buf)
    .extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const ch = info.channels
  const W = crop.w
  const H = crop.h
  const lum = (i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
  const rowMean = []
  for (let y = 0; y < H; y++) {
    let sum = 0
    let n = 0
    for (let x = 25; x < 95; x++) { sum += lum((y * W + x) * ch); n++ }
    rowMean.push(sum / n)
  }
  let min = Infinity
  let minRow = -1
  for (let y = 0; y < H; y++) {
    if (rowMean[y] < min) { min = rowMean[y]; minRow = y }
  }
  let darkNarrow120 = 0
  let reddish = 0
  for (let y = 13; y < 37; y++) for (let x = 30; x < 90; x++) {
    if (lum((y * W + x) * ch) < 120) darkNarrow120++
  }
  for (let i = 0; i < W * H; i++) {
    if (data[i * ch] > 90 && data[i * ch] > data[i * ch + 1] + 25 && data[i * ch] > data[i * ch + 2] + 25) reddish++
  }
  return {
    dipMin: Math.round(min), dipRow: minRow,
    darkNarrow120: +(darkNarrow120 / 1440).toFixed(4),
    reddishFrac: +(reddish / (W * H)).toFixed(4),
  }
}

// ---- pixel-diff between two screenshot mouth crops: the forced-open
// control's proof that the mouth region VISIBLY differs. Mean abs
// per-channel diff + fraction of pixels whose luminance moved > 12.
async function cropDiff(bufA, bufB, crop) {
  const a = await sharp(bufA).extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h }).raw().toBuffer({ resolveWithObject: true })
  const b = await sharp(bufB).extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h }).raw().toBuffer({ resolveWithObject: true })
  const ch = a.info.channels
  const n = crop.w * crop.h
  let sumAbs = 0
  let changed = 0
  for (let i = 0; i < n; i++) {
    const la = 0.2126 * a.data[i * ch] + 0.7152 * a.data[i * ch + 1] + 0.0722 * a.data[i * ch + 2]
    const lb = 0.2126 * b.data[i * ch] + 0.7152 * b.data[i * ch + 1] + 0.0722 * b.data[i * ch + 2]
    const d = Math.abs(la - lb)
    sumAbs += d
    if (d > 12) changed++
  }
  return { meanAbsDiff: +(sumAbs / n).toFixed(2), changedFrac: +(changed / n).toFixed(4) }
}

const tRun0 = Date.now()
console.log(`loading ${base}/#agent …`)
await page.goto(`${base}/#agent`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForFunction(() => !!document.querySelector('#agent-input'), null, { timeout: 120000, polling: 500 })
await page.waitForFunction(
  () => window.__nekomiDebug?.status === 'ready' || window.__nekomiDebug?.status === 'failed',
  null, { timeout: 300000, polling: 1000 },
)
const debug0 = await page.evaluate(() => window.__nekomiDebug)
console.log('stage:', JSON.stringify(debug0), `(loaded in ${((Date.now() - tRun0) / 1000).toFixed(0)}s)`)
check('stage ready (not failed)', debug0?.status === 'ready', `status=${debug0?.status} error=${debug0?.error ?? ''}`)
if (debug0?.status !== 'ready') {
  await browser.close()
  preview.kill()
  process.exit(1)
}
console.log('speechSynthesis present:', await page.evaluate(() => 'speechSynthesis' in window),
  '| voices at load:', await page.evaluate(() => window.speechSynthesis.getVoices().length),
  '| mute pressed:', await page.evaluate(() => document.querySelector('[aria-label="Couper la voix"]')?.getAttribute('aria-pressed') ?? 'n/a'))

await page.evaluate(() => {
  const live2d = [...document.querySelectorAll('canvas')].find(c => { const r = c.getBoundingClientRect(); return r.width < window.innerWidth || r.height < window.innerHeight })
  live2d?.scrollIntoView({ block: 'center' })
})
await sleep(2000)

// ---- check 1: one displayed Live2D canvas, mouth not covered ------
// NOTE (fix-19 run 1 lesson): this MUST run AFTER scrollIntoView —
// at load the model sits below the fold (mouth doc-Y ~762 in a 640
// viewport), so elementFromPoint at the mouth returns null before
// the scroll, which is a probe artifact, not a covered mouth.
const canvasInfo = await page.evaluate(() => {
  const d = window.__nekomiDebug ?? {}
  const all = [...document.querySelectorAll('canvas')].map((c) => {
    const r = c.getBoundingClientRect()
    const cs = getComputedStyle(c)
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), display: cs.display, opacity: cs.opacity, visibility: cs.visibility }
  })
  const live = [...document.querySelectorAll('canvas')].filter(c => { const r = c.getBoundingClientRect(); return r.width < window.innerWidth || r.height < window.innerHeight })
  const mouthX = (d.mouthScreenPx?.[0] ?? 0) + (live[0]?.getBoundingClientRect().x ?? 0)
  const mouthY = (d.mouthScreenPx?.[1] ?? 0) + (live[0]?.getBoundingClientRect().y ?? 0)
  const hit = document.elementFromPoint(mouthX, mouthY)
  let hitChain = []
  let el = hit
  while (el && hitChain.length < 6) { hitChain.push(`${el.tagName}${el.id ? `#${el.id}` : ''}.${(el.className?.baseVal ?? el.className ?? '').toString().split(' ')[0] ?? ''}`); el = el.parentElement }
  return {
    canvasCount: all.length, canvases: all, liveCount: live.length,
    mouthClient: [Math.round(mouthX), Math.round(mouthY)],
    hitChain, hitIsLiveCanvas: hit === live[0],
    form: d.form, param3: d.param3,
  }
})
console.log('canvases:', JSON.stringify(canvasInfo))
check('1 exactly one Live2D canvas displayed', canvasInfo.liveCount === 1, `live canvases=${canvasInfo.liveCount} total=${canvasInfo.canvasCount}`)
check('1b elementFromPoint at the mouth hits the Live2D canvas (nothing opaque covers the mouth)',
  canvasInfo.hitIsLiveCanvas, `hit chain: ${canvasInfo.hitChain.join(' < ')}`)

const geo = await page.evaluate(() => {
  const d = window.__nekomiDebug
  const canvas = [...document.querySelectorAll('canvas')].find(c => { const r = c.getBoundingClientRect(); return r.width < window.innerWidth || r.height < window.innerHeight })
  const r = canvas?.getBoundingClientRect()
  return {
    canvasRect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
    scrollY: window.scrollY,
    canvasDocTop: r ? r.y + window.scrollY : null,
    canvasDocLeft: r ? r.x + window.scrollX : null,
    stageW: d.stageW,
    stageH: d.stageH,
    scale: d.scale,
    bounds: d.bounds,
    mouthStage: d.mouthScreenPx,
  }
})
console.log('geo:', JSON.stringify(geo))
async function cropNow() {
  const sy = await page.evaluate(() => window.scrollY)
  const mouthX = geo.canvasDocLeft + geo.mouthStage[0]
  const mouthY = geo.canvasDocTop - sy + geo.mouthStage[1]
  return { x: Math.round(mouthX - 60), y: Math.round(mouthY - 25), w: 120, h: 50, scrollY: sy }
}
async function debugState() {
  const d = await page.evaluate(() => window.__nekomiDebug ?? {})
  return { bridge: d.mouthBridge ?? -1, written: d.mouthWritten ?? -1, bboxH: d.mouthBboxH ?? -1, bake: d.bakeCount ?? -1, form: d.form ?? '?', param3: d.param3 ?? -1 }
}
async function shot(name) {
  const crop = await cropNow()
  const before = await debugState()
  const tReqWall = Date.now()
  const tReqPerf = await page.evaluate(() => performance.now()).catch(() => -1)
  const file = `${OUT}/${name}.png`
  await page.screenshot({ timeout: 240000, path: file })
  const after = await debugState()
  const dip = await lipDip(readFileSync(file), crop)
  console.log(`shot ${name}: dipMin ${dip.dipMin}@row ${dip.dipRow} darkNarrow120 ${dip.darkNarrow120} reddish ${dip.reddishFrac} (crop ${JSON.stringify({ x: crop.x, y: crop.y })} scrollY ${crop.scrollY}) | at request bridge ${before.bridge} bboxH ${before.bboxH} bake ${before.bake} | at return bridge ${after.bridge} bboxH ${after.bboxH} bake ${after.bake} (round-trip ${((Date.now() - tReqWall) / 1000).toFixed(0)}s)`)
  return { name, file, crop, ...dip, reqBridge: before.bridge, reqBboxH: before.bboxH, reqBake: before.bake, retBridge: after.bridge, retBboxH: after.bboxH, retBake: after.bake, reqWall: tReqWall, reqPerf: tReqPerf }
}

// ---- fastShot: for the live-reply series. A pre-shot evaluate
// round-trip costs seconds under SwiftShader — long enough for the
// ~12 s reply to end before the screenshot is even requested — so
// this fires the screenshot IMMEDIATELY with the last known crop
// (the page does not scroll during the reply: the chat list scrolls
// internally) and reads the debug state only AFTER it returns. The
// bridge at request time is recovered afterwards from the in-page
// series timeline via the wall->perf anchor (sendWall/sendPerf).
async function fastShot(name) {
  const sy = geo.scrollY // page scroll does not move during the reply
  const crop = {
    x: Math.round(geo.canvasDocLeft + geo.mouthStage[0] - 60),
    y: Math.round(geo.canvasDocTop - sy + geo.mouthStage[1] - 25),
    w: 120, h: 50, scrollY: sy,
  }
  const tReqWall = Date.now()
  // The perf time of the request is recovered in the analysis from
  // the in-page send anchor (data.sendPerf/sendWall) — no Node
  // evaluate runs before the shot (run 3 lesson: two anchor-read
  // evaluates delayed the first live shot to t+11.4s after speak).
  const tReqPerf = -1
  const file = `${OUT}/${name}.png`
  await page.screenshot({ timeout: 240000, path: file })
  const after = await debugState()
  const dip = await lipDip(readFileSync(file), crop)
  console.log(`shot ${name}: dipMin ${dip.dipMin}@row ${dip.dipRow} darkNarrow120 ${dip.darkNarrow120} reddish ${dip.reddishFrac} (crop ${JSON.stringify({ x: crop.x, y: crop.y })} scrollY ${crop.scrollY}) | at return bridge ${after.bridge} bboxH ${after.bboxH} bake ${after.bake} (round-trip ${((Date.now() - tReqWall) / 1000).toFixed(0)}s; request perf ~${Math.round(tReqPerf)})`)
  return { name, file, crop, ...dip, reqBridge: -1, reqBboxH: -1, reqBake: -1, retBridge: after.bridge, retBboxH: after.bboxH, retBake: after.bake, reqWall: tReqWall, reqPerf: tReqPerf, fast: true }
}

// ---- baseline closed screenshot ------------------------------------
const shotA = await shot('baseline-closed')
check('3 baseline screenshot reads closed (dipMin > 184, darkNarrow120 <= 0.005)',
  shotA.dipMin > SHOT_DIP_OPEN && shotA.darkNarrow120 <= 0.005,
  `dipMin ${shotA.dipMin} darkNarrow120 ${shotA.darkNarrow120}`)

// ---- check 4: FORCED-OPEN CONTROL (a) ------------------------------
// Force 1.0 (the largest opening — if screenshots cannot see THIS,
// the channel is blind), wait for 2 forced bakes, screenshot;
// release, wait for the baked mouth to close, screenshot again;
// pixel-diff the two mouth ROIs.
await page.evaluate(() => window.__nekomiForceMouth(1.0))
{
  const startBake = (await page.evaluate(() => window.__nekomiDebug.bakeCount))
  for (let i = 0; i < 90; i++) {
    await sleep(1000)
    const d = await page.evaluate(() => window.__nekomiDebug)
    if (d.bakeCount >= startBake + 2 && d.mouthBboxH > 100) break
  }
}
const forceState = await debugState()
console.log(`forced state before control shot: bridge ${forceState.bridge} bboxH ${forceState.bboxH} bake ${forceState.bake}`)
const shotF1 = await shot('force-1-0-open')
await page.evaluate(() => window.__nekomiForceMouth(null))
{
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    const d = await page.evaluate(() => window.__nekomiDebug)
    if (d.mouthBboxH <= 75) break
  }
}
const shotF0 = await shot('force-released-closed')
const forceDiff = await cropDiff(readFileSync(shotF1.file), readFileSync(shotF0.file), shotF1.crop)
console.log(`forced-open pixel diff (open vs released, mouth ROI 120x50): meanAbsDiff ${forceDiff.meanAbsDiff} changedFrac(>12) ${forceDiff.changedFrac}`)
check('4a forced-open screenshot reads open (dipMin <= 184)',
  shotF1.dipMin <= SHOT_DIP_OPEN, `dipMin ${shotF1.dipMin} (bboxH at return ${shotF1.retBboxH})`)
check('4b forced-open vs released screenshots VISIBLY DIFFER on pixels (meanAbsDiff > 2, changedFrac > 0.02)',
  forceDiff.meanAbsDiff > 2 && forceDiff.changedFrac > 0.02,
  `meanAbsDiff ${forceDiff.meanAbsDiff} changedFrac ${forceDiff.changedFrac}`)
check('4c released screenshot reads closed again (dipMin > 184)',
  shotF0.dipMin > SHOT_DIP_OPEN, `dipMin ${shotF0.dipMin}`)

// ---- check 5/6: LIVE REPLY SERIES (b) ------------------------------
// Send the message, then take a series of REAL screenshots during
// the reply. The first screenshot is requested as soon as the reply
// starts speaking (polled from Node — each poll costs seconds under
// SwiftShader, so ALSO fire on a timer: request shot S1 ~4 s after
// send, when the offline reply is already speaking). Each shot
// records bridge/bboxH at request and at return, so its captured
// frame can be placed against the in-page timeline afterwards.
const MESSAGE = 'Bonjour, un café et un croissant s’il vous plaît'
await page.evaluate((msg) => {
  const el = document.querySelector('#agent-input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(el, msg)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.focus()
  // Fix-19 run 2 lesson: stashing the anchor in-page at send time
  // (not via a post-Enter evaluate round-trip, which inflates it by
  // seconds under SwiftShader) so fastShot request times are exact.
  window.__sendPerf = performance.now()
  window.__sendWall = Date.now()
}, MESSAGE)
await sleep(1500)
await page.keyboard.press('Enter')
// No anchor-read evaluates here (run 3 lesson): the in-page anchor
// (window.__sendPerf/__sendWall, stashed at send time) is read back
// in the final data evaluate, and fastShot request times are
// recovered from it in the analysis. Any evaluate before the first
// live shot delays it by seconds under SwiftShader.
console.log('message sent')

const liveShots = []
// S1: requested ~2 s after send (reply speaking by then — the
// offline reply lands in 1-3 s and speaks ~12 s + 3 s ramp).
// fastShot fires immediately: no pre-shot evaluate round-trips.
await sleep(2000)
liveShots.push(await fastShot('live-reply-1'))
// S2, S3: back-to-back after S1 returns (each round-trip is long;
// the request time is what matters — the captured frame is the one
// the compositor produces for the request).
liveShots.push(await fastShot('live-reply-2'))
liveShots.push(await fastShot('live-reply-3'))
// S4: after the reply has ended + the mouth has closed (control).
{
  for (let i = 0; i < 40; i++) {
    await sleep(1000)
    const d = await page.evaluate(() => window.__nekomiDebug)
    if (d.mouthBridge === 0 && d.mouthBboxH <= 75) break
  }
}
liveShots.push(await shot('live-reply-4-after'))

// ---- read the in-page series + speak log once ----------------------
const data = await page.evaluate(() => {
  return {
    series: window.__series,
    speakLog: window.__speakLog,
    rbRing: window.__rbRing ?? [],
    sendPerf: window.__sendPerf ?? null,
    sendWall: window.__sendWall ?? null,
    perfNow: performance.now(),
    wallNow: Date.now(),
    debug: window.__nekomiDebug,
    bubbles: [...document.querySelectorAll('.rounded-3xl')].map((el) => el.textContent?.trim() ?? ''),
  }
})
writeFileSync(`${OUT}/data.json`, JSON.stringify({
  ...data, geo, canvasInfo, shots: { A: shotA, F1: shotF1, F0: shotF0, live: liveShots }, forceDiff,
}, null, 2))
await browser.close()
preview.kill()

// ------------------------------------------------- analysis: audio (check 2)
console.log('\n=== AUDIO (honest report) ===')
console.log(`speak log: ${JSON.stringify(data.speakLog.map((r) => ({ text: r.text.slice(0, 40), events: r.events })))}`)
const voicesSeen = new Set([...data.series.map((p) => p.voices), ...data.rbRing.map((p) => p.voices)].filter((v) => typeof v === 'number'))
const speakingSamples = data.series.filter((p) => p.speaking === true).length
const audioPlayed = data.speakLog.some((r) => r.events.some(([ev]) => ev === 'onstart')) && speakingSamples > 5
console.log(`voices seen: ${[...voicesSeen].join(',') || 'none recorded'} | synth.speaking=true samples: ${speakingSamples}/${data.series.length} | onstart fired: ${data.speakLog.some((r) => r.events.some(([ev]) => ev === 'onstart'))}`)
console.log(audioPlayed
  ? 'AUDIO: PLAYING — onstart fired and speechSynthesis.speaking held.'
  : `AUDIO: SILENT — 0 voices in this environment, utterance errored (onerror at +${data.speakLog[0]?.events?.find(([ev]) => ev === 'onerror')?.[1] ?? '?'} ms); the mouth is driven by the open-loop fallback.`)
check('2 audio state reported honestly (voices + utterance events recorded)',
  data.speakLog.length >= 1 && data.speakLog[0]?.events !== undefined,
  audioPlayed ? 'PLAYING' : 'SILENT (0 voices — open-loop mouth)')

// ------------------------------------------------- analysis: speak / bridge / baked
const t0 = data.speakLog[0]?.t0 ?? 0
check('speak() called for the reply', data.speakLog.length >= 1,
  data.speakLog.length === 0 ? 'no speak() detected' : `t0=${Math.round(t0)} ms`)
// Run end: first bridge==0 in the series after the mouth opened.
const tlPts = [
  ...data.series.map((p) => ({ t: p.t, bridge: p.bridge })),
  ...(data.rbRing ?? []).map((p) => ({ t: p.t, bridge: p.bridge })),
].filter((p) => typeof p.t === 'number' && typeof p.bridge === 'number' && p.bridge >= 0 && p.t >= t0)
const openTs = tlPts.filter((p) => p.bridge >= 0.45).map((p) => p.t)
const firstOpenT = openTs.length ? Math.min(...openTs) : null
const releasedTs = firstOpenT !== null
  ? tlPts.filter((p) => p.t > Math.max(t0 + 10000, firstOpenT) && p.bridge === 0).map((p) => p.t)
  : []
const releasedT = releasedTs.length ? Math.min(...releasedTs) : null
const tEnd = releasedT ?? (t0 + 20000)
const inRun = (t) => t >= t0 - 500 && t <= tEnd + 2000
const duringSeries = data.series.filter((p) => inRun(p.t))
const duringRing = (data.rbRing ?? []).filter((p) => inRun(p.t))
const allDuring = [...duringSeries, ...duringRing]
const bridges = allDuring.map((p) => p.bridge).filter((v) => typeof v === 'number' && v >= 0)
const bboxs = allDuring.map((p) => p.bboxH).filter((v) => typeof v === 'number' && v >= 0)
const maxBridge = Math.max(...bridges, -1)
const maxBboxH = Math.max(...bboxs, -1)
const minBboxH = Math.min(...bboxs, Infinity)
console.log(`\nrun window: speak t0=${Math.round(t0)} to release t=${Math.round(tEnd)} (${((tEnd - t0) / 1000).toFixed(1)}s)`)
console.log(`witness samples during the run: ${allDuring.length} (${duringSeries.length} series + ${duringRing.length} ring)`)
console.log(`bridge during run: max ${maxBridge} | >=0.45: ${allDuring.filter((p) => p.bridge >= 0.45).length}/${allDuring.length}`)
console.log(`bboxH during run: max ${maxBboxH} min ${minBboxH === Infinity ? 'n/a' : minBboxH}`)
check('6 bridge peaks >= 0.45 during the reply (synchronous floor)', maxBridge >= 0.45, `max bridge ${maxBridge}`)
check('6b baked mouth peaks > 100 during the reply', maxBboxH > 100, `max bboxH ${maxBboxH}`)

// ---- ring pixels during the run (dense truth, fix 18 channel) ------
const duringPx = duringRing
const runDark = duringPx.map((p) => p.darkNarrow120 ?? -1).filter((v) => v >= 0)
const runDip = duringPx.map((p) => p.dipMin ?? 999).filter((v) => v < 999)
const maxDark = Math.max(...runDark, -1)
const minDip = Math.min(...runDip, 999)
console.log(`ring pixels during run: ${duringPx.length} samples | darkNarrow120 max ${maxDark} | dipMin min ${minDip === 999 ? 'n/a' : minDip} (baseline closed: dark ${shotA.darkNarrow120} dipMin ${shotA.dipMin})`)

// ------------------------------------------------- analysis: live screenshots (check 5)
console.log('\n=== LIVE-REPLY SCREENSHOTS (the fix-19 proof) ===')
// A live shot counts as "requested during the reply" when the
// bridge was >= 0.45 at request time. For fast shots the bridge at
// request is recovered from the in-page series timeline (nearest
// sample to the request's perf time); for slow shots the pre-shot
// evaluate is used directly.
function bridgeAtPerf(perf) {
  let best = null
  let bestDt = Infinity
  for (const p of [...data.series, ...(data.rbRing ?? [])]) {
    if (typeof p.bridge !== 'number' || p.bridge < 0) continue
    const dt = Math.abs(p.t - perf)
    if (dt < bestDt) { bestDt = dt; best = p.bridge }
  }
  return bestDt <= 3000 ? best : null
}
for (const s of liveShots) {
  // Fast shots recorded only reqWall live; recover the request's
  // perf time from the in-page send anchor read back in `data`.
  if ((s.reqPerf ?? -1) < 0 && data.sendPerf !== null && data.sendWall !== null) {
    s.reqPerf = data.sendPerf + (s.reqWall - data.sendWall)
  }
  s.bridgeAtRequest = s.reqBridge >= 0 ? s.reqBridge : bridgeAtPerf(s.reqPerf ?? -1)
  const reqRelSpeak = (s.reqPerf ?? -1) >= 0 && t0 ? ((s.reqPerf - t0) / 1000).toFixed(1) : '?'
  const open = s.dipMin <= SHOT_DIP_OPEN || s.darkNarrow120 >= 0.01
  console.log(`  ${s.name}: requested t+${reqRelSpeak}s after speak (bridge at request ${s.bridgeAtRequest}, at return ${s.retBridge}) — dipMin ${s.dipMin} darkNarrow120 ${s.darkNarrow120} -> ${open ? 'OPEN' : 'closed'}`)
}
const midReplyShots = liveShots.filter((s) => (s.bridgeAtRequest ?? -1) >= 0.45)
const midReplyOpen = midReplyShots.filter((s) => s.dipMin <= SHOT_DIP_OPEN || s.darkNarrow120 >= 0.01)
console.log(`screenshots requested while bridge >= 0.45: ${midReplyShots.length} (${midReplyShots.map((s) => s.name).join(', ') || 'none'}); of those reading OPEN on pixels: ${midReplyOpen.length}`)
let liveDiff = null
if (midReplyOpen.length > 0) {
  liveDiff = await cropDiff(readFileSync(midReplyOpen[0].file), readFileSync(shotA.file), midReplyOpen[0].crop)
  console.log(`pixel diff (mid-reply OPEN shot vs closed baseline): meanAbsDiff ${liveDiff.meanAbsDiff} changedFrac ${liveDiff.changedFrac}`)
}
check('5 live reply: at least one screenshot requested while the mouth was open reads OPEN on real pixels',
  midReplyOpen.length >= 1,
  midReplyOpen.length > 0
    ? `${midReplyOpen.map((s) => s.name).join(', ')} read open (dipMin ${midReplyOpen.map((s) => s.dipMin).join('/')})`
    : (midReplyShots.length === 0
      ? 'NO screenshot was even requested while bridge >= 0.45 — the series missed the reply window entirely'
      : `screenshots requested mid-reply (${midReplyShots.map((s) => s.name).join(', ')}) all read CLOSED on pixels while the ring measured dark max ${maxDark} / dip min ${minDip === 999 ? 'n/a' : minDip} during the run — SCREENSHOT-CHANNEL STALENESS, not a mouth pass`))
if (midReplyOpen.length > 0) {
  check('5b that open live shot visibly differs from the closed baseline (meanAbsDiff > 2, changedFrac > 0.02)',
    liveDiff.meanAbsDiff > 2 && liveDiff.changedFrac > 0.02,
    `meanAbsDiff ${liveDiff.meanAbsDiff} changedFrac ${liveDiff.changedFrac}`)
} else {
  skip('5b open-live-shot pixel diff (no open live shot)')
}

// ------------------------------------------------- analysis: close + reply
const closedBboxH = data.debug?.mouthBboxH ?? -1
check('7 bridge back to 0 after the reply (driver released the mouth)',
  releasedT !== null, releasedT !== null ? `bridge 0 at t+${((releasedT - t0) / 1000).toFixed(1)}s` : 'bridge never returned to 0 in the recorded timeline')
check('7b baked mouth closed again after the reply (bboxH <= 75)',
  closedBboxH <= 75, `bboxH ${closedBboxH} at end`)
const spoken = data.speakLog[0]?.text ?? ''
const replyShown = spoken.length > 0 && data.bubbles.some((b) => b.includes(spoken.slice(0, 30)) || spoken.includes(b.slice(0, 30)))
check('8 bot bubble carrying the spoken reply text appears in the chat',
  replyShown, spoken ? `spoken: "${spoken.slice(0, 40)}…"` : 'no spoken text recorded')

console.log(failures === 0 ? `\nALL FIX19 CHECKS PASSED (${skips} skipped)` : `\n${failures} CHECK(S) FAILED (${skips} skipped)`)
process.exit(failures === 0 ? 0 : 1)
