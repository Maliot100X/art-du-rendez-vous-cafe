/**
 * Fix pass 16 probe — a finished reading stays finished.
 *
 * Run from the repo root:  node scripts/fix16-reading-probe.mjs [--no-live]
 * Exit 0 = all checks pass, 1 = at least one fails.
 *
 * The bug (proven on real pixels with a diagnostic 20 s brain delay):
 * there are TWO reading systems rendering the identical
 * "Lecture en cours… · Boissons Chaudes" + "Couper la voix" UI — the
 * menu store (src/lib/readingStore.ts) and the Livre tab's local
 * state (BookTab in src/App.tsx). A book reading finished at 12 s
 * (timer fired, indicator OFF); the late brain reply landed at ~20 s
 * with the live reading null, and the old fix-8 carve-out ("a natural
 * end must not block the reply") let it restart the reading for a
 * fresh 10 s timer — the indicator came back ON. The category switch
 * to VINS is the moment it becomes visible, not the cause. The store
 * had the same latent shape: finishReading HELD the pending open
 * forever when the reply had not arrived, and the re-time guard lived
 * in each caller rather than in the store.
 *
 * The fix: completion is TERMINAL — finishReading always clears the
 * pending open + reply flag — and the ONLY way a reply may re-time a
 * reading is the store's atomic retimeReading(nonce, catId, seconds),
 * which succeeds only while that exact reading (nonce + category) is
 * still live and refuses finished / stopped / superseded outright.
 * BookTab's late reply now returns when the live reading is null
 * (the fix-8 natural-finish carve-out is removed). Fix pass 17
 * later removed flip-driven readings entirely (a flip landing
 * starts no reading — that was the page-turn resurrection).
 *
 * Dynamic checks (real logic, real timers, no pixels): the store is
 * transpiled with the repo's own tsc into a temp dir under ~/.cache
 * and imported into node (same pattern as fix14-reading-probe.mjs).
 * Static checks: the guard shape in all three reply handlers
 * (MenuGuide ask + askBartender, BookTab askBartender), terminal
 * completion in finishReading, no reading started on a flip landing
 * (fix pass 17), and no diagnostic instrumentation left in the
 * three changed files.
 *
 * Live checks (best effort — needs playwright-core + a headless
 * Chromium; set FIX16_URL, FIX16_PLAYWRIGHT to the playwright-core
 * package dir if it is not resolvable, FIX16_CHROME to a chrome
 * binary):
 *   - the served index is verified to be THIS worktree's own dist
 *     (served asset hash == dist/index.html asset hash) before the
 *     browser is driven;
 *   - menu repro: Boissons Chaudes → "Demander à la barmaid" →
 *     indicator appears → finishes → switch to VINS → indicator
 *     stays OFF;
 *   - book finish: Livre tab → "Demander à la barmaid" → indicator
 *     appears → finishes → stays OFF.
 * If no browser is available the live checks print LIVE SKIP and the
 * run still passes on the logic + static checks (exit 0) — the
 * logic + static checks are the gate; live is confirmation.
 *
 * HONEST CAVEAT: the rendered check cannot force a slow brain reply
 * in this sandbox (the offline fallback resolves in <0.1 s; the LLM
 * path aborts at 12 s), so the late-reply window itself is covered
 * at logic level (R2/R3/R4/R5 below) plus the diagnostic pixel repro
 * that already proved the mechanism; the rendered probe covers the
 * exact menu repro (Boissons Chaudes → VINS) and the book finish.
 *
 * Usage:
 *   node scripts/fix16-reading-probe.mjs [--no-live]
 *   FIX16_URL=http://127.0.0.1:4193/ FIX16_PLAYWRIGHT=/path/to/playwright-core \
 *     FIX16_CHROME=/path/to/chrome node scripts/fix16-reading-probe.mjs
 */
import { execFileSync } from 'node:child_process'
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

/** Slice of `src` between two markers (first occurrence each). */
function sliceBetween(src, start, end) {
  const i = src.indexOf(start)
  if (i === -1) return null
  const j = end ? src.indexOf(end, i + start.length) : src.length
  return src.slice(i, j === -1 ? src.length : j)
}

