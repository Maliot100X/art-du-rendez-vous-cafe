#!/usr/bin/env node
/**
 * FIX PASS 16, GROUP 2 — budget-chips probe (node, no network, no key).
 *
 * The bug (fix-15 cloud-browser pixel check, 22:01–22:10 CET, keyed
 * asset index-evO8t8Xh.js): for "j'ai seulement 5 euros en poche, que
 * me conseilles-tu ?" the LLM reply TEXT respected the 5 € budget
 * (CAPPUCCINO CHANTILLY 3,50 €, THÉ 3,00 €, BLANCHE SUPER B 3,90 €,
 * DOUBLE EXPRESSO 4,50 €, VIN ROUGE 4,00 €) but the reply rendered
 * add-to-order chips for Aperol Spritz 9,00 €, Primus Pils 50 CL
 * 5,30 € and Irish Coffee 10,00 € — all over budget.
 *
 * Root cause: askBrain() (src/lib/brain.ts) paired the LLM's text
 * with the OFFLINE brain's actions, and the offline brain
 * (src/lib/agentBrain.ts) never parsed a budget — its conseil branch
 * fell back to three hardcoded favourites whatever the visitor said.
 *
 * This probe asserts, with the EXACT 5-euro question:
 *   Part A (logic-level, real bundled brain.ts, fetch stubbed — no
 *     network, no real key, fake key via env like fix15):
 *     - LLM path (stub returns the fix-15 reply's item list verbatim
 *       — its full wording was not recorded, only the five items):
 *       source 'llm', every chip ≤ 5,00 €, every chip named in the
 *       LLM text, at least one chip shown
 *     - offline path (fetch throws): same budget assertion
 *     - no-budget regression: the three favourites are unchanged
 *       when no budget is stated
 *     - other budgets (3 €, 10 €), category + budget, a named
 *       over-budget drink, and a budget below the cheapest item
 *   Part B (real rendered check): `npm run build`, serve the built
 *     worktree with vite preview, drive headless Chromium with
 *     playwright-core, type the exact question into the Agent chat,
 *     read the rendered chip buttons and assert every chip price
 *     is ≤ 5,00 €. The preview build has no key configured (no .env
 *     in the worktree), so Part B exercises the offline brain; the
 *     LLM path is covered by Part A. The preview runs on port 44173,
 *     NOT 4173: 4173 is the coordinator's master-build preview
 *     (keyed asset index-evO8t8Xh.js) and a --strictPort spawn there
 *     fails EADDRINUSE while the health poll still succeeds against
 *     the master server — an earlier probe run drove the MASTER
 *     build and "failed" on the unfixed favourites. Part B therefore
 *     verifies the served index asset is this worktree's own dist.
 *
 * Run: node scripts/fix16-chips-probe.mjs   (exit 0 = all pass)
 */
