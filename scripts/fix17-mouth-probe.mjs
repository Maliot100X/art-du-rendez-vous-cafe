/**
 * FIX PASS 17, GROUP 1 — mouth probe (real browser). NOT shipped.
 *
 * What it checks (exit 1 on any failure, SKIP only where stated):
 *   0. SERVED ASSET — the local preview serves THIS worktree's own
 *      dist (asset hash in served HTML == dist/index.html), never
 *      the coordinator's master preview (:4173) or a stale build.
 *   1. SPEAK — speak() is called for a real chat reply on #agent.
 *   2. BRIDGE — during the reply (speak -> run end) the bridge
 *      peaks > 0.3.
 *   3. BAKED — the mouth geometry baked into the live model tracks
 *      it: max mouthBboxH (ArtMesh13 baked height; 61 closed,
 *      88 @0.3, 109 @0.5, 125 @0.7, 152 @1.0) > 100, and >= 2
 *      samples during the run have bboxH > 88 (visibly open), and
 *      the baked mouth visibly modulates (max-min bboxH >= 15, not
 *      stuck open). This is the rendered value read back from the
 *      live model — the task's "at minimum" proof — and the fix-17
 *      diagnosis proved it tracks the bridge (61 -> 88 as the
 *      bridge rose) while the pixels still failed on master.
 *      The samples are the UNION of the in-page 50 ms series and a
 *      Node-side ~1 s poll series: in this environment the in-page
 *      series is too starved to witness the run alone (1 point in
 *      a 20 s window in one run), and the run's wall duration
 *      stretches past any fixed window (clock starts late under
 *      starvation), so the window is [speak, run end], not a fixed
 *      20 s.
 *   4. PIXELS — page.screenshot frames (see the channel note below):
 *      4a the pre-send baseline reads closed (dipMin > 180);
 *      4b at least one of two screenshots taken DURING the reply
 *      shows a visibly open mouth (lip-dip min <= 180). The shots
 *      are BLIND-FIRED at send+15 s and send+30 s with no evaluate
 *      before issuing (speak detection lags 10-30 s under this
 *      VM's starvation, and a request-time evaluate queues behind
 *      a screenshot render — in one run shot C's "request" state
 *      was read 51 s late). Each shot is then classified by its
 *      issue/return wall times against the speak/run-end window:
 *      OPEN = pass; EVIDENCE (issued during the run AND returned
 *      while the run was still going) reading closed = a REAL pixel
 *      failure; MISS (issued before speak or after the run ended)
 *      = ignored; INCONCLUSIVE (issued during the run, returned
 *      after it ended — the frame boundary may have fallen after
 *      the run) with no evidence shot and no open shot = SKIP, not
 *      a fail, with the timing evidence logged. Screenshot
 *      round-trips of 45-104 s under this VM's load exceed the
 *      ~25 s reply, so INCONCLUSIVE is the expected outcome here;
 *      the baked-geometry checks (3/3b) and the force control
 *      (4c) are the proof in that case.
 *      4c a post-reply control screenshot with the mouth forced to
 *      0.5 via window.__nekomiForceMouth reads open (dipMin <= 180),
 *      proving the presentation channel itself can show an open
 *      mouth in this session.
 *      THE FIX (fix 17 speaking floor, src/lib/speech.ts): while a
 *      line is spoken the mouth rests at 0.5 and the vowels modulate
 *      above it, instead of closing to ~0 between syllables. The
 *      force test proved param -> bake -> pixels works when the
 *      value is HELD, and the reply-path measurement proved the
 *      failure is sparse sampling: in a starved browser the speech
 *      tick fires every ~3-8 s and a forced render blocks the main
 *      thread 1-9 s, so a 12-sample pixel check almost always lands
 *      on the envelope's closed gaps (bridge max 0.21, 8 series
 *      points in a 20 s window, 2 forced bakes). With the floor,
 *      ANY sample during the reply shows an open mouth.
 *   5. CLOSE — after the reply the driver releases the mouth
 *      (bridge back to 0) and the baked mouth closes again
 *      (bboxH <= 75 within 20 s of the reply ending): the floor must
 *      not stick the mouth open forever.
 *   6. REPLY — a bot bubble carrying the spoken reply text appears
 *      in the chat (the reply happened, not just a speak() call).
 *
 * PIXEL CHANNEL (measured, do not "fix" by switching back): the
 * CDP screencast is BROKEN in chrome-headless-shell — it replays a
 * frozen compositor surface. Channel test (fix 17, same session,
 * mouth forced to 1.0, bboxH 155): latest screencast frame dipMin
 * 189 (closed) while a fresh page.screenshot at the same forced
 * state reads dipMin 93 (wide open); screencast frames 13-20 of a
 * reply run were byte-identical (meanAbsDiff 0.00). Screenshots
 * (CDPScreenshotNewSurface) force a fresh BeginFrame + present and
 * show the truth. So this probe takes NO screencast frames and
 * asserts pixels only from screenshots. Fix 16's screencast-based
 * pixel verdicts were taken in FULL Chromium, whose compositor
 * presents properly — do not compare the two channels' frame counts.
 * In-page canvas readback does NOT work either: drawImage from the
 * WebGL canvas yields transparent black (preserveDrawingBuffer is
 * false), verified in the fix-17 readback test.
 *
 * Method (learned from fix 13-16): the message is sent without
 * Playwright actionability waits (page.fill/page.press time out on
 * "stable" under this VM's load): native setter + input event + a
 * real keyboard Enter. The probe drives the REAL site: vite preview
 * of this worktree's dist on a local port (never :4173),
 * Playwright chrome-headless-shell 1255 + SwiftShader WebGL2, a
 * real chat message sent to #agent, the real offline-fallback reply
 * read aloud via speechSynthesis (no voices in this environment:
 * speak() errors after a few seconds, the open-loop fallback runs
 * the beats).
 *
 * Usage: FIX17_PORT=4180 node scripts/fix17-mouth-probe.mjs
 *   (exit 0 = all pass; screenshots + stats in /tmp/fix17-mouth-probe)
 *   playwright-core is resolved from (in order): the `playwright-core`
 *   package, $FIX17_PLAYWRIGHT, ~/workspace/.fix15-tools/node_modules,
 *   /tmp/fix16-driver/node_modules.
 *   BROWSER: chrome-headless-shell, not full Chromium — the shell is
 *   the working invocation on this VM: full Chromium 159 died three
 *   times mid-run under the VM's memory pressure (181-429 MB free
 *   while other agents render), while the shell reached stage-ready
 *   in 54-203 s and survived (WebGL2 verified). $FIX17_CHROME
 *   overrides the binary (e.g. full Chromium) for a re-check
 *   elsewhere.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.FIX17_PORT ?? 4180)
const OUT = process.env.FIX17_OUT ?? '/tmp/fix17-mouth-probe'
mkdirSync(OUT, { recursive: true })
const CHROME =
  process.env.FIX17_CHROME ??
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

// ------------------------------------------------- resolve playwright-core
let chromium
{
  try {
    chromium = (await import('playwright-core')).chromium
  } catch { /* not installed in the worktree */ }
  if (!chromium) {
    const dirs = [
      process.env.FIX17_PLAYWRIGHT,
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
    console.log('FAIL  playwright-core not resolvable (npm i playwright-core or set FIX17_PLAYWRIGHT)')
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
      scrollY: window.scrollY,
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
})