// ---------------------------------------------------------------------
// Transpile the dependency-free store with the repo's tsc.
// ---------------------------------------------------------------------
const tmpDir = mkdtempSync(join(homedir(), '.cache', 'fix16-reading-probe-'))
let store
try {
  const tsc = join(root, 'node_modules', '.bin', 'tsc')
  execFileSync(
    tsc,
    [
      'src/lib/readingStore.ts',
      '--outDir',
      tmpDir,
      '--module',
      'esnext',
      '--target',
      'es2022',
      '--moduleResolution',
      'bundler',
      '--skipLibCheck',
      '--ignoreConfig',
    ],
    { cwd: root, stdio: 'pipe' },
  )
  store = await import(pathToFileURL(join(tmpDir, 'readingStore.js')).href)
} catch (err) {
  console.log(`FAIL  setup — could not transpile/import the store: ${err.message}`)
  process.exit(1)
}

const guide = read('src/components/MenuGuide.tsx')
const app = read('src/App.tsx')
const storeSrc = read('src/lib/readingStore.ts')

// ---------------------------------------------------------------------
// Dynamic checks against the real store.
// ---------------------------------------------------------------------
const opens = []
let stopperCalls = 0
store.registerReadingFinishHandler((catId) => {
  opens.push(catId)
})
store.registerSpeechStopper(() => {
  stopperCalls++
})

function resetBetweenTests() {
  store.stopReading()
  stopperCalls = 0
  opens.length = 0
}

// R1 — a reply that lands while the reading is still live still
// re-times it (the fix must not break the normal fast-reply path).
resetBetweenTests()
const r1 = store.startReading('chaudes', 5)
check('R1a live reading re-times (store accepts while live)', store.retimeReading(r1, 'chaudes', 10) === true)
check(
  'R1b re-timed reading keeps its nonce with the new seconds',
  store.getReading()?.nonce === r1 && store.getReading()?.seconds === 10 && store.getReading()?.categoryId === 'chaudes',
  `reading=${JSON.stringify(store.getReading())}`,
)

// R2 — THE proven pixel mechanism: a reply that lands after the
// natural finish must be refused — the reading stays finished.
resetBetweenTests()
const r2 = store.startReading('chaudes', 0.05)
store.setPendingOpen('chaudes')
store.setReplyArrived(false)
await sleep(200)
check('R2a reading finished on its timer', store.getReading() === null)
check(
  'R2b completion is terminal: pending open dropped, no book open',
  store.getPendingOpen() === null && opens.length === 0,
  `pending=${JSON.stringify(store.getPendingOpen())} opens=${JSON.stringify(opens)}`,
)
check(
  'R2c late reply is refused by the store (retimeReading false)',
  store.retimeReading(r2, 'chaudes', 10) === false,
  `oldNonce=${r2}`,
)
check(
  'R2d refused re-time changed nothing (still no reading, no open)',
  store.getReading() === null && opens.length === 0,
)

// R3 — a reply that lands after "Couper la voix" is refused.
resetBetweenTests()
const r3 = store.startReading('vins', 5)
store.setPendingOpen('vins')
store.setReplyArrived(false)
store.stopReading()
check(
  'R3 late reply refused after stop',
  store.retimeReading(r3, 'vins', 10) === false && store.getReading() === null && store.getPendingOpen() === null,
)

// R4 — a reply for a superseded reading is refused; the live one
// still re-times.
resetBetweenTests()
const r4a = store.startReading('bieres', 5)
const r4b = store.startReading('vins', 5)
check('R4a late reply for the superseded reading is refused', store.retimeReading(r4a, 'bieres', 10) === false)
check(
  'R4b the live reading still re-times',
  store.retimeReading(r4b, 'vins', 10) === true && store.getReading()?.categoryId === 'vins',
)

// R5 — a re-time for the wrong category is refused and leaves the
// live reading untouched.
resetBetweenTests()
const r5 = store.startReading('chaudes', 5)
check('R5a re-time with the wrong category is refused', store.retimeReading(r5, 'vins', 10) === false)
check(
  'R5b refused re-time left the live reading untouched',
  store.getReading()?.categoryId === 'chaudes' && store.getReading()?.nonce === r5,
  `reading=${JSON.stringify(store.getReading())}`,
)

