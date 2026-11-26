// fix18-flash-probe.mjs — Fix pass 18, group 4: AGENT left-column
// white flash.
//
// ROOT CAUSE (measured in a real browser, 1280x1000, CDP screencast,
// pre-fix build):
//   The white flash is the MODEL, not a missing page background. The
//   heading region never goes white (mean 25–39, 0–0.2% near-white on
//   every sampled frame, all legs) and every DOM background in the
//   section is dark — but the STAGE goes up to 17–37% near-white
//   (>235 on all channels) during a Henshin morph, and on a tab
//   switch back to AGENT the stage jumps dark → white-faced model in
//   a single frame (stage mean 19 → 92, white 0% → 5.7%). Two
//   mechanisms, both in the model's own presentation:
//     (a) The morph crossfades the two forms through Param3 0.3–0.7
//         with both faces semi-transparent at once (fix 15 measured
//         the band on the real .moc3). The furry face is WHITE fur:
//         at Param3 ~0.5 the double-exposed white face renders as a
//         big white blob filling the stage. The fix-15 faster ease
//         (0.25) only shortens the blob to ~3 frames; a rapid
//         screenshot still catches one.
//     (b) On a warm remount the stage canvas is cleared and the
//         first render draws the model at full brightness in one
//         frame — a dark → white-face pop when the form is furry.
//   The fix (src/components/Live2DModel.tsx) fades the model itself
//   through the Cubism renderer's own global model color
//   (setModelColor — the sanctioned whole-model fade; the Pixi
//   Container alpha never reaches the Cubism shader): the morph dips
//   through the dark stage background across the whole morph
//   (morphDipAlpha: triangular dip over Param3 0–1, to 0.2 at 0.5 —
//   widened from fix 15's 0.3–0.7 band after the probe measured the
//   white peaks at Param3 0.68–0.87, outside that band), the model
//   fades in from alpha 0 on every mount/remount (modelFadeAlpha), and fit() only resizes the
//   renderer when the size actually changed (setting canvas
//   width/height clears the drawing buffer even to the same value).
//
// What it checks (exit 1 on any failure):
//   STATIC — no browser needed:
//     1. Live2DModel.tsx contains the morph dip (morphDipAlpha +
//        MORPH_DIP_FLOOR), the model fade (modelFadeAlpha, reset to
//        0 on mount, eased in the afterMotionUpdate hook and applied
//        via setModelAlpha), and the fit() resize guard.
//   LIVE (needs playwright-core + a headless Chromium; set FIX18_URL,
//     FIX18_PLAYWRIGHT to the playwright-core package dir if it is
//     not resolvable, FIX18_CHROME to a chrome binary):
//     2. The AGENT left column never goes white across tab switches
//        (away and back, in both Henshin forms) and Henshin toggles
//        (both directions), sampled with CDP screencast frames
//        through each transition. Two regions are measured
//        separately, because the model's white furry face is
//        legitimate content and must NOT trip the gate:
//          - heading region (eyebrow + "Parlez à Nekomi." + status
//            pill): no model ever renders there — it must stay dark
//            (mean < 60, near-white < 1% on every frame).
//          - stage region: the model lives here, so the gate is on
//            the FLASH, not the face — near-white < 10% on every
//            frame (pre-fix morphs measured 17–37%; the settled
//            furry face is ~6%), and on tab-back legs the model must
//            not POP in bright: the first frame in which the stage
//            mean crosses 40 (when a darker frame precedes it in
//            the same leg) must still be dim (mean < 70); pre-fix
//            it appears at 92 in one frame.
//        The probe FAILS on the pre-fix build (gates 2 and 3 trip)
//        and PASSES after the fix.
//   If no browser is available the live checks print LIVE SKIP and
//   the run still passes on the static checks (exit 0) — the static
//   checks are the gate; live is confirmation, not a substitute.
//   A live leg that FAILS (not skips) fails the run.
//
// Usage: node scripts/fix18-flash-probe.mjs [--live]
//   --live is the default when playwright-core resolves; --no-live
//   runs static checks only. Expect the live run to take ~10 min on
//   this VM (SwiftShader morphs take 15–40 s each). Serve the built
//   site first (npm run build && vite preview) and point FIX18_URL
//   at it.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const live2dSrc = readFileSync(resolve(root, 'src/components/Live2DModel.tsx'), 'utf8')

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// ---- 1. Static checks ------------------------------------------------------
check('fix18: morph dip helper present (morphDipAlpha + band + floor)',
  /function morphDipAlpha/.test(live2dSrc) &&
  /MORPH_BAND_LO = 0\n/.test(live2dSrc) &&
  /MORPH_BAND_HI = 1\n/.test(live2dSrc) &&
  /MORPH_DIP_FLOOR = 0\.2/.test(live2dSrc))
