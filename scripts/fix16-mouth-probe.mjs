/**
 * FIX PASS 16, GROUP 1 — mouth chain probe (real browser). NOT shipped.
 *
 * What it checks (exit 1 on any failure):
 *   0. SERVED ASSET — the local preview serves THIS worktree's own
 *      dist (asset hash in served HTML == dist/index.html), never the
 *      coordinator's master preview (:4173) or a stale build.
 *   1. BRIDGE — during a real chat reply on #agent, mouthBridge peaks
 *      > 0.3 (the 50 ms interval driver samples the ~2-3 Hz viseme
 *      envelope even when rAF is starved to ~0.4 fps).
 *   2. WRITTEN — mouthWritten (ParamMouthOpenY read-back) peaks
 *      > 0.3, i.e. the value reaches the core.
 *   3. PIXELS — CDP screencast frames captured during the reply show
 *      >= 2 DISTINCTLY OPEN frames: the mouth crop's lip-dip minimum
 *      (see below) is <= 180, with the bridge > 0.3 at the frame's
 *      time or within the 2 s before it (presentation lag — a frame
 *      baked at bridge-peak time is presented 1-2 s later in this
 *      environment). (The fix-15 failure mode was a frozen closed
 *      mouth on pixels despite a moving bridge; the fix-16 bake timer
 *      must make presented frames carry the current value.)
 *      THE DETECTOR (run-2 lesson): the open mouth is NOT a dark
 *      hole — its interior is pale pink-white (luminance ~200), so
 *      a dark-pixel count reads 0-5 whether open or closed. What
 *      changes is the LIP-DIP: the row-mean luminance profile of the
 *      mouth crop dips at the lip line. The detector is the dip's
 *      MINIMUM row-mean luminance (the darkest lip row): clearly-open
 *      frames read 164-175, closed frames 184-197 — a 9-level gap,
 *      threshold 180. Head breath drifts the dip's row by ~7 px over
 *      a reply, so the detector finds the dip wherever it is instead
 *      of assuming a fixed row.
 *      THRESHOLD CALIBRATION (runs 4-5): the dip WIDTH was tried
 *      first (width >= 4, then >= 3) and is fuzzy at the boundary —
 *      run-5 frame 41 is width 3 / min 186 and visually a thin
 *      closed line, while run-4 frame 22 is width 3 / min 175 and
 *      visibly open; a trough-width variant was also tried and
 *      rejected (closed frames reach trough 6 from broad lip
 *      shading). The minimum separates cleanly across every
 *      visually-checked frame in runs 2-5 (open 164-175, closed
 *      184-197). A frame baked at bridge <= 0.22 shows only a
 *      slightly thicker lip line (min 186-190, still closed) — the
 *      visible slit needs bridge ≳ 0.4, so an open frame is only
 *      caught when a bake lands on a high-bridge moment AND its
 *      frame is presented, captured and not scroll-skipped.
 *      RUN-5 LESSON (probe bugs, not product bugs): run 5's own
 *      analysis reported 0 open frames, but a re-analysis of its
 *      67 saved JPEGs found 12 consecutive raw frames at min
 *      164-170 — the mouth WAS wide open; the probe missed them
 *      because (a) the frame window was 14 s while the reply runs
 *      to ~17 s and a peak bake presents 1-2 s later (R1 peaked
 *      0.61 at 16.5 s, outside the window), and (b) scrollAt
 *      returned null on series gaps and skipped frames that were
 *      croppable at the frozen scroll. Fixed here: 20 s window
 *      (matches the series window), scrollAt falls back to the
 *      nearest sample with no recency cutoff, and frames.json now
 *      records every RAW frame (raw index, perf, reply) — the
 *      JPEG filenames use raw indices while frameStats' `i` is the
 *      filtered index, and mixing the two hid the open frames.
 *   4. MOUTH POSITION — the dip's minimum row in the most-open
 *      frame IS the mouth line: mapped back through the same-state
 *      canvas rect + debug scale/bounds it implies a canvas fraction
 *      within 0.02 of the 0.528 used for __nekomiDebug.mouthScreenPx.
 *      (Fix 15's pixel check may have cropped the wrong region; this
 *      pins the projection to same-state geometry instead of
 *      cross-run viewport numbers. Run 2 measured 0.527 by hand from
 *      the dip row — the 135 px "error" in the fix-15 check was a
 *      scroll artifact: the claim (312,772) was at scrollY 0, the
 *      screenshot (320,637) at scrollY 138; the stage-coordinate
 *      projection was right all along.)
 *   rAF rate + in-page timer rate during the reply are REPORTED, not
 *   asserted — the fix does not change rAF, it routes around it.
 *
 * Run-1 lesson (kept in the probe, not papered over): the page
 * SCROLLS mid-reply (input focus / reply render), so a crop fixed
 * from pre-send geometry lands below the stage and reads static dark
 * page background as "open". This run therefore (a) focuses the
 * input BEFORE measuring geometry, (b) records window.scrollY in the
 * 50 ms series, and (c) crops EACH screencast frame at the mouth
 * position interpolated from the scroll at that frame's time — a
 * frame only counts if its own crop shows the mouth. Screencast
 * frames are saved to OUT/frames/ so a human can look at them.
 *
 * Drives the REAL site: vite preview of this worktree's dist on a
 * local port (never :4173), Playwright full Chromium 159 +
 * SwiftShader WebGL2, a real chat message sent to #agent, the real
 * offline-fallback reply read aloud via speechSynthesis (no voices
 * in this environment: speak() errors at ~100 ms, the open-loop
 * fallback runs the beats).
 *
 * Usage: FIX16_PORT=4180 node scripts/fix16-mouth-probe.mjs
 *   (exit 0 = all pass; screenshots + frame stats in /tmp/fix16-mouth-probe)
 *   playwright-core is resolved from (in order): the `playwright-core`
 *   package, $FIX16_PLAYWRIGHT, ~/workspace/.fix15-tools/node_modules,
 *   /tmp/fix16-driver/node_modules.
 *
 * Two replies, not one (run-3 lesson): the environment's presentation
 * rate varies 3x run to run (46 frames in run 2, 16 in run 3 — rAF
 * 0.85 vs 0.23 fps), and the mouth is open only during beats, so a
 * single 13 s window catches 12 open frames one run and 1 the next.
 * Both replies are the same message; the assertions are the same,
 * evaluated over both windows combined, and the per-reply numbers
 * are printed so a one-reply fluke cannot hide.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.FIX16_PORT ?? 4180)
const OUT = process.env.FIX16_OUT ?? '/tmp/fix16-mouth-probe'
mkdirSync(OUT, { recursive: true })
const CHROME =
  process.env.FIX16_CHROME ??
  `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------- resolve playwright-core
let chromium
{
  const candidates = []
  try {
    candidates.push(await import('playwright-core'))
  } catch { /* not installed in the worktree */ }
  if (!chromium) {
    const dirs = [
      process.env.FIX16_PLAYWRIGHT,
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
    console.log('FAIL  playwright-core not resolvable (npm i playwright-core or set FIX16_PLAYWRIGHT)')
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
// The build must already exist (npm run build); the probe only verifies
// the preview serves it — it never rebuilds (a rebuild mid-probe would
// move the asset under the browser).
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
  // Wait for the preview to answer, then verify it serves THIS dist.
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
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--force-device-scale-factor=1'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))

await page.addInitScript(() => {
  window.__series = []
  window.__rafTimes = []
  window.__speakLog = []
  const rafTick = (t) => {
    if (window.__rafTimes.length < 20000) window.__rafTimes.push(t)
    requestAnimationFrame(rafTick)
  }
  requestAnimationFrame(rafTick)
  // 50 ms series recorder (main-thread timer; gaps reveal starvation).
  // NOTE: this is the same sampling the fix-16 interval uses — the
  // series rate here is an independent witness of timer health.
  // scrollY is recorded too: the page scrolls mid-reply (run 1), so
  // each screencast frame must be cropped at the scroll of ITS time.
  setInterval(() => {
    const d = window.__nekomiDebug ?? {}
    const ss = window.speechSynthesis
    window.__series.push({
      t: Math.round(performance.now()),
      bridge: d.mouthBridge ?? null,
      written: d.mouthWritten ?? null,
      speaking: ss ? ss.speaking : null,
      pending: ss ? ss.pending : null,
      voices: ss ? ss.getVoices().length : null,
      vis: document.visibilityState,
      scrollY: window.scrollY,
      bakeCount: d.bakeCount ?? null,
      lastBakeMs: d.lastBakeMs ?? null,
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

const tRun0 = Date.now()
console.log(`loading ${base}/#agent …`)
await page.goto(`${base}/#agent`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForSelector('#agent-input', { timeout: 120000 })
await page.waitForFunction(
  () => window.__nekomiDebug?.status === 'ready' || window.__nekomiDebug?.status === 'failed',
  null, { timeout: 240000, polling: 500 },
)
const debug0 = await page.evaluate(() => window.__nekomiDebug)
console.log('stage:', JSON.stringify(debug0), `(loaded in ${((Date.now() - tRun0) / 1000).toFixed(0)}s)`)
check('stage ready (not failed)', debug0?.status === 'ready', `status=${debug0?.status} error=${debug0?.error ?? ''}`)
if (debug0?.status !== 'ready') {
  await browser.close()
  preview.kill()
  process.exit(1)
}

// Focus the input FIRST (run 1: focusing scrolls the page ~145 px,
// and the scroll can keep creeping under starved rAF — measure
// geometry AFTER it, and track scrollY per frame below instead of
// trusting one pre-send crop). Then wait for the scroll to settle.
await page.fill('#agent-input', 'Bonjour, un café et un croissant s’il vous plaît')
await sleep(3000)
const scrollSettled = await page.evaluate(() => window.scrollY)
console.log('scrollY after focus+settle:', scrollSettled)

// Same-state geometry: canvas rect + debug, read in ONE evaluate so
// the crop below cannot drift from the projection it is testing.
// scrollY is read with it: canvasDocTop/Left below are
// scroll-independent anchors for the per-frame mouth position.
const geo = await page.evaluate(() => {
  const d = window.__nekomiDebug
  const canvas = document.querySelector('canvas')
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
    form: d.form,
    mouthStage: d.mouthScreenPx,
    mouthViewport: r ? [r.x + d.mouthScreenPx[0], r.y + d.mouthScreenPx[1]] : null,
  }
})
console.log('geo:', JSON.stringify(geo))
const [mx, my] = geo.mouthViewport
// Mouth crop at THIS scroll position (the baseline reference only —
// screencast frames are cropped per-frame at their own scroll, see
// the analysis below).
const CROP = { x: Math.round(mx - 60), y: Math.round(my - 25), w: 120, h: 50 }
console.log('mouth crop at baseline scroll (viewport):', JSON.stringify(CROP))

// Baseline: full-page screenshot, mouth closed, before the message.
await page.screenshot({ path: `${OUT}/baseline.png`, timeout: 120000 })
console.log('baseline screenshot saved')

// ---- CDP screencast: real presented frames during the reply ----------
const cdp = await page.context().newCDPSession(page)
const frames = []
cdp.on('Page.screencastFrame', (ev) => {
  frames.push({ wall: Date.now(), data: ev.data, ts: ev.metadata?.timestamp ?? null })
  cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {})
})
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 75, everyNthFrame: 1 })
console.log('screencast started')

// ---- send the message (twice), wait for each reply to be read aloud
// The input is already filled (focus scroll done above) — Enter sends.
// Two replies: see the header note (one 13 s window is underpowered
// when the presentation rate varies 3x run to run).
const MESSAGE = 'Bonjour, un café et un croissant s’il vous plaît'
async function waitForSpeak(count, timeoutS) {
  for (let i = 0; i < timeoutS; i++) {
    await sleep(1000)
    const log = await page.evaluate(() => window.__speakLog.map((r) => r.t0))
    if (log.length >= count) return log[count - 1]
  }
  return null
}
async function waitForReplyEnd(t0) {
  // The greeting is ~137 chars -> ~11 s of beats. Wait until the run
  // ends (bridge back to 0 after having opened) or 25 s after speak.
  for (let i = 0; i < 25; i++) {
    await sleep(1000)
    const st = await page.evaluate(() => {
      const d = window.__nekomiDebug ?? {}
      return { bridge: d.mouthBridge ?? -1, t: performance.now() }
    })
    if (t0 !== null && st.t - t0 > 12000 && st.bridge === 0) return true
  }
  return false
}
await page.press('#agent-input', 'Enter')
const sendWall = Date.now()
console.log('message 1 sent; waiting for speak() …')
const speakT0 = await waitForSpeak(1, 90)
check('speak() called for reply 1', speakT0 !== null, speakT0 === null ? 'no speak() within 90 s of sending' : `t0=${Math.round(speakT0)} ms`)
const reply1Ended = await waitForReplyEnd(speakT0)
console.log(`reply 1 ${reply1Ended ? 'ended (bridge back to 0)' : 'wait window elapsed'}`)
await page.fill('#agent-input', MESSAGE)
await page.press('#agent-input', 'Enter')
console.log('message 2 sent; waiting for speak() …')
const speakT1 = await waitForSpeak(2, 90)
check('speak() called for reply 2', speakT1 !== null, speakT1 === null ? 'no second speak() within 90 s of sending' : `t0=${Math.round(speakT1)} ms`)
const reply2Ended = await waitForReplyEnd(speakT1)
console.log(`reply 2 ${reply2Ended ? 'ended (bridge back to 0)' : 'wait window elapsed'}`)
await cdp.send('Page.stopScreencast').catch(() => {})
console.log(`screencast frames captured: ${frames.length}`)
// Save every frame: the pixel verdict must be checkable by eye, and
// run 1 proved a summary number alone can hide a wrong crop.
mkdirSync(`${OUT}/frames`, { recursive: true })
for (const [i, f] of frames.entries()) {
  writeFileSync(`${OUT}/frames/frame-${String(i).padStart(2, '0')}.jpg`, Buffer.from(f.data, 'base64'))
}
// Re-read geometry + scroll at reply end: if the page scrolled
// mid-reply, the end geo (not the baseline geo) is what the late
// frames show — and the per-frame scroll series settles which.
const geoEnd = await page.evaluate(() => {
  const d = window.__nekomiDebug
  const canvas = document.querySelector('canvas')
  const r = canvas?.getBoundingClientRect()
  return {
    scrollY: window.scrollY,
    canvasDocTop: r ? r.y + window.scrollY : null,
    mouthViewport: r ? [r.x + d.mouthScreenPx[0], r.y + d.mouthScreenPx[1]] : null,
    bakeCount: d.bakeCount ?? null,
    lastBakeMs: d.lastBakeMs ?? null,
    mouthBridge: d.mouthBridge ?? null,
    mouthWritten: d.mouthWritten ?? null,
  }
})
console.log('geo at reply end:', JSON.stringify(geoEnd))

await page.screenshot({ path: `${OUT}/after.png`, timeout: 120000 }).catch((e) =>
  console.log('after screenshot failed (non-fatal):', String(e).slice(0, 120)))

// ---- read the in-page series once -------------------------------------
const data = await page.evaluate(() => {
  const perfNow = performance.now()
  return {
    series: window.__series,
    rafTimes: window.__rafTimes,
    speakLog: window.__speakLog,
    perfNow,
    wallNow: Date.now(),
    debug: window.__nekomiDebug,
  }
})
// Wall->perf clock mapping (frames are timestamped in wall time).
const perfAtWallNow = data.perfNow - (Date.now() - data.wallNow)
const wallToPerf = (wall) => perfAtWallNow + (wall - data.wallNow)
writeFileSync(`${OUT}/data.json`, JSON.stringify({ ...data, geo, crop: CROP, sendWall, frames: frames.length }, null, 2))
await browser.close()
preview.kill()

// ------------------------------------------------- analysis: rAF + series
// Two reply windows (see the header note): every windowed stat is
// computed over both replies combined, per-reply where it matters.
const speakStarts = data.speakLog.map((r) => r.t0)
const t0 = speakStarts[0] ?? 0
const inReplyWindow = (t, spanMs) => speakStarts.some((s) => t >= s && t <= s + spanMs)
console.log(`speak log: ${JSON.stringify(data.speakLog.map((r) => ({ text: r.text.slice(0, 40), events: r.events })))}`)
console.log(`reply windows: ${speakStarts.map((s) => Math.round(s)).join(', ')} (perf ms)`)
const during = data.series.filter((p) => inReplyWindow(p.t, 20000))
const raf = data.rafTimes.filter((t) => inReplyWindow(t, 13000))
const gaps = []
for (let i = 1; i < raf.length; i++) gaps.push(raf[i] - raf[i - 1])
gaps.sort((a, b) => a - b)
const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : -1
console.log(`rAF in reply windows: ${raf.length} frames over ${13 * speakStarts.length} s (${(raf.length / (13 * speakStarts.length)).toFixed(2)} fps) | median gap ${medianGap.toFixed(0)} ms | max gap ${gaps.length ? gaps[gaps.length - 1].toFixed(0) : -1} ms`)
const seriesGaps = []
for (let i = 1; i < during.length; i++) seriesGaps.push(during[i].t - during[i - 1].t)
seriesGaps.sort((a, b) => a - b)
const seriesMedian = seriesGaps.length ? seriesGaps[Math.floor(seriesGaps.length / 2)] : -1
console.log(`series points during reply: ${during.length} (median interval ${seriesMedian.toFixed(0)} ms — the 50 ms timer's real rate)`)
const bridges = during.map((p) => p.bridge).filter((v) => typeof v === 'number')
const maxBridge = Math.max(...bridges, -1)
const written = during.map((p) => p.written).filter((v) => typeof v === 'number')
const maxWritten = Math.max(...written, -1)
const over03 = during.filter((p) => p.bridge > 0.3).length
const over005 = during.filter((p) => p.bridge > 0.05).length
console.log(`bridge during reply: max ${maxBridge} | >0.3: ${over03}/${during.length} | >0.05: ${over005}/${during.length}`)
console.log(`written during reply: max ${maxWritten}`)
const buckets = new Map()
for (const p of during) {
  const ri = speakStarts.findIndex((s) => p.t >= s && p.t <= s + 20000)
  const b = Math.floor((p.t - speakStarts[ri]) / 500)
  const key = `R${ri + 1}:${(b * 0.5).toFixed(1)}s`
  buckets.set(key, Math.max(buckets.get(key) ?? -1, p.bridge ?? -1))
}
console.log('bridge max per 500 ms bucket (reply:seconds after speak -> max bridge):')
console.log([...buckets.entries()].map(([k, v]) => `${k}:${v}`).join(' '))

check('1 bridge peaks >0.3 during the reply', maxBridge > 0.3, `max bridge ${maxBridge}`)
check('2 written peaks >0.3 during the reply', maxWritten > 0.3, `max written ${maxWritten}`)
// Bake telemetry: did the timer force renders, and how slow were
// they? (A timer that never fires, or renders that each block the
// thread for seconds, reads differently from a healthy one.)
const bakeCounts = data.series.map((p) => p.bakeCount).filter((v) => typeof v === 'number')
const maxBake = bakeCounts.length ? Math.max(...bakeCounts) : -1
console.log(`bake timer: forced renders during run ${maxBake} (final debug bakeCount ${data.debug?.bakeCount ?? 'n/a'}, lastBakeMs ${data.debug?.lastBakeMs ?? 'n/a'})`)

// ------------------------------------------------- analysis: pixels
// Dark-pixel count in the mouth crop: the open mouth shows a dark
// interior (luminance < 70); the closed mouth is a thin lip line.
// `lum` thresholds are reported raw so the verdict is auditable.
const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b
async function darkCount(buf, crop) {
  const { data, info } = await sharp(buf)
    .extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h })
    .raw()
    .toBuffer({ resolveWithObject: true })
  let dark = 0
  let veryDark = 0
  for (let i = 0; i < data.length; i += info.channels) {
    const l = lumOf(data[i], data[i + 1], data[i + 2])
    if (l < 70) dark++
    if (l < 40) veryDark++
  }
  return { dark, veryDark, total: crop.w * crop.h }
}
function bridgeAt(perfMs) {
  // Nearest series sample to a perf timestamp (series is ~50 ms,
  // starved to ~250-350 ms here — nearest is the honest correlate).
  let best = null
  let bestDt = Infinity
  for (const p of data.series) {
    const dt = Math.abs(p.t - perfMs)
    if (dt < bestDt) { bestDt = dt; best = p }
  }
  return best && bestDt < 1000 ? best.bridge : null
}
function scrollAt(perfMs) {
  // scrollY at a perf timestamp, from the nearest series sample.
  // The page scrolls mid-reply (run 1), so each frame is cropped at
  // the scroll of ITS time, not at the pre-send scroll.
  let best = null
  let bestDt = Infinity
  for (const p of data.series) {
    const dt = Math.abs(p.t - perfMs)
    if (dt < bestDt) { bestDt = dt; best = p }
  }
  // No recency cutoff (run-5 lesson): during a main-thread block the
  // scroll cannot change — scroll changes need the main thread — so
  // the nearest sample is correct even across a multi-second gap.
  // The old <2000 ms cutoff returned null mid-gap and skipped frames
  // that were perfectly croppable at the frozen scroll.
  return best && typeof best.scrollY === 'number' ? best.scrollY : null
}
// Mouth crop for one frame: the mouth's DOCUMENT position is fixed
// (canvasDocTop/Left + stage fractions), so its VIEWPORT position at
// a frame's time is the document position minus that frame's scroll.
function cropForFrame(perfMs) {
  const sy = scrollAt(perfMs)
  if (sy === null) return null
  const mouthX = geo.canvasDocLeft + geo.mouthStage[0]
  const mouthY = geo.canvasDocTop - sy + geo.mouthStage[1]
  const crop = { x: Math.round(mouthX - 60), y: Math.round(mouthY - 25), w: 120, h: 50, mouthX: Math.round(mouthX), mouthY: Math.round(mouthY), scrollY: sy }
  // The crop must lie fully inside the 1280x800 frame — a mouth
  // scrolled half out of view cannot be judged from that frame.
  if (crop.x < 0 || crop.y < 0 || crop.x + crop.w > 1280 || crop.y + crop.h > 800) return { ...crop, outOfView: true }
  return crop
}

// Lip-dip analysis of one mouth crop (sharp raw pixels): the
// row-mean luminance over the central 70 columns dips at the lip
// line. Returns the half-depth width of that dip (rows), its minimum
// luminance, and the dip's row. Closed mouth: width 1-2, min ~188.
// Open mouth: width 4, min 169-175 (run 2, verified by eye on the
// saved frames). The open interior is PALE, so darkness alone cannot
// see it — the dip WIDTH is the signal. Head breath drifts the dip's
// row by ~7 px over a reply; the detector finds the dip wherever it
// is, so drift cannot fake or hide an opening.
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
  const edge = [...rowMean.slice(0, 10), ...rowMean.slice(40)]
  edge.sort((a, b) => a - b)
  const base = edge[Math.floor(edge.length / 2)]
  let min = Infinity
  let minRow = -1
  for (let y = 0; y < H; y++) {
    if (rowMean[y] < min) { min = rowMean[y]; minRow = y }
  }
  const thr = min + (base - min) * 0.5
  const dipRows = rowMean.map((v, y) => (v < thr ? y : -1)).filter((y) => y >= 0)
  return { dipWidth: dipRows.length, dipMin: Math.round(min), dipRow: minRow, base: Math.round(base) }
}
function maxBridgeBefore(perfMs, windowMs = 2000) {
  // Highest bridge in the 2 s before a frame's time — a frame baked
  // at bridge-peak time is presented 1-2 s later here, so the bridge
  // AT the delivery timestamp lags the bake by that much.
  let m = -1
  for (const p of data.series) {
    if (p.t <= perfMs && p.t >= perfMs - windowMs && typeof p.bridge === 'number') {
      if (p.bridge > m) m = p.bridge
    }
  }
  return m
}

// Closed baseline: the same crop from the pre-message screenshot.
const baselineBuf = readFileSync(`${OUT}/baseline.png`)
const closed = await darkCount(baselineBuf, CROP)
const closedDip = await lipDip(baselineBuf, CROP)
console.log(`closed baseline (pre-message screenshot): dark<70 ${closed.dark}/${closed.total} | lip-dip width ${closedDip.dipWidth} min ${closedDip.dipMin}@row ${closedDip.dipRow}`)

// Per-frame lip-dip over the reply windows, each frame cropped at its
// own scroll-corrected mouth position. Dark counts are kept for the
// record (they stay ~0 open or closed — the interior is pale).
// `perf` stays absolute page time (the correlation functions need
// it); `rel` is ms after that frame's own reply start, for display.
const replyFrames = frames
  .map((f) => {
    const perf = wallToPerf(f.wall)
    const ri = speakStarts.findIndex((s) => perf >= s - 500 && perf <= s + 20000)
    return { ...f, perf, reply: ri + 1, rel: ri >= 0 ? perf - speakStarts[ri] : null }
  })
  .filter((f) => f.reply > 0)
console.log(`screencast frames in reply windows: ${replyFrames.length}`)
const frameStats = []
for (const [i, f] of replyFrames.entries()) {
  const buf = Buffer.from(f.data, 'base64')
  const crop = cropForFrame(f.perf)
  if (!crop || crop.outOfView) {
    console.log(`  frame ${i} R${f.reply} t+${Math.round(f.rel)}ms SKIP — mouth out of view at this scroll (crop ${crop ? JSON.stringify({ x: crop.x, y: crop.y }) : 'no scroll sample'})`)
    frameStats.push({ i, reply: f.reply, perf: Math.round(f.rel), skipped: true, crop: crop ?? null })
    continue
  }
  const c = await darkCount(buf, crop)
  const dip = await lipDip(buf, crop)
  const b = bridgeAt(f.perf)
  const bBefore = maxBridgeBefore(f.perf)
  frameStats.push({ i, reply: f.reply, perf: Math.round(f.rel), bridge: b, bridgeBefore: bBefore, dark: c.dark, veryDark: c.veryDark, dipWidth: dip.dipWidth, dipMin: dip.dipMin, dipRow: dip.dipRow, crop })
  console.log(`  frame ${i} R${f.reply} t+${Math.round(f.rel)}ms bridge ${b ?? 'n/a'} (max 2s before ${bBefore < 0 ? 'n/a' : bBefore}) dark ${c.dark} dip width ${dip.dipWidth} min ${dip.dipMin}@row ${dip.dipRow} mouth@(${crop.mouthX},${crop.mouthY})`)
}
const allRaw = frames.map((f, i) => {
  const perf = wallToPerf(f.wall)
  const ri = speakStarts.findIndex((s) => perf >= s - 500 && perf <= s + 20000)
  return { raw: i, perf: Math.round(perf), reply: ri + 1, rel: ri >= 0 ? Math.round(perf - speakStarts[ri]) : null }
})
writeFileSync(`${OUT}/frames.json`, JSON.stringify({ closed, closedDip, crop: CROP, frames: frameStats, allRaw }, null, 2))
// Open = lip-dip width >= 4 rows (closed: 1-2 rows — run 2, verified
// by eye on the saved frames). Bridge-correlated = the bridge was
// > 0.3 at the frame's time or within the 2 s before it (the bake
// lag: a frame baked at bridge-peak time is presented 1-2 s later).
const OPEN_DIP_MIN = 180 // calibrated: clearly-open frames read min 164-175, closed 184-197 (see header)
const openFrames = frameStats.filter((f) => (f.dipMin ?? 999) <= OPEN_DIP_MIN)
const openWithBridge = openFrames.filter((f) => (f.bridgeBefore ?? -1) > 0.3)
console.log(`open frames by lip-dip (min <= ${OPEN_DIP_MIN}): ${openFrames.length}/${frameStats.length}`)
console.log(`of those, bridge-correlated (max bridge >0.3 in the 2 s before the frame): ${openWithBridge.length}`)
if (openFrames.length > 0) {
  console.log(`open frame dip mins: ${openFrames.map((f) => `${f.dipMin}@R${f.reply}+${f.perf}ms`).join(', ')}`)
}
check('3 >=2 distinctly open pixel frames during the reply (bridge-correlated)',
  openWithBridge.length >= 2,
  `${openWithBridge.length} open+bridge frames of ${frameStats.length} in window`)

// ------------------------------------------------- analysis: mouth position
// The dip's minimum row in the most-open frame IS the mouth line:
// viewport row (crop top + dip row) -> document (plus that frame's
// scroll) -> stage coords -> canvas fraction. Compare with the 0.528
// the debug projection uses.
let measuredFrac = null
{
  const bestOpen = openFrames.length > 0
    ? openFrames.reduce((a, b) => ((a.dipMin ?? 999) < (b.dipMin ?? 999) ? a : b))
    : null
  if (bestOpen?.crop) {
    const oc = bestOpen.crop
    const stageY = (oc.y + bestOpen.dipRow) + oc.scrollY - geo.canvasDocTop
    const top = geo.form === 'furry' ? 0.0 : 0.02
    measuredFrac = top + (stageY - geo.stageH * 0.02) / (geo.bounds.height * geo.scale)
    console.log(`most-open frame ${bestOpen.i} (R${bestOpen.reply} t+${bestOpen.perf}ms, dip width ${bestOpen.dipWidth}, min ${bestOpen.dipMin}@row ${bestOpen.dipRow}): mouth viewport y ${oc.y + bestOpen.dipRow}, stageY ${stageY.toFixed(0)} vs projected ${geo.mouthStage[1]}`)
    console.log(`measured mouth fraction: ${measuredFrac.toFixed(3)} (debug uses 0.528)`)
  } else {
    console.log('mouth-position: skipped — no open frame to measure from')
  }
}

if (measuredFrac !== null) {
  check('4 measured mouth fraction within 0.02 of the 0.528 projection',
    Math.abs(measuredFrac - 0.528) < 0.02, `measured ${measuredFrac.toFixed(3)} vs 0.528`)
} else {
  console.log('SKIP  4 mouth fraction — could not be measured from pixels (see above)')
}

console.log(failures === 0 ? '\nALL FIX16 CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