// R6 — the normal finished flow is intact: a reading whose reply
// arrived still opens the book exactly once.
resetBetweenTests()
store.startReading('chaudes', 0.05)
store.setPendingOpen('chaudes')
store.setReplyArrived(true)
await sleep(200)
check(
  'R6 finished reading with reply arrived still opens the book exactly once',
  opens.length === 1 && opens[0] === 'chaudes',
  `opens=${JSON.stringify(opens)}`,
)

// R7 — a reply-less finish never opens the book, even after waiting:
// the dropped pending cannot fire late.
resetBetweenTests()
store.startReading('aperitifs', 0.05)
store.setPendingOpen('aperitifs')
store.setReplyArrived(false)
await sleep(300)
check(
  'R7 no late book open after a reply-less finish',
  opens.length === 0 && store.getPendingOpen() === null,
  `opens=${JSON.stringify(opens)} pending=${JSON.stringify(store.getPendingOpen())}`,
)

// ---------------------------------------------------------------------
// Static checks on the wired-up code.
// ---------------------------------------------------------------------

// S1 — the store: terminal completion + the atomic re-time guard.
check(
  'S1a store exports retimeReading(nonce, catId, seconds): boolean',
  storeSrc.includes('export function retimeReading(nonce: number, catId: string, seconds: number): boolean'),
)
const finishFn = sliceBetween(storeSrc, 'function finishReading(nonce: number): void {', '\n}\n')
check('S1b finishReading block found', finishFn !== null)
if (finishFn !== null) {
  check(
    'S1c finishReading clears pendingOpen + replyArrived (terminal completion)',
    finishFn.includes('pendingOpen = null') && finishFn.includes('replyArrived = false'),
  )
  check(
    'S1d finishReading fires the pending open only from the saved reply flag',
    finishFn.includes('const arrived = replyArrived') && finishFn.includes('if (pending !== null && arrived)'),
  )
}
const retimeFn = sliceBetween(storeSrc, 'export function retimeReading(nonce: number, catId: string, seconds: number): boolean {', '\n}\n')
check('S1e retimeReading block found', retimeFn !== null)
if (retimeFn !== null) {
  check(
    'S1f retimeReading refuses unless the exact reading is live (null / nonce / category)',
    retimeFn.includes('if (reading === null || reading.nonce !== nonce || reading.categoryId !== catId) return false'),
  )
  check(
    'S1g retimeReading keeps the nonce (same press, only longer)',
    retimeFn.includes('reading = { categoryId: catId, nonce, seconds }'),
  )
}

// S2 — MenuGuide: both reply handlers re-time only via the store.
const askBtn = sliceBetween(guide, 'const askBartender = () => {', '\n  }\n\n  return {')
check('S2a askBartender block found', askBtn !== null)
if (askBtn !== null) {
  check(
    'S2b askBartender late reply re-times via retimeReading only (no startReading after the brain call)',
    askBtn.includes('retimeReading(nonce, categoryId, estimateSeconds(shortenForSpeech(reply.text)))') &&
      !askBtn.slice(askBtn.indexOf('void askBrain(request)')).includes('startReading('),
  )
  check(
    'S2c askBartender reply handler has no per-call-site nonce check left',
    !askBtn.slice(askBtn.indexOf('void askBrain(request)')).includes('getReading()?.nonce'),
  )
}
const askBlock = sliceBetween(guide, 'const ask = (e: FormEvent) => {', '// "Demander à la barmaid" — the button, not a typed question:')
check('S2d ask() block found', askBlock !== null)
if (askBlock !== null) {
  check(
    'S2e ask() late reply re-times via retimeReading only (no startReading after the brain call)',
    askBlock.includes('retimeReading(nonce, catId, estimateSeconds(shortenForSpeech(reply.text)))') &&
      !askBlock.slice(askBlock.indexOf('void askBrain(clean)')).includes('startReading('),
  )
  check(
    'S2f ask() reply handler has no per-call-site nonce check left',
    !askBlock.slice(askBlock.indexOf('void askBrain(clean)')).includes('getReading()?.nonce'),
  )
}

