// Fix pass 16, Group 6 — speaker toggle icon mismatch probe.
//
// The bug (fix-15 pixel check, 22:01–22:10 CET): the chat speaker
// toggle showed "Activer la voix" PRESSED while the icon rendered
// muted (VolumeX). Root cause: `aria-pressed` tracked the `muted`
// flag directly, but pressed means the controlled feature (voice) is
// ON — so pressed was true exactly when the voice was OFF, while the
// icon (and the amber/dim styling) correctly showed the voice state.
// One side was inverted: the pressed side. The fix is
// aria-pressed={!muted} in both toggles (Agent chat + MenuGuide panel,
// which share the same pattern and the same module-level speech flag).
//
// This probe asserts the agreement in both directions:
//   voice on  (muted=false) -> pressed=true,  Volume2 icon, "Couper la voix"
//   voice off (muted=true)  -> pressed=false, VolumeX icon, "Activer la voix"
//
// Two layers:
//   (A) Static: the shipped source wires pressed, icon and label to
//       the same single `muted` flag with the correct polarity, and
//       the old inverted form is gone.
//   (B) Rendered: headless Chromium (CDP, no npm deps — Node's built-in
//       WebSocket) against `vite preview` of this worktree's own build:
//       open #agent, read the live toggle, click it, read again, click
//       back; then open #menu, start a reading via an item "+" button
//       so the MenuGuide panel toggle mounts, and repeat the click
//       cycle there.
//
// Usage: node scripts/fix16-speaker-probe.mjs
//   (run from the worktree root; builds must already exist in dist/ —
//   run `npm run build` first. The probe serves THIS worktree's dist/
//   itself on 127.0.0.1:4176 (or FIX16_PORT), never reusing another
//   server: :4173 is the coordinator's master preview and other fix-16
//   groups hold their own ports, so reusing a port would test the
//   wrong build. Headless Chromium is the Playwright cache build —
//   /opt/meta-chromium/chrome cannot start standalone on this VM
//   ("Hatch WebGL domain policy is required for browser startup").)
// Exit 0 = all checks pass. Rendered MenuGuide checks are best-effort:
// if no reading can be started headlessly they are reported SKIPPED
// (static checks still cover that toggle) rather than failed.

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
let skipped = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}
function skip(name, detail = '') {
  skipped += 1
  console.log(`SKIP  ${name}${detail ? ` — ${detail}` : ''}`)
}

// ---------------------------------------------------------------------
// (A) Static: pressed, icon and label agree, from one flag.
// ---------------------------------------------------------------------

const agent = read('src/components/Agent.tsx')
const guide = read('src/components/MenuGuide.tsx')

// A1 — Agent chat toggle: pressed is !muted (voice ON = pressed).
{
  const m = agent.match(/aria-pressed=\{([^}]+)\}/)
  check('A1a Agent toggle aria-pressed reads !muted', m?.[1] === '!muted', `found aria-pressed={${m?.[1] ?? '—'}}`)
  check('A1b Agent icon is VolumeX when muted, Volume2 when not',
    agent.includes('{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}'))
  check('A1c Agent label is "Activer la voix" when muted, "Couper la voix" when not',
    agent.includes("aria-label={muted ? 'Activer la voix' : 'Couper la voix'}"))
  check('A1d Agent toggle still flips the same muted flag it reads',
    agent.includes('const next = !muted') && agent.includes('setMutedState(next)') && agent.includes('setSpeechMuted(next)'))
  check('A1e Agent styling agrees too: muted = dim, unmuted = amber highlight',
    agent.includes("muted\n                      ? 'border-line text-mist hover:text-bone'"))
}

// A2 — MenuGuide panel toggle: same pattern, same fix.
{
  const m = guide.match(/aria-pressed=\{([^}]+)\}/)
  check('A2a MenuGuide toggle aria-pressed reads !guide.muted', m?.[1] === '!guide.muted', `found aria-pressed={${m?.[1] ?? '—'}}`)
  check('A2b MenuGuide icon is VolumeX when muted, Volume2 when not',
    guide.includes('{guide.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}'))
  check('A2c MenuGuide label matches the Agent toggle',
    guide.includes("aria-label={guide.muted ? 'Activer la voix' : 'Couper la voix'}"))
  check('A2d MenuGuide toggle still flips the same muted flag it reads',
    guide.includes('const next = !muted') && guide.includes('setMutedState(next)') && guide.includes('setSpeechMuted(next)'))
}

