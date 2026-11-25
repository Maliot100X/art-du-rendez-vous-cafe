#!/usr/bin/env node
/**
 * FIX PASS 16, GROUP 3 — one status source of truth + remove "EN DIRECT".
 *
 * Root cause under test (fix-15 pixel check, 22:01–22:10 CET): the
 * pill, the LA CARTE banner and the chat each kept their OWN brain
 * state — Agent.tsx `useState(false)` (reset on every tab-switch
 * unmount), MenuGuide.tsx `useState(false)` (flipped only by its own
 * mini-chat), and brain.ts's module-level flag that NO component ever
 * read. So after a live reply the pill said connected, the banner
 * still said "hors ligne", and the pill reverted on navigation.
 *
 * The fix: src/lib/agentStatus.ts is the single shared store
 * (module-level snapshot + subscription, same pattern as the fix-14
 * reading store). brain.ts marks it live on a successful LLM call;
 * Agent and MenuGuide only read it via useAgentStatus(). brainLive
 * is sticky for the session (no reset path); voiceLive is written
 * only by the Agent tab from the voice client's status. The pill now
 * reads AGENT.statusOnline ("Cerveau connecté") and the phrase
 * "en direct" is gone from src/ and dist/ (any case).
 *
 * This probe asserts, in three layers:
 *   LOGIC (node, no network, no real key — same harness as the
 *   fix-15 brain probe: the real brain.ts + agentStatus.ts bundled
 *   with Vite, fetch stubbed, fake key via env):
 *     (a) after a stubbed LLM success, the shared store reports
 *         brainLive true — and a subscriber attaching AFTER the
 *         success (exactly what a remounted component does) reads
 *         true at once; an offline fallback afterwards does NOT
 *         clear it; voiceLive flips independently and never touches
 *         brainLive.
 *     (b) persistence by construction: no reset/unmark exists in the
 *         store, no component keeps a local brainLive copy, and the
 *         store is module-level (survives unmounts).
 *     (c) source guards: both surfaces import useAgentStatus, the
 *         pill uses AGENT.statusOnline, brain.ts calls markBrainLive.
 *   GREP: zero matches for /en direct/i in src/, index.html and
 *   dist/ (dist rebuilt here by `npm run build` first).
 *   RENDERED (headless Chromium via scripts/fix16-status-render.py):
 *   a probe-only build with a DUMMY key is served locally and the
 *   LLM endpoint is intercepted with a canned reply, so the REAL
 *   page goes live with no real key and no network. The script
 *   checks pill + banner + chat agree live, the state survives tab
 *   navigation, and no "en direct" appears in the rendered text.
 *   If Python Playwright is unavailable the rendered layer is
 *   SKIPPED (reported, not faked) and the logic + grep layers still
 *   decide the exit code.
 *
 * Run: node scripts/fix16-status-probe.mjs   (exit 0 = all pass)
 */
import { build } from 'vite'
import { execSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Home disk, not /tmp (512 MB tmpfs): keep probe scratch on the home disk.
const tmpBase = join(root, '.fix16-probe-')
const outDir = mkdtempSync(tmpBase)

let failures = 0
let skipped = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
function skip(name, reason) {
  console.log(`SKIP  ${name} — ${reason}`)
  skipped++
}

// ---------------------------------------------------------------- logic
// brain.ts uses window.setTimeout/clearTimeout — stub before import.
globalThis.window = { setTimeout, clearTimeout }

let fetchQueue = []
let fetchCalls = []
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url, body: JSON.parse(init.body) })
  const next = fetchQueue.shift()
  if (!next) throw new Error('unexpected fetch call (no stub queued)')
  return next(url, init)
}
const okJson = (json) => ({ ok: true, status: 200, json: async () => json })
const mercurySuccess = (text) => ({
  choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
})

// Fake key only — no real key, no network (fetch is stubbed).
process.env.VITE_LLM_API_KEY = 'probe-fake-key'

await build({
  configFile: false,
  root,
  logLevel: 'silent',
  build: {
    lib: { entry: [join(root, 'src/lib/brain.ts'), join(root, 'src/lib/agentStatus.ts')], formats: ['es'] },
    outDir,
    emptyOutDir: true,
  },
})
const files = readdirSync(outDir)
const brainFile = files.find((f) => f.startsWith('brain.'))
const statusFile = files.find((f) => f.startsWith('agentStatus.'))
const brain = await import(pathToFileURL(join(outDir, brainFile)).href)
const status = await import(pathToFileURL(join(outDir, statusFile)).href)

// 0. Honesty rule: both start false.
check('store starts brainLive false', status.getAgentStatus().brainLive === false)
check('store starts voiceLive false', status.getAgentStatus().voiceLive === false)
check('brainWasLive() starts false', brain.brainWasLive() === false)

