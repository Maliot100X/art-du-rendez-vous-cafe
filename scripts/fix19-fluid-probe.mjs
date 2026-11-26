// fix19-fluid-probe.mjs — Fix pass 19: ACCUEIL must VISIBLY move in 22 s.
//
// ROOT CAUSE (diagnosed from the code + fix-18's own logs, not guessed):
//   The fix-18 cloud check (06:34–06:42 CET) split: VENIR drifts (PASS)
//   but ACCUEIL is effectively static in 22 s (mean 0.72–2.51, 0–2.1% of
//   pixels changed, golden dots identical). NOT a mount problem: the
//   background mounts ONCE at the app root (App.tsx) and is identical on
//   every tab, and fix 18's own VM probe measured the pan advancing on
//   Home too (65.7 px / 32 s). It is a rate x contrast x coverage
//   problem:
//   - 120 s cycle = ~2 px/s, ~42 px in 22 s, and the field is 6 big soft
//     dim splats (SPLAT_RADIUS 0.35, dye x0.16) over smooth gradients —
//     a 42 px shift of a field that varies over 200–400 px scales
//     changes most pixels by a few levels. Fix 18's own probe documented
//     that meanAbsDiff/corr cannot separate pre-fix from post-fix on
//     this field (pre-fix control 0.721 / corr 0.978).
//   - Home hides most of the field: the hero's intro panel (bg-ink/85
//     + blur), the full-bleed opaque photo frame and the giant title
//     cover most of the first viewport; the fluid shows only in thin
//     gutters/gaps. VENIR is text-only and mostly bare fluid. Same pan,
//     same field, different visible area: that is the split.
//   - The "golden dots in identical positions" are the HeroDust motes
//     (a separate Home-only component): its whole cloud only rotates
//     sin(t*0.05)*0.08 rad and bobs sin(t*0.12)*0.25 — individual motes
//     never translate. That is a HeroDust item, not a fluid item; this
//     pass does not touch it (flagged in the fix-19 report).
//   Fix 19 (FluidBackground only): pan 120 s -> 30 s, travel
//   +/-6vw/+/-4vh -> +/-8vw/+/-5vh (oversize 114% -> 118%, inset -9%):
//   ~10 px/s, ~220 px in 22 s. Dye x0.16 -> x0.30. Sixteen ember motes
//   inside the panning wrapper, each on its own 16–26 s wall-clock
//   cycle, 150–260 px travel (four added after the first probe run
//   showed the bottom-right corner reading weak on both tabs).
//
//   Gate calibration (measured, not guessed — see the run log in the
//   fix-19 report): the OLD build on this same VM rig read full-viewport
//   1.564 / 4.63% on Home; the new build reads 2.36–3.51 / 7.6–14.4%
//   across runs. The full-viewport mean on Home is diluted by the
//   ~65% of the viewport that is opaque static content (photo frame,
//   intro panel, title), so its ceiling there is ~3–3.5 and it swings
//   ±20% run to run on dye-churn luck; the gate is therefore the
//   conjunction mean >= 2.0 AND pct>10 >= 5% (old build fails both,
//   new build passes both, both runs), with the corner region held to
//   the stricter 2.5 / 5% and the transform to >= 100 px (old 51–70 px,
//   new 179–314 px). The cloud check's old ACCUEIL reading was
//   0.72–2.51 mean / 0–2.1% changed — the pct leg is the one that
//   separates the builds there (new: 7.6–14.4%).
//   UPDATE after the third full run: the swing is bigger than ±20% and
//   it is NOT noise in the pan — it is a DYE LOTTERY. Three runs of
//   the same build read Home top-left 6.59 / 2.81 / 1.09 while VENIR
//   stayed 3.6–5.3: the 6 opening splats landed at fully random
//   positions, so on some loads a corner had no dye at all and the pan
//   moved an empty field there. The fix is deterministic spread
//   placement (fluid.ts OPENING_SPREAD: one splat per region, corners
//   included, ±0.06 jitter) — the numbers above are therefore the
//   pre-spread baseline, and the spread build must read consistently,
//   not just once. If a re-run still swings like that, the spread did
//   not take (or the region is covered by static UI) — do not lower
//   the gate to hide it.
//
// What it checks (exit 1 on any failure):
//   STATIC:
//     1. fluid-pan is 30s linear infinite alternate, +/-8vw/+/-5vh.
//     2. .fluid-canvas has EXPLICIT width/height 118% and inset -9%
//        (the replaced-element sizing fix, grown for the wider pan).
//     3. 16 ember motes render inside the drift wrapper, each with its
//        own --dx/--dy travel and 16–26 s duration.
//     4. Reduced motion kills the drift AND the mote animations.
//     5. Dye scale is 0.24 and the fix-18 sim nudge is intact.
//   LIVE (Playwright, SwiftShader; set FIX19_URL, FIX19_PLAYWRIGHT,
//     FIX19_CHROME as in fix17/18):
//     The gate is PIXELS, not transform: three full-viewport shots per
//     leg (t≈0, t≈22 s, t≈44 s, no input), analysed in three regions
//     (full viewport, top-left 400x300, bottom-right 400x300 — the
//     cloud check's corner regions). For every pair (A→B, B→C, A→C)
//     report unmasked meanAbsDiff/255, % pixels changed >10, and
//     corr(0,0); the gate uses the MAX pair per region. Gates per leg:
//       * max-pair full-viewport meanAbsDiff >= 2.0 AND pct>10 >= 5%
//         (calibration: old build on this rig 1.564 / 4.63%; new build
//         2.36–3.51 / 7.6–14.4%; see header for why mean is 2.0 not 2.5)
//       * at least one corner region meets meanAbsDiff >= 2.5 AND
//         pct>10 >= 5%
//       * max transform advance across the pairs >= 100 px over >= 22 s
//         (fix-18's pan measured 51–70 px; the 30 s pan must show ~5x)
//     Stale-frame defeat (the fix-18 trap: screenshots came back
//     identical 23 s apart while the DOM transform had advanced ~750 px,
//     because a screenshot does NOT force a fresh frame in SwiftShader):
//     double-rAF settle (2 s race) + forced style flush before EVERY
//     shot, three shots instead of two (a single stale shot can zero
//     one pair but not all three), and the gate takes the MAX pair.
//     If every pair reads ~0 while the transform advanced, the probe
//     FAILS honestly (stale surface) instead of passing on transform.
//     The cloud check (real browser, produces frames) is the arbiter
//     for the real visual drift.
//   If no browser is available the live checks print LIVE SKIP and the
//   run still passes on the static checks (exit 0). A live leg that
//   FAILS (not skips) fails the run.
//   Serve the built site first (npm run build && vite preview) and
//   point FIX19_URL at it. Screenshots land in /tmp/fix19-fluid/.
//
// Usage: node scripts/fix19-fluid-probe.mjs [--live-only] [--legs=a,b]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cssSrc = readFileSync(resolve(root, 'src/components/FluidBackground.css'), 'utf8')
const tsxSrc = readFileSync(resolve(root, 'src/components/FluidBackground.tsx'), 'utf8')
const fluidSrc = readFileSync(resolve(root, 'src/lib/fluid.ts'), 'utf8')
const SHOT_DIR = '/tmp/fix19-fluid'
mkdirSync(SHOT_DIR, { recursive: true })

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
  check('static: fluid-pan is 30s linear infinite alternate',
    /\.fluid-drift\s*\{[^}]*animation:\s*fluid-pan 30s linear infinite alternate/.test(cssSrc))
  const pan = cssSrc.match(/@keyframes fluid-pan\s*\{([\s\S]*?)\n\}/)
  check('static: fluid-pan translates ±8vw/±5vh',
    !!pan && /translate3d\(-8vw, -5vh, 0\)/.test(pan[1]) && /translate3d\(8vw, 5vh, 0\)/.test(pan[1]),
    pan ? 'keyframes found' : 'no fluid-pan keyframes')
  const canvasRule = cssSrc.match(/\.fluid-canvas\s*\{([\s\S]*?)\}/)
  check('static: fluid-canvas has explicit 118% width/height + inset -9% (replaced-element fix)',
    !!canvasRule && /width:\s*118%/.test(canvasRule[1]) && /height:\s*118%/.test(canvasRule[1]) && /inset:\s*-9%/.test(canvasRule[1]),
    canvasRule ? canvasRule[1].replace(/\s+/g, ' ').trim() : 'no .fluid-canvas rule')
  const underlayRule = cssSrc.match(/\.fluid-underlay\s*\{([\s\S]*?)\}/)
  check('static: fluid-underlay inset -9% (oversize matches the wider pan)',
    !!underlayRule && /inset:\s*-9%/.test(underlayRule[1]))
  const motes = tsxSrc.match(/const MOTES[\s\S]*?^\]/m)
  const moteCount = motes ? (motes[0].match(/left: '/g) || []).length : 0
  check('static: 16 ember motes defined in FluidBackground.tsx',
    moteCount === 16, `found ${moteCount}`)
  check('static: motes render inside the drift wrapper with per-mote --dx/--dy + duration',
    /className="fluid-motes absolute inset-0"/.test(tsxSrc) &&
    /\['--dx' as string\]: `\$\{m\.dx\}px`/.test(tsxSrc) &&
    /\['--dy' as string\]: `\$\{m\.dy\}px`/.test(tsxSrc) &&
    /animationDuration: m\.dur/.test(tsxSrc))
  check('static: mote keyframes exist (fluid-mote-drift, translate via --dx/--dy)',
    /@keyframes fluid-mote-drift/.test(cssSrc) &&
    /translate3d\(var\(--dx, 180px\), var\(--dy, 100px\), 0\)/.test(cssSrc))
  check('static: reduced motion kills the drift AND the mote animations',
    /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.fluid-drift\s*\{\s*animation:\s*none/.test(cssSrc) &&
    /\.fluid-mote\s*\{\s*animation:\s*none/.test(cssSrc))
  check('static: dye brighter (generateColor scale 0.30) + sim nudge intact',
    /const s = 0.3 \* \(0\.8 \+ Math\.random\(\) \* 0\.4\)/.test(fluidSrc) &&
    /WANDERER_SPEED = 0\.08/.test(fluidSrc) && /WANDERER_PUSH = 900/.test(fluidSrc) &&
    /VELOCITY_DISSIPATION: 0\.3/.test(fluidSrc))
  check('static: opening splats spread over the viewport (one per region, not random)',
    /const OPENING_SPREAD/.test(fluidSrc) &&
    /\[0\.15, 0\.18\]/.test(fluidSrc) && /\[0\.85, 0\.15\]/.test(fluidSrc) &&
    /\[0\.18, 0\.78\]/.test(fluidSrc) && /\[0\.82, 0\.8\]/.test(fluidSrc) &&
    /const \[sx, sy\] = OPENING_SPREAD\[i % OPENING_SPREAD\.length\]/.test(fluidSrc))
  check('static: no-WebGL fallback still animated (4 blobs)',
    /fluid-blob--amber/.test(cssSrc) && /fluid-blob--teal/.test(cssSrc) &&
    /fluid-blob--ember/.test(cssSrc) && /fluid-blob--moss/.test(cssSrc) &&
    /if \(failed\) return <FluidFallback animated \/>/.test(tsxSrc))
}

// ---- Live checks -----------------------------------------------------------
const wantLive = !process.argv.includes('--no-live')
const TRANSFORM_MIN = 100 // screen px, max across pairs (fix-18 pan: 51–70 px)
const PIXEL_MIN = 2.0 // /255 mean absolute change, max pair (cloud ACCUEIL: 0.72–2.51)
const CORNER_PIXEL_MIN = 2.5 // corner regions are mostly bare fluid, so they are held stricter
const PCT_MIN = 5 // % pixels changed >10, max pair (cloud ACCUEIL: 0–2.1%)
const CORR_MAX = 0.995 // corr(0,0) must drop below this on the gated pair
const DS = 5 // downsample factor for the analysis grids (1 grid px = 5 screen px)
const REGIONS = {
  full: null, // whole viewport
  topLeft: { x: 0, y: 0, width: 400, height: 300 },
  bottomRight: { x: 1520, y: 700, width: 400, height: 300 },
}

if (wantLive) {
  let pw = null
  try {
    pw = await import('playwright-core')
  } catch {
    try {
      const dir = process.env.FIX19_PLAYWRIGHT
      if (dir) pw = await import(`${dir}/index.mjs`)
    } catch { /* fall through */ }
    if (!pw) {
      try {
        pw = await import('/home/hatch/workspace/.fix15-tools/node_modules/playwright-core/index.mjs')
      } catch { /* fall through to SKIP */ }
    }
  }
  if (!pw) {
    console.log('LIVE SKIP: playwright-core not resolvable (npm i playwright-core or set FIX19_PLAYWRIGHT) — static checks are the gate')
  } else {
    const { chromium } = pw
    const url = process.env.FIX19_URL || 'http://127.0.0.1:4173/'
    const exe = process.env.FIX19_CHROME ||
      `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`
    const LAUNCH = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--force-device-scale-factor=1']

    async function makeAnalyser(browser) {
      const page = await browser.newPage()
      await page.setContent('<canvas id="c"></canvas>', { timeout: 120000 })
      const analyse = async (a, b) => page.evaluate(async ({ a, b, DS, REGIONS }) => {
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
        const stats = (rect) => {
          const x0 = rect ? Math.floor(rect.x / DS) : 0
          const y0 = rect ? Math.floor(rect.y / DS) : 0
          const x1 = rect ? Math.min(W, Math.ceil((rect.x + rect.width) / DS)) : W
          const y1 = rect ? Math.min(H, Math.ceil((rect.y + rect.height) / DS)) : H
          let sum = 0
          let n = 0
          let over10 = 0
          let ma = 0
          let mb = 0
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const i = y * W + x
            ma += ga[i]
            mb += gb[i]
            n++
          }
          ma /= n
          mb /= n
          let num = 0
          let da = 0
          let db = 0
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const i = y * W + x
            const d = Math.abs(ga[i] - gb[i])
            sum += d
            if (d > 10) over10++
            const va = ga[i] - ma
            const vb = gb[i] - mb
            num += va * vb
            da += va * va
            db += vb * vb
          }
          const corr = da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0
          return {
            meanAbsDiff: +(sum / n).toFixed(3),
            pctOver10: +(100 * over10 / n).toFixed(2),
            corr00: +corr.toFixed(4),
          }
        }
        const out = {}
        for (const [name, rect] of Object.entries(REGIONS)) out[name] = stats(rect)
        return out
      }, { a: a.toString('base64'), b: b.toString('base64'), DS, REGIONS })
      return { page, analyse }
    }

    async function freshShot(page, label) {
      // Stale-frame defeat: a screenshot does NOT force a fresh frame in
      // SwiftShader (fix 18: identical shots 23 s apart while the DOM
      // transform advanced ~750 px). Before every shot, force a style
      // flush (computed-transform read) and a double-rAF settle (2 s
      // race) so the compositor commits at wall-clock time; the shot
      // then captures the fresh state. Best-effort: if the settle
      // throws, the shot runs anyway.
      try {
        await page.evaluate(() => {
          const el = document.querySelector('.fluid-drift')
          if (el) void getComputedStyle(el).transform
          void document.body.offsetHeight
          return Promise.race([
            new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
            new Promise((r) => setTimeout(r, 2000)),
          ])
        })
      } catch { /* settle is best-effort */ }
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          return await page.screenshot({ timeout: 300000 })
        } catch (e) {
          console.log(`  shot ${label} attempt ${attempt} failed: ${String(e?.message ?? e).split('\n')[0]}`)
          if (attempt === 2) throw e
        }
      }
      throw new Error(`unreachable: shot ${label}`)
    }

    function parseTransform(t) {
      if (!t || t === 'none') return { x: 0, y: 0 }
      const m = t.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*([-\d.]+),\s*([-\d.]+)\)/)
      return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 }
    }

    async function pixelLeg({ label, hash }) {
      const browser = await chromium.launch({
        headless: true,
        executablePath: exe,
        args: LAUNCH,
      })
      try {
        const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } })
        await page.goto(url + hash, { waitUntil: 'load', timeout: 120000 })
        await page.waitForFunction(() => !!document.querySelector('canvas') && !!window.__fluidDebug, null, { timeout: 600000, polling: 1000 })
        await page.waitForTimeout(1000)
        check(`live ${label}: fluid canvas mounts on ${hash}`, !!(await page.evaluate(() => document.querySelector('canvas'))))
        const canvasRect = await page.evaluate(() => {
          const c = [...document.querySelectorAll('canvas')].find((el) => el.closest('div.fixed.inset-0'))
          if (!c) return null
          const r = c.getBoundingClientRect()
          return { w: Math.round(r.width), h: Math.round(r.height) }
        })
        check(`live ${label}: fluid canvas covers the viewport (>= 1920x1000)`,
          !!canvasRect && canvasRect.w >= 1920 && canvasRect.h >= 1000,
          canvasRect ? `${canvasRect.w}x${canvasRect.h}` : 'no fluid canvas')
        const moteCount = await page.evaluate(() => document.querySelectorAll('.fluid-mote').length)
        check(`live ${label}: 16 ember motes mounted`, moteCount === 16, `found ${moteCount}`)
        const readTransform = () => page.evaluate(() => {
          const el = document.querySelector('.fluid-drift')
          return el ? getComputedStyle(el).transform : null
        })
        const readFrames = () => page.evaluate(() => window.__fluidDebug?.frames ?? null)

        // Three shots, >= 22 s apart, no input. The gate takes the MAX
        // pair: one stale shot can zero a pair, but not all three.
        const shots = []
        const transforms = []
        const frames = []
        const t0 = Date.now()
        for (let i = 0; i < 3; i++) {
          if (i > 0) {
            // Wait until 22 s after the previous shot's wall time.
            const elapsed = Date.now() - shots[i - 1].wall
            if (22000 - elapsed > 0) await page.waitForTimeout(22000 - elapsed)
          }
          const buf = await freshShot(page, `${label}/${'ABC'[i]}`)
          const wall = Date.now()
          const tr = parseTransform(await readTransform())
          const fr = await readFrames()
          shots.push({ buf, wall })
          transforms.push(tr)
          frames.push(fr)
          writeFileSync(resolve(SHOT_DIR, `${label}-${'ABC'[i]}.png`), buf)
          console.log(`  ${label}: shot ${'ABC'[i]} at +${((wall - t0) / 1000).toFixed(0)}s, transform=(${tr.x.toFixed(1)}, ${tr.y.toFixed(1)}), sim frames=${fr}`)
        }
        const { page: ap, analyse } = await makeAnalyser(browser)
        try {
          const pairs = [[0, 1, 'A→B'], [1, 2, 'B→C'], [0, 2, 'A→C']]
          const results = []
          for (const [i, j, name] of pairs) {
            const adv = Math.hypot(transforms[j].x - transforms[i].x, transforms[j].y - transforms[i].y)
            const secs = (shots[j].wall - shots[i].wall) / 1000
            const img = await analyse(shots[i].buf, shots[j].buf)
            results.push({ name, adv, secs, img })
            console.log(`  ${label} ${name} (${secs.toFixed(0)}s, Δtransform ${adv.toFixed(1)}px): full meanAbsDiff=${img.full.meanAbsDiff} pct>10=${img.full.pctOver10}% corr=${img.full.corr00} | TL meanAbsDiff=${img.topLeft.meanAbsDiff} pct>10=${img.topLeft.pctOver10}% corr=${img.topLeft.corr00} | BR meanAbsDiff=${img.bottomRight.meanAbsDiff} pct>10=${img.bottomRight.pctOver10}% corr=${img.bottomRight.corr00}`)
          }
          const maxAdv = Math.max(...results.map((r) => r.adv))
          const bestFull = results.reduce((a, b) => (b.img.full.meanAbsDiff > a.img.full.meanAbsDiff ? b : a))
          const bestCorner = results.reduce((a, b) => {
            const ma = Math.max(b.img.topLeft.meanAbsDiff, b.img.bottomRight.meanAbsDiff)
            const mb = Math.max(a.img.topLeft.meanAbsDiff, a.img.bottomRight.meanAbsDiff)
            return ma > mb ? b : a
          })
          const cornerBest = Math.max(bestCorner.img.topLeft.meanAbsDiff, bestCorner.img.bottomRight.meanAbsDiff)
          const cornerPct = bestCorner.img.topLeft.meanAbsDiff >= bestCorner.img.bottomRight.meanAbsDiff
            ? bestCorner.img.topLeft.pctOver10 : bestCorner.img.bottomRight.pctOver10
          const cornerName = bestCorner.img.topLeft.meanAbsDiff >= bestCorner.img.bottomRight.meanAbsDiff ? 'top-left' : 'bottom-right'
          check(`live ${label}: pixels move (max-pair full-viewport meanAbsDiff >= ${PIXEL_MIN}/255, pct>10 >= ${PCT_MIN}%)`,
            bestFull.img.full.meanAbsDiff >= PIXEL_MIN && bestFull.img.full.pctOver10 >= PCT_MIN,
            `best pair ${bestFull.name}: meanAbsDiff=${bestFull.img.full.meanAbsDiff} pct>10=${bestFull.img.full.pctOver10}% corr=${bestFull.img.full.corr00}`)
          check(`live ${label}: pattern is not identical (max-pair full corr(0,0) < ${CORR_MAX})`,
            bestFull.img.full.corr00 < CORR_MAX, `corr=${bestFull.img.full.corr00} on ${bestFull.name}`)
          check(`live ${label}: a corner region moves too (max ${cornerName} meanAbsDiff >= ${CORNER_PIXEL_MIN}, pct>10 >= ${PCT_MIN}%)`,
            cornerBest >= CORNER_PIXEL_MIN && cornerPct >= PCT_MIN,
            `best pair ${bestCorner.name} ${cornerName}: meanAbsDiff=${cornerBest} pct>10=${cornerPct}%`)
          check(`live ${label}: pattern drifts positionally (max transform advance >= ${TRANSFORM_MIN}px over >= 22s, no input)`,
            maxAdv >= TRANSFORM_MIN && Math.max(...results.map((r) => r.secs)) >= 22,
            `max Δtransform=${maxAdv.toFixed(1)}px, sim frames ${frames[0]}→${frames[2]}`)
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
      { key: 'home-webgl', label: 'home-webgl', hash: '#home' },
      { key: 'venir-webgl', label: 'venir-webgl', hash: '#venir' },
    ]
    for (const leg of legs) {
      if (wantLegs && !wantLegs.has(leg.key)) continue
      await withRetries(leg.label, () => pixelLeg(leg))
    }
  }
}

console.log(failures === 0 ? 'fix19-fluid-probe: ALL CHECKS PASSED' : `fix19-fluid-probe: ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
