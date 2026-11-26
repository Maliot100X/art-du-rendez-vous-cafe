/**
 * FIX PASS 18, GROUP 1 — mouth probe (real browser). NOT shipped.
 *
 * What it checks (exit 1 on any failure, SKIP only where stated):
 *   0. SERVED ASSET — the local preview serves THIS worktree's own
 *      dist (asset hash in served HTML == dist/index.html), never
 *      the coordinator's master preview (:4173) or a stale build.
 *   1. SPEAK — speak() is called for a real chat reply on #agent.
 *   2. AUDIO STATE (reported honestly, not gated on audio playing):
 *      voices count, utterance events, speechSynthesis.speaking
 *      timeline. In this environment there are 0 voices and the
 *      utterance errors (onerror synthesis-failed, 65 ms–11.5 s
 *      after queueing depending on run load) — NO
 *      audio ever plays, so the mouth is driven by the synchronous
 *      floor + the open-loop viseme clock. The check passes when the
 *      report is complete (voices + events recorded); SILENT vs
 *      PLAYING is logged, never faked.
 *   3. BRIDGE — during the reply the bridge peaks >= 0.45 (the
 *      fix-18 synchronous open puts it at the 0.5 floor the moment
 *      speak() is called — no tick delay — and the first sample
 *      after speak already reads >= 0.45).
 *   4. BAKED — the mouth geometry baked into the live model tracks
 *      it: max mouthBboxH (ArtMesh13 baked height; 61 closed,
 *      88 @0.3, 109 @0.5, 125 @0.7, 152 @1.0) > 100, >= 2 samples
 *      during the run have bboxH > 88 (visibly open), and the baked
 *      mouth visibly modulates (max-min bboxH >= 15).
 *   5. PIXELS — the mouth on REAL RENDERED PIXELS during the reply
 *      (the fix-18 proof, replacing fix-17's screenshot-only
 *      verdict). The probe samples the mouth ROI from the LIVE
 *      Live2D canvas with in-page drawImage readback (fast: no
 *      BeginFrame). TWO channels collect it: (a) an in-page ring
 *      buffer sampled every 250 ms from load (read out ONCE at the
 *      end — a Node-driven readback round-trip costs ~17 s under
 *      SwiftShader, run 1 collected only 2 samples in 35 s, so the
 *      round-trips starve the evidence, not the mouth); (b) the
 *      Node-driven readbackSample() loop as an independent
 *      cross-check. Same ROI, same metrics in both. Asserted: max
 *      dark-pixel fraction (luminance < 120, narrow mouth ROI)
 *      >= 0.01 AND min lip-dip <= 182 (closed 184-198).
 *      LIP-DIP RECALIBRATION (fix-18 run 4): the old 180 sat
 *      inside the open state's own variance — a forced-0.5
 *      SCREENSHOT read dipMin 181 while its bboxH (110) and its
 *      readback (179) both proved the mouth open, and the closed
 *      baseline reads as low as 184 on the readback channel.
 *      Measured distributions: readback open 162-179, closed
 *      184-198 (threshold 182, mid-gap); screenshot open 160-181,
 *      closed 188-198 (threshold 184, mid-gap). Both bars sit in
 *      the gap between the open and closed distributions, so a
 *      closed mouth still cannot pass and a genuinely open one
 *      cannot fail on metric noise.
 *      RECALIBRATION (fix-18 run 2): the old 0.02 threshold sat
 *      INSIDE the open state's own run-to-run variance — closed
 *      baseline is 0.0000 in every run, forced 0.5 measured
 *      0.024-0.029 (run 1) but 0.0194 (run 2) for the SAME held
 *      state, while the screenshot of that same state agreed it
 *      is open (dipMin 166). 0.015 sits below the lowest measured
 *      open (0.0194) with margin and far above closed (0.000);
 *      the lip-dip conjunction (run min 168 vs closed 193) is an
 *      independent second witness, so the check still asserts
 *      "visibly open" and cannot pass on a closed mouth.
 *      RECALIBRATION 2 (fix-18 run 3): run 3's forced-0.5
 *      READBACK measured 0.0146 — below 0.015 — while the
 *      screenshot of the same held state read 0.0222. The metric
 *      counts a handful of dark pixels (narrow ROI 1440 px:
 *      0.0146 = 21 px, 0.0222 = 32 px), so channel/run noise is
 *      ~±0.005 and any threshold in 0.014-0.02 sits inside the
 *      open state's own variance. 0.01 (≈14 px) is below the
 *      lowest measured open on ANY channel (0.0146) and far above
 *      closed (0.000 in every run, both channels); a mouth that
 *      never opens reads exactly 0.000, so 0.01 still asserts
 *      "visibly open" and cannot pass on a closed mouth.
 *      WHY READBACK, NOT SCREENSHOTS, FOR THE DURING-REPLY PIXELS:
 *      a screenshot round-trip on this VM takes 25-63 s (measured
 *      fix 18: baseline 25-30 s, fluid hidden 15-17 s, small
 *      viewport 35 s) while the spoken reply lasts ~12-20 s — a
 *      screenshot issued during the run returns a post-run frame and
 *      CANNOT show the run (fix 17 classified exactly that as
 *      INCONCLUSIVE; the cloud check's closed samples have the same
 *      shape). The readback channel is calibrated against
 *      screenshots on HELD states in check 6 (same ROI, same
 *      metrics: closed dipMin 189 = 189, forced 0.5 dipMin 165 =
 *      165, darkNarrow 0.0243 vs 0.0292), so it is not trusted
 *      blindly. The readback only works because fix 18 sets
 *      preserveDrawingBuffer: true on the PIXI app (default false
 *      returns transparent black — verified fix 17 + fix 18).
 *   6. SCREENSHOT CROSS-CALIBRATION (gating, held states only —
 *      screenshots CAN prove held states): the pre-send baseline
 *      screenshot reads closed (dipMin > 184) and the forced-0.5
 *      control screenshot reads open (dipMin <= 184 — see the
 *      lip-dip recalibration in check 5: screenshot open 160-181,
 *      closed 188-198), and the
 *      readback of the same held 0.5 state agrees (darkNarrow120
 *      >= 0.01 — recalibrated run 3, see check 5: the same held
 *      state measured 0.024-0.029 (run 1), 0.0194 (run 2) and
 *      0.0146 (run 3 readback; screenshot 0.0222), so any
 *      threshold in 0.014-0.02 sits inside the open state's own
 *      variance; 0.01 is below the lowest measured open and far
 *      above closed 0.000). NOTE (fix-18 run 1): the
 *      probe used to blind-fire two reply screenshots DURING the run
 *      (fix-17 scheme) — removed, because a screenshot in flight
 *      starves the fast sampling this proof depends on (run 1: 2
 *      readback samples in 52 s with two screenshots in flight, vs
 *      ~2 s per evaluate idle) while being INCONCLUSIVE by
 *      construction (round-trip 25-122 s > run). The parent's cloud
 *      check does its own screenshot sampling; this probe's job is
 *      the during-reply pixel proof, and the screenshot channel is
 *      proven equivalent on the held states here.
 *   7. CLOSE — after the reply the driver releases the mouth
 *      (bridge back to 0) and the baked mouth closes again
 *      (bboxH <= 75 within 20 s of the reply ending): the floor
 *      must not stick the mouth open forever (the fix-18 safety
 *      timer is the backstop if the tick chain dies). Read from
 *      the COMBINED in-page timeline (series + ring + readback),
 *      not just the Node loop's flag — run 3's loop expired 20 s
 *      after speak without ever sampling a 0, while the combined
 *      timeline shows bridge 0 continuously from +20 s: the
 *      release is a property of the driver, not of the loop's
 *      sampling luck.
 *   8. REPLY — a bot bubble carrying the spoken reply text appears
 *      in the chat (the reply happened, not just a speak() call).
 *
 * Method (learned from fix 13-17): the message is sent without
 * Playwright actionability waits (page.fill/page.press time out on
 * "stable" under this VM's load): native setter + input event + a
 * real keyboard Enter. The probe drives the REAL site: vite preview
 * of this worktree's dist on a local port (never :4173),
 * Playwright chrome-headless-shell 1255 + SwiftShader WebGL2, a
 * real chat message sent to #agent, the real offline-fallback reply
 * read aloud via speechSynthesis (no voices in this environment:
 * speak() errors after a few seconds, the synchronous floor + open-loop
 * fallback run the beats).
 *
 * Usage: FIX18_PORT=4181 node scripts/fix18-mouth-probe.mjs
 *   (exit 0 = all pass; screenshots + stats in /tmp/fix18-mouth-probe)
 *   playwright-core is resolved from (in order): the `playwright-core`
 *   package, $FIX18_PLAYWRIGHT, ~/workspace/.fix15-tools/node_modules,
 *   /tmp/fix16-driver/node_modules. sharp is resolved from the
 *   worktree node_modules (symlink to pro-studio's).
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.FIX18_PORT ?? 4181)
const OUT = process.env.FIX18_OUT ?? '/tmp/fix18-mouth-probe'
mkdirSync(OUT, { recursive: true })
const CHROME =
  process.env.FIX18_CHROME ??
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

// ------------------------------------------------- resolve playwright-core + sharp
let chromium
{
  try {
    chromium = (await import('playwright-core')).chromium
  } catch { /* not installed in the worktree */ }
  if (!chromium) {
    const dirs = [
      process.env.FIX18_PLAYWRIGHT,
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
    console.log('FAIL  playwright-core not resolvable (npm i playwright-core or set FIX18_PLAYWRIGHT)')
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

  // Fix-18 run 2: in-page pixel ring buffer. A Node-driven
  // readbackSample() round-trip costs ~17 s under SwiftShader
  // (run 1: 2 samples in 35 s), so the during-run pixel evidence
  // is starved by the round-trips, not by the mouth. Sampling
  // in-page every 250 ms into a ring buffer costs one
  // drawImage+getImageData of a 120x50 ROI per tick and is read
  // out ONCE at the end — same ROI, same metrics as
  // readbackSample(), so the two channels stay comparable.
  // (Timers are throttled in headless shell, so the effective
  // cadence is ~1-3 s — still an order of magnitude denser than
  // the Node round-trips.)
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

// ---- in-page mouth pixel readback (fix 18): drawImage the Live2D
// canvas into a 2D canvas and analyse the same 120x50 mouth ROI the
// screenshots use. Reads the last PRESENTED frame (the canvas keeps
// it because preserveDrawingBuffer is true) — fast, no BeginFrame,
// so it can sample a ~12 s reply that a 25-63 s screenshot cannot.
// Returns the same metrics as the screenshot analysis: lip-dip,
// dark fractions (crop + narrow ROI), reddish fraction, plus the
// debug state at sample time. nonZeroPx == 0 means the channel is
// broken (transparent black — preserveDrawingBuffer false).
const readbackSample = () => page.evaluate(() => {
  const d = window.__nekomiDebug ?? {}
  const canvas = [...document.querySelectorAll('canvas')].find(c => { const r = c.getBoundingClientRect(); return r.width < window.innerWidth || r.height < window.innerHeight })
  const t = performance.now()
  if (!canvas) return { t, err: 'no live2d canvas' }
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
  let reddish = 0
  const rowMean = []
  for (let y = 0; y < 50; y++) {
    let s = 0
    for (let x = 25; x < 95; x++) s += lum((y * 120 + x) * 4)
    rowMean.push(s / 70)
  }
  let dipMin = Infinity
  for (const v of rowMean) if (v < dipMin) dipMin = v
  const dark = { lt80: 0, lt120: 0, lt150: 0 }
  for (let i = 0; i < 120 * 50; i++) {
    const l = lum(i * 4)
    if (data[i * 4 + 3] > 0) nonZero++
    if (l < 80) dark.lt80++
    if (l < 120) dark.lt120++
    if (l < 150) dark.lt150++
    if (data[i * 4] > 90 && data[i * 4] > data[i * 4 + 1] + 25 && data[i * 4] > data[i * 4 + 2] + 25) reddish++
  }
  const narrow = { lt120: 0, lt150: 0 }
  for (let y = 13; y < 37; y++) for (let x = 30; x < 90; x++) {
    const l = lum((y * 120 + x) * 4)
    if (l < 120) narrow.lt120++
    if (l < 150) narrow.lt150++
  }
  let synth = null
  try {
    const ss = window.speechSynthesis
    synth = ss ? { speaking: ss.speaking, pending: ss.pending, voices: ss.getVoices().length } : null
  } catch { /* ignore */ }
  // Fix 18 run 1: a second evaluate per sample (for the speak log)
  // doubles the round-trips and halves the sampling cadence under
  // load — read the speak log in the SAME evaluate.
  const speakT0s = (window.__speakLog ?? []).map((r) => r.t0)
  return {
    t, nonZeroPx: nonZero, dipMin: Math.round(dipMin),
    darkCrop120: +(dark.lt120 / 6000).toFixed(4),
    darkCrop150: +(dark.lt150 / 6000).toFixed(4),
    darkNarrow120: +(narrow.lt120 / 1440).toFixed(4),
    darkNarrow150: +(narrow.lt150 / 1440).toFixed(4),
    reddishFrac: +(reddish / 6000).toFixed(4),
    bridge: d.mouthBridge ?? -1, written: d.mouthWritten ?? -1,
    bboxH: d.mouthBboxH ?? -1, bake: d.bakeCount ?? -1, synth,
    speakT0: speakT0s.length ? speakT0s[0] : null,
  }
})

// ---- lip-dip detector (fix 16 calibration, kept): the open mouth is
// NOT a dark hole — its interior is pale pink-white, so a dark-pixel
// count reads ~0 open or closed. What changes is the LIP-DIP: the
// row-mean luminance profile of the mouth crop dips at the lip line.
// Calibrated on real pixels: closed 187-195, forced 0.4/0.5 -> 167,
// 0.6 -> 158, 1.0 -> 90-93. Per-channel open/closed thresholds
// (fix-18 lip-dip recalibration, see check 5 header): the lip-dip
// of a held-open mouth varies run to run with head-bob phase —
// readback open 162-179 vs closed 184-198 (bar 182, mid-gap),
// screenshot open 160-181 vs closed 188-198 (bar 184, mid-gap).
// A single 180 sat inside the open state's own variance (a
// forced-0.5 screenshot read 181 with bboxH 110 proving it open).
// The dark-pixel fractions (fix 18, the cloud metric) are computed
// on the same crops: closed narrow<120 0.0000, forced 0.5 0.0243
// (run 1) / 0.0194 (run 2) / 0.0146 (run 3 readback; screenshot
// 0.0222), forced 1.0 0.1292. Threshold 0.01 (see check 5 header).
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
console.log('voices at load:', await page.evaluate(() => window.speechSynthesis.getVoices().length))

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
  return { bridge: d.mouthBridge ?? -1, written: d.mouthWritten ?? -1, bboxH: d.mouthBboxH ?? -1, bake: d.bakeCount ?? -1, t: await page.evaluate(() => performance.now()) }
}
async function shot(name) {
  const crop = await cropNow()
  const before = await debugState()
  const tReqWall = Date.now()
  const file = `${OUT}/${name}.png`
  await page.screenshot({ timeout: 240000, path: file })
  const after = await debugState()
  const dip = await lipDip(readFileSync(file), crop)
  console.log(`shot ${name}: dipMin ${dip.dipMin}@row ${dip.dipRow} darkNarrow120 ${dip.darkNarrow120} reddish ${dip.reddishFrac} (crop ${JSON.stringify({ x: crop.x, y: crop.y })} scrollY ${crop.scrollY}) | at request bridge ${before.bridge} bboxH ${before.bboxH} bake ${before.bake} | at return bridge ${after.bridge} bboxH ${after.bboxH} bake ${after.bake} (round-trip ${((Date.now() - tReqWall) / 1000).toFixed(0)}s)`)
  return { name, file, crop, ...dip, reqBridge: before.bridge, reqBboxH: before.bboxH, reqBake: before.bake, retBridge: after.bridge, retBboxH: after.bboxH, retBake: after.bake }
}

// ---- baseline: readback (closed) + screenshot A (closed) ----------
const baselineRb = await readbackSample()
console.log(`readback baseline-closed: nonZeroPx ${baselineRb.nonZeroPx} dipMin ${baselineRb.dipMin} darkNarrow120 ${baselineRb.darkNarrow120} darkCrop120 ${baselineRb.darkCrop120} reddish ${baselineRb.reddishFrac} | bridge ${baselineRb.bridge} bboxH ${baselineRb.bboxH} bake ${baselineRb.bake}`)
check('5a baseline readback is real pixels (nonZeroPx > 5000 — the channel works, not transparent black)',
  (baselineRb.nonZeroPx ?? 0) > 5000, `nonZeroPx ${baselineRb.nonZeroPx}`)
check('5b baseline readback reads closed (darkNarrow120 <= 0.005, dipMin > 182)',
  (baselineRb.darkNarrow120 ?? 9) <= 0.005 && (baselineRb.dipMin ?? 0) > READBACK_DIP_OPEN,
  `darkNarrow120 ${baselineRb.darkNarrow120} dipMin ${baselineRb.dipMin}`)
const shotA = await shot('baseline-closed')
check('6a closed baseline screenshot reads closed (dipMin > 184 — the crop is on the mouth)',
  shotA.dipMin > SHOT_DIP_OPEN, `dipMin ${shotA.dipMin}`)

// ---- send the message (no Playwright actionability waits) ----------
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
const sendWall = Date.now()
const sendPerf = await page.evaluate(() => performance.now())
console.log('message sent')

// ---- readback sampling loop: sample the live canvas every ~1-2 s
// from send until the run ends (bridge back to 0 after having
// opened) or 75 s after send. Each sample is real rendered pixels
// of the last presented frame + the debug state at that moment.
// NO screenshots run concurrently with this loop (fix-18 run 1:
// two screenshots in flight starved it to 2 samples in 52 s).
const rbSamples = []
let speakT0 = null
let speakWall = null
let runEndPerf = null
let replyEnded = false
const loopStart = Date.now()
while (true) {
  // Run-3 lesson: the 75 s budget was anchored at SEND, but
  // speak() can happen late (slow page + bot thinking time), so
  // the window expired ~20 s after speak — right when the mouth
  // closed — and the loop never observed the release even though
  // the in-page timeline shows bridge 0 from +20 s. Anchor the
  // budget at SPEAK: never stop before 60 s after speak.
  if (Date.now() - loopStart >= 75000 && (speakWall === null || Date.now() - speakWall >= 60000)) break
  let s
  try {
    s = await readbackSample()
  } catch (e) {
    console.log('readback sample failed:', String(e).slice(0, 120))
    await sleep(1000)
    continue
  }
  rbSamples.push(s)
  if (speakT0 === null && s.speakT0 !== null) { speakT0 = s.speakT0; speakWall = Date.now() }
  if (speakT0 !== null && s.t - speakT0 > 10000 && s.bridge === 0 && rbSamples.some((p) => p.bridge >= 0.45)) {
    replyEnded = true
    runEndPerf = s.t
    break
  }
  await sleep(300)
}
console.log(`readback sampling: ${rbSamples.length} samples over ${((Date.now() - loopStart) / 1000).toFixed(0)}s; speak ${speakT0 !== null ? `t0=${Math.round(speakT0)}` : 'NEVER detected'}; run ${replyEnded ? `ended at t=${Math.round(runEndPerf ?? -1)}` : 'did not end inside the window'}`)

// ---- shot D: force control — mouth forced to 0.5, readback + shot
await page.evaluate(() => window.__nekomiForceMouth(0.5))
{
  const startBake = (await page.evaluate(() => window.__nekomiDebug.bakeCount))
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    const d = await page.evaluate(() => window.__nekomiDebug)
    if (d.bakeCount >= startBake + 2) break
  }
}
const forceRb = await readbackSample()
console.log(`readback force-0.5: nonZeroPx ${forceRb.nonZeroPx} dipMin ${forceRb.dipMin} darkNarrow120 ${forceRb.darkNarrow120} darkCrop120 ${forceRb.darkCrop120} | bridge ${forceRb.bridge} bboxH ${forceRb.bboxH} bake ${forceRb.bake}`)
const shotD = await shot('force-0-5-control')
await page.evaluate(() => window.__nekomiForceMouth(null))
check('6b force control screenshot reads open (mouth forced to 0.5: dipMin <= 184)',
  shotD.dipMin <= SHOT_DIP_OPEN, `dipMin ${shotD.dipMin} (bboxH at return ${shotD.retBboxH})`)