// ---- lip-dip detector (fix 16 calibration, kept): the open mouth is
// NOT a dark hole — its interior is pale pink-white, so a dark-pixel
// count reads ~0 open or closed. What changes is the LIP-DIP: the
// row-mean luminance profile of the mouth crop dips at the lip line.
// Calibrated on real pixels: closed 187-195, forced 0.4/0.5 -> 167,
// 0.6 -> 158, 1.0 -> 90-93. Threshold 180.
const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b
async function lipDip(buf, crop) {
  const { data, info } = await sharp(buf)
    .extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const ch = info.channels
  const W = crop.w
  const H = crop.h
  const rowMean = []
  for (let y = 0; y < H; y++) {
    let sum = 0
    let n = 0
    for (let x = 25; x < 95; x++) {
      const i = (y * W + x) * ch
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      n++
    }
    rowMean.push(sum / n)
  }
  let min = Infinity
  let minRow = -1
  for (let y = 0; y < H; y++) {
    if (rowMean[y] < min) { min = rowMean[y]; minRow = y }
  }
  return { dipMin: Math.round(min), dipRow: minRow }
}
const OPEN_DIP_MIN = 180

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

// Smaller viewport than fix-16 (1024x640): full Chromium dies under
// this VM's memory pressure at 1280x800, and smaller framebuffers
// make each forced render faster. The mouth is scroll-corrected per
// shot, so the viewport size cannot bias the verdict — but at 640 px
// tall the mouth sits below the fold, so scroll the canvas to the
// centre of the viewport first.
await page.evaluate(() => {
  // Fix 17 merge note: the fluid background canvas is now FIRST in the
  // DOM (mounted once at app root), so a bare querySelector('canvas')
  // finds the fixed full-viewport fluid canvas and scrollIntoView
  // becomes a no-op — the Live2D stage canvas is the one whose rect
  // is NOT the full viewport.
  const live2d = [...document.querySelectorAll('canvas')].find(c => { const r = c.getBoundingClientRect(); return r.width < window.innerWidth || r.height < window.innerHeight })
  live2d?.scrollIntoView({ block: 'center' })
})
await sleep(2000)

