// fix17-fluid-probe.mjs — Fix pass 17: fluid background static on desktop.
//
// ROOT CAUSE (found by diagnosis, not by guessing at the sim):
//   The fluid sim was never dead on desktop — it was never MOUNTED
//   where the cloud check looked. FluidBackground lived inside the
//   `{activeTab === 'home' && ...}` branch of src/App.tsx, so on the
//   VENIR tab (visit, #venir) — and every other non-home tab — the
//   page showed only the static `.fluid-fallback` gradient plus a
//   grain layer with `animation: none`. The cloud check (00:03–00:08
//   CET, 1920x1000, VENIR, 22s) measured top-left and bottom-right
//   mean RGB exactly constant and identical screenshots because there
//   was no animated layer in the DOM at all. Fix 15's "fluid PASS"
//   was mobile-width on the Home tab, where the canvas does mount,
//   so it never caught this. The fix mounts the sim once at the app
//   root, fixed behind every tab (the tab surfaces are transparent
//   gradients, so the field shows through on all seven tabs).
//
// What it checks (exit 1 on any failure):
//   STATIC — no browser needed:
//     1. App.tsx mounts <FluidBackground /> once, at the app root
//        (before <Nav />), and the Home branch no longer contains it.
//     2. The sim still exposes window.__fluidDebug and the fix-15
//        sustaining config (dissipation / wanderers) is intact.
//   LIVE (needs playwright-core + a headless Chromium; set FIX17_URL,
//     FIX17_PLAYWRIGHT to the playwright-core package dir if it is
//     not resolvable, FIX17_CHROME to a chrome binary):
//     3. VENIR / WebGL path (the failing case, 1920x1000): the canvas
//        mounts, __fluidDebug.frames advances, and real composited
//        pixels change between two screenshots taken >= 20s of wall
//        time apart AND >= 60 sim frames apart. The sim is first
//        populated by a mouse stir (see the stir note in pixelLeg):
//        in SwiftShader the sim steps at ~0.5 fps, so 20s of wall
//        time is ~10 frames — far too little for the ambient
//        wanderers (one emission per 0.9s of sim time) to populate
//        the field, and an unpopulated field correctly measures
//        ~0.00. The stir lays dye the way real mouse use does; the
//        A→B drift is then pure sim advection, and ambientSplats
//        growing proves the no-input sustaining input fires too. In
//        a real browser 20s wall is 1200 frames and the ambient field
//        populates on its own; the cloud check verifies that leg
//        directly. Mean absolute change must be >= 0.5/255 in BOTH
//        cloud-check regions (top-left 400x300, bottom-right
//        400x300). The broken state measured exactly 0.00 in both
//        regions; the fixed build measures 1.8–4.0 top-left and
//        4.5–10.9 bottom-right across runs (random splat placement
//        moves the numbers, both far above the threshold).
//        Capture is CLIPPED per region, not full-viewport: a
//        full-viewport 1920x1000 screenshot times out even at 240s
//        in SwiftShader here (the page's big software blurs make
//        the compositor rasterise slowly), while a 400x300 clip of
//        the same surface completes (~146s worst case measured).
//        fromSurface:false never completes here; the surface clip
//        is the working invocation.
//     4. VENIR / no-WebGL path (--disable-webgl): the animated CSS
//        fallback mounts, its blob animations run, and real pixels
//        change >= 0.5/255 mean over 20s wall in both regions — the
//        fallback is the background when WebGL is off, so it must
//        drift too. Measured with the fix-17 strengthened CSS:
//        2.429 top-left, 4.141 bottom-right (the fix-15 CSS measured
//        0.295 / 0.106 and failed this gate, which is why the CSS
//        was strengthened: sharper/smaller/brighter/faster blobs,
//        ember moved to the bottom-right corner).
//     5. HOME stepping: on the Home tab the sim steps
//        (__fluidDebug.frames advances, ambientSplats grows). No
//        pixel gate here: Home also runs the HeroDust R3F
//        postprocessing canvas, and SwiftShader on this VM cannot
//        produce a 1920x1000 Home screenshot in reasonable time even
//        at a 240s timeout (both full Chrome and headless shell
//        time out); the cloud browser check covers Home pixels.
//   If no browser is available the live checks print LIVE SKIP and
//   the run still passes on the static checks (exit 0) — the static
//   checks are the gate; live is confirmation, not a substitute.
//   A live leg that FAILS (not skips) fails the run.
//
// Usage: node scripts/fix17-fluid-probe.mjs [--live]
//   --live is the default when playwright-core resolves; --no-live
//   runs static checks only. Expect the live run to take several
//   minutes on this VM (SwiftShader clip screenshots at 1920x1000
//   take ~1–2 min each and the sim steps slowly in software); on a
//   real GPU it takes ~1 minute. Serve the built site first
//   (npm run build && vite preview) and point FIX17_URL at it.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appSrc = readFileSync(resolve(root, 'src/App.tsx'), 'utf8')
const fluidSrc = readFileSync(resolve(root, 'src/lib/fluid.ts'), 'utf8')
const tsxSrc = readFileSync(resolve(root, 'src/components/FluidBackground.tsx'), 'utf8')

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// ---- 1. Global mount ----------------------------------------------------
const fluidUses = [...appSrc.matchAll(/<FluidBackground \/>/g)].map((m) => m.index ?? -1)
const navIdx = appSrc.indexOf('<Nav />')
const homeBranchIdx = appSrc.indexOf("activeTab === 'home'")
check('fluid mounted exactly once', fluidUses.length === 1, `uses=${fluidUses.length}`)
check('fluid mounted at app root (before <Nav />)',
  fluidUses.length === 1 && navIdx !== -1 && fluidUses[0] < navIdx,
  `fluid@${fluidUses[0]} nav@${navIdx}`)