check('6c force control readback agrees with the screenshot (darkNarrow120 >= 0.01 at forced 0.5)',
  (forceRb.darkNarrow120 ?? 0) >= 0.01, `darkNarrow120 ${forceRb.darkNarrow120} dipMin ${forceRb.dipMin}`)

// ---- close watch: the baked mouth must close again after the reply.
let closedBboxH = null
for (let i = 0; i < 20; i++) {
  await sleep(1000)
  const st = await debugState()
  closedBboxH = st.bboxH
  if (st.bboxH <= 75) break
}
console.log(`baked mouth after the reply: bboxH ${closedBboxH}`)

// ---- read the in-page series + speak log once ----------------------
const data = await page.evaluate(() => {
  const perfNow = performance.now()
  return {
    series: window.__series,
    speakLog: window.__speakLog,
    rbRing: window.__rbRing ?? [],
    perfNow,
    wallNow: Date.now(),
    debug: window.__nekomiDebug,
    bubbles: [...document.querySelectorAll('.rounded-3xl')].map((el) => el.textContent?.trim() ?? ''),
  }
})
writeFileSync(`${OUT}/data.json`, JSON.stringify({
  ...data, geo, rbSamples, baselineRb, forceRb, shots: { A: shotA, D: shotD }, closedBboxH, runEndPerf, sendWall, sendPerf,
}, null, 2))
await browser.close()
preview.kill()