// 1. (a) One stubbed LLM success flips the ONE shared truth.
const LLM_TEXT = 'Bien sûr ! Pour un vin rouge, je vous conseille le Bordeaux 75 CL à 9,00 €.'
fetchQueue = [async () => okJson(mercurySuccess(LLM_TEXT))]
fetchCalls = []
const res = await brain.askBrain('quel vin rouge conseilles-tu ?', [])
check('LLM success: source is llm', res.source === 'llm', res.source)
check('LLM success: shared store brainLive true', status.getAgentStatus().brainLive === true)
check('LLM success: brainWasLive() true', brain.brainWasLive() === true)

// 2. (b) A subscriber attaching AFTER the success — exactly what a
// remounted Agent/MenuGuide does on tab return — reads live at once.
// (useSyncExternalStore calls getSnapshot on subscribe; the probe
// mirrors that by reading the snapshot fresh here.)
const lateSnapshot = status.getAgentStatus()
check('remount-after-live: fresh subscriber reads brainLive true', lateSnapshot?.brainLive === true)

// 3. An offline fallback AFTER going live must NOT clear the truth
// (the old pill reverted; the shared store must not).
fetchQueue = [async () => { throw new Error('network down') }]
fetchCalls = []
const down = await brain.askBrain('bonjour', [])
check('offline after live: source is offline', down.source === 'offline', String(down.source))
check('offline after live: brainLive STAYS true', status.getAgentStatus().brainLive === true)
check('offline after live: brainWasLive() STAYS true', brain.brainWasLive() === true)

// 4. voiceLive flips independently and never touches brainLive.
status.setVoiceLive(true)
check('voiceLive true after setVoiceLive(true)', status.getAgentStatus().voiceLive === true)
check('voiceLive flip leaves brainLive true', status.getAgentStatus().brainLive === true)
status.setVoiceLive(false)
check('voiceLive false after setVoiceLive(false)', status.getAgentStatus().voiceLive === false)
check('voiceLive flip leaves brainLive true (again)', status.getAgentStatus().brainLive === true)

// 5. No reset path exists in the store source. (Match code, not
// comments: the header comment itself says "no reset path".)
const statusSrc = readFileSync(join(root, 'src/lib/agentStatus.ts'), 'utf8')
check(
  'store has no reset/unmark function',
  !/\bfunction\s+(reset|unmark)/.test(statusSrc) && !/brainLive\s*=\s*false/.test(statusSrc),
)
check('store exposes markBrainLive (only writer for brain)', statusSrc.includes('export function markBrainLive'))
check('store exposes setVoiceLive (only writer for voice)', statusSrc.includes('export function setVoiceLive'))
check('store exposes useAgentStatus hook', statusSrc.includes('export function useAgentStatus'))

// 6. Source guards: both surfaces read the shared store; no local copy.
const agentSrc = readFileSync(join(root, 'src/components/Agent.tsx'), 'utf8')
const guideSrc = readFileSync(join(root, 'src/components/MenuGuide.tsx'), 'utf8')
const brainSrc = readFileSync(join(root, 'src/lib/brain.ts'), 'utf8')
check('Agent.tsx reads useAgentStatus', agentSrc.includes('useAgentStatus'))
check('Agent.tsx has no local brainLive useState', !agentSrc.includes('const [brainLive, setBrainLive]'))
check('Agent.tsx has no setBrainLive call', !agentSrc.includes('setBrainLive('))
check('Agent.tsx pill uses AGENT.statusOnline', agentSrc.includes('AGENT.statusOnline'))
check('Agent.tsx writes voiceLive from voice status', agentSrc.includes('setVoiceLive(status'))
check('MenuGuide.tsx reads useAgentStatus', guideSrc.includes('useAgentStatus'))
check('MenuGuide.tsx has no local brainLive useState', !guideSrc.includes('const [brainLive, setBrainLive]'))
check('MenuGuide.tsx has no setBrainLive call', !guideSrc.includes('setBrainLive('))
check('brain.ts marks the shared store on LLM success', brainSrc.includes('markBrainLive()'))
check('brain.ts keeps no local brainLive flag', !brainSrc.includes('let brainLive'))
const contentSrc = readFileSync(join(root, 'src/content.ts'), 'utf8')
check("AGENT.statusOnline is 'Cerveau connecté'", contentSrc.includes("statusOnline: 'Cerveau connecté'"))

// ----------------------------------------------------------------- grep
function grepEnDirect(dir, label) {
  const hits = []
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name)
      if (entry.isDirectory()) {
        if (['node_modules', '.git'].includes(entry.name)) continue
        walk(p)
      } else if (/\.(ts|tsx|js|mjs|html|css|json)$/.test(entry.name)) {
        const text = readFileSync(p, 'utf8')
        if (/en direct/i.test(text)) hits.push(p)
      }
    }
  }
  walk(dir)
  check(`grep: zero "en direct" (any case) in ${label}`, hits.length === 0, hits.join(', '))
}
grepEnDirect(join(root, 'src'), 'src/')