// A3 — the old inverted form is gone everywhere; no other speaker
// toggle disagrees. (Live2DModel's aria-pressed is a form selector,
// unrelated — it must NOT be touched.)
{
  check('A3a no aria-pressed={muted} remains', !agent.includes('aria-pressed={muted}') && !guide.includes('aria-pressed={muted}'))
  check('A3b no aria-pressed={guide.muted} remains', !guide.includes('aria-pressed={guide.muted}'))
  const allPressed = [...agent.matchAll(/aria-pressed=\{([^}]+)\}/g), ...guide.matchAll(/aria-pressed=\{([^}]+)\}/g)]
    .map((m) => m[1])
  check('A3c every speaker-toggle pressed in Agent/MenuGuide is the negated muted flag',
    allPressed.length === 2 && allPressed.includes('!muted') && allPressed.includes('!guide.muted'),
    `found=[${allPressed.join(', ')}]`)
  check('A3d both toggles read the one module-level speech flag (isSpeechMuted)',
    agent.includes('useState(isSpeechMuted())') && guide.includes('useState(isSpeechMuted())'))
}

// A4 — the agreement table, evaluated from the shipped ternaries:
// muted=false -> pressed=true, Volume2, "Couper la voix";
// muted=true  -> pressed=false, VolumeX, "Activer la voix".
{
  const table = (muted) => ({
    pressed: !muted,
    icon: muted ? 'VolumeX' : 'Volume2',
    label: muted ? 'Activer la voix' : 'Couper la voix',
  })
  const on = table(false)
  const off = table(true)
  check('A4a voice ON  -> pressed + Volume2 + "Couper la voix"',
    on.pressed === true && on.icon === 'Volume2' && on.label === 'Couper la voix', JSON.stringify(on))
  check('A4b voice OFF -> unpressed + VolumeX + "Activer la voix"',
    off.pressed === false && off.icon === 'VolumeX' && off.label === 'Activer la voix', JSON.stringify(off))
  check('A4c pressed and icon never disagree across the table',
    (on.pressed && on.icon === 'Volume2') && (!off.pressed && off.icon === 'VolumeX'))
}

// ---------------------------------------------------------------------
// (B) Rendered: real DOM in headless Chromium via CDP.
// ---------------------------------------------------------------------

const PORT = Number(process.env.FIX16_PORT ?? 4176)
let BASE = `http://127.0.0.1:${PORT}`

const CHROME_CANDIDATES = [
  // Playwright cache build — the one that starts standalone on this VM.
  join(process.env.HOME ?? '', '.cache/ms-playwright/chromium-1255/chrome-linux64/chrome'),
  join(process.env.HOME ?? '', '.cache/ms-playwright/chromium_headless_shell-1255/chrome-linux/headless_shell'),
  // /opt/meta-chromium/chrome cannot start standalone here ("Hatch
  // WebGL domain policy is required for browser startup") — last resort.
  '/opt/meta-chromium/chrome',
]
const chromeBin = CHROME_CANDIDATES.find((p) => existsSync(p))
check('B0a headless Chromium binary found', !!chromeBin, chromeBin ?? 'none of the candidates exist')
check('B0b built output exists (run `npm run build` first)', existsSync(join(root, 'dist', 'index.html')))

let preview = null
let chrome = null
let ws = null

let ENTRY_ASSET = null
function entryAsset() {
  if (ENTRY_ASSET === null) {
    const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
    const m = html.match(/\/assets\/index-[^"']+\.js/)
    ENTRY_ASSET = m ? m[0] : 'index-'
  }
  return ENTRY_ASSET
}

async function pageServesOurBuild(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) })
    const text = await res.text()
    // The served index must reference THIS worktree's built entry
    // asset — otherwise it is someone else's preview (e.g. the
    // coordinator's master preview on :4173).
    return res.ok && text.includes('<div id="root"') && text.includes(entryAsset())
  } catch {
    return false
  }
}