// ------------------------------------------------- analysis: audio (check 2)
console.log('\n=== AUDIO (honest report) ===')
console.log(`speak log: ${JSON.stringify(data.speakLog.map((r) => ({ text: r.text.slice(0, 40), events: r.events })))}`)
const voicesSeen = new Set([...data.series.map((p) => p.voices), ...rbSamples.map((p) => p.synth?.voices)].filter((v) => typeof v === 'number'))
const speakingSamples = [...data.series, ...rbSamples].filter((p) => p.speaking === true || p.synth?.speaking === true).length
const totalSamples = data.series.length + rbSamples.length
const audioPlayed = data.speakLog.some((r) => r.events.some(([ev]) => ev === 'onstart')) && speakingSamples > 5
console.log(`voices seen: ${[...voicesSeen].join(',') || 'none recorded'} | synth.speaking=true samples: ${speakingSamples}/${totalSamples} | onstart fired: ${data.speakLog.some((r) => r.events.some(([ev]) => ev === 'onstart'))}`)
console.log(audioPlayed
  ? 'AUDIO: PLAYING — onstart fired and speechSynthesis.speaking held; the mouth is driven by the engine-synced viseme clock.'
  : `AUDIO: SILENT — 0 voices in this environment, utterance errored (onerror synthesis-failed at +${data.speakLog[0]?.events?.find(([ev]) => ev === 'onerror')?.[1] ?? '?'} ms after queueing; varies run to run, 65 ms–11.5 s), no audio played; the mouth is driven by the fix-18 synchronous floor + the open-loop viseme clock.`)
