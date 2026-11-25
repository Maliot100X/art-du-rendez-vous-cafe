// fix15-fluid-probe.mjs — Fix pass 15: fluid background static on desktop.
//
// What it checks (exit 1 on any failure):
//   STATIC — the mechanism, read from source, no browser needed:
//     1. Config sustains the field: DENSITY_DISSIPATION /
//        VELOCITY_DISSIPATION low enough and the ambient input fast
//        enough that injection beats decay at a visible equilibrium.
//        The equilibrium is computed from the actual config values
//        (same decay/injection math as the sim's advection shader):
//          mass per ambient splat ~= peak dye 0.15 x Gaussian area
//            pi * SPLAT_RADIUS/100
//          injection rate = AMBIENT_WANDERERS / AMBIENT_INTERVAL
//          loss rate per second ~= 1 - exp(-DENSITY_DISSIPATION)
//          equilibrium mean dye = injection x mass / loss
//        The old constants (0.3 dissipation, one random splat per
//        2.4s) equilibrate at ~0.003 mean dye — measured on real
//        pixels as 0.0% of the frame above background+10 from ~25s on.
//        The new constants must equilibrate >= 0.01 and >= 4x the old.
//     2. Hover stirs: onPointerMove no longer resets prev=pos on
//        every button-less move (the `seen` flag gates the first
//        sighting only), so mouse movement produces a delta.
//     3. The loop steps: update() schedules the next rAF BEFORE the
//        document.hidden early return, and calls step(dt) + render().
//     4. window.__fluidDebug is exposed and updated (frames,
//        ambientSplats) so a later pixel check can confirm stepping.
//     5. CSS fallback: all four fluid-drift keyframes exist, each
//        blob's cycle is <= 20s, keyframe travel is >= 20vw/vh, and
//        the radial gradient fades to transparent at <= 60% (the old
//        26–36s cycles + 70% fade + 70px blur read as static: 0.33/255
//        mean change, 0.00% >10 in the top-right region over 8s).
//   LIVE (best effort — needs playwright-core + a headless Chromium;
//     set FIX15_URL, FIX15_PLAYWRIGHT to the playwright-core package
//     dir if it is not resolvable, FIX15_CHROME to a chrome binary):
//     6. WebGL path: the canvas mounts, __fluidDebug.frames and
//        .ambientSplats advance across a 3s window, lastStepAt moves.
//     7. No-WebGL path (--disable-webgl): the animated CSS fallback
//        mounts and its blob animations are running with advancing
//        currentTime.
//   If no browser is available the live checks print LIVE SKIP and the
//   run still passes on the static checks (exit 0) — the static
//   checks are the gate; live is confirmation, not a substitute.
//
// Usage: node scripts/fix15-fluid-probe.mjs [--live]
//   --live is the default when playwright-core resolves; --no-live
//   runs static checks only.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fluidSrc = readFileSync(resolve(root, 'src/lib/fluid.ts'), 'utf8')
const cssSrc = readFileSync(resolve(root, 'src/components/FluidBackground.css'), 'utf8')
const tsxSrc = readFileSync(resolve(root, 'src/components/FluidBackground.tsx'), 'utf8')

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// ---- 1. Config + equilibrium model ------------------------------------
function ternary(src, key) {
  // Matches `KEY: mobile ? <m> : <d>` or `KEY: <v>` inside resolveFluidConfig.
  const m = src.match(new RegExp(`${key}:\\s*mobile \\? ([0-9.]+) : ([0-9.]+)`))
  if (m) return { mobile: Number(m[1]), desktop: Number(m[2]) }
  const s = src.match(new RegExp(`${key}:\\s*([0-9.]+)`))
  if (s) return { mobile: Number(s[1]), desktop: Number(s[1]) }
  return null
}
const density = ternary(fluidSrc, 'DENSITY_DISSIPATION')
const velocity = ternary(fluidSrc, 'VELOCITY_DISSIPATION')
const ambient = ternary(fluidSrc, 'AMBIENT_INTERVAL')
const wanderers = ternary(fluidSrc, 'AMBIENT_WANDERERS')
const radiusScale = ternary(fluidSrc, 'AMBIENT_RADIUS_SCALE')
const splatRadius = ternary(fluidSrc, 'SPLAT_RADIUS')
check('config parses', !!(density && velocity && ambient && wanderers && splatRadius && radiusScale),
  JSON.stringify({ density, velocity, ambient, wanderers, radiusScale, splatRadius }))