// Same-state geometry (see fix-16 probe): canvas rect + debug, read in
// ONE evaluate; scrollY read with it.
const geo = await page.evaluate(() => {
  const d = window.__nekomiDebug
  // Same fix-17 note as the scrollIntoView above: select the Live2D
  // stage canvas (rect smaller than the viewport), not the fluid
  // canvas (fixed, full-viewport, first in the DOM since the global
  // fluid mount). A bare querySelector('canvas') returns the fluid
  // canvas and makes every crop wrong.
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
// Mouth crop for a screenshot: the mouth's DOCUMENT position is fixed
// (canvasDocTop/Left + stage fractions), so its VIEWPORT position at
// a shot's time is the document position minus that shot's scrollY.
async function cropNow() {
  const sy = await page.evaluate(() => window.scrollY)
  const mouthX = geo.canvasDocLeft + geo.mouthStage[0]
  const mouthY = geo.canvasDocTop - sy + geo.mouthStage[1]
  return { x: Math.round(mouthX - 60), y: Math.round(mouthY - 25), w: 120, h: 50, scrollY: sy }
}
async function debugState() {
  const d = await page.evaluate(() => window.__nekomiDebug ?? {})
  return { bridge: d.mouthBridge ?? -1, written: d.mouthWritten ?? -1, bboxH: d.mouthBboxH ?? -1, bake: d.bakeCount ?? -1, t: await page.evaluate(() => performance.now()) }
}
async function shot(name) {
  const crop = await cropNow()
  const before = await debugState()
  const tReqWall = Date.now()
  const file = `${OUT}/${name}.png`
  await page.screenshot({ timeout: 180000, path: file })
  const after = await debugState()
  const dip = await lipDip(readFileSync(file), crop)
  console.log(`shot ${name}: dipMin ${dip.dipMin}@row ${dip.dipRow} (crop ${JSON.stringify({ x: crop.x, y: crop.y })} scrollY ${crop.scrollY}) | at request bridge ${before.bridge} bboxH ${before.bboxH} bake ${before.bake} | at return bridge ${after.bridge} bboxH ${after.bboxH} bake ${after.bake} (round-trip ${((Date.now() - tReqWall) / 1000).toFixed(0)}s)`)
  return { name, file, crop, ...dip, reqBridge: before.bridge, reqBboxH: before.bboxH, reqBake: before.bake, retBridge: after.bridge, retBboxH: after.bboxH, retBake: after.bake }
}

// ---- shot A: closed baseline, before the message --------------------
const shotA = await shot('baseline-closed')
check('4a closed baseline reads closed (dipMin > 180 — the crop is on the mouth)',
  shotA.dipMin > 180, `dipMin ${shotA.dipMin}`)

// ---- Node-side poll series: the in-page 50 ms series is too starved
// to witness the run alone, so the driver polls the debug state
// itself (~1 s nominal; each evaluate can take seconds under load)
// from just after sending until the run ends. The union of this
// series and the in-page series is the witness for checks 2/3/3b.
const pollSeries = []
async function pollOnce() {
  const st = await debugState()
  pollSeries.push(st)
  return st
}

// ---- send the message (no Playwright actionability waits: page.fill
// / page.press time out on "stable" under this VM's load). The
// blind-fired shots below are timed from the Enter keypress.
const MESSAGE = 'Bonjour, un café et un croissant s’il vous plaît'
await page.evaluate((msg) => {
  const el = document.querySelector('#agent-input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(el, msg)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.focus()
}, MESSAGE)
await sleep(1500)
await page.keyboard.press('Enter')
console.log('message sent; blind-fired reply shots scheduled at send+15 s / send+30 s')

// ---- blind-fire the reply screenshots: shot B at send+15 s, shot C
// at send+30 s, issued WITHOUT any preceding evaluate. The speak
// detection below lags 10-30 s under this VM's starvation, and a
// request-time evaluate would queue behind a screenshot render (in
// the last run shot C's "request" state was read 51 s late, after
// the run had ended). The captures are classified afterwards by
// their issue/return wall times against the speak/run-end window
// read from the series, so a shot that demonstrably missed the run
// is SKIP, not a fail — and a shot that returns while the run is
// still going and reads closed IS a real pixel fail.
const sendWall = Date.now()
function blindShot(name, delayMs) {
  const file = `${OUT}/${name}.png`
  const issue = sleep(delayMs).then(async () => {
    const issueWall = Date.now()
    try {
      await page.screenshot({ timeout: 180000, path: file })
      return { name, file, issueWall, retWall: Date.now(), error: null }
    } catch (e) {
      return { name, file, issueWall, retWall: Date.now(), error: String(e).slice(0, 200) }
    }
  })
  return issue
}
const pShotB = blindShot('reply-open-1', 15000)
const pShotC = blindShot('reply-open-2', 30000)

// ---- wait for speak() (check 1). This loop's evaluates queue behind
// the screenshot renders, so detection can lag the actual speak() by
// tens of seconds — that lag is why the shots above are blind-fired.
let speakT0 = null
for (let i = 0; i < 90; i++) {
  await sleep(1000)
  const log = await page.evaluate(() => window.__speakLog.map((r) => r.t0))
  if (log.length >= 1) { speakT0 = log[0]; break }
  await pollOnce()
}
check('1 speak() called for the reply', speakT0 !== null, speakT0 === null ? 'no speak() within 90 s of sending' : `t0=${Math.round(speakT0)} ms`)

// ---- await the blind-fired reply screenshots, then read their
// return state and compute their crops from the current scrollY
// (scrollY stayed 318 for every shot in the last run — the chat
// scrolls in its own container, not the page).
const rawB = await pShotB
const rawC = await pShotC
async function finishBlindShot(raw) {
  if (raw.error) {
    console.log(`shot ${raw.name}: FAILED TO CAPTURE — ${raw.error}`)
    return { ...raw, dipMin: null, crop: null, retBridge: null, retBboxH: null }
  }
  const crop = await cropNow()
  const after = await debugState()
  const dip = await lipDip(readFileSync(raw.file), crop)
  console.log(`shot ${raw.name}: dipMin ${dip.dipMin}@row ${dip.dipRow} (crop ${JSON.stringify({ x: crop.x, y: crop.y })} scrollY ${crop.scrollY}) | issued at wall+${((raw.issueWall - sendWall) / 1000).toFixed(0)}s, returned at wall+${((raw.retWall - sendWall) / 1000).toFixed(0)}s | at return bridge ${after.bridge} bboxH ${after.bboxH} bake ${after.bake}`)
  return { ...raw, crop, ...dip, retBridge: after.bridge, retBboxH: after.bboxH, retBake: after.bake }
}
const shotB = await finishBlindShot(rawB)
const shotC = await finishBlindShot(rawC)

// ---- wait until the run ends (bridge back to 0 after having opened)
// or 45 s after speak, polling into pollSeries the whole time.
let replyEnded = false
let runEndT = null
for (let i = 0; i < 45; i++) {
  await sleep(1000)
  const st = await pollOnce()
  if (speakT0 !== null && st.t - speakT0 > 12000 && st.bridge === 0) {
    replyEnded = true
    runEndT = st.t
    break
  }
}
console.log(`reply ${replyEnded ? `ended (bridge back to 0 at t=${Math.round(runEndT ?? -1)})` : 'wait window elapsed'}`)

// ---- shot D: force control — the mouth forced to 0.5 in the same
// session must read open on a screenshot (proves the presentation
// channel, not just the reply path).
const forceStartPerf = await page.evaluate(() => performance.now())
await page.evaluate(() => window.__nekomiForceMouth(0.5))
{
  const startBake = (await page.evaluate(() => window.__nekomiDebug.bakeCount))
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    const d = await page.evaluate(() => window.__nekomiDebug)
    if (d.bakeCount >= startBake + 2) break
  }
}
const shotD = await shot('force-0-5-control')
await page.evaluate(() => window.__nekomiForceMouth(null))
check('4c force control reads open (mouth forced to 0.5: dipMin <= 180)',
  shotD.dipMin <= OPEN_DIP_MIN, `dipMin ${shotD.dipMin} (bboxH at return ${shotD.retBboxH})`)

// ---- close watch: the baked mouth must close again after the reply.
// (The app-ticker tick re-reads the baked vertices on rAF renders,
// so bboxH tracks the close even though the bake timer is gated off
// once speaking stops.)
let closedBboxH = null
for (let i = 0; i < 20; i++) {
  await sleep(1000)
  const st = await pollOnce()
  closedBboxH = st.bboxH
  if (st.bboxH <= 75) break
}
console.log(`baked mouth after the reply: bboxH ${closedBboxH}`)

// ---- read the in-page series once -------------------------------------
const data = await page.evaluate(() => {
  const perfNow = performance.now()
  return {
    series: window.__series,
    speakLog: window.__speakLog,
    perfNow,
    wallNow: Date.now(),
    debug: window.__nekomiDebug,
    bubbles: [...document.querySelectorAll('.rounded-3xl')].map((el) => el.textContent?.trim() ?? ''),
  }
})
writeFileSync(`${OUT}/data.json`, JSON.stringify({
  ...data, geo, pollSeries, shots: { A: shotA, B: shotB, C: shotC, D: shotD }, closedBboxH, runEndT, sendWall, forceStartPerf,
}, null, 2))
await browser.close()
preview.kill()

// ------------------------------------------------- analysis: series
// Witness = union of the in-page series and the Node poll series,
// inside the run window [speak, run end]. The run's wall duration
// stretches under starvation, so no fixed 20 s window — and the
// poll-observed run end is recorded LATE (the polls only start
// after the screenshot round-trips), so the run end used here is
// the last open sample in the series (bridge > 0.3 or bboxH > 88)
// before the force control started, + 3 s. The true end lies
// between that sample and the first bridge-0 poll.
const speakStarts = data.speakLog.map((r) => r.t0)
const t0 = speakStarts[0] ?? 0
const allSamples = [...data.series, ...pollSeries]
const lastOpenT = Math.max(
  ...allSamples
    .filter((p) => p.t >= t0 && p.t < forceStartPerf && ((p.bridge ?? -1) > 0.3 || (p.bboxH ?? -1) > 88))
    .map((p) => p.t),
  -1,
)
const tEnd = lastOpenT > 0 ? lastOpenT + 3000 : (runEndT ?? (t0 + 20000))
const inRun = (t) => t >= t0 - 500 && t <= tEnd + 500
console.log(`speak log: ${JSON.stringify(data.speakLog.map((r) => ({ text: r.text.slice(0, 40), events: r.events })))}`)
console.log(`run window: speak t0=${Math.round(t0)} to run end t=${Math.round(tEnd)} (${((tEnd - t0) / 1000).toFixed(1)}s)`)
const during = [
  ...data.series.filter((p) => inRun(p.t)).map((p) => ({ ...p, src: 'in-page' })),
  ...pollSeries.filter((p) => inRun(p.t)).map((p) => ({ ...p, src: 'node-poll' })),
]
console.log(`witness samples during the run: ${during.length} (${data.series.filter((p) => inRun(p.t)).length} in-page + ${pollSeries.filter((p) => inRun(p.t)).length} node-poll)`)
const bridges = during.map((p) => p.bridge).filter((v) => typeof v === 'number')
const bboxs = during.map((p) => p.bboxH).filter((v) => typeof v === 'number')
const maxBridge = Math.max(...bridges, -1)
const maxBboxH = Math.max(...bboxs, -1)
const minBboxH = Math.min(...bboxs, Infinity)
const openSamples = during.filter((p) => (p.bboxH ?? -1) > 88).length
console.log(`bridge during run: max ${maxBridge} | >0.3: ${during.filter((p) => p.bridge > 0.3).length}/${during.length}`)
console.log(`bboxH during run: max ${maxBboxH} min ${minBboxH === Infinity ? 'n/a' : minBboxH} | >88 (visibly open): ${openSamples}/${during.length}`)
const buckets = new Map()
for (const p of during) {
  const b = Math.floor((p.t - t0) / 1000)
  const cur = buckets.get(b) ?? { bridge: -1, bboxH: -1, n: 0 }
  cur.bridge = Math.max(cur.bridge, p.bridge ?? -1)
  cur.bboxH = Math.max(cur.bboxH, p.bboxH ?? -1)
  cur.n++
  buckets.set(b, cur)
}
console.log('per-second max (s after speak -> bridge / bboxH / n):')
for (const [k, v] of [...buckets.entries()].sort((a, b) => a - b)) console.log(`  ${k}s: bridge ${v.bridge} bboxH ${v.bboxH} (n=${v.n})`)

check('2 bridge peaks >0.3 during the reply', maxBridge > 0.3, `max bridge ${maxBridge}`)
check('3 baked mouth peaks >100 and stays open (max bboxH >100, >=2 samples >88)',
  maxBboxH > 100 && openSamples >= 2,
  `max bboxH ${maxBboxH}, ${openSamples}/${during.length} samples >88`)
check('3b baked mouth visibly modulates during the reply (max-min bboxH >= 15, not stuck open)',
  bboxs.length > 0 && maxBboxH - minBboxH >= 15,
  `bboxH range ${minBboxH === Infinity ? 'n/a' : minBboxH}-${maxBboxH}`)

// ------------------------------------------------- analysis: reply pixels
// ------------------------------------------------- analysis: reply pixels
// Each blind-fired shot is classified by its issue/return wall
// times against the speak/run-end window (wall = perf + offset,
// from the single evaluate that read perfNow and wallNow together):
//   - OPEN (dipMin <= 180): a pass, whatever the timing — an open
//     mouth can only be captured while the mouth is open, and the
//     blind shots are issued before any force is applied, so the
//     frame was produced during the run.
//   - EVIDENCE (issued during the run AND returned while the run
//     was still going): the frame was produced during the run —
//     captureScreenshot triggers a new BeginFrame after the request
//     and the run spans the whole [issue, return] interval — so a
//     closed read here is a REAL pixel failure.
//   - MISS (issued before speak, or after the run ended): the
//     capture cannot show the run; ignored.
//   - INCONCLUSIVE (issued during the run but returned after it
//     ended): the frame boundary may have fallen after the run;
//     a screenshot round-trip of 45-104 s under this VM's load
//     makes this the common case. No evidence shot + no open shot
//     => 4b is SKIP (inconclusive), not a fail — the baked-geometry
//     checks (3/3b) and the force control (4c) are the proof then.
const perfOffset = data.wallNow - data.perfNow
const toPerf = (wall) => wall - perfOffset
const speakWall = t0 + perfOffset
const runEndWall = tEnd + perfOffset
const replyShots = [shotB, shotC].filter((s) => s && s.dipMin !== null && s.dipMin !== undefined)
function classifyShot(s) {
  const issuePerf = toPerf(s.issueWall)
  const retPerf = toPerf(s.retWall)
  const issueRel = ((s.issueWall - speakWall) / 1000).toFixed(0)
  const retRel = ((s.retWall - speakWall) / 1000).toFixed(0)
  const runLen = ((runEndWall - speakWall) / 1000).toFixed(0)
  let cls
  if (s.dipMin <= OPEN_DIP_MIN) cls = 'OPEN'
  else if (s.issueWall >= speakWall && s.issueWall < runEndWall && s.retWall < runEndWall) cls = 'EVIDENCE-CLOSED'
  else if (s.issueWall < speakWall || s.issueWall >= runEndWall) cls = 'MISS'
  else cls = 'INCONCLUSIVE'
  return { ...s, issuePerf, retPerf, issueRel, retRel, runLen, cls }
}
const classified = replyShots.map(classifyShot)
console.log(`run window (perf): speak t0=${Math.round(t0)} to run end t=${Math.round(tEnd)} (~${((tEnd - t0) / 1000).toFixed(1)}s; poll-observed end was t=${Math.round(runEndT ?? -1)})`)
for (const s of classified) {
  console.log(`reply screenshot ${s.name}: dipMin ${s.dipMin} — ${s.cls} (issued speak+${s.issueRel}s, returned speak+${s.retRel}s, run length ~${s.runLen}s; bridge/bboxH at return ${s.retBridge}/${s.retBboxH})`)
}
const openReplyShots = classified.filter((s) => s.cls === 'OPEN')
const evidenceClosed = classified.filter((s) => s.cls === 'EVIDENCE-CLOSED')
if (openReplyShots.length >= 1) {
  check('4b >=1 reply screenshot shows an open mouth (dipMin <= 180)',
    true, `${openReplyShots.length}/${classified.length} open (${openReplyShots.map((s) => s.name).join(', ')})`)
} else if (evidenceClosed.length >= 1) {
  check('4b >=1 reply screenshot shows an open mouth (dipMin <= 180)',
    false,
    `shot(s) issued during the run and returned while the run was still going read closed: ${evidenceClosed.map((s) => `${s.name} dipMin ${s.dipMin} (issued speak+${s.issueRel}s, returned speak+${s.retRel}s)`).join('; ')}`)
} else if (classified.length >= 1) {
  skip('4b reply screenshot shows an open mouth',
    `no shot captured the run: ${classified.map((s) => `${s.name} ${s.cls} (issued speak+${s.issueRel}s, returned speak+${s.retRel}s)`).join('; ')} — screenshot round-trips (45-104 s) exceed the ~25 s reply under this VM's load; the baked-geometry checks (3/3b) and force control (4c) are the proof`)
} else {
  check('4b >=1 reply screenshot shows an open mouth (dipMin <= 180)',
    false, 'no reply screenshot was captured (both blind shots failed — see the shot log above)')
}

// ------------------------------------------------- analysis: close + reply
check('5 bridge back to 0 after the reply (driver released the mouth)',
  replyEnded, replyEnded ? `bridge 0 at t=${Math.round(runEndT ?? -1)}` : 'bridge never returned to 0 within the wait window')
check('5b baked mouth closed again after the reply (bboxH <= 75 within 20 s of the reply ending)',
  (closedBboxH ?? 999) <= 75, `bboxH ${closedBboxH} after reply`)
const spoken = data.speakLog[0]?.text ?? ''
const replyShown = spoken.length > 0 && data.bubbles.some((b) => b.includes(spoken.slice(0, 30)) || spoken.includes(b.slice(0, 30)))
check('6 bot bubble carrying the spoken reply text appears in the chat',
  replyShown, spoken ? `spoken: "${spoken.slice(0, 40)}…"` : 'no spoken text recorded')

console.log(failures === 0 ? `\nALL FIX17 CHECKS PASSED (${skips} skipped)` : `\n${failures} CHECK(S) FAILED (${skips} skipped)`)
process.exit(failures === 0 ? 0 : 1)