check('2 audio state reported honestly (voices + utterance events recorded)',
  data.speakLog.length >= 1 && data.speakLog[0]?.events !== undefined,
  audioPlayed ? 'PLAYING' : 'SILENT (0 voices, synthesis-failed — open-loop mouth)')

// ------------------------------------------------- analysis: speak / bridge / baked
const t0 = speakT0 ?? data.speakLog[0]?.t0 ?? 0
check('1 speak() called for the reply', speakT0 !== null || data.speakLog.length >= 1,
  speakT0 === null && data.speakLog.length === 0 ? 'no speak() detected' : `t0=${Math.round(t0)} ms`)
const tEnd = runEndPerf ?? (t0 + 20000)
const inRun = (t) => t >= t0 - 500 && t <= tEnd + 2000
const duringRb = rbSamples.filter((p) => inRun(p.t))
const duringSeries = data.series.filter((p) => inRun(p.t))
const duringRing = (data.rbRing ?? []).filter((p) => inRun(p.t))
const allDuring = [
  ...duringRb.map((p) => ({ ...p, src: 'readback' })),
  ...duringSeries.map((p) => ({ ...p, src: 'in-page' })),
  ...duringRing.map((p) => ({ ...p, src: 'ring' })),
]
console.log(`\nrun window: speak t0=${Math.round(t0)} to run end t=${Math.round(tEnd)} (${((tEnd - t0) / 1000).toFixed(1)}s)`)
console.log(`witness samples during the run: ${allDuring.length} (${duringRb.length} readback + ${duringSeries.length} in-page + ${duringRing.length} ring)`)
// Release timeline (check 7 backstop): every bridge point the page
// itself recorded — series (50 ms), ring (250 ms), Node readbacks
// — merged. releasedT = first bridge==0 after the mouth opened
// (and >10 s after speak). Run 3's Node loop missed this because
// its ~7 s samples never landed on a 0 before the window expired.
const tlPts = [
  ...data.series.map((p) => ({ t: p.t, bridge: p.bridge })),
  ...(data.rbRing ?? []).map((p) => ({ t: p.t, bridge: p.bridge })),
  ...rbSamples.map((p) => ({ t: p.t, bridge: p.bridge })),
].filter((p) => typeof p.t === 'number' && typeof p.bridge === 'number' && p.bridge >= 0 && p.t >= t0)
const openTs = tlPts.filter((p) => p.bridge >= 0.45).map((p) => p.t)
const firstOpenT = openTs.length ? Math.min(...openTs) : null
const releasedTs = firstOpenT !== null
  ? tlPts.filter((p) => p.t > Math.max(t0 + 10000, firstOpenT) && p.bridge === 0).map((p) => p.t)
  : []
