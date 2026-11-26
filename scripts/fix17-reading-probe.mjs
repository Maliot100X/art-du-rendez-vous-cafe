/**
 * Fix pass 17 probe — a finished reading stays finished across book
 * page turns (group 4).
 *
 * Run from the repo root:  node scripts/fix17-reading-probe.mjs [--no-live]
 * Exit 0 = all checks pass, 1 = at least one fails.
 *
 * THE BUG (cloud check 2026-11-26 00:03-00:08 CET, master 8e30543):
 * after a Boissons Chaudes reading finished on its own, turning the
 * book to Bières brought back "Lecture en cours… · Bières" with
 * "Couper la voix"; turning from Vins to Apéritifs re-showed
 * "Lecture en cours… · Vins". Fix 16's probe passed 42/42 on this VM
 * because it never turned the book after a reading finished — its
 * book check (LIVE6) only waited 5 s on the same page, and its menu
 * check (LIVE3) only switched the MENU category tab, which (fix 13)
 * correctly starts no reading.
 *
 * ROOT CAUSE (src/App.tsx, BookTab): the Livre tab has its OWN
 * reading system, separate from the menu store (readingStore.ts),
 * and it auto-starts a reading on EVERY book event:
 *   (1) the onBookCategory subscription restarts a fresh 12 s
 *       reading on every flip landing — so any page turn after a
 *       reading finished looks exactly like a resurrection (same
 *       "Lecture en cours… · <new category>" + "Couper la voix");
 *   (2) the mount initialiser starts a reading from goToCategory,
 *       so the book opening after a finished menu reading shows a
 *       second, phantom 12 s "reading" for that category even though
 *       nothing is being spoken any more (the real reading already
 *       finished on the Menu tab and the open is its payoff).
 * Neither path is an explicit ask, so both violate the fix-13 rule
 * (readings start ONLY from "Demander à la barmaid" / an explicit
 * chat ask). The fix removes both: flip landings only consume the
 * book target, and BookTab mounts with no reading.
 *
 * Live checks (real browser, real timers): the exact cloud repros —
 *   L1  bare turn, no prior reading: fresh Livre tab, turn the book
 *       twice, zero reading indicators at any point;
 *   L2  menu ask Boissons Chaudes -> finishes -> book auto-opens ->
 *       its reading finishes -> turn to Bières, then to Boissons
 *       Froides: zero indicators, no auto-start;
 *   L3  book ask Vins -> finishes -> turn to Apéritifs, then to
 *       Liqueurs: zero indicators, no auto-start;
 *   L4  regression: an explicit "Demander à la barmaid" on the
 *       Livre tab still starts a reading (indicator appears);
 *   L5  regression: menu category switch after a finish stays off.
 * Static checks: no flip-landing / mount reading start remains in
 * BookTab, the target is still consumed on landing, askBartender
 * still starts a reading, and the Agent flip log is untouched.
 *
 * HARNESS NOTES (this VM, measured 2026-11-26): the animated book
 * path cannot be driven here — rAF ticks ~2 frames in 5 s under
 * SwiftShader + the Live2D prewarm, so the GSAP flip tween (rAF
 * driven) never completes inside a probe window and its onComplete
 * emit never fires; Playwright .click() also times out waiting for
 * elements to go "stable", which never happens on this loaded page.
 * The live checks therefore run with prefers-reduced-motion, where
 * MenuBook is static and goTo() emits synchronously, and drive all
 * buttons with DOM clicks (the probe tests the reading, not
 * clickability — same as fix16's book-button clicks). What is under
 * test is the emit -> BookTab subscription path, which is identical
 * in both modes; on a real browser the tween completes in ~0.9 s
 * and the same emit fires. The cloud check that caught this bug ran
 * a real browser, where the tween completes.
 *
 * By default the probe builds the worktree and serves its own dist
 * with `vite preview` on an ephemeral port; set FIX17_URL to point
 * it at an already-running server instead (then no build/serve is
 * done, but the served asset is still verified to be this tree's
 * dist). Playwright resolution: bare `playwright-core` import, then
 * FIX17_PLAYWRIGHT (package dir), then the fix-15 tools copy.
 * Chromium: FIX17_CHROME or ~/.cache/ms-playwright/chromium-1255.
 *
 * Usage:
 *   node scripts/fix17-reading-probe.mjs [--no-live]
 *   FIX17_URL=http://127.0.0.1:4193/ node scripts/fix17-reading-probe.mjs
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const app = read('src/App.tsx')

// ---------------------------------------------------------------------
// Static checks on BookTab.
// ---------------------------------------------------------------------
check(
  'S1 flip landings no longer start a reading (no setReading/armReadingTimer in the onBookCategory subscription)',
  (() => {
    const i = app.indexOf('onBookCategory((catId) => {')
    if (i === -1) return false
    const block = app.slice(i, app.indexOf('}),', i))
    return !block.includes('setReading(') && !block.includes('armReadingTimer(')
  })(),
)
check(
  'S2 flip landings still consume the book target on landing',
  (() => {
    const i = app.indexOf('onBookCategory((catId) => {')
    if (i === -1) return false
    const block = app.slice(i, app.indexOf('}),', i))
    return block.includes('onTargetConsumedRef.current?.()')
  })(),
)
check(
  'S3 BookTab mounts with no reading (initialiser is null, not goToCategory)',
  app.includes('useState<{ categoryId: string; nonce: number; seconds?: number } | null>(() => null)') ||
    app.includes('useState<{ categoryId: string; nonce: number; seconds?: number } | null>(() =>\n    null'),
)
check(
  'S4 no mount effect arms a reading timer for an initial reading',
  !/if \(reading\) armReadingTimer\(reading\.nonce/.test(app),
)
check(
  'S5 explicit ask on the Livre tab still starts a reading (askBartender setReading + armReadingTimer)',
  (() => {
    const i = app.indexOf('const askBartender = useCallback(')
    if (i === -1) return false
    const block = app.slice(i, app.indexOf('},\n    [armReadingTimer],', i))
    return block.includes('setReading({ categoryId: catId, nonce, seconds: 12 })') && block.includes('armReadingTimer(nonce, 12)')
  })(),
)
check(
  'S6 the Agent flip log is untouched (Agent.tsx still subscribes to onBookCategory)',
  read('src/components/Agent.tsx').includes('onBookCategory(handleCategory)'),
)
check(
  'S7 the menu store is untouched by this fix (retimeReading still the only re-time path)',
  read('src/lib/readingStore.ts').includes('export function retimeReading(nonce: number, catId: string, seconds: number): boolean'),
)

// ---------------------------------------------------------------------
// Live rendered checks (best effort).
// ---------------------------------------------------------------------
const wantLive = !process.argv.includes('--no-live')
let previewProc = null
let base = process.env.FIX17_URL || null

async function startPreviewServer() {
  console.log('BUILD  npm run build …')
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' })
  console.log('BUILD  ok')
  // Spawn vite directly (no npm wrapper) in its own process group so
  // the server can be killed reliably at the end (an npm-wrapped
  // spawn survives a SIGTERM to the wrapper).
  previewProc = spawn(
    join(root, 'node_modules', '.bin', 'vite'),
    ['preview', '--port', '0', '--strictPort'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  )
  const out = await new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => reject(new Error('vite preview did not print a URL in 30 s')), 30000)
    const onData = (d) => {
      buf += d.toString()
      const m = buf.match(/Local:\s+(http:\/\/[^\s]+)/)
      if (m) {
        clearTimeout(timer)
        previewProc.stdout.off('data', onData)
        previewProc.stderr.off('data', onData)
        resolve(m[1])
      }
    }
    previewProc.stdout.on('data', onData)
    previewProc.stderr.on('data', onData)
    previewProc.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })
  base = out.endsWith('/') ? out : `${out}/`
  console.log(`SERVE  preview at ${base}`)
}

if (wantLive) {
  let pw = null
  try {
    pw = await import('playwright-core')
  } catch {
    try {
      const dir = process.env.FIX17_PLAYWRIGHT || join(homedir(), 'workspace', '.fix15-tools', 'node_modules', 'playwright-core')
      pw = await import(`${dir}/index.mjs`)
    } catch { /* fall through to SKIP */ }
  }
  if (!pw) {
    console.log('LIVE SKIP: playwright-core not resolvable (set FIX17_PLAYWRIGHT) — static checks are the gate')
  } else {
    const { chromium } = pw
    if (!base) {
      try {
        await startPreviewServer()
      } catch (err) {
        check('LIVE0 build + preview server start', false, err.message)
      }
    }
    if (base) {
      // Identity: the served index must be THIS worktree's own dist.
      try {
        const served = await (await fetch(base)).text()
        const local = read('dist/index.html')
        const asset = served.match(/assets\/index-[A-Za-z0-9_-]+\.js/)
        check(
          "LIVE0 served index is this worktree's own dist (asset hash matches dist/index.html)",
          asset !== null && local.includes(asset[0]),
          asset ? `asset=${asset[0]}` : 'no asset in served index',
        )
      } catch (err) {
        check("LIVE0 served index is this worktree's own dist", false, err.message)
      }

      const exe = process.env.FIX17_CHROME || join(homedir(), '.cache', 'ms-playwright', 'chromium-1255', 'chrome-linux64', 'chrome')
      let browser = null
      try {
        browser = await chromium.launch({
          headless: true,
          executablePath: exe,
          args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
        })

        const readingIndicators = async (page) => {
          const text = await page.locator('text=Lecture en cours').count()
          const stop = await page.getByRole('button', { name: 'Couper la voix' }).count()
          return { text, stop, total: text + stop }
        }
        const clickBookButton = async (page, label) => {
          // MenuBook is lazy (React.lazy): on the first Livre mount
          // the controls do not exist until its chunk arrives, so
          // wait for the button instead of assuming it is mounted.
          await page.waitForFunction(
            (l) => [...document.querySelectorAll('button')].some(
              (b) => b.getAttribute('aria-label') === l || (b.textContent || '').includes(l),
            ),
            label,
            { timeout: 120000 },
          )
          await page.evaluate((l) => {
            const btn = [...document.querySelectorAll('button')].find(
              (b) => b.getAttribute('aria-label') === l || b.textContent?.includes(l),
            )
            if (!btn) throw new Error(`book button not found: ${l}`)
            if (btn.disabled) throw new Error(`book button disabled: ${l}`)
            btn.click()
          }, label)
        }
        /** Assert zero indicators now and at +3 s and +5 s (a late
            resurrection must not slip through a single snapshot). */
        const assertStayedOff = async (page, name) => {
          for (const wait of [0, 3000, 2000]) {
            if (wait) await page.waitForTimeout(wait)
            const n = await readingIndicators(page)
            if (n.total !== 0) {
              check(name, false, `indicators=${n.total} (text=${n.text} stop=${n.stop})`)
              return
            }
          }
          check(name, true)
        }
        const waitIndicatorVisible = async (page, timeoutMs = 30000) => {
          await page.locator('text=Lecture en cours').first().waitFor({ state: 'visible', timeout: timeoutMs })
        }
        const waitIndicatorGone = async (page, timeoutMs = 180000) => {
          const t0 = Date.now()
          while (Date.now() - t0 < timeoutMs) {
            if ((await readingIndicators(page)).total === 0) return Date.now() - t0
            await page.waitForTimeout(1000)
          }
          return -1
        }
        const newPage = async () => browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
        /** DOM clicks: Playwright .click() waits for the element to
            go "stable", which never happens on this loaded page (see
            harness notes) — the probe tests the reading, not
            clickability. */
        const clickCategory = async (page, label) => {
          await page.evaluate((l) => {
            const btn = [...document.querySelectorAll('[aria-label="Catégories de la carte"] button')].find(
              (b) => (b.textContent || '').includes(l),
            )
            if (!btn) throw new Error(`category button not found: ${l}`)
            btn.click()
          }, label)
        }
        const clickAskButton = async (page, text) => {
          await page.evaluate((t) => {
            const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === t)
            if (!btn) throw new Error(`ask button not found: ${t}`)
            btn.click()
          }, text)
        }

        // --- L1: bare turn, no prior reading at all. ---
        {
          const page = await newPage()
          try {
            await page.goto(`${base}#book`, { waitUntil: 'load', timeout: 30000 })
            await page.waitForTimeout(2500)
            await clickBookButton(page, 'Page suivante') // cover -> Chaudes
            await assertStayedOff(page, 'L1a no auto-reading on the cover -> Chaudes turn')
            await clickBookButton(page, 'Page suivante') // Chaudes -> Bières
            await assertStayedOff(page, 'L1b no auto-reading on the Chaudes -> Bières turn')
          } finally {
            await page.close()
          }
        }

        // --- L2: menu ask Chaudes -> finishes -> book auto-opens ->
        // its reading finishes -> turn to Bières, then Froides. ---
        {
          const page = await newPage()
          try {
            await page.goto(`${base}#menu`, { waitUntil: 'load', timeout: 30000 })
            await page.waitForTimeout(2000)
            await clickCategory(page, 'Boissons Chaudes')
            await clickAskButton(page, 'Demander à la barmaid')
            await waitIndicatorVisible(page)
            check('L2a menu reading indicator appears after "Demander à la barmaid"', true)
            const goneMs = await waitIndicatorGone(page)
            check('L2b menu reading finishes', goneMs >= 0, goneMs >= 0 ? `finished after ${goneMs} ms` : 'indicator never went off in 180 s')
            // The finished reading opens the book (designed pending-open
            // flow): wait until we are on the Livre tab AND quiet AND
            // the book has actually rendered (its lazy chunk arrives
            // after the tab switch — the hash alone does not prove
            // the Livre tab is mounted).
            const t1 = Date.now()
            let quietOnBook = false
            while (Date.now() - t1 < 120000) {
              const state = await page.evaluate(() => ({
                hash: window.location.hash,
                lecture: document.body.innerText.includes('Lecture en cours'),
                bookButton: [...document.querySelectorAll('button')].some(
                  (b) => b.getAttribute('aria-label') === 'Page suivante',
                ),
              }))
              if (state.hash === '#book' && !state.lecture && state.bookButton) {
                quietOnBook = true
                break
              }
              await page.waitForTimeout(1000)
            }
            check('L2c book opened after the finish and is quiet (no phantom reading)', quietOnBook, `hash=${await page.evaluate(() => window.location.hash)}`)
            if (quietOnBook) {
              await clickBookButton(page, 'Page suivante') // Chaudes -> Bières
              await assertStayedOff(page, 'L2d no resurrection on the Chaudes -> Bières turn (cloud repro 1)')
              await clickBookButton(page, 'Page suivante') // Bières -> Froides
              await assertStayedOff(page, 'L2e no resurrection on the Bières -> Froides turn')
            }
          } finally {
            await page.close()
          }
        }

        // --- L3: book ask Vins -> finishes -> turn to Apéritifs, then Liqueurs. ---
        {
          const page = await newPage()
          try {
            await page.goto(`${base}#book`, { waitUntil: 'load', timeout: 30000 })
            await page.waitForTimeout(2500)
            for (let i = 0; i < 4; i++) {
              await clickBookButton(page, 'Page suivante') // cover -> Chaudes -> Bières -> Froides -> Vins
              await page.waitForTimeout(1200)
            }
            await clickAskButton(page, 'Demander à la barmaid — elle lit cette page')
            await waitIndicatorVisible(page)
            check('L3a book reading indicator appears after an explicit ask (regression guard)', true)
            const goneMs = await waitIndicatorGone(page)
            check('L3b book reading finishes', goneMs >= 0, goneMs >= 0 ? `finished after ${goneMs} ms` : 'indicator never went off in 180 s')
            if (goneMs >= 0) {
              await clickBookButton(page, 'Page suivante') // Vins -> Apéritifs
              await assertStayedOff(page, 'L3c no resurrection on the Vins -> Apéritifs turn (cloud repro 2)')
              await clickBookButton(page, 'Page suivante') // Apéritifs -> Liqueurs
              await assertStayedOff(page, 'L3d no resurrection on the Apéritifs -> Liqueurs turn')
            }
          } finally {
            await page.close()
          }
        }

        // --- L4/L5: explicit ask still works; menu switch stays off. ---
        {
          const page = await newPage()
          try {
            await page.goto(`${base}#menu`, { waitUntil: 'load', timeout: 30000 })
            await page.waitForTimeout(2000)
            await clickCategory(page, 'Boissons Chaudes')
            await clickAskButton(page, 'Demander à la barmaid')
            await waitIndicatorVisible(page)
            const goneMs = await waitIndicatorGone(page)
            check('L4 menu reading finishes (second run)', goneMs >= 0, goneMs >= 0 ? `finished after ${goneMs} ms` : 'indicator never went off in 180 s')
            await page.goto(`${base}#menu`, { waitUntil: 'load', timeout: 30000 })
            await page.waitForTimeout(1500)
            await clickCategory(page, 'Vins')
            await assertStayedOff(page, 'L5 no resurrection after the Chaudes -> Vins menu switch (fix-16 LIVE3)')
          } finally {
            await page.close()
          }
        }
      } catch (err) {
        check('LIVE rendered checks ran without a harness error', false, err.message)
      } finally {
        if (browser) await browser.close()
      }
    }
  }
}

if (previewProc) {
  try {
    process.kill(-previewProc.pid, 'SIGTERM')
  } catch {
    previewProc.kill('SIGTERM')
  }
  await sleep(500)
}

console.log(failures === 0 ? '\nAll fix-17 reading probe checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
