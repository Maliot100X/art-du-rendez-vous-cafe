// fix18-fluid-probe.mjs — Fix pass 18: the fluid background must VISIBLY
// DRIFT POSITIONALLY on desktop (VENIR + ACCUEIL), with no input, over 22 s.
//
// ROOT CAUSE (diagnosed in a real Playwright/SwiftShader browser, not guessed):
//   1. What renders: the WebGL sim DOES render (SwiftShader WebGL 2.0,
//      fluid canvas mounts, the CSS fallback does NOT mount) — so the
//      fallback is not what the cloud check sees and tuning it cannot fix
//      the drift. The WebGL layer is the one that must move.
//   2. Why it didn't drift: the sim steps at ~0.5 fps at 1920x1000 in that
//      browser, so 22 s wall is ~11 frames = ~0.18 s of sim time. The
//      wanderers (one emission per 54 frames) never fire and the opening
//      splats barely move: the field is effectively frozen, and the
//      15–36% pixel diff the fix-17 cloud check measured is the grain
//      jitter, not the fluid. No sim-frame-gated tuning can fix a 22 s
//      wall check at 0.5 fps — the drift has to run on WALL-CLOCK time.
//   3. Even at full speed the dye does not translate coherently: over
//      ~2 s of sim time the field decorrelates (corr(0,0) ≈ 0.00–0.10,
//      best-shift corr only ~0.19–0.25) because dye blooms and fades in
//      place; new splats, not a moving pattern. So the fix pans the whole
//      field on the compositor's clock: the fluid wrapper (canvas +
//      underlay) translates ±6vw/±4vh on a 120 s linear alternate cycle
//      (~2 px/s at 1920 wide, ~42 px in 22 s). The canvas/underlay are
//      oversized to 114% so the pan never exposes an edge.
//   4. Two gotchas the probe caught while verifying the fix:
//      - A <canvas> is a REPLACED element: `inset` alone does NOT stretch
//        it — with width/height auto it keeps its intrinsic 300x150 size
//        and the field becomes a 300x150 patch at the top-left. Explicit
//        width/height (114%) are required; the probe checks them.
//      - In SwiftShader the compositor produces frames rarely (the WebGL
//        canvas costs seconds per frame), so the CSS animation clock —
//        which tracks the last produced frame's timestamp — lags wall
//        time, and screenshots can capture a stale surface. The header
//        used to claim "the screenshot forces a frame" — the merged-tree
//        runs disproved that: screenshots came back identical 23 s apart
//        (unmasked diff 0.002, corr 1.0) while the DOM transform had
//        advanced ~750 px in the same interval. clipShot therefore runs
//        a double-rAF settle (2 s race) BEFORE every screenshot to force
//        a commit at wall-clock time. The parent's cloud check (which
//        does produce frames — it measured 15–36% pixel diff) is the
//        arbiter for the real visual drift.
//
// What it checks (exit 1 on any failure):
//   STATIC:
//     1. The fluid wrapper carries the `fluid-drift` class and the
//        `fluid-pan` animation is 120s linear infinite alternate.
//     2. `fluid-pan` translates ±6vw/±4vh.
//     3. `.fluid-canvas` has EXPLICIT width/height 114% and inset -7%
//        (the replaced-element sizing fix).
//     4. Reduced motion kills the drift animation.
//     5. The sim nudge is intact (wanderer speed/push, velocity
//        dissipation, ambient radius scale).
//     6. The no-WebGL fallback is still animated (4 blobs).
//   LIVE (Playwright, SwiftShader; set FIX18_URL, FIX18_PLAYWRIGHT,
//     FIX18_CHROME as in fix17; --live-only skips the static checks,
//     --legs=venir-webgl,home-webgl,venir-fallback selects legs):
//     The POSITIONAL gate is the wrapper's own computed transform:
//     the pattern the user sees IS the canvas bitmap plus this
//     transform, so the transform's advance between two screenshots
//     taken >= 22 s apart with no input IS the pattern's positional
//     drift. Pixel-difference percentage alone is NOT accepted (the
//     old pulse passed it): the probe ALSO reports the screenshot
//     analysis — dark-masked centroid shift, normalised correlation
//     at (0,0) and at the best shift — but the dye field churns as it
//     blooms/fades, which swamps the centroid and flattens the
//     correlation peak, so the image numbers are evidence, not the
//     gate. The gates are:
//       * |Δtransform| >= 8 screen px between the two shots
//         (pre-fix: no animation, transform is `none`, Δ = 0)
//       * >= 22 s wall between the shots, no input
//     The screenshot analysis (dark-masked centroid shift,
//     normalised correlation at (0,0) and at the best shift, mean
//     absolute change) is REPORTED as evidence, not gated, on the
//     WebGL legs: the dye field is dim and smooth and it churns as it
//     blooms/fades, so neither meanAbsDiff nor corr(0,0) separates
//     pre-fix from post-fix — the pre-fix control run measured
//     meanAbsDiff 0.721 / corr 0.978 on VENIR and corr 0.902 on Home
//     while the pattern never translated (Δtransform 0.0 px). Gating
//     on them would pass broken builds and fail fixed ones.
//     The fallback leg gates on its blob transform (>= 20 px) plus
//     the UNMASKED image numbers (meanAbsDiff, corr, best-shift): the
//     blobs are bright, so the dark-masked numbers exclude the very
//     pixels that move and can read static while the blobs visibly
//     drift (masked 0.008 / corr 1.0 vs unmasked 9.4 on the same pair
//     — coordinator's merged-tree run). The masked numbers are still
//     reported; the gates use the unmasked ones.
//   If no browser is available the live checks print LIVE SKIP and the
//   run still passes on the static checks (exit 0). A live leg that
//   FAILS (not skips) fails the run. Expect the live run to take
//   several minutes on this VM (SwiftShader clip screenshots at
//   1920x1000 take ~1–2 min each); on a real GPU it takes ~2 minutes.
//   Serve the built site first (npm run build && vite preview) and
//   point FIX18_URL at it.
//
// Usage: node scripts/fix18-fluid-probe.mjs [--live-only] [--legs=a,b]
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cssSrc = readFileSync(resolve(root, 'src/components/FluidBackground.css'), 'utf8')
const tsxSrc = readFileSync(resolve(root, 'src/components/FluidBackground.tsx'), 'utf8')
const fluidSrc = readFileSync(resolve(root, 'src/lib/fluid.ts'), 'utf8')

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const liveOnly = process.argv.includes('--live-only')
const legsArg = (process.argv.find((a) => a.startsWith('--legs=')) || '').slice('--legs='.length)
const wantLegs = legsArg ? new Set(legsArg.split(',')) : null