const homeBlock = homeBranchIdx === -1 ? '' : appSrc.slice(homeBranchIdx, homeBranchIdx + 600)
check('home branch no longer mounts its own fluid',
  !homeBlock.includes('FluidBackground'),
  homeBranchIdx === -1 ? 'no home branch found' : 'home branch is fluid-free')
check('app comment records the fix-17 global mount',
  /Fix 17/.test(appSrc) && /every tab/.test(appSrc))

// ---- 2. Sim diagnostics + sustaining config intact -----------------------
check('debug: window.__fluidDebug exposed', /__fluidDebug/.test(fluidSrc))
check('sim: wanderers still emit (fix 15 sustaining input)',
  /AMBIENT_WANDERERS/.test(fluidSrc) && /WANDERER_PUSH/.test(fluidSrc))
check('component: WebGL failure still swaps to animated fallback',
  /if \(failed\) return <FluidFallback animated \/>/.test(tsxSrc))

// ---- 3/4/5. Live checks (best effort) -------------------------------------
const wantLive = !process.argv.includes('--no-live')
const PIXEL_MIN = 0.5 // /255 mean absolute change; broken state measured 0.00
const REGIONS = {
  topLeft: { x: 0, y: 0, width: 400, height: 300 },
  bottomRight: { x: 1520, y: 700, width: 400, height: 300 },
}