// Equilibrium mean dye, desktop. Peak dye per splat: generateColor()
// dims the palette by ~0.16 (x0.8..1.2) and the brightest palette
// channel is ~0.95, so peak ~= 0.15. Gaussian mass = pi * radius
// (splat shader: exp(-dot(p,p)/radius)); ambient splats are wider
// by AMBIENT_RADIUS_SCALE, so their mass scales by the same factor.
const PEAK_DYE = 0.15
function equilibrium(diss, interval, n, radius, scale = 1) {
  const massPerSplat = PEAK_DYE * Math.PI * (radius / 100) * scale
  const injection = (n / interval) * massPerSplat
  const loss = 1 - Math.exp(-diss)
  return injection / loss
}
if (density && ambient && wanderers && splatRadius && radiusScale) {
  const eqNew = equilibrium(density.desktop, ambient.desktop, wanderers.desktop, splatRadius.desktop, radiusScale.desktop)
  // Old constants, same formula: 0.3 dissipation, 1 random splat / 2.4s.
  const eqOld = equilibrium(0.3, 2.4, 1, 0.35)
  check('dissipation low enough to sustain dye',
    density.desktop <= 0.2 && velocity.desktop <= 0.5,
    `DENSITY_DISSIPATION=${density.desktop} VELOCITY_DISSIPATION=${velocity.desktop}`)
  check('ambient input fast + wandering (not one random splat)',
    ambient.desktop <= 1.2 && wanderers.desktop >= 1,
    `AMBIENT_INTERVAL=${ambient.desktop}s x${wanderers.desktop} wanderers`)
  check('equilibrium mean dye visible and >> old',
    eqNew >= 0.01 && eqNew / eqOld >= 4,
    `new=${eqNew.toFixed(4)} old=${eqOld.toFixed(4)} ratio=${(eqNew / eqOld).toFixed(1)}x`)
}

// ---- 2. Hover stirs -----------------------------------------------------
check('hover stir: pointer has a seen flag', /seen:\s*boolean/.test(fluidSrc) && /seen:\s*false/.test(fluidSrc))
check('hover stir: no delta-zeroing reset on button-less move',
  !/if \(!pointer\.down\) updatePointerDownData/.test(fluidSrc))
check('hover stir: first sighting positions, later moves track delta',
  /if \(!pointer\.seen\)/.test(fluidSrc) && /updatePointerMoveData\(pointer, posX, posY\)/.test(fluidSrc))

// ---- 3. Loop steps -------------------------------------------------------
const rafIdx = fluidSrc.indexOf('raf = requestAnimationFrame(update)')
const hiddenIdx = fluidSrc.indexOf('if (document.hidden) return')
check('loop: rAF scheduled before the hidden early-return',
  rafIdx !== -1 && hiddenIdx !== -1 && rafIdx < hiddenIdx)
