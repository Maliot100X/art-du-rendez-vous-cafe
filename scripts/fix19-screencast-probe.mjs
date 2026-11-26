/**
 * FIX PASS 19, RUN 2 — screencast + clipped-screenshot diagnostic.
 *
 * Run 1's result that this run discriminates:
 *   - Forced held-open mouth: REAL full-page screenshots show it OPEN
 *     (dipMin 94, dark 0.122, pixel diff 8.31 vs closed). The
 *     screenshot channel CAN see an open mouth.
 *   - Live reply: bridge max 0.66, bboxH max 126, ring pixels open
 *     (dark max 0.0201, dip min 165) — the mouth WAS open during the
 *     reply on the canvas/readback channel.
 *   - But the ONE full-page screenshot requested mid-reply (bridge
 *     0.52 at request) read CLOSED (dipMin 190, dark 0), round-trip
 *     8 s, reply window only 10.6 s.
 *
 * Two mechanisms fit run 1:
 *   (A) CAPTURE LAG: a screenshot captures the state at ~return time
 *       (raster under SwiftShader takes seconds), so a mid-reply
 *       request returns a post-reply frame. Presented frames are fine.
 *   (B) PRESENTED STALE: the compositor's presented frames lag the
 *       baked state by seconds, so even a request-time presented
 *       frame is closed. A real presentation bug.
 * Run 1 could not separate them (its request-time anchor had a
 * multi-second evaluate uncertainty).
 *
 * This run measures both, with exact anchors:
 *   - CDP SCREENCast: genuinely PRESENTED frames, timestamped, during
 *     the reply. If any frame inside the open window reads OPEN,
 *     presented pixels are fine and (A) is the story.
 *   - CLIPPED mouth-ROI screenshots (120x50 clip): the fast sampler.
 *     If a clip requested mid-reply reads OPEN, a fast sampler CAN
 *     catch the natural reply window — and the cloud's 0/32 would
 *     then point at the cloud's own sampler/ROI, not at the mouth.
 *   - Exact anchors: window.__sendPerf/__sendWall stashed in-page
 *     at send time (no Node round-trip error), and one post-run
 *     evaluate giving {perf, wall} to convert every timestamp onto
 *     the performance.now() timeline (speak t0, ring, series).
 *
 * RUN 4 (post-fix): the clipped screenshots are REMOVED (run 2
 * showed a 120x50 clip still takes 28-102 s here — the same slow
 * capture path, and they starved the screencast). This run is
 * screencast-only, validating the fix-19 Form-cap + release ramp:
 * pre-fix, presented frames read OPEN only for the first ~6 s of a
 * reply and then closed as the smile eased in; post-fix they should
 * read OPEN for the whole reply + ramp.
 *
 * Usage: FIX19_PORT=4183 node scripts/fix19-screencast-probe.mjs
 *   (screenshots + screencast frames in /tmp/fix19-screencast)
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.FIX19_PORT ?? 4183)
const OUT = process.env.FIX19_OUT ?? '/tmp/fix19-screencast'
mkdirSync(OUT, { recursive: true })
mkdirSync(`${OUT}/frames`, { recursive: true })
const CHROME =
  process.env.FIX19_CHROME ??
  `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let chromium
{
  try { chromium = (await import('playwright-core')).chromium } catch { /* fallback below */ }
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
  if (!chromium) { console.log('FAIL  playwright-core not resolvable'); process.exit(1) }
}
let sharp
try { sharp = (await import('sharp')).default } catch {
  console.log('FAIL  sharp not resolvable'); process.exit(1)
}

const distIndex = readFileSync(path.join(root, 'dist/index.html'), 'utf8')
const distAsset = distIndex.match(/assets\/index-[^"']+\.js/)?.[0]
if (!distAsset) { console.log('FAIL  dist/index.html has no index asset — run npm run build first'); process.exit(1) }
const preview = spawn('node_modules/vite/bin/vite.js',
  ['preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: root, stdio: 'pipe' })
let previewOut = ''
preview.stdout.on('data', (d) => { previewOut += d })
preview.stderr.on('data', (d) => { previewOut += d })
const base = `http://127.0.0.1:${PORT}`
let servedHtml = ''
for (let i = 0; i < 30; i++) {
  try {
    servedHtml = await (await fetch(`${base}/`)).text()
    if (servedHtml.includes(distAsset)) break
    servedHtml = ''
  } catch { /* not up yet */ }
  await sleep(500)
}
console.log(servedHtml.includes(distAsset) ? 'PASS  served asset is this worktree dist' : 'FAIL  preview did not serve this dist')
if (!servedHtml.includes(distAsset)) { preview.kill(); process.exit(1) }

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
      bboxH: d.mouthBboxH ?? null,
      bake: d.bakeCount ?? null,
    })
  }, 50)
  try {
    const ss = window.speechSynthesis
    const origSpeak = ss.speak.bind(ss)
    ss.speak = (u) => {
      const rec = { text: u.text, t0: performance.now(), events: [] }
      window.__speakLog.push(rec)
      for (const ev of ['onstart', 'onend', 'onerror']) {
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
      c2.width = 120; c2.height = 50
      const ctx = c2.getContext('2d')
      ctx.drawImage(canvas, (cx - 60) * sx, (cy - 25) * sy, 120 * sx, 50 * sy, 0, 0, 120, 50)
      const { data } = ctx.getImageData(0, 0, 120, 50)
      const lum = (i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
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
      window.__rbRing.push({
        t: Math.round(performance.now()),
        dipMin: Math.round(dipMin),
        darkNarrow120: +(lt120 / 1440).toFixed(4),
        bridge: d.mouthBridge ?? -1,
        bboxH: d.mouthBboxH ?? -1,
      })
      if (window.__rbRing.length > 1200) window.__rbRing.splice(0, window.__rbRing.length - 1200)
    } catch (e) { /* never break the page */ }
  }
  setInterval(() => window.__rbSample(), 250)
})