// index.html is a file, not a dir — grep it directly.
{
  const html = readFileSync(join(root, 'index.html'), 'utf8')
  check('grep: zero "en direct" (any case) in index.html', !/en direct/i.test(html))
}

// ------------------------------------------------------------ build + dist
console.log('--- building (npm run build) for the dist grep ---')
execSync('npm run build', { cwd: root, stdio: 'pipe' })
{
  let distHits = []
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (/\.(js|css|html)$/.test(entry.name)) {
        if (/en direct/i.test(readFileSync(p, 'utf8'))) distHits.push(p)
      }
    }
  }
  walk(join(root, 'dist'))
  check('grep: zero "en direct" (any case) in dist/ after build', distHits.length === 0, distHits.join(', '))
}

// --------------------------------------------------------------- rendered
// Probe-only build with a DUMMY key (never a real one), served locally;
// the LLM endpoint is intercepted by the render script with a canned
// reply, so the real page goes live with no network.
let playwrightAvailable = false
try {
  execSync('python3 -c "import playwright"', { stdio: 'pipe' })
  playwrightAvailable = true
} catch {
  skip('rendered check (headless Chromium)', 'Python Playwright is not installed on this machine')
}
if (playwrightAvailable) {
  const renderOut = mkdtempSync(join(root, '.fix16-render-'))
  try {
    execSync(`npx vite build --outDir ${renderOut}`, {
      cwd: root,
      stdio: 'pipe',
      env: { ...process.env, VITE_LLM_API_KEY: 'probe-dummy-key' },
    })
    // The asset hash of OUR probe build, read from its own index.html.
    const renderIndex = readFileSync(join(renderOut, 'index.html'), 'utf8')
    const assetMatch = renderIndex.match(/\/assets\/index-[^"]+\.js/)
    const ourAsset = assetMatch ? assetMatch[0] : null
    check('probe build has a hashed index asset', ourAsset !== null, ourAsset ?? '')

    // Port 4173 is TAKEN on this machine (the coordinator's master
    // preview serves the fix-15 asset index-evO8t8Xh.js there) — a
    // previous probe run silently tested THAT server instead of its
    // own build, because its http.server failed to bind while curl
    // still got a 200 from the squatter. So: pick a port that is
    // provably free first, then VERIFY the served root HTML carries
    // our asset hash before letting Playwright near it.
    let port = 0
    for (let candidate = 43000 + Math.floor(Math.random() * 900); candidate < 44000; candidate++) {
      try {
        execSync(`curl -sf --max-time 1 http://127.0.0.1:${candidate}/ -o /dev/null`, { stdio: 'pipe' })
      } catch {
        port = candidate
        break
      }
    }
    check('found a provably free port for the probe server', port !== 0)
    const server = spawn('python3', ['-m', 'http.server', String(port), '--directory', renderOut], {
      cwd: root,
      stdio: 'pipe',
    })
    try {
      // Wait for OUR server to answer, and prove it is ours.
      let servedOurs = false
      for (let i = 0; i < 20; i++) {
        try {
          const served = execSync(`curl -sf http://127.0.0.1:${port}/`, { stdio: 'pipe' }).toString()
          if (ourAsset && served.includes(ourAsset)) {
            servedOurs = true
            break
          }
        } catch {
          // Not up yet.
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      check('probe server serves OUR build (asset hash matches)', servedOurs)
      if (servedOurs) {
        console.log('--- rendered check (headless Chromium) ---')
        try {
          execSync(`python3 ${join(root, 'scripts/fix16-status-render.py')} http://127.0.0.1:${port}`, {
            cwd: root,
            stdio: 'inherit',
          })
        } catch {
          // The render script exited non-zero: its own assertions
          // failed — a real failure, not a skip.
          failures++
          console.log('FAIL  rendered check assertions failed (see output above)')
        }
      } else {
        failures++
        console.log('FAIL  refusing to run the rendered check against a wrong server')
      }
    } finally {
      server.kill('SIGTERM')
    }
  } finally {
    rmSync(renderOut, { recursive: true, force: true })
  }
}
rmSync(outDir, { recursive: true, force: true })

console.log(
  failures === 0
    ? `\nALL CHECKS PASSED${skipped ? ` (${skipped} skipped)` : ''}`
    : `\n${failures} CHECK(S) FAILED${skipped ? ` (${skipped} skipped)` : ''}`,
)
process.exit(failures === 0 ? 0 : 1)