const releasedT = releasedTs.length ? Math.min(...releasedTs) : null
const bridges = allDuring.map((p) => p.bridge).filter((v) => typeof v === 'number' && v >= 0)
const bboxs = allDuring.map((p) => p.bboxH).filter((v) => typeof v === 'number' && v >= 0)
const maxBridge = Math.max(...bridges, -1)
const maxBboxH = Math.max(...bboxs, -1)
const minBboxH = Math.min(...bboxs, Infinity)
const openBboxSamples = allDuring.filter((p) => (p.bboxH ?? -1) > 88).length
console.log(`bridge during run: max ${maxBridge} | >=0.45: ${allDuring.filter((p) => p.bridge >= 0.45).length}/${allDuring.length}`)
console.log(`bboxH during run: max ${maxBboxH} min ${minBboxH === Infinity ? 'n/a' : minBboxH} | >88 (visibly open): ${openBboxSamples}/${allDuring.length}`)
const firstAfterSpeak = allDuring.filter((p) => p.t >= t0).sort((a, b) => a.t - b.t)[0]
console.log(`first sample at/after speak: t+${firstAfterSpeak ? Math.round(firstAfterSpeak.t - t0) : '?'}ms bridge ${firstAfterSpeak?.bridge ?? '?'} bboxH ${firstAfterSpeak?.bboxH ?? '?'} (fix-18 synchronous open: bridge must already be >= 0.45)`)
const buckets = new Map()
for (const p of allDuring) {
  const b = Math.floor((p.t - t0) / 1000)
  const cur = buckets.get(b) ?? { bridge: -1, bboxH: -1, dark: -1, n: 0 }
  cur.bridge = Math.max(cur.bridge, p.bridge ?? -1)
  cur.bboxH = Math.max(cur.bboxH, p.bboxH ?? -1)
  cur.dark = Math.max(cur.dark, p.darkNarrow120 ?? -1)
  cur.n++
  buckets.set(b, cur)
}
console.log('per-second max (s after speak -> bridge / bboxH / darkNarrow120 / n):')
for (const [k, v] of [...buckets.entries()].sort((a, b) => a - b)) console.log(`  ${k}s: bridge ${v.bridge} bboxH ${v.bboxH} dark ${v.dark} (n=${v.n})`)