// ---- mouth ROI metrics on a 120x50 image (full frame or clip) ----
async function mouthMetrics(buf, crop) {
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
  for (let y = 0; y < H; y++) if (rowMean[y] < min) min = rowMean[y]
  let darkNarrow120 = 0
  for (let y = 13; y < 37; y++) for (let x = 30; x < 90; x++) {
    if (lum((y * W + x) * ch) < 120) darkNarrow120++
  }
  return { dipMin: Math.round(min), darkNarrow120: +(darkNarrow120 / 1440).toFixed(4) }
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
if (debug0?.status !== 'ready') { await browser.close(); preview.kill(); process.exit(1) }

await page.evaluate(() => {
  const live2d = [...document.querySelectorAll('canvas')].find(c => { const r = c.getBoundingClientRect(); return r.width < window.innerWidth || r.height < window.innerHeight })
  live2d?.scrollIntoView({ block: 'center' })
})
await sleep(2000)
const geo = await page.evaluate(() => {
  const d = window.__nekomiDebug
  const canvas = [...document.querySelectorAll('canvas')].find(c => { const r = c.getBoundingClientRect(); return r.width < window.innerWidth || r.height < window.innerHeight })
  const r = canvas?.getBoundingClientRect()
  return {
    canvasDocTop: r ? r.y + window.scrollY : null,
    canvasDocLeft: r ? r.x + window.scrollX : null,
    scrollY: window.scrollY,
    mouthStage: d.mouthScreenPx,
  }
})
// Viewport (client) coords of the mouth ROI — screenshots and
// screencast frames are both viewport-sized.
const ROI = {
  x: Math.round(geo.canvasDocLeft + geo.mouthStage[0] - 60),
  y: Math.round(geo.canvasDocTop - geo.scrollY + geo.mouthStage[1] - 25),
  w: 120, h: 50,
}
console.log('mouth ROI (viewport coords):', JSON.stringify(ROI))

// ---- CDP screencast: genuinely presented frames --------------------
const cdp = await page.context().newCDPSession(page)
const frames = []
cdp.on('Page.screencastFrame', (ev) => {
  const recvWall = Date.now()
  frames.push({ recvWall, sessionId: ev.sessionId, data: ev.data })
  cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {})
})
await cdp.send('Page.enable')
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 })
console.log('screencast started')

// ---- send the message (stash exact in-page anchors first) ---------
const MESSAGE = 'Bonjour, un café et un croissant s’il vous plaît'
await page.evaluate((msg) => {
  const el = document.querySelector('#agent-input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(el, msg)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.focus()
  window.__sendPerf = performance.now()
  window.__sendWall = Date.now()
}, MESSAGE)
await sleep(300)
await page.keyboard.press('Enter')
const sendWall = Date.now()
console.log('message sent')

// ---- live reply, screencast only ------------------------------------
// Run-2 lesson: the clipped screenshots starved the compositor
// (28-102 s round-trips) and polluted the screencast with odd-sized
// frames, while proving nothing the screencast doesn't (a clip is
// the same capture path, just as slow). This run is screencast-only:
// the reply is spoken while the compositor streams presented frames.
// Wait for the reply to end (bridge back to 0) then stop screencast.
{
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    const d = await page.evaluate(() => window.__nekomiDebug)
    if (d.mouthBridge === 0 && d.mouthBboxH <= 75) break
  }
}
await cdp.send('Page.stopScreencast').catch(() => {})
console.log(`screencast stopped — ${frames.length} frames received`)