async function startPreview() {
  // Own preview on our own port; try a few ports in case another
  // fix-16 group holds one. --strictPort makes vite exit at once if
  // the port is taken, so a taken port is a fast retry, not a hang.
  const candidates = [PORT, 4177, 4178, 4179].filter((p, i, a) => a.indexOf(p) === i)
  for (const port of candidates) {
    preview = spawn(join(root, 'node_modules', '.bin', 'vite'), ['preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
      cwd: root,
      stdio: 'pipe',
    })
    let up = false
    for (let i = 0; i < 50; i++) {
      if (await pageServesOurBuild(port)) { up = true; break }
      if (preview.exitCode !== null) break
      await sleep(200)
    }
    if (up) {
      BASE = `http://127.0.0.1:${port}`
      console.log(`      (serving this worktree's dist/ on ${BASE})`)
      return
    }
    preview.kill()
    preview = null
  }
  throw new Error('could not start a vite preview serving this worktree\'s dist/ (tried ports 4176–4179)')
}

// Minimal CDP client over Node's built-in WebSocket.
let msgId = 0
const pending = new Map()
async function cdpConnect() {
  const profile = mkdtempSync(join(tmpdir(), 'fix16-speaker-chrome-'))
  chrome = spawn(chromeBin, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=9223',
    '--window-size=1280,900',
    'about:blank',
  ], { stdio: 'pipe' })
  let target = null
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9223/json/list', { signal: AbortSignal.timeout(1000) })
      const targets = await res.json()
      target = targets.find((t) => t.type === 'page')
      if (target) break
    } catch { /* not up yet */ }
    await sleep(200)
  }
  if (!target) throw new Error('Chromium DevTools did not come up')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('CDP WebSocket failed to open'))
  })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(`CDP: ${msg.error.message}`))
      else resolve(msg.result)
    }
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
  await send('Runtime.enable')
  await send('Page.enable')
  return { send, profile }
}

async function evaluate(send, expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (res.exceptionDetails) throw new Error(`page JS threw: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description ?? ''}`)
  return res.result.value
}

async function waitFor(send, expression, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const v = await evaluate(send, expression)
      if (v) return v
    } catch { /* keep polling */ }
    await sleep(250)
  }
  return null
}

// Read a speaker toggle's live state: pressed, label, icon class.
const READ_TOGGLE = `(label) => {
  const btns = [...document.querySelectorAll('button[aria-pressed]')]
  const btn = btns.find((b) => b.getAttribute('aria-label') === label)
  if (!btn) return null
  const svg = btn.querySelector('svg')
  return {
    pressed: btn.getAttribute('aria-pressed'),
    label: btn.getAttribute('aria-label'),
    icon: svg ? svg.getAttribute('class') : null,
    visible: btn.offsetParent !== null,
  }
}`
const CLICK_TOGGLE = `(label) => {
  const btn = [...document.querySelectorAll('button[aria-pressed]')].find((b) => b.getAttribute('aria-label') === label)
  if (!btn) return false
  btn.click()
  return true
}`

function expectToggle(name, state, want) {
  if (!state) {
    check(name, false, 'toggle not found in the DOM')
    return false
  }
  const ok =
    state.pressed === String(want.pressed) &&
    state.label === want.label &&
    typeof state.icon === 'string' && state.icon.includes(want.iconClass)
  check(name, ok, `pressed=${state.pressed} label="${state.label}" icon="${state.icon}" (want pressed=${want.pressed} label="${want.label}" icon~${want.iconClass})`)
  return ok
}