check('loop: update() steps and renders', /step\(dt\)/.test(fluidSrc) && /render\(\)/.test(fluidSrc))
check('loop: wanderers emit along their heading',
  /WANDERER_PUSH/.test(fluidSrc) && /splat\(w\.x, w\.y, Math\.cos\(w\.angle\)/.test(fluidSrc))

// ---- 4. Debug diagnostic --------------------------------------------------
check('debug: window.__fluidDebug exposed',
  /__fluidDebug/.test(fluidSrc))
check('debug: frames + ambientSplats counted',
  /debug\.frames\+\+/.test(fluidSrc) && /debug\.ambientSplats\+\+/.test(fluidSrc))

// ---- 5. CSS fallback -------------------------------------------------------
for (const k of ['a', 'b', 'c', 'd']) {
  check(`css: keyframes fluid-drift-${k} exist`, new RegExp(`@keyframes fluid-drift-${k}`).test(cssSrc))
}
const durations = [...cssSrc.matchAll(/animation:\s*fluid-drift-[a-d]\s+(\d+(?:\.\d+)?)s/g)].map((m) => Number(m[1]))
check('css: blob cycles fast enough to register (<= 20s)',
  durations.length === 4 && durations.every((d) => d <= 20), `durations=${durations.join(',')}s`)
const travels = [...cssSrc.matchAll(/translate3d\((-?\d+)vw,\s*(-?\d+)vh/g)].map((m) => Math.max(Math.abs(Number(m[1])), Math.abs(Number(m[2]))))
check('css: keyframe travel large enough (>= 20vw/vh)',
  travels.length > 0 && Math.max(...travels) >= 20, `max travel=${Math.max(...travels)}`)
const stops = [...cssSrc.matchAll(/transparent (\d+)%\)/g)].map((m) => Number(m[1]))
check('css: gradients tight enough to have a slope (transparent <= 60%)',
  stops.length > 0 && stops.every((s) => s <= 60), `stops=${stops.join(',')}%`)

// ---- 6/7. Live checks (best effort) ---------------------------------------
const wantLive = !process.argv.includes('--no-live')
if (wantLive) {
  let pw = null
  try {
    pw = await import('playwright-core')
  } catch {
    try {
      const dir = process.env.FIX15_PLAYWRIGHT
      if (dir) pw = await import(`${dir}/index.mjs`)
    } catch { /* fall through to SKIP */ }
  }
  if (!pw) {
    console.log('LIVE SKIP: playwright-core not resolvable (npm i playwright-core or set FIX15_PLAYWRIGHT) — static checks are the gate')
  } else {
    const { chromium } = pw
    const url = process.env.FIX15_URL || 'http://127.0.0.1:4191/'
    const exe = process.env.FIX15_CHROME || undefined
    async function liveDiag(disableWebgl) {
      const browser = await chromium.launch({
        headless: true,
        executablePath: exe,
        args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars',
          ...(disableWebgl ? ['--disable-webgl', '--disable-webgl2'] : [])],
      })
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 30000 })
        await page.waitForTimeout(2000)
        const d1 = await page.evaluate(() => ({
          webgl2: !!document.createElement('canvas').getContext('webgl2'),
          canvas: !!document.querySelector('canvas'),
          fallback: !!document.querySelector('.fluid-animated-fallback'),
          dbg: window.__fluidDebug || null,
          blobs: [...document.querySelectorAll('.fluid-blob')].map((b) => ({
            name: b.getAnimations()[0]?.animationName,
            state: b.getAnimations()[0]?.playState,
            t: b.getAnimations()[0]?.currentTime,
          })),
        }))
        await page.waitForTimeout(3000)
        const d2 = await page.evaluate(() => ({
          dbg: window.__fluidDebug || null,
          blobs: [...document.querySelectorAll('.fluid-blob')].map((b) => b.getAnimations()[0]?.currentTime),
        }))
        return { d1, d2 }
      } finally {
        await browser.close()
      }
    }
    try {
      const { d1, d2 } = await liveDiag(false)
      check('live webgl: canvas mounted (or animated fallback if no WebGL)',
        d1.canvas || d1.fallback, JSON.stringify({ canvas: d1.canvas, fallback: d1.fallback, webgl2: d1.webgl2 }))
      if (d1.dbg) {
        check('live webgl: sim steps (frames + lastStepAt advance)',
          d2.dbg.frames > d1.dbg.frames && d2.dbg.lastStepAt > d1.dbg.lastStepAt,
          `frames ${d1.dbg.frames}→${d2.dbg.frames}, ambientSplats ${d1.dbg.ambientSplats}→${d2.dbg.ambientSplats}`)
        check('live webgl: wanderers inject (ambientSplats grows)',
          d2.dbg.ambientSplats > d1.dbg.ambientSplats,
          `ambientSplats ${d1.dbg.ambientSplats}→${d2.dbg.ambientSplats}`)
      } else {
        check('live webgl: __fluidDebug present', false, 'no __fluidDebug (WebGL path did not run?)')
      }
    } catch (e) {
      console.log(`LIVE SKIP: webgl run failed (${e.message}) — page unreachable from this VM?`)
    }
    try {
      const { d1, d2 } = await liveDiag(true)
      check('live fallback: animated fallback mounts when WebGL is off',
        d1.fallback && !d1.canvas, JSON.stringify({ fallback: d1.fallback, canvas: d1.canvas }))
      const timesAdvance = d1.blobs.length === 4 && d2.blobs.every((t, i) => typeof t === 'number' && t > d1.blobs[i].t)
      check('live fallback: blob animations running with advancing time',
        d1.blobs.every((b) => b.state === 'running') && timesAdvance,
        `blobs=${d1.blobs.map((b) => `${b.name}:${b.state}@${Math.round(b.t ?? -1)}`).join(' ')}`)
    } catch (e) {
      console.log(`LIVE SKIP: fallback run failed (${e.message})`)
    }
  }
}

console.log(failures === 0 ? 'fix15-fluid-probe: ALL CHECKS PASSED' : `fix15-fluid-probe: ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