// ---- read everything once ------------------------------------------
const data = await page.evaluate(() => ({
  series: window.__series,
  speakLog: window.__speakLog,
  rbRing: window.__rbRing ?? [],
  sendPerf: window.__sendPerf ?? null,
  sendWall: window.__sendWall ?? null,
  perfNow: performance.now(),
  wallNow: Date.now(),
  debug: window.__nekomiDebug,
  bubbles: [...document.querySelectorAll('.rounded-3xl')].map((el) => el.textContent?.trim() ?? ''),
}))
// Save screencast frames to disk (decode base64 -> jpg).
const frameFiles = []
for (let i = 0; i < frames.length; i++) {
  const f = `${OUT}/frames/frame-${String(i).padStart(3, '0')}.jpg`
  writeFileSync(f, Buffer.from(frames[i].data, 'base64'))
  frameFiles.push({ file: f, recvWall: frames[i].recvWall })
}
writeFileSync(`${OUT}/data.json`, JSON.stringify({ ...data, geo, ROI, frameFiles }, null, 2))
await browser.close()
preview.kill()

// ------------------------------------------------- analysis
// Clock conversion: perf <-> wall from the single post-run anchor.
const perfToWall = (perf) => data.wallNow + (perf - data.perfNow)
const wallToPerf = (wall) => data.perfNow + (wall - data.wallNow)
const t0 = data.speakLog[0]?.t0 ?? 0
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
console.log(`\nspeak log: ${JSON.stringify(data.speakLog.map((r) => ({ text: r.text.slice(0, 40), events: r.events })))})`)
console.log(`reply window: speak t0=${Math.round(t0)} to release t=${Math.round(tEnd)} (${((tEnd - t0) / 1000).toFixed(1)}s)`)
console.log(`send anchor: in-page sendPerf=${data.sendPerf} sendWall=${data.sendWall} (Node sendWall=${sendWall}); speak started ${(t0 - (data.sendPerf ?? t0)) / 1000 >= 0 ? '+' : ''}${((t0 - (data.sendPerf ?? t0)) / 1000).toFixed(1)}s after send`)
const duringRing = (data.rbRing ?? []).filter((p) => p.t >= t0 - 500 && p.t <= tEnd + 2000)
const runDark = duringRing.map((p) => p.darkNarrow120 ?? -1).filter((v) => v >= 0)
const runDip = duringRing.map((p) => p.dipMin ?? 999).filter((v) => v < 999)
console.log(`ring during run: ${duringRing.length} samples | dark max ${Math.max(...runDark, -1)} | dip min ${Math.min(...runDip, 999)}`)
const spoken = data.speakLog[0]?.text ?? ''
console.log(`reply bubble shown: ${spoken.length > 0 && data.bubbles.some((b) => b.includes(spoken.slice(0, 30)))}`)

// ---- Q1: screencast frames (presented pixels) ----------------------
console.log('\n=== Q1 — SCREENCast frames (presented pixels) ===')
const frameResults = []
for (const f of frameFiles) {
  const perf = wallToPerf(f.recvWall)
  const relSpeak = (perf - t0) / 1000
  const inWindow = perf >= t0 - 500 && perf <= tEnd + 2000
  // Run-2 lesson: some screencast frames arrive smaller than the
  // viewport (80x50 / 120x50 / 1024x427) — the ROI cannot be cut
  // from those, so skip them instead of crashing the analysis.
  const meta = await sharp(f.file).metadata()
  if (meta.width < ROI.x + ROI.w || meta.height < ROI.y + ROI.h) {
    frameResults.push({ ...f, perf: Math.round(perf), relSpeak: +relSpeak.toFixed(1), inWindow, skip: `ROI out of frame (${meta.width}x${meta.height})` })
    continue
  }
  const m = await mouthMetrics(readFileSync(f.file), ROI)
  const open = m.dipMin <= 184 || m.darkNarrow120 >= 0.01
  frameResults.push({ ...f, perf: Math.round(perf), relSpeak: +relSpeak.toFixed(1), inWindow, ...m, open })
}
for (const r of frameResults) {
  console.log(`  ${r.file.split('/').pop()}: t${r.relSpeak >= 0 ? '+' : ''}${r.relSpeak}s after speak ${r.inWindow ? '[IN REPLY WINDOW]' : ''} — ${r.skip ?? `dipMin ${r.dipMin} dark ${r.darkNarrow120} -> ${r.open ? 'OPEN' : 'closed'}`}`)
}
const inWindowFrames = frameResults.filter((r) => r.inWindow && !r.skip)
const openFrames = inWindowFrames.filter((r) => r.open)
console.log(`frames inside the reply window: ${inWindowFrames.length}; reading OPEN: ${openFrames.length}`)
console.log(openFrames.length > 0
  ? 'Q1 ANSWER: PRESENTED FRAMES SHOW THE OPEN MOUTH during the reply — mechanism (A) capture lag, not a presentation bug.'
  : 'Q1 ANSWER: NO presented frame inside the reply window reads open — mechanism (B) presented-stale (or the window had no frames).')

writeFileSync(`${OUT}/analysis.json`, JSON.stringify({ t0, tEnd, frameResults, ringMaxDark: Math.max(...runDark, -1), ringMinDip: Math.min(...runDip, 999) }, null, 2))
console.log('\ndone — frames in /tmp/fix19-screencast/frames, data in /tmp/fix19-screencast/data.json')