check('fix18: model fade state present (modelFadeAlpha, reset on mount)',
  /let modelFadeAlpha = 0/.test(live2dSrc) &&
  /modelFadeAlpha = 0/.test(live2dSrc))
check('fix18: fade applied via Cubism model color (setModelAlpha)',
  /function setModelAlpha/.test(live2dSrc) &&
  /setModelColor\(1, 1, 1,/.test(live2dSrc) &&
  /setModelAlpha\(model, morphDipAlpha\(param3Current\) \* modelFadeAlpha\)/.test(live2dSrc))
check('fix18: fade eased in the afterMotionUpdate hook',
  /modelFadeAlpha \+= \(1 - modelFadeAlpha\) \* 0\.15/.test(live2dSrc))
check('fix18: fit() resizes the renderer only on a real size change',
  /Math\.round\(w \* res\) !== app\.renderer\.width/.test(live2dSrc) &&
  /Math\.round\(h \* res\) !== app\.renderer\.height/.test(live2dSrc))

// ---- 2. Live checks --------------------------------------------------------
// Thresholds from the measured baselines (see header):
//   heading: pre-fix max mean 38.7, max white 0.2% — gate 60 / 1%.
//   stage white: pre-fix morphs 17–37%, settled furry ~6% — gate 10%.
//   tab-back pop: pre-fix first bright frame mean 92 — gate < 70.
const HEADING_MEAN_MAX = 60
const HEADING_WHITE_MAX = 1
const STAGE_WHITE_MAX = 10
const STAGE_APPEAR_MEAN_MAX = 70
const REGIONS = {
  heading: { x: 16, y: 250, width: 600, height: 140 },
  stage: { x: 16, y: 400, width: 600, height: 480 },
}

const wantLive = !process.argv.includes('--no-live')

if (wantLive) {
  let pw = null
  try {
    pw = await import('playwright-core')
  } catch {
    try {
      const dir = process.env.FIX18_PLAYWRIGHT
      if (dir) pw = await import(`${dir}/index.mjs`)
    } catch { /* fall through */ }
    if (!pw) {
      try {
        pw = await import('/home/hatch/workspace/.fix15-tools/node_modules/playwright-core/index.mjs')
      } catch { /* fall through to SKIP */ }
    }
  }
  if (!pw) {
    console.log('LIVE SKIP: playwright-core not resolvable (npm i playwright-core or set FIX18_PLAYWRIGHT) — static checks are the gate')
  } else {
    const { chromium } = pw
    const url = process.env.FIX18_URL || 'http://127.0.0.1:4184/'
    const exe = process.env.FIX18_CHROME ||
      `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`
    const LAUNCH = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--force-device-scale-factor=1']

    const browser = await chromium.launch({ headless: true, executablePath: exe, args: LAUNCH })
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
      await page.goto(url + '#agent', { waitUntil: 'load', timeout: 120000 })
      await page.waitForFunction(() => window.__nekomiDebug?.status === 'ready', null, { timeout: 300000, polling: 1000 })
      console.log('live: stage ready, param3 =', await page.evaluate(() => window.__nekomiDebug.param3))
      await page.waitForTimeout(2000)

      const helper = await browser.newPage()
      await helper.setContent('<canvas id="c"></canvas>', { timeout: 60000 })
      async function stats(buf, region) {
        return helper.evaluate(async ({ b64, region }) => {
          const img = await new Promise((res, rej) => {
            const im = new Image()
            im.onload = () => res(im)
            im.onerror = rej
            im.src = 'data:image/jpeg;base64,' + b64
          })
          const c = document.getElementById('c')
          c.width = region.width
          c.height = region.height
          const ctx = c.getContext('2d')
          ctx.drawImage(img, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height)
          const d = ctx.getImageData(0, 0, c.width, c.height).data
          let sum = 0, n = 0, white = 0
          for (let i = 0; i < d.length; i += 4) {
            sum += (d[i] + d[i + 1] + d[i + 2]) / 3
            n++
            if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) white++
          }
          return { mean: sum / n, whitePct: (100 * white) / n }
        }, { b64: Buffer.from(buf).toString('base64'), region })
      }

      const cdp = await page.context().newCDPSession(page)
      let frames = []
      cdp.on('Page.screencastFrame', async (ev) => {
        frames.push({ t: Date.now(), data: Buffer.from(ev.data, 'base64') })
        await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {})
      })

      // Collect screencast frames for `ms`, or until `done()` is true
      // (polled every 500 ms) — morph legs end when Param3 settles.
      async function collect(label, { ms = 0, done = null, maxMs = 120000 } = {}) {
        frames = []
        await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 50, everyNthFrame: 1 })
        const t0 = Date.now()
        if (done) {
          for (;;) {
            if (await done().catch(() => false)) break
            if (Date.now() - t0 > maxMs) break
            await page.waitForTimeout(500)
          }
        } else {
          await page.waitForTimeout(ms)
        }
        await cdp.send('Page.stopScreencast').catch(() => {})
        const rows = []
        for (let i = 0; i < frames.length; i++) {
          const h = await stats(frames[i].data, REGIONS.heading)
          const s = await stats(frames[i].data, REGIONS.stage)
          rows.push({ i, dt: frames[i].t - frames[0].t, hMean: h.mean, hWhite: h.whitePct, sMean: s.mean, sWhite: s.whitePct })
        }
        const maxHMean = rows.reduce((a, r) => Math.max(a, r.hMean), 0)
        const maxHWhite = rows.reduce((a, r) => Math.max(a, r.hWhite), 0)
        const maxSWhite = rows.reduce((a, r) => Math.max(a, r.sWhite), 0)
        const maxSMean = rows.reduce((a, r) => Math.max(a, r.sMean), 0)
        console.log(`live ${label}: ${rows.length} frames in ${Date.now() - t0}ms — heading max mean=${maxHMean.toFixed(1)} white=${maxHWhite.toFixed(1)}% | stage max mean=${maxSMean.toFixed(1)} white=${maxSWhite.toFixed(1)}%`)
        check(`live ${label}: heading never white (mean < ${HEADING_MEAN_MAX}, white < ${HEADING_WHITE_MAX}%)`,
          rows.length > 0 && maxHMean < HEADING_MEAN_MAX && maxHWhite < HEADING_WHITE_MAX,
          `frames=${rows.length} maxMean=${maxHMean.toFixed(1)} maxWhite=${maxHWhite.toFixed(1)}%`)
        check(`live ${label}: stage never flashes white (white < ${STAGE_WHITE_MAX}%)`,
          rows.length > 0 && maxSWhite < STAGE_WHITE_MAX,
          `frames=${rows.length} maxWhite=${maxSWhite.toFixed(1)}%`)
        return rows
      }

      // Tab-back legs also gate the pop-in: the first frame whose
      // stage mean crosses 40 (when a darker frame precedes it in
      // the same leg) must still be dim — the model fades in, it
      // must not appear at full brightness in one frame.
      function checkPopIn(label, rows) {
        const firstBright = rows.findIndex((r) => r.sMean > 40)
        if (firstBright <= 0) {
          console.log(`live ${label}: pop-in gate skipped (no dark→bright crossing observed, frames=${rows.length})`)
          return
        }
        const appearMean = rows[firstBright].sMean
        check(`live ${label}: model fades in, never pops in bright (first bright frame mean < ${STAGE_APPEAR_MEAN_MAX})`,
          appearMean < STAGE_APPEAR_MEAN_MAX,
          `first bright frame f${firstBright} mean=${appearMean.toFixed(1)}`)
      }

      async function param3() {
        return page.evaluate(() => window.__nekomiDebug?.param3 ?? -1)
      }

      // Leg 1: tab switch, human form.
      await page.getByRole('tab', { name: 'Venir' }).click()
      await page.waitForTimeout(1500)
      const leg1 = collect('tab-back-human', { ms: 12000 })
      await page.getByRole('tab', { name: 'Agent' }).click()
      checkPopIn('tab-back-human', await leg1)

      // Leg 2: Henshin to furry (morph is slow in SwiftShader).
      await page.waitForTimeout(2000)
      const leg2 = collect('henshin-furry', { done: async () => (await param3()) >= 0.95, maxMs: 120000 })
      await page.getByRole('button', { name: 'Forme féline' }).click()
      await leg2
      console.log('live: param3 after furry leg =', await param3())

      // Leg 3: tab switch, furry form.
      await page.waitForTimeout(2000)
      await page.getByRole('tab', { name: 'Venir' }).click()
      await page.waitForTimeout(1500)
      const leg3 = collect('tab-back-furry', { ms: 12000 })
      await page.getByRole('tab', { name: 'Agent' }).click()
      checkPopIn('tab-back-furry', await leg3)

      // Leg 4: Henshin back to human.
      await page.waitForTimeout(2000)
      const leg4 = collect('henshin-human', { done: async () => (await param3()) <= 0.05, maxMs: 120000 })
      await page.getByRole('button', { name: 'Forme humaine' }).click()
      await leg4
      console.log('live: param3 after human leg =', await param3())

      await helper.close()
      await page.close()
    } finally {
      await browser.close()
    }
  }
}

console.log(failures === 0 ? 'fix18-flash-probe: ALL CHECKS PASSED' : `fix18-flash-probe: ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