check('3 bridge peaks >= 0.45 during the reply (fix-18 synchronous floor)', maxBridge >= 0.45, `max bridge ${maxBridge}`)
check('3b bridge already open at the first sample after speak (no tick delay)',
  firstAfterSpeak !== undefined && (firstAfterSpeak.bridge ?? -1) >= 0.45,
  firstAfterSpeak ? `first sample t+${Math.round(firstAfterSpeak.t - t0)}ms bridge ${firstAfterSpeak.bridge}` : 'no sample at/after speak')
check('4 baked mouth peaks >100 and stays open (max bboxH >100, >=2 samples >88)',
  maxBboxH > 100 && openBboxSamples >= 2,
  `max bboxH ${maxBboxH}, ${openBboxSamples}/${allDuring.length} samples >88`)
check('4b baked mouth visibly modulates during the reply (max-min bboxH >= 15, not stuck open)',
  bboxs.length > 0 && maxBboxH - minBboxH >= 15,
  `bboxH range ${minBboxH === Infinity ? 'n/a' : minBboxH}-${maxBboxH}`)

// ------------------------------------------------- analysis: pixels (check 5)
// Pixel evidence = Node readbacks + in-page ring buffer (same ROI,
// same metrics). The ring is the dense channel; the Node readbacks
// are the independent cross-check.
const duringPx = [...duringRb, ...duringRing]
const runDark = duringPx.map((p) => p.darkNarrow120 ?? -1).filter((v) => v >= 0)
const runDip = duringPx.map((p) => p.dipMin ?? 999).filter((v) => v < 999)
const maxDark = Math.max(...runDark, -1)
const openPxSamples = duringPx.filter((p) => (p.darkNarrow120 ?? 0) >= 0.01).length
const minDip = Math.min(...runDip, 999)
console.log(`\nreadback pixels during run: ${duringPx.length} samples (${duringRb.length} node + ${duringRing.length} ring) | darkNarrow120 max ${maxDark} | >=0.01: ${openPxSamples}/${duringPx.length} | dipMin min ${minDip === 999 ? 'n/a' : minDip} (baseline closed: darkNarrow120 ${baselineRb.darkNarrow120} dipMin ${baselineRb.dipMin})`)
check('5 mouth-region pixels during the reply show a visibly open mouth (darkNarrow120 max >= 0.01 AND lip-dip min <= 182)',
  maxDark >= 0.01 && minDip <= READBACK_DIP_OPEN,
  `max darkNarrow120 ${maxDark} (closed baseline ${baselineRb.darkNarrow120}; forced-0.5 measured 0.0146-0.029), ${openPxSamples}/${duringPx.length} samples >= 0.01, min dipMin ${minDip === 999 ? 'n/a' : minDip}`)