// ---- Static checks ---------------------------------------------------------
if (!liveOnly) {
  check('static: fluid wrapper carries the fluid-drift class',
    /className="fluid-drift pointer-events-none fixed inset-0 z-0"/.test(tsxSrc))
  check('static: fluid-pan is 120s linear infinite alternate',
    /\.fluid-drift\s*\{[^}]*animation:\s*fluid-pan 120s linear infinite alternate/.test(cssSrc))
  const pan = cssSrc.match(/@keyframes fluid-pan\s*\{([\s\S]*?)\n\}/)
  check('static: fluid-pan translates ±6vw/±4vh',
    !!pan && /translate3d\(-6vw, -4vh, 0\)/.test(pan[1]) && /translate3d\(6vw, 4vh, 0\)/.test(pan[1]),
    pan ? 'keyframes found' : 'no fluid-pan keyframes')
  const canvasRule = cssSrc.match(/\.fluid-canvas\s*\{([\s\S]*?)\}/)
  check('static: fluid-canvas has explicit 114% width/height + inset -7% (replaced-element fix)',
    !!canvasRule && /width:\s*114%/.test(canvasRule[1]) && /height:\s*114%/.test(canvasRule[1]) && /inset:\s*-7%/.test(canvasRule[1]),
    canvasRule ? canvasRule[1].replace(/\s+/g, ' ').trim() : 'no .fluid-canvas rule')
  check('static: reduced motion kills the drift animation',
    /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.fluid-drift\s*\{\s*animation:\s*none/.test(cssSrc))
  check('static: sim nudge intact (wanderer speed 0.08 / push 900 / vel diss 0.30 / ambient radius 1.5)',
    /WANDERER_SPEED = 0\.08/.test(fluidSrc) && /WANDERER_PUSH = 900/.test(fluidSrc) &&
    /VELOCITY_DISSIPATION: 0\.3/.test(fluidSrc) && /AMBIENT_RADIUS_SCALE: mobile \? 1\.5 : 1\.5/.test(fluidSrc))
  check('static: no-WebGL fallback still animated (4 blobs)',
    /fluid-blob--amber/.test(cssSrc) && /fluid-blob--teal/.test(cssSrc) &&
    /fluid-blob--ember/.test(cssSrc) && /fluid-blob--moss/.test(cssSrc) &&
    /if \(failed\) return <FluidFallback animated \/>/.test(tsxSrc))
}

// ---- Live checks -----------------------------------------------------------
const wantLive = !process.argv.includes('--no-live')
const TRANSFORM_MIN = 8 // screen px of wrapper-transform advance between shots
const PIXEL_MIN = 0.5 // /255 mean absolute change; frozen pre-fix field measured 0.34
const CORR_MAX = 0.995 // corr(0,0) must drop below this; frozen pre-fix measured 0.9979
const CLIP = { x: 0, y: 0, width: 400, height: 300 } // top-left, the cloud-check region
const DS = 5 // downsample factor for the correlation grids (1 grid px = 5 screen px)

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
    const url = process.env.FIX18_URL || 'http://127.0.0.1:4182/'
    const exe = process.env.FIX18_CHROME ||
      `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`
    const LAUNCH = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--force-device-scale-factor=1']

    async function makeAnalyser(browser) {
      const page = await browser.newPage()
      await page.setContent('<canvas id="c"></canvas>', { timeout: 120000 })
      const analyse = async (a, b) => page.evaluate(async ({ a, b, DS }) => {
        const load = (buf) => new Promise((res, rej) => {
          const img = new Image()
          img.onload = () => res(img)
          img.onerror = rej
          img.src = 'data:image/png;base64,' + buf
        })
        const ia = await load(a)
        const ib = await load(b)
        const W = Math.floor(ia.width / DS)
        const H = Math.floor(ia.height / DS)
        const grid = (img) => {
          const c = document.getElementById('c')
          c.width = W
          c.height = H
          const ctx = c.getContext('2d')
          ctx.drawImage(img, 0, 0, W, H)
          const d = ctx.getImageData(0, 0, W, H).data
          const g = []
          for (let i = 0; i < d.length; i += 4) g.push((d[i] + d[i + 1] + d[i + 2]) / 3)
          return g
        }
        const ga = grid(ia)
        const gb = grid(ib)
        // Dark mask: background pixels are dark; bright bone text,
        // buttons and photos are excluded so the measure tracks the
        // background field, not static UI.
        const mask = ga.map((v, i) => (v < 90 && gb[i] < 90 ? 1 : 0))
        const maskedMean = (g) => {
          let s = 0
          let n = 0
          for (let i = 0; i < g.length; i++) if (mask[i]) { s += g[i]; n++ }
          return n ? s / n : 0
        }
        const ma = maskedMean(ga)
        const mb = maskedMean(gb)
        const centroid = (g, m) => {
          let sx = 0
          let sy = 0
          let sw = 0
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const i = y * W + x
            if (!mask[i]) continue
            const w = Math.max(0, g[i] - m)
            sx += x * w
            sy += y * w
            sw += w
          }
          return sw > 0 ? { x: sx / sw, y: sy / sw } : { x: -1, y: -1 }
        }
        const ca = centroid(ga, ma)
        const cb = centroid(gb, mb)
        const corr = (dx, dy) => {
          let num = 0
          let da = 0
          let db = 0
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const bx = x + dx
            const by = y + dy
            if (bx < 0 || bx >= W || by < 0 || by >= H) continue
            const i = y * W + x
            const j = by * W + bx
            if (!mask[i] || !mask[j]) continue
            const va = ga[i] - ma
            const vb = gb[j] - mb
            num += va * vb
            da += va * va
            db += vb * vb
          }
          return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0
        }
        const c00 = corr(0, 0)
        let best = { dx: 0, dy: 0, c: c00 }
        for (let dy = -24; dy <= 24; dy++) for (let dx = -24; dx <= 24; dx++) {
          const c = corr(dx, dy)
          if (c > best.c) best = { dx, dy, c }
        }
        let sum = 0
        let n = 0
        let over10 = 0
        for (let i = 0; i < ga.length; i++) {
          if (!mask[i]) continue
          const d = Math.abs(ga[i] - gb[i])
          sum += d
          n++
          if (d > 10) over10++
        }
        // Unmasked equivalents — the dark mask (v<90 in both shots)
        // excludes bright blob cores AND the moving edges (a pixel
        // dark in A but bright in B is masked out), so the masked
        // numbers can read static while the blobs visibly drift:
        // merged-tree run measured masked meanAbsDiff 0.008 / corr
        // 1.0 while the unmasked diff was 9.4 and the blobs had moved
        // ~300 px. The fallback leg gates on the unmasked numbers.
        const meanAll = (g) => { let s = 0; for (let i = 0; i < g.length; i++) s += g[i]; return s / g.length }
        const maAll = meanAll(ga); const mbAll = meanAll(gb)
        const corrAll = (dx, dy) => {
          let num = 0; let da = 0; let db = 0
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const bx = x + dx; const by = y + dy
            if (bx < 0 || bx >= W || by < 0 || by >= H) continue
            const i = y * W + x; const j = by * W + bx
            const va = ga[i] - maAll; const vb = gb[j] - mbAll
            num += va * vb; da += va * va; db += vb * vb
          }
          return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0
        }
        const c00All = corrAll(0, 0)
        let bestAll = { dx: 0, dy: 0, c: c00All }
        for (let dy = -24; dy <= 24; dy++) for (let dx = -24; dx <= 24; dx++) {
          const c = corrAll(dx, dy)
          if (c > bestAll.c) bestAll = { dx, dy, c }
        }
        let sumAll = 0; let over10All = 0
        for (let i = 0; i < ga.length; i++) {
          const d = Math.abs(ga[i] - gb[i])
          sumAll += d
          if (d > 10) over10All++
        }
        return {
          meanAbsDiff: +(sum / n).toFixed(3),
          pctOver10: +(100 * over10 / n).toFixed(2),
          meanAbsDiffAll: +(sumAll / ga.length).toFixed(3),
          pctOver10All: +(100 * over10All / ga.length).toFixed(2),
          centroidShiftScreenPx: { dx: +((cb.x - ca.x) * DS).toFixed(1), dy: +((cb.y - ca.y) * DS).toFixed(1) },
          corr00: +c00.toFixed(4),
          bestShiftScreenPx: { dx: best.dx * DS, dy: best.dy * DS },
          bestCorr: +best.c.toFixed(4),
          corr00All: +c00All.toFixed(4),
          bestShiftAllScreenPx: { dx: bestAll.dx * DS, dy: bestAll.dy * DS },
          bestCorrAll: +bestAll.c.toFixed(4),
        }
      }, { a: a.toString('base64'), b: b.toString('base64'), DS })
      return { page, analyse }
    }

    async function clipShot(page, label) {
      // Force a fresh compositor frame BEFORE capturing: in headless
      // SwiftShader the compositor can serve a stale surface — merged-
      // tree runs measured screenshots identical 23 s apart (unmasked
      // diff 0.002, corr 1.0) while the DOM transform had advanced
      // ~750 px in the same interval. The DOM read forces a main-thread
      // style recalc at wall time, but the compositor only advances
      // when it produces frames; a screenshot of an idle page can
      // return the last presented frame. A double-rAF forces a commit
      // at wall-clock time (the 2 s race keeps a throttled renderer
      // from stalling the probe); the screenshot then captures the
      // fresh state. Best-effort: if the settle throws, the shot runs
      // anyway.
      try {
        await page.evaluate(() => Promise.race([
          new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
          new Promise((r) => setTimeout(r, 2000)),
        ]))
      } catch { /* settle is best-effort */ }
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          return await page.screenshot({ clip: CLIP, timeout: 300000 })
        } catch (e) {
          console.log(`  shot ${label} attempt ${attempt} failed: ${String(e?.message ?? e).split('\n')[0]}`)
          if (attempt === 2) throw e
        }
      }
      throw new Error(`unreachable: shot ${label}`)
    }

    // Parse "matrix(1, 0, 0, 1, tx, ty)" / "none" into {x, y} or null.
    function parseTransform(t) {
      if (!t || t === 'none') return { x: 0, y: 0, none: true }
      const m = t.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*([-\d.]+),\s*([-\d.]+)\)/)
      return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]), none: false } : null
    }

    async function positionalLeg({ label, hash, disableWebgl }) {
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
          await page.waitForFunction(() => !!document.querySelector('canvas') && !!window.__fluidDebug, null, { timeout: 600000, polling: 1000 })
        }
        await page.waitForTimeout(1000)
        // The positional signal: the transform of the layer that carries
        // the background. WebGL path: the panning .fluid-drift wrapper.
        // Fallback path: the amber blob (its own drift is the signal).
        const readSignal = () => page.evaluate((disableWebgl) => {
          // WebGL path: the panning .fluid-drift wrapper; pre-fix there
          // is no such class, so fall back to the fixed wrapper div that
          // holds the canvas (its transform is `none`, so the advance
          // reads 0 and the leg fails — which is the point: the probe
          // must FAIL on the pre-fix behaviour, with real numbers).
          const el = disableWebgl
            ? document.querySelector('.fluid-blob--amber')
            : (document.querySelector('.fluid-drift') ||
              [...document.querySelectorAll('div.fixed.inset-0')].find((d) => d.querySelector('canvas')))
          if (!el) return null
          return {
            transform: getComputedStyle(el).transform,
            frames: window.__fluidDebug?.frames ?? null,
          }
        }, disableWebgl)
        const s0 = await readSignal()
        if (!s0) {
          check(`live ${label}: drift layer present`, false, 'no .fluid-drift / .fluid-blob--amber in DOM')
          return
        }
        if (disableWebgl) {
          const blobs = await page.evaluate(() => [...document.querySelectorAll('.fluid-blob')].map((b) => b.getAnimations()[0]?.playState ?? null))
          check(`live ${label}: fallback mounts, 4 blob animations running`,
            blobs.length === 4 && blobs.every((s) => s === 'running'), `blobs=${blobs.join(',')}`)
        } else {
          check(`live ${label}: fluid canvas mounts on ${hash}`, !!(await page.evaluate(() => document.querySelector('canvas'))))
          const canvasRect = await page.evaluate(() => {
            const c = [...document.querySelectorAll('canvas')].find((el) => el.closest('div.fixed.inset-0'))
            if (!c) return null
            const r = c.getBoundingClientRect()
            return { w: Math.round(r.width), h: Math.round(r.height) }
          })
          // The canvas must cover the viewport (and more — it is
          // oversized 114%): the replaced-element 300x150 trap made it
          // a 300x150 patch, which this catches.
          check(`live ${label}: fluid canvas covers the viewport (>= 1920x1000)`,
            !!canvasRect && canvasRect.w >= 1920 && canvasRect.h >= 1000,
            canvasRect ? `${canvasRect.w}x${canvasRect.h}` : 'no fluid canvas')
        }
        const t0 = parseTransform(s0.transform)
        const shotA = await clipShot(page, `${label}/A`)
        // The transform read right after the shot is fresh: the settle
        // in clipShot forced a commit at wall-clock time before the
        // capture (in SwiftShader the animation clock tracks produced
        // frames, not wall time between them).
        const sA = await readSignal()
        const tA = parseTransform(sA.transform)
        const wallA = Date.now()
        const minAdvance = disableWebgl ? 20 : TRANSFORM_MIN
        // >= 22 s wall, no input. Then retake shot B until the pan has
        // actually advanced AND (fallback leg only) the composited
        // pixels show the drift: the blob animations are periodic and
        // the 400x300 clip only catches the bright core part of the
        // time, so one pair of shots can land on a quiet phase by luck
        // (measured unmasked diffs 0.002–2.1 for the same drifting
        // field). Retaking 30 s later samples a different phase.
        // WebGL legs break on the transform advance alone (their image
        // numbers are evidence, not gates).
        const { page: ap, analyse } = await makeAnalyser(browser)
        let img = null
        try {
          let shotB = null
          let sB = null
          let wallB = 0
          for (let attempt = 1; attempt <= 4; attempt++) {
            if (attempt === 1) {
              const wait = 22000 - (Date.now() - wallA)
              if (wait > 0) await page.waitForTimeout(wait)
            } else {
              await page.waitForTimeout(30000)
            }
            shotB = await clipShot(page, `${label}/B#${attempt}`)
            sB = await readSignal()
            wallB = Date.now()
            const tB = parseTransform(sB.transform)
            const adv = Math.hypot(tB.x - tA.x, tB.y - tA.y)
            img = await analyse(shotA, shotB)
            console.log(`  ${label}: shot B attempt ${attempt}: transform advance ${adv.toFixed(1)}px, elapsed ${((wallB - wallA) / 1000).toFixed(0)}s wall, unmasked meanAbsDiff=${img.meanAbsDiffAll} corr(0,0)=${img.corr00All}`)
            const advOk = adv >= minAdvance
            const imgOk = !disableWebgl || (img.meanAbsDiffAll >= PIXEL_MIN && img.corr00All < CORR_MAX)
            if ((advOk && imgOk) || attempt === 4) break
            console.log(`  ${label}: advance ${adv.toFixed(1)}px / image diff ${img.meanAbsDiffAll} — phase coincidence, retaking shot B`)
          }
          const tB = parseTransform(sB.transform)
          const advance = Math.hypot(tB.x - tA.x, tB.y - tA.y)
          const elapsedS = (wallB - wallA) / 1000
          check(`live ${label}: pattern drifts positionally (transform advance >= ${minAdvance}px over >= 22s, no input)`,
            advance >= minAdvance && elapsedS >= 22,
            `Δtransform=(${((tB.x - tA.x)).toFixed(1)}, ${(tB.y - tA.y).toFixed(1)})px = ${advance.toFixed(1)}px over ${elapsedS.toFixed(0)}s wall, frames ${sA.frames}→${sB.frames}`)
          console.log(`  ${label}: image — meanAbsDiff=${img.meanAbsDiff}/255 pct>10=${img.pctOver10}% centroidShift=(${img.centroidShiftScreenPx.dx}, ${img.centroidShiftScreenPx.dy})px corr(0,0)=${img.corr00} bestShift=(${img.bestShiftScreenPx.dx}, ${img.bestShiftScreenPx.dy})px corr=${img.bestCorr} | unmasked meanAbsDiff=${img.meanAbsDiffAll} corr(0,0)=${img.corr00All} bestShift=(${img.bestShiftAllScreenPx.dx}, ${img.bestShiftAllScreenPx.dy})px corr=${img.bestCorrAll}`)
          if (disableWebgl) {
            // The fallback blobs are bright, so the image numbers that
            // resolve the drift are the UNMASKED ones: the dark mask
            // (v<90 in both shots) excludes bright blob cores and the
            // moving edges, and can read static while the blobs visibly
            // drift (masked 0.008 / corr 1.0 vs unmasked 9.4 on the
            // same pair). Masked numbers are still logged above.
            check(`live ${label}: composited pixels change (unmasked meanAbsDiff >= ${PIXEL_MIN}/255)`,
              img.meanAbsDiffAll >= PIXEL_MIN, `meanAbsDiffAll=${img.meanAbsDiffAll} (masked ${img.meanAbsDiff})`)
            check(`live ${label}: pattern is not identical (unmasked corr(0,0) < ${CORR_MAX})`,
              img.corr00All < CORR_MAX, `corr00All=${img.corr00All} (masked ${img.corr00})`)
            // Best-shift is REPORTED, not gated: it assumes one rigid
            // translation aligns the whole pattern, but the four blobs
            // move independently (manual run: amber (-256,+200), teal
            // (-164,+295), ember (+194,-184), moss (-12,+4) over 23 s),
            // so no single shift aligns them and (0,0) can stay best
            // even while the pattern visibly drifts — the gates above
            // (transform advance + pixels change + not identical)
            // already prove that. The worker's one passing best-shift
            // (-120 px) was phase luck, not a reliable gate.
          } else {
            // WebGL legs: the image numbers are EVIDENCE, not gates.
            // The dye field is dim and smooth and it churns as it
            // blooms/fades, so neither meanAbsDiff nor corr(0,0)
            // separates pre-fix from post-fix: the PRE-FIX control run
            // measured meanAbsDiff 0.721 / corr 0.978 on VENIR (higher
            // change than the post-fix 0.526 — 159 s of dye churn) and
            // corr 0.902 on Home, while the pattern never translated
            // (Δtransform 0.0 px). Gating on them would pass broken
            // builds and fail fixed ones. The positional gate is the
            // transform advance above; the image numbers are reported
            // so a human can see the picture changed too.
          }
        } finally {
          await ap.close()
        }
        await page.close()
      } finally {
        await browser.close()
      }
    }

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

    const legs = [
      { key: 'venir-webgl', label: 'venir-webgl', hash: '#venir', disableWebgl: false },
      { key: 'home-webgl', label: 'home-webgl', hash: '#home', disableWebgl: false },
      { key: 'venir-fallback', label: 'venir-fallback', hash: '#venir', disableWebgl: true },
    ]
    for (const leg of legs) {
      if (wantLegs && !wantLegs.has(leg.key)) continue
      await withRetries(leg.label, () => positionalLeg(leg))
    }
  }
}

console.log(failures === 0 ? 'fix18-fluid-probe: ALL CHECKS PASSED' : `fix18-fluid-probe: ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