if (failures === 0 && chromeBin) {
  try {
    await startPreview()
    const { send, profile } = await cdpConnect()
    try {
      // --- Agent chat toggle (#agent) ---
      await evaluate(send, `location.href = ${JSON.stringify(`${BASE}/#agent`)}`)
      const agentFound = await waitFor(send, `(${READ_TOGGLE})('Couper la voix') || (${READ_TOGGLE})('Activer la voix')`)
      check('B1a Agent chat toggle renders on #agent', !!agentFound, agentFound ? JSON.stringify(agentFound) : 'never appeared')
      if (agentFound) {
        // Default state: voice on (speech.ts: muted starts false).
        let s = await evaluate(send, `(${READ_TOGGLE})('Couper la voix')`)
        expectToggle('B1b Agent initial: voice ON -> pressed=true, Volume2, "Couper la voix"',
          s, { pressed: true, label: 'Couper la voix', iconClass: 'lucide-volume-2' })
        await evaluate(send, `(${CLICK_TOGGLE})('Couper la voix')`)
        await sleep(400)
        s = await evaluate(send, `(${READ_TOGGLE})('Activer la voix')`)
        expectToggle('B1c Agent after 1 click: voice OFF -> pressed=false, VolumeX, "Activer la voix"',
          s, { pressed: false, label: 'Activer la voix', iconClass: 'lucide-volume-x' })
        await evaluate(send, `(${CLICK_TOGGLE})('Activer la voix')`)
        await sleep(400)
        s = await evaluate(send, `(${READ_TOGGLE})('Couper la voix')`)
        expectToggle('B1d Agent after 2nd click: voice ON again -> pressed=true, Volume2',
          s, { pressed: true, label: 'Couper la voix', iconClass: 'lucide-volume-2' })
      }

      // --- MenuGuide panel toggle (#menu) ---
      // The panel toggle only mounts while a reading is active; an item
      // "+" tap starts one (itemEvent -> startReading). Note the mute
      // flag is module-level, so the Agent clicks above already set it
      // back to unmuted — the guide toggle must start from the same
      // shared state (pressed=true, Volume2).
      await evaluate(send, `location.href = ${JSON.stringify(`${BASE}/#menu`)}`)
      await waitFor(send, `document.querySelector('button[aria-label^="Ajouter"]') !== null`)
      const added = await evaluate(send, `(() => {
        const btn = document.querySelector('button[aria-label^="Ajouter"]')
        if (!btn) return false
        btn.click()
        return true
      })()`)
      const guideFound = added
        ? await waitFor(send, `(${READ_TOGGLE})('Couper la voix') || (${READ_TOGGLE})('Activer la voix')`, 15000)
        : null
      if (!guideFound) {
        skip('B2a MenuGuide toggle renders while a reading is active', added ? 'reading started but toggle never appeared' : 'no "Ajouter" button found on #menu')
      } else {
        check('B2a MenuGuide toggle renders while a reading is active', true, JSON.stringify(guideFound))
        let s = await evaluate(send, `(${READ_TOGGLE})('Couper la voix')`)
        expectToggle('B2b MenuGuide initial (shared flag, voice ON) -> pressed=true, Volume2',
          s, { pressed: true, label: 'Couper la voix', iconClass: 'lucide-volume-2' })
        await evaluate(send, `(${CLICK_TOGGLE})('Couper la voix')`)
        await sleep(400)
        // Muting stops the reading (MenuGuide.toggleMute calls
        // stopReading), which unmounts the toggle — so read it fast,
        // and if it is gone, the unmount itself proves the click
        // landed on the muted path; re-start a reading to read the
        // muted state instead.
        s = await evaluate(send, `(${READ_TOGGLE})('Activer la voix')`)
        if (s) {
          expectToggle('B2c MenuGuide after click: voice OFF -> pressed=false, VolumeX',
            s, { pressed: false, label: 'Activer la voix', iconClass: 'lucide-volume-x' })
        } else {
          const restarted = await evaluate(send, `(() => {
            const btn = document.querySelector('button[aria-label^="Ajouter"]')
            if (!btn) return false
            btn.click()
            return true
          })()`)
          const s2 = restarted
            ? await waitFor(send, `(${READ_TOGGLE})('Activer la voix')`, 15000)
            : null
          if (s2) {
            expectToggle('B2c MenuGuide after click (reading re-started): voice OFF -> pressed=false, VolumeX',
              s2, { pressed: false, label: 'Activer la voix', iconClass: 'lucide-volume-x' })
          } else {
            check('B2c MenuGuide after click: voice OFF -> pressed=false, VolumeX', false,
              'toggle unmounted on mute (stopReading) and no second reading could be started to re-read it')
          }
        }
      }
    } finally {
      try { ws.close() } catch { /* ignore */ }
      try { chrome.kill() } catch { /* ignore */ }
      rmSync(profile, { recursive: true, force: true })
    }
  } catch (err) {
    console.log(`FAIL  B rendered probe setup — ${err.message}`)
    failures += 1
  } finally {
    if (preview) preview.kill()
  }
}

console.log(
  failures === 0
    ? `\nfix16-speaker-probe: ALL CHECKS PASSED${skipped ? ` (${skipped} skipped)` : ''}`
    : `\nfix16-speaker-probe: ${failures} CHECK(S) FAILED${skipped ? ` (${skipped} skipped)` : ''}`,
)
process.exit(failures === 0 ? 0 : 1)