check('5b lip-dip on readback pixels reads open during the reply (min dipMin <= 182)',
  minDip <= READBACK_DIP_OPEN, `min dipMin ${minDip === 999 ? 'n/a' : minDip} (closed baseline ${baselineRb.dipMin})`)

// ------------------------------------------------- analysis: close + reply
check('7 bridge back to 0 after the reply (driver released the mouth)',
  replyEnded || releasedT !== null,
  replyEnded
    ? `bridge 0 at t=${Math.round(runEndPerf ?? -1)}`
    : (releasedT !== null
      ? `bridge 0 in-page at t+${((releasedT - t0) / 1000).toFixed(1)}s (Node loop missed it — sparse sampling)`
      : 'bridge never returned to 0 within the wait window'))
check('7b baked mouth closed again after the reply (bboxH <= 75 within 20 s of the reply ending)',
  (closedBboxH ?? 999) <= 75, `bboxH ${closedBboxH} after reply`)
const spoken = data.speakLog[0]?.text ?? ''
const replyShown = spoken.length > 0 && data.bubbles.some((b) => b.includes(spoken.slice(0, 30)) || spoken.includes(b.slice(0, 30)))
check('8 bot bubble carrying the spoken reply text appears in the chat',
  replyShown, spoken ? `spoken: "${spoken.slice(0, 40)}…"` : 'no spoken text recorded')

console.log(failures === 0 ? `\nALL FIX18 CHECKS PASSED (${skips} skipped)` : `\n${failures} CHECK(S) FAILED (${skips} skipped)`)
process.exit(failures === 0 ? 0 : 1)