// S3 — BookTab (App.tsx): a natural finish now blocks the late reply,
// and (fix pass 17) flip landings start NO reading at all — the old
// flip-driven reading is what resurrected "Lecture en cours…" on
// every page turn after a finish.
const bookAsk = sliceBetween(app, 'void askBrain(request).then(({ reply }) => {', '\n      })\n    },\n    [armReadingTimer],')
check('S3a BookTab askBartender reply handler found', bookAsk !== null)
if (bookAsk !== null) {
  check(
    'S3b late reply returns when the live reading is null (natural finish blocks it)',
    bookAsk.includes('if (cur === null) return'),
  )
  check(
    'S3c late reply still returns on a stopped nonce and on a superseded nonce',
    bookAsk.includes('if (stoppedNonceRef.current === nonce) return') && bookAsk.includes('if (cur.nonce !== nonce) return'),
  )
}
check(
  'S3d the old fix-8 natural-finish carve-out is gone',
  !app.includes('must NOT block the reply'),
)
const flipLanding = sliceBetween(app, 'onBookCategory((catId) => {', '}),\n    [],')
check('S3e flip-landing handler found', flipLanding !== null)
if (flipLanding !== null) {
  check(
    'S3f fix-17: a flip landing starts NO reading (no setReading/armReadingTimer on landing)',
    !flipLanding.includes('setReading(') && !flipLanding.includes('armReadingTimer('),
  )
  check(
    'S3g fix-17: a flip landing still consumes the book target',
    flipLanding.includes('onTargetConsumedRef.current?.()'),
  )
}

// S4 — no diagnostic instrumentation left in the three changed files.
for (const [label, src] of [
  ['readingStore.ts', storeSrc],
  ['MenuGuide.tsx', guide],
  ['App.tsx', app],
]) {
  check(
    `S4 ${label} has no diagnostic instrumentation`,
    !/diagnostic/i.test(src) && !src.includes('__fix16') && !src.includes('window.__reading'),
  )
}

// Cleanup the transpiled temp dir (live section needs no store).
rmSync(tmpDir, { recursive: true, force: true })