import { build } from 'vite'
import { execSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const HOME = process.env.HOME ?? ''
const PLAYWRIGHT_CORE = join(HOME, 'workspace/.fix15-tools/node_modules/playwright-core')
const CHROME_PATHS = [
  join(HOME, '.cache/ms-playwright/chromium-1255/chrome-linux64/chrome'),
  '/opt/meta-chromium/chrome',
]

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = mkdtempSync(join(root, '.fix16-probe-'))

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const priceOf = (a) => parseFloat(String(a.price).replace(',', '.')) || 0
const fmtChips = (actions) =>
  (actions ?? []).map((a) => `${a.name} ${a.price}`).join(' | ') || '(no chips)'
const allUnder = (actions, budget) => (actions ?? []).every((a) => priceOf(a) <= budget + 0.001)

const QUESTION = "j'ai seulement 5 euros en poche, que me conseilles-tu ?"
// The fix-15 check recorded the LLM reply's item list, not its full
// wording — the stub reproduces that list verbatim inside a plausible
// reply sentence.
const LLM_TEXT =
  'Avec 5 €, voici ce que je vous conseille : CAPPUCCINO CHANTILLY 3,50 €, THÉ 3,00 €, BLANCHE SUPER B 3,90 €, DOUBLE EXPRESSO 4,50 €, VIN ROUGE 4,00 €. Dites-moi ce qui vous tente !'

// ---------------------------------------------------------------- Part A
// brain.ts uses window.setTimeout/clearTimeout — stub before import;
// fetch is stubbed per test below (fix15 pattern). Save the real one:
// Part B needs it to poll the preview server.
const realFetch = globalThis.fetch
globalThis.window = { setTimeout, clearTimeout }
let fetchQueue = []
globalThis.fetch = async (url, init) => {
  const next = fetchQueue.shift()
  if (!next) throw new Error('unexpected fetch call (no stub queued)')
  return next(url, init)
}
const okJson = (json) => ({ ok: true, status: 200, json: async () => json })
const llmOk = (text) => okJson({ choices: [{ message: { content: text }, finish_reason: 'stop' }] })

// Fake key only — no real key, no network (fetch is stubbed).
process.env.VITE_LLM_API_KEY = 'probe-fake-key'

await build({
  configFile: false,
  root,
  logLevel: 'silent',
  build: {
    lib: { entry: join(root, 'src/lib/brain.ts'), formats: ['es'], fileName: 'brain' },
    outDir,
    emptyOutDir: true,
  },
})
await build({
  configFile: false,
  root,
  logLevel: 'silent',
  build: {
    lib: { entry: join(root, 'src/lib/agentBrain.ts'), formats: ['es'], fileName: 'agentBrain' },
    outDir,
    emptyOutDir: false,
  },
})

const brain = await import(pathToFileURL(join(outDir, 'brain.js')).href)
const agentBrain = await import(pathToFileURL(join(outDir, 'agentBrain.js')).href)
rmSync(outDir, { recursive: true, force: true })

console.log('--- Part A: chip derivation (bundled real brain.ts) ---')

// Guarded: on the UNFIXED code parseBudget does not exist at all —
// the checks below must FAIL (not crash the probe) so the same script
// demonstrates the before/after on old vs new code.
const hasParseBudget = typeof agentBrain.parseBudget === 'function'
check('parseBudget is exported (fix 16)', hasParseBudget)
const pb = (m) => (hasParseBudget ? agentBrain.parseBudget(m) : null)
check('parseBudget: exact 5-euro question -> 5', pb(QUESTION) === 5)
check('parseBudget: no amount -> null', pb('que me conseilles-tu ?') === null)
check('parseBudget: "moins de 10 €" -> 10', pb('moins de 10 €') === 10)
check('parseBudget: "3,50 euros" -> 3.5', pb("j'ai 3,50 euros") === 3.5)
check(
  'parseBudget: "entre 3 et 5 euros" -> 5 (cap is the largest)',
  pb('entre 3 et 5 euros') === 5,
)

// 1. LLM path — THE reported bug: LLM text respects 5 €, chips must too.
fetchQueue = [async () => llmOk(LLM_TEXT)]
const llm = await brain.askBrain(QUESTION, [])
check('LLM path: source is llm', llm.source === 'llm', llm.source)
check('LLM path: reply is the LLM text', llm.reply.text === LLM_TEXT)
check('LLM path: at least one chip', (llm.reply.actions ?? []).length > 0, fmtChips(llm.reply.actions))
check(
  'LLM path: every chip ≤ 5,00 €',
  allUnder(llm.reply.actions, 5),
  fmtChips(llm.reply.actions),
)
check(
  'LLM path: every chip is named in the LLM text',
  (llm.reply.actions ?? []).every((a) => LLM_TEXT.includes(a.name)),
  fmtChips(llm.reply.actions),
)
check(
  'LLM path: chips are the drinks the reply named (longest match — DOUBLE EXPRESSO, not bare EXPRESSO)',
  (llm.reply.actions ?? []).map((a) => a.name).join(',') === 'THÉ,CAPPUCCINO CHANTILLY,DOUBLE EXPRESSO',
  fmtChips(llm.reply.actions),
)

// 2. Offline path (fetch throws) — same question, same budget rule.
fetchQueue = [
  async () => {
    throw new Error('network down')
  },
]
const off = await brain.askBrain(QUESTION, [])
check('offline path: source is offline', off.source === 'offline', off.source)
check('offline path: at least one chip', (off.reply.actions ?? []).length > 0, fmtChips(off.reply.actions))
check(
  'offline path: every chip ≤ 5,00 €',
  allUnder(off.reply.actions, 5),
  fmtChips(off.reply.actions),
)
check(
  'offline path: no favourite over budget survives',
  !(off.reply.actions ?? []).some((a) => ['APEROL SPRITZ', 'PRIMUS PILS 50 CL', 'IRISH COFFEE'].includes(a.name)),
  fmtChips(off.reply.actions),
)

// 3. No-budget regression: the favourites are unchanged when no
//    budget is stated (the fix must not nuke chips in general).
fetchQueue = [
  async () => {
    throw new Error('network down')
  },
]
const noBudget = await brain.askBrain('que me conseilles-tu ?', [])
check(
  'no-budget regression: the three favourites still appear',
  (noBudget.reply.actions ?? []).map((a) => a.name).join(',') ===
    'APEROL SPRITZ,PRIMUS PILS 50 CL,IRISH COFFEE',
  fmtChips(noBudget.reply.actions),
)

// 4. Other budgets.
fetchQueue = [
  async () => {
    throw new Error('network down')
  },
]
const three = await brain.askBrain("j'ai 3 euros en poche, que me conseilles-tu ?", [])
check('3 € budget: at least one chip', (three.reply.actions ?? []).length > 0, fmtChips(three.reply.actions))
check('3 € budget: every chip ≤ 3,00 €', allUnder(three.reply.actions, 3), fmtChips(three.reply.actions))

fetchQueue = [
  async () => {
    throw new Error('network down')
  },
]
const ten = await brain.askBrain("j'ai 10 euros en poche, que me conseilles-tu ?", [])
check('10 € budget: at least one chip', (ten.reply.actions ?? []).length > 0, fmtChips(ten.reply.actions))
check('10 € budget: every chip ≤ 10,00 €', allUnder(ten.reply.actions, 10), fmtChips(ten.reply.actions))

// 5. Category + budget: a beer request with 4 € must not chip the
//    5,30 € Primus 50 CL (first-in-category before fix 16).
fetchQueue = [
  async () => {
    throw new Error('network down')
  },
]
const beer = await brain.askBrain("une bière, j'ai 4 euros en poche", [])
check('beer + 4 €: at least one chip', (beer.reply.actions ?? []).length > 0, fmtChips(beer.reply.actions))
check('beer + 4 €: every chip ≤ 4,00 €', allUnder(beer.reply.actions, 4), fmtChips(beer.reply.actions))

// 6. Named over-budget drink: the visitor asked for it by name, so
//    the text may name its price — but no over-budget chip is shown.
fetchQueue = [
  async () => {
    throw new Error('network down')
  },
]
const named = await brain.askBrain("je veux un Aperol Spritz, j'ai 5 euros en poche", [])
check(
  'named over-budget drink: no chip shown',
  (named.reply.actions ?? []).length === 0,
  fmtChips(named.reply.actions),
)

// 7. Budget below the cheapest item: no chips, no crash, honest text.
fetchQueue = [
  async () => {
    throw new Error('network down')
  },
]
let poor = null
let threw = false
try {
  poor = await brain.askBrain("j'ai 2 euros en poche, que me conseilles-tu ?", [])
} catch {
  threw = true
}
check('2 € budget: no crash', threw === false)
check('2 € budget: no chip shown', (poor?.reply.actions ?? []).length === 0, fmtChips(poor?.reply.actions))
check(
  '2 € budget: reply says nothing fits',
  typeof poor?.reply.text === 'string' && poor.reply.text.length > 0,
  poor?.reply.text ?? '',
)

// ---------------------------------------------------------------- Part B
console.log('\n--- Part B: rendered check (built site, headless Chromium) ---')
globalThis.fetch = realFetch // Part A stubbed it — the preview poll needs the real one.

const { chromium } = require(PLAYWRIGHT_CORE)
const { existsSync } = await import('node:fs')
const chromePath = CHROME_PATHS.find((p) => existsSync(p))
if (!chromePath) {
  check('headless Chromium available', false, 'no chrome binary found')
} else {
  // Build the worktree first — the rendered check runs the real bundle.
  // The build runs WITHOUT any VITE_* key vars: Part A sets a fake
  // VITE_LLM_API_KEY in this process for its stubbed-fetch tests, and
  // a child build would inherit it and bake the fake key into dist
  // (that leak made an earlier probe run exercise the LLM path with a
  // dead key instead of the no-key production build).
  const cleanEnv = { ...process.env }
  for (const k of Object.keys(cleanEnv)) if (k.startsWith('VITE_')) delete cleanEnv[k]
  try {
    execSync('npm run build', { cwd: root, stdio: 'pipe', timeout: 300_000, env: cleanEnv })
    check('npm run build passes', true)
  } catch (e) {
    check('npm run build passes', false, String(e.stdout ?? e.message).slice(-500))
  }
  const { readdirSync, readFileSync: readFileSync2 } = await import('node:fs')
  const distJs = readdirSync(join(root, 'dist/assets')).filter((f) => f.endsWith('.js'))
  const distHasFakeKey = distJs.some((f) => readFileSync2(join(root, 'dist/assets', f), 'utf8').includes('probe-fake-key'))
  check('built bundle has no leaked fake key', !distHasFakeKey)

  if (failures === 0) {
    // Port 44173, not 4173 (see header): 4173 is the coordinator's
    // master-build preview — a spawn there fails EADDRINUSE while
    // the poll below would still succeed against the master server.
    const PORT = 44173
    const preview = spawn(join(root, 'node_modules/vite/bin/vite.js'), ['preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
      cwd: root,
      stdio: 'pipe',
      env: cleanEnv,
    })
    let previewErr = ''
    preview.stderr?.on('data', (d) => {
      previewErr += String(d)
    })
    const waitUp = async (tries = 40) => {
      for (let i = 0; i < tries; i++) {
        if (preview.exitCode !== null) return false
        try {
          const r = await fetch(`http://127.0.0.1:${PORT}/`)
          if (r.ok) return true
        } catch {
          /* not up yet */
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      return false
    }
    try {
      const up = await waitUp()
      check('vite preview serves the built site', up, `http://127.0.0.1:${PORT}/`)
      if (!up) {
        console.log(`    preview never came up — stderr tail: ${previewErr.slice(-300)}`)
        console.log('    preview never came up — skipping the browser drive')
      } else {
        // Prove the preview serves THIS worktree's dist, not another
        // agent's server on the same port: the served index.html must
        // reference this dist's index asset, and that asset must
        // contain the fix-16 marker string. The browser drive below
        // runs ONLY when both hold.
        const { readdirSync: readdirSync2 } = await import('node:fs')
        const myIndex = readdirSync2(join(root, 'dist/assets')).find(
          (f) => f.startsWith('index-') && f.endsWith('.js'),
        )
        const servedHtml = await (await fetch(`http://127.0.0.1:${PORT}/`)).text()
        const servedIndex = servedHtml.match(/assets\/(index-[^"]+\.js)/)?.[1] ?? '(none)'
        check('preview serves this worktree’s dist asset', servedIndex === myIndex, `served ${servedIndex}, dist has ${myIndex}`)
        const servedJs = await (await fetch(`http://127.0.0.1:${PORT}/assets/${servedIndex}`)).text()
        const servingMine = servedIndex === myIndex && servedJs.includes('rien sur la carte ne rentre')
        check(
          'served bundle contains the fix-16 budget code',
          servedJs.includes('rien sur la carte ne rentre'),
          servedIndex,
        )
        if (!servingMine) {
          console.log('    preview is not serving this dist — skipping the browser drive')
        } else {
      const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox'] })
      try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
        await page.goto(`http://127.0.0.1:${PORT}/#agent`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await page.locator('#agent-input').waitFor({ state: 'visible', timeout: 90_000 })
        await page.locator('#agent-input').fill(QUESTION)
        await page.keyboard.press('Enter')
        // Wait for the bot reply's chips: buttons labelled "Ajouter …"
        // (budget picks) or "Name — price €" (the favourites format).
        await page
          .locator('button', { hasText: /^Ajouter / })
          .first()
          .waitFor({ state: 'visible', timeout: 30_000 })
          .catch(() => {})
        await page.waitForTimeout(1500)
        const rendered = await page.evaluate(() => {
          // Last bot bubble text: it lists the recommended items with
          // their prices — the price lookup for "Ajouter NAME" chips.
          const bubbles = [...document.querySelectorAll('#agent p.whitespace-pre-line')]
          const lastBot = bubbles.length > 0 ? bubbles[bubbles.length - 1].textContent ?? '' : ''
          const priceInText = new Map()
          for (const m of lastBot.matchAll(/([A-ZÀ-Þ][A-ZÀ-Þ0-9 ()/%.-]{1,40}?)\s+(\d+[.,]\d{2})\s*€/g)) {
            priceInText.set(m[1].trim(), parseFloat(m[2].replace(',', '.')))
          }
          const chips = [...document.querySelectorAll('#agent button')]
            .map((b) => (b.textContent ?? '').trim())
            .filter((t) => t.startsWith('Ajouter ') || /—\s*\d+[.,]\d{2}\s*€/.test(t))
            .map((t) => {
              const priced = t.match(/^(.*?)\s*—\s*(\d+[.,]\d{2})\s*€$/)
              if (priced) return { name: priced[1].trim(), price: parseFloat(priced[2].replace(',', '.')), label: t }
              const name = t.replace(/^Ajouter\s+/, '').trim()
              return { name, price: priceInText.get(name) ?? null, label: t }
            })
          return { chips, lastBot }
        })
        console.log(`    rendered reply: ${JSON.stringify(rendered.lastBot)}`)
        console.log(
          `    rendered chips: ${rendered.chips.map((c) => `${c.name} ${c.price === null ? '(price unknown)' : c.price.toFixed(2) + ' €'}`).join(' | ') || '(none)'}`,
        )
        check('rendered: at least one chip', rendered.chips.length > 0, `got ${rendered.chips.length}`)
        check(
          'rendered: every chip price is known',
          rendered.chips.every((c) => c.price !== null),
          JSON.stringify(rendered.chips),
        )
        check(
          'rendered: every chip ≤ 5,00 €',
          rendered.chips.every((c) => c.price !== null && c.price <= 5.001),
          rendered.chips.map((c) => `${c.name} ${c.price}`).join(' | '),
        )
        check(
          'rendered: no over-budget favourite chip',
          !rendered.chips.some((c) =>
            ['APEROL SPRITZ', 'PRIMUS PILS 50 CL', 'IRISH COFFEE'].includes(c.name.toUpperCase()),
          ),
          JSON.stringify(rendered.chips.map((c) => c.name)),
        )
      } finally {
        await browser.close()
      }
        } // end: servingMine — browser drive
      } // end: else (preview is up)
    } catch (e) {
      check('rendered check ran without error', false, String(e?.message ?? e).slice(-400))
    } finally {
      preview.kill()
    }
  }
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