if (wantLive) {
  let pw = null
  try {
    pw = await import('playwright-core')
  } catch {
    try {
      const dir = process.env.FIX17_PLAYWRIGHT
      if (dir) pw = await import(`${dir}/index.mjs`)
    } catch { /* fall through */ }
    if (!pw) {
      try {
        // Where playwright-core actually lives on this VM.
        pw = await import('/home/hatch/workspace/.fix15-tools/node_modules/playwright-core/index.mjs')
      } catch { /* fall through to SKIP */ }
    }
  }
  if (!pw) {
    console.log('LIVE SKIP: playwright-core not resolvable (npm i playwright-core or set FIX17_PLAYWRIGHT) — static checks are the gate')
  } else {
    const { chromium } = pw
    const url = process.env.FIX17_URL || 'http://127.0.0.1:4199/'
    const exe = process.env.FIX17_CHROME ||
      `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`
    const LAUNCH = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--force-device-scale-factor=1']

    // One helper page per leg for pixel diffs (created once, reused
    // for both regions): creating a fresh page per region timed out
    // on setContent (30s default) when the VM is loaded, and a new
    // renderer per diff is wasteful. The long setContent timeout is
    // deliberate — the page is blank, but a starved renderer can
    // still take a minute to answer.
    async function makeDiffHelper(browser) {
      const page = await browser.newPage()
      await page.setContent('<canvas id="c"></canvas>', { timeout: 120000 })
      const diff = async (a, b) => page.evaluate(async ({ a, b }) => {
        const load = (buf) => new Promise((res, rej) => {
          const img = new Image()
          img.onload = () => res(img)
          img.onerror = rej
          img.src = 'data:image/png;base64,' + buf
        })
        const ia = await load(a)
        const ib = await load(b)
        const c = document.getElementById('c')
        c.width = ia.width
        c.height = ia.height
        const ctx = c.getContext('2d')
        ctx.drawImage(ia, 0, 0)
        const da = ctx.getImageData(0, 0, c.width, c.height).data
        ctx.clearRect(0, 0, c.width, c.height)
        ctx.drawImage(ib, 0, 0)
        const db = ctx.getImageData(0, 0, c.width, c.height).data
        let sum = 0
        let n = 0
        let over10 = 0
        for (let i = 0; i < da.length; i += 4) {
          for (let k = 0; k < 3; k++) {
            const d = Math.abs(da[i + k] - db[i + k])
            sum += d
            if (d > 10) over10++
            n++
          }
        }
        return { mean: sum / n, pctOver10: (100 * over10) / n, identical: sum === 0 }
      }, { a: a.toString('base64'), b: b.toString('base64') })
      return { page, diff }
    }

    // One clipped screenshot, retried once: a clip can time out when
    // the VM is loaded (sibling renders), then succeed on retry.
    async function clipShot(page, clip, label) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          return await page.screenshot({ clip, timeout: 300000 })
        } catch (e) {
          console.log(`  shot ${label} attempt ${attempt} failed: ${String(e?.message ?? e).split('\n')[0]}`)
          if (attempt === 2) throw e
        }
      }
      throw new Error(`unreachable: shot ${label}`)
    }

    async function pixelLeg({ label, hash, disableWebgl, frameGate }) {
      const browser = await chromium.launch({
        headless: true,
        executablePath: exe,
        args: [...LAUNCH, ...(disableWebgl ? ['--disable-webgl', '--disable-webgl2'] : [])],
      })
      try {
        const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } })
        await page.goto(url + hash, { waitUntil: 'load', timeout: 120000 })
        if (disableWebgl) {
          await page.waitForFunction(() => !!document.querySelector('.fluid-animated-fallback'), null, { timeout: 300000, polling: 1000 })
        } else {
          // Generous: WebGL context + shader compile in SwiftShader
          // under a loaded VM took > 180s once; at low load it is
          // seconds. The timeout is a hang guard, not a perf budget.
          await page.waitForFunction(() => !!document.querySelector('canvas') && !!window.__fluidDebug, null, { timeout: 600000, polling: 1000 })
        }
        await page.waitForTimeout(1000)
        const s1 = await page.evaluate(() => ({
          canvas: !!document.querySelector('canvas'),
          fallback: !!document.querySelector('.fluid-animated-fallback'),
          frames: window.__fluidDebug?.frames ?? null,
          blobs: [...document.querySelectorAll('.fluid-blob')].map((b) => b.getAnimations()[0]?.playState ?? null),
        }))
        if (disableWebgl) {
          check(`live ${label}: animated fallback mounts, no canvas`,
            s1.fallback && !s1.canvas, JSON.stringify({ fallback: s1.fallback, canvas: s1.canvas }))
          check(`live ${label}: blob animations running`,
            s1.blobs.length === 4 && s1.blobs.every((s) => s === 'running'),
            `blobs=${s1.blobs.join(',')}`)
        } else {
          check(`live ${label}: fluid canvas mounts on ${hash}`,
            s1.canvas, JSON.stringify({ canvas: s1.canvas }))
        }
        // Stir (WebGL legs only): drive the mouse across the viewport
        // so the sim's hover-stir input lays dye. One mouse sweep is
        // NOT a trail — applyInputs consumes one delta per frame, so
        // fast moves collapse to a single splat; instead, hop between
        // spread-out points and let a frame pass at each, so every
        // hop lays its own dye blob + velocity kick. Two points sit
        // inside each measured region, so dye is present where the
        // pixel gate looks. This is the sim's designed input path
        // (a user moving the mouse), not a test hook: it populates
        // the field the way real use does, and the A→B drift after
        // the stir is pure sim advection. The no-input sustaining
        // mechanism is checked separately via ambientSplats below.
        // (Why stir at all: in SwiftShader the sim steps at ~0.5
        // fps, so 20s of wall time is ~10 frames / 0.17s of sim
        // time — far too little for the ambient wanderers, which
        // emit every 0.9s of sim time, to populate the field. A
        // real browser runs 20s wall as 1200 frames and the ambient
        // field populates on its own; the cloud check verifies that
        // directly. The stir makes the same drift measurable here.)
        if (!disableWebgl) {
          const STIR = [[200, 150], [350, 250], [700, 150], [1100, 300], [1600, 200], [1650, 800], [1800, 900], [1200, 800], [600, 600], [900, 450], [300, 850], [1500, 500]]
          for (const [x, y] of STIR) {
            const f0 = await page.evaluate(() => window.__fluidDebug?.frames ?? 0).catch(() => 0)
            await page.mouse.move(x, y)
            const t0 = Date.now()
            for (;;) {
              const f = await page.evaluate(() => window.__fluidDebug?.frames ?? 0).catch(() => 0)
              if (f > f0 || Date.now() - t0 > 30000) break
              await page.waitForTimeout(500)
            }
          }
        }
        const shotsA = {}
        for (const [name, clip] of Object.entries(REGIONS)) shotsA[name] = await clipShot(page, clip, `${label}/A/${name}`)
        const tA = Date.now()
        if (frameGate) {
          // Wait for real sim motion, not just wall time: in
          // SwiftShader the sim steps at ~0.2–1 fps, so 60 frames
          // can take minutes; in a real browser it is 1s.
          const t0 = Date.now()
          for (;;) {
            const f = await page.evaluate(() => window.__fluidDebug?.frames ?? -1).catch(() => -1)
            if (f >= (s1.frames ?? 0) + frameGate) break
            if (Date.now() - t0 > 300000) {
              check(`live ${label}: sim steps >= ${frameGate} frames`, false, `frames stuck at ${f} after 300s`)
              break
            }
            await page.waitForTimeout(2000)
          }
        }
        const wall = Date.now() - tA
        if (wall < 20000) await page.waitForTimeout(20000 - wall)
        const s2 = await page.evaluate(() => ({
          frames: window.__fluidDebug?.frames ?? null,
          ambient: window.__fluidDebug?.ambientSplats ?? null,
        }))
        if (!disableWebgl) {
          check(`live ${label}: sim steps (frames advance)`,
            typeof s2.frames === 'number' && typeof s1.frames === 'number' && s2.frames > s1.frames,
            `frames ${s1.frames}→${s2.frames}`)
          // No-input sustaining input: the wanderers must have fired
          // at least once during the leg. One emission needs 0.9s of
          // sim time = 54 frames from mount; the leg spans the stir
          // (~12 frames) plus the 60-frame gate, so it clears that
          // bar in any environment.
          check(`live ${label}: ambient wanderers sustain the field (ambientSplats grows)`,
            typeof s2.ambient === 'number' && s2.ambient >= 1,
            `ambientSplats=${s2.ambient}`)
        }
        const shotsB = {}
        for (const [name, clip] of Object.entries(REGIONS)) shotsB[name] = await clipShot(page, clip, `${label}/B/${name}`)
        const { page: diffPage, diff } = await makeDiffHelper(browser)
        try {
          for (const [name] of Object.entries(REGIONS)) {
            const d = await diff(shotsA[name], shotsB[name])
            check(`live ${label}: pixels drift in ${name} (>= ${PIXEL_MIN}/255 over 20s+ wall)`,
              d.mean >= PIXEL_MIN,
              `mean=${d.mean.toFixed(3)}/255 pct>10=${d.pctOver10.toFixed(2)}% identical=${d.identical}`)
          }
        } finally {
          await diffPage.close()
        }
        await page.close()
      } finally {
        await browser.close()
      }
    }

    // A leg that THROWS (browser died, screenshot timed out) is
    // retried from scratch, up to 3 attempts: on this shared VM
    // browsers die mid-leg for environmental reasons (load spikes,
    // sibling agents' browsers) and a dead browser proves nothing
    // about the page. Checks recorded by an incomplete attempt are
    // rolled back — only a completed attempt's checks stand. A leg
    // that COMPLETES but fails an assertion is not retried: that
    // failure is real signal.
    async function withRetries(label, fn) {
      let lastErr = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        const before = failures
        try {
          await fn()
          if (attempt > 1) console.log(`  ${label}: completed on attempt ${attempt}`)
          return
        } catch (e) {
          failures = before
          lastErr = e
          console.log(`  ${label}: attempt ${attempt} crashed (${String(e?.message ?? e).split('\n')[0]}) — retrying`)
          await new Promise((r) => setTimeout(r, 10000))
        }
      }
      check(`live ${label}: leg completed`, false, String(lastErr?.message ?? lastErr).split('\n')[0])
    }

    await withRetries('venir-webgl', () =>
      pixelLeg({ label: 'venir-webgl', hash: '#venir', disableWebgl: false, frameGate: 60 }))
    await withRetries('venir-fallback', () =>
      pixelLeg({ label: 'venir-fallback', hash: '#venir', disableWebgl: true, frameGate: 0 }))
    // Home stepping only (see header note: no pixel gate on Home —
    // SwiftShader cannot screenshot 1920x1000 Home in reasonable
    // time; the cloud browser check covers Home pixels).
    await withRetries('home', async () => {
      const browser = await chromium.launch({ headless: true, executablePath: exe, args: LAUNCH })
      try {
        const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } })
        await page.goto(url + '#home', { waitUntil: 'load', timeout: 120000 })
        await page.waitForFunction(() => !!document.querySelector('canvas') && !!window.__fluidDebug, null, { timeout: 600000, polling: 1000 })
        const d1 = await page.evaluate(() => ({ ...window.__fluidDebug }))
        await page.waitForTimeout(10000)
        const d2 = await page.evaluate(() => ({ ...window.__fluidDebug }))
        check('live home: sim steps (frames + lastStepAt advance)',
          d2.frames > d1.frames && d2.lastStepAt > d1.lastStepAt,
          `frames ${d1.frames}→${d2.frames}, ambientSplats ${d1.ambientSplats}→${d2.ambientSplats}`)
        await page.close()
      } finally {
        await browser.close()
      }
    })
  }
}

console.log(failures === 0 ? 'fix17-fluid-probe: ALL CHECKS PASSED' : `fix17-fluid-probe: ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