// ---------------------------------------------------------------------
// Live rendered checks (best effort).
// ---------------------------------------------------------------------
const wantLive = !process.argv.includes('--no-live')
if (wantLive) {
  let pw = null
  try {
    pw = await import('playwright-core')
  } catch {
    try {
      const dir = process.env.FIX16_PLAYWRIGHT
      if (dir) pw = await import(`${dir}/index.mjs`)
    } catch { /* fall through to SKIP */ }
  }
  if (!pw) {
    console.log('LIVE SKIP: playwright-core not resolvable (npm i playwright-core or set FIX16_PLAYWRIGHT) — logic + static checks are the gate')
  } else {
    const { chromium } = pw
    const url = process.env.FIX16_URL || 'http://127.0.0.1:4193/'
    const exe = process.env.FIX16_CHROME || join(homedir(), '.cache', 'ms-playwright', 'chromium-1255', 'chrome-linux64', 'chrome')
    const base = url.endsWith('/') ? url : `${url}/`

    // Identity: the served index must be THIS worktree's own dist.
    try {
      const served = await (await fetch(base)).text()
      const local = read('dist/index.html')
      const asset = served.match(/assets\/index-[A-Za-z0-9_-]+\.js/)
      check(
        'LIVE0 served index is this worktree\'s own dist (asset hash matches dist/index.html)',
        asset !== null && local.includes(asset[0]),
        asset ? `asset=${asset[0]}` : 'no asset in served index',
      )
    } catch (err) {
      check('LIVE0 served index is this worktree\'s own dist', false, err.message)
    }

    const indicator = (page) => page.getByText('Lecture en cours')
    const indicatorCount = async (page) => indicator(page).count()

    let browser = null
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: exe,
        args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
      })

      // --- Menu repro: Boissons Chaudes -> VINS. ---
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
      try {
        await page.goto(`${base}#menu`, { waitUntil: 'load', timeout: 30000 })
        await page.waitForTimeout(2000)
        await page.locator('[aria-label="Catégories de la carte"] button', { hasText: 'Boissons Chaudes' }).click()
        await page.getByRole('button', { name: 'Demander à la barmaid', exact: true }).click()
        const t0 = Date.now()
        await indicator(page).first().waitFor({ state: 'visible', timeout: 15000 })
        const shownMs = Date.now() - t0
        check('LIVE1 menu reading indicator appears after "Demander à la barmaid"', true, `shown in ${shownMs} ms`)
        // The reading finishes on its timer; finishing with the reply
        // arrived switches to the Livre tab (the designed pending-open
        // flow), so "finished" is indicator-gone OR tab-switched.
        const t1 = Date.now()
        let finished = false
        while (Date.now() - t1 < 180000) {
          if ((await indicatorCount(page)) === 0 || (await page.evaluate(() => window.location.hash)) !== '#menu') {
            finished = true
            break
          }
          await page.waitForTimeout(1000)
        }
        const finishedMs = Date.now() - t1
        check('LIVE2 menu reading finishes (indicator off, or book opens as designed)', finished, `finished after ${finishedMs} ms, hash=${await page.evaluate(() => window.location.hash)}`)
        // Back on LA CARTE, switch to VINS: the exact repro moment.
        await page.goto(`${base}#menu`, { waitUntil: 'load', timeout: 30000 })
        await page.waitForTimeout(1500)
        await page.locator('[aria-label="Catégories de la carte"] button', { hasText: 'Vins' }).click()
        await page.waitForTimeout(3000)
        const afterVins = await indicatorCount(page)
        check('LIVE3 no resurrection after the Boissons Chaudes -> VINS switch', afterVins === 0, `indicators=${afterVins} after 3 s on Vins`)
      } finally {
        await page.close()
      }

      // --- Book finish: fresh page, no bookTarget state. ---
      const book = await browser.newPage({ viewport: { width: 390, height: 844 } })
      try {
        await book.goto(`${base}#book`, { waitUntil: 'load', timeout: 30000 })
        await book.waitForTimeout(2000)
        // A fresh load opens on the cover (flipped 0 → no category →
        // no button): flip one page to the first category first.
        // Plain clicks time out here (the controls sit below the fold
        // behind a reveal animation, so Playwright never sees them
        // actionable), so drive the buttons via the DOM — the probe
        // tests the reading, not clickability.
        const clickBookButton = async (label) => {
          await book.evaluate((l) => {
            const btn = [...document.querySelectorAll('button')].find(
              (b) => b.getAttribute('aria-label') === l || b.textContent?.includes(l),
            )
            if (!btn) throw new Error(`book button not found: ${l}`)
            btn.click()
          }, label)
        }
        await clickBookButton('Page suivante')
        await book.getByRole('button', { name: 'Demander à la barmaid — elle lit cette page', exact: true }).waitFor({ state: 'attached', timeout: 15000 })
        // A flip landing on mount may start a reading; supersede it
        // with an explicit ask, as the repro does.
        await clickBookButton('Demander à la barmaid — elle lit cette page')
        const t0 = Date.now()
        await indicator(book).first().waitFor({ state: 'visible', timeout: 15000 })
        const shownMs = Date.now() - t0
        check('LIVE4 book reading indicator appears after "Demander à la barmaid"', true, `shown in ${shownMs} ms`)
        const t1 = Date.now()
        let finished = false
        while (Date.now() - t1 < 180000) {
          if ((await indicatorCount(book)) === 0) {
            finished = true
            break
          }
          await book.waitForTimeout(1000)
        }
        const finishedMs = Date.now() - t1
        check('LIVE5 book reading finishes (indicator off)', finished, `finished after ${finishedMs} ms`)
        await book.waitForTimeout(5000)
        const afterWait = await indicatorCount(book)
        check('LIVE6 book reading stays finished (no resurrection 5 s after the finish)', afterWait === 0, `indicators=${afterWait}`)
      } finally {
        await book.close()
      }
    } catch (err) {
      check('LIVE rendered checks ran without a harness error', false, err.message)
    } finally {
      if (browser) await browser.close()
    }
  }
}

console.log(failures === 0 ? '\nAll fix-16 reading probe checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
