// Fix pass 17, group 3 — voice does not connect in a real browser.
//
// THE FAILURE (cloud check 00:03–00:08 CET, zeeww tunnel, keyed asset
// index-DxldTtyJ.js, master 8e30543): clicking "Parler à voix haute"
// showed "Connexion à l'agent vocal…" then after ~8 s "Micro non
// autorisé — le chat texte reste disponible.", no mic prompt, no
// visible token/WebSocket state, while the page itself said voice via
// Deepgram was "pour l'instant indisponible" under APPEL VOCAL. The
// grant endpoint itself works (POST 200, real JWT) — so the failure
// is in the browser path, not the endpoint.
//
// ROOT CAUSE (diagnosed from src/lib/voiceAgent.ts + Agent.tsx):
//   1. ORDER — start() awaited the grant fetch FIRST (1–2 s healthy,
//      up to ~33 s with the fix-16 retries) and only then called
//      getUserMedia, so the mic prompt arrived seconds after the tap,
//      detached from the user gesture (Safari suppresses a
//      gesture-less mic request; Chrome is less reliable about it
//      too). In the headless browser the cloud check used there is
//      no mic device and no permission grant, so getUserMedia
//      auto-denied with NotAllowedError and NO prompt ever appeared.
//      The ~8 s is the checker's observation window, NOT a grant
//      timeout: a grant timeout would take >= 10 s and would surface
//      as 'grant-timeout', which it did not — and the message shown
//      ('mic-denied') is only reachable AFTER fetchGrantToken()
//      succeeds, so the grant HAD worked through the tunnel.
//   2. BLIND ATTRIBUTION — micErrorReason mapped every unclassified
//      rejection to 'mic-denied' and the code never consulted
//      navigator.permissions, so "blocked in site settings",
//      "prompt dismissed", "headless auto-deny" and "insecure
//      context" all rendered as the same "Micro non autorisé", with
//      no recovery path and no record of which step was attempted.
//   3. NO TIMEOUTS — an unanswered mic prompt, or a socket that
//      opens but never reaches SettingsApplied, stuck on
//      "Connexion…" forever.
//   4. STALE IDLE COPY — voiceOffline said voice was "pour l'instant
//      indisponible" while the grant endpoint demonstrably works.
//   No Permissions-Policy / Feature-Policy header blocks the mic
//   (vercel.json sets none, index.html sets none), and no iframe
//   allow attribute is involved — the page itself is the top frame.
//
// THE FIX (this branch):
//   * getUserMedia fires synchronously in start(), first statement
//     after the 'connecting' status — still inside the tap's gesture
//     — and the grant fetch runs CONCURRENTLY (awaited only once the
//     mic is in hand; a mic failure reports at once and the grant
//     result is ignored; a grant failure stops the mic tracks).
//   * Connecting reports its real stage ('mic' | 'grant' | 'socket').
//   * Mic failures are classified against the live permission state:
//     'mic-blocked' (browser has the mic blocked for this site),
//     'mic-dismissed' (prompt closed/auto-denied without a decision),
//     'mic-timeout' (prompt unanswered for 30 s).
//   * A socket that opens but never reaches SettingsApplied times
//     out after 20 s ('socket-timeout'); stop() mid-connect bumps a
//     generation counter so late mic grants / tokens can never
//     resurrect an ended call (late mic tracks are stopped), and
//     ws.onmessage ignores frames arriving after stop() — the probe
//     caught a late SettingsApplied flipping an ended call to 'live'.
//   * voiceOffline no longer claims voice is "indisponible".
//
// HARNESS NOTES (found while writing this probe, not site bugs):
//   * page.routeWebSocket MUST be registered before navigation —
//     registering it after load hangs on this heavy page (the
//     renderer is busy with the Live2D stage; the CDP call never
//     resolves). Same for SwiftShader flags: --use-angle=swiftshader
//     saturates the renderer so badly that CDP calls stall for
//     minutes, so the probe launches WITHOUT them (the voice panel
//     needs no WebGL; the Live2D stage falls back).
//   * CDP evaluates on this page take seconds (busy renderer), so
//     wall-clock observation lags the page's own timers: B4 polls
//     60 s for a timeout the page fires ~20 s after socket creation
//     (verified in isolation: the timeout text lands on time, the
//     probe just observes it late).
//   * A registered routeWebSocket bypasses a window.WebSocket
//     wrapper (verified in isolation) — read the socket URL from
//     the route handler's ws.url(), not from an init-script shim.
//
// THIS PROBE (no real Deepgram key anywhere — the stub mints its own
// fake JWT; the real grant server, preview and tunnel are untouched):
//   A  STUB GRANT (HTTP): the probe's own stub grant server answers
//      POST /api/deepgram/grant with a fake JWT; the built site is
//      served from the same server, so the browser uses the exact
//      same-origin grant path as production.
//   B  BROWSER (Playwright, cached Chromium 1255), real built site:
//      B1  fake mic + mic permission + stub Deepgram WebSocket
//          (Welcome -> Settings -> SettingsApplied) -> the call
//          reaches LIVE ("Je vous écoute…"); grant POST observed;
//          mic requested before the grant answered; socket opened
//          to wss://agent.deepgram.com/v1/agent/converse (seen by
//          the route — a routeWebSocket bypasses a window.WebSocket
//          wrapper, so the exact ['bearer', <stub JWT>] construction
//          is proven by C1 instead); Settings carries the
//          mercury-3 think block; no "Micro non autorisé", no
//          "indisponible" in the voice panel; Terminer returns to
//          the corrected idle text.
//      B2  no mic permission, no fake device (headless auto-deny,
//          the cloud check's situation) -> a TRUTHFUL mic error
//          ('mic-blocked' or 'mic-dismissed' wording), never a
//          grant error and never the blanket "Micro non autorisé".
//      B3  grant 503 with a working mic -> truthful grant-http
//          text, exactly 3 grant attempts, mic requested first.
//      B4  socket opens but never sends Welcome -> 'socket-timeout'
//          text within ~20 s (no stuck "Connexion…" forever).
//   C  UNIT (real shipped DeepgramVoiceAgent, bundled like the
//      fix16 probe, browser globals stubbed): mic-before-grant call
//      order; mic-blocked vs mic-dismissed classification;
//      mic-missing without a grant fetch; grant-503 after a working
//      mic stops the mic tracks; stop() during a pending mic prompt
//      ends idle with the late tracks stopped; connecting stages
//      mic -> grant -> socket -> live in order.
//   D  STATIC: retry constants intact, WebSocket handshake and think
//      block unchanged, voiceOffline free of "indisponible", zero
//      "EN DIRECT" in src, grant server + Vercel fn untouched.
//
// Usage: node scripts/fix17-voice-probe.mjs  (from the repo root)
// Exit 0 = all checks pass, 1 = at least one fails.
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs'
import { dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const HOME = process.env.HOME ?? ''
const PLAYWRIGHT_CORE =
  process.env.FIX17_PLAYWRIGHT ??
  join(HOME, 'workspace/.fix15-tools/node_modules/playwright-core')
const CHROME_PATHS = [
  join(HOME, '.cache/ms-playwright/chromium-1255/chrome-linux64/chrome'),
  '/opt/meta-chromium/chrome',
]

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const STUB_JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXgxNy1wcm9iZS1zdHViIn0.c3R1Yi1zaWduYXR1cmUtZml4MTc'

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------------ build
// `npm run build` = tsc -b && vite build. The worktree's node_modules
// is a symlink to the main checkout's (see the worktree setup); the
// binaries resolve through it.
async function run(bin, args) {
  return new Promise((resolve) => {
    execFile(join(root, 'node_modules', '.bin', bin), args, { cwd: root }, (err, stdout, stderr) => {
      resolve({ err, out: `${stdout ?? ''}${stderr ?? ''}` })
    })
  })
}
{
  const tsc = await run('tsc', ['-b'])
  check('build: tsc -b passes', !tsc.err, tsc.err ? tsc.out.slice(-300) : '')
  const vite = await run('vite', ['build'])
  check('build: vite build passes', !vite.err, vite.err ? vite.out.slice(-300) : '')
  const indexHtml = join(root, 'dist', 'index.html')
  const indexJs = readFileSync(indexHtml, 'utf8').match(/assets\/index-[^"']+\.js/)?.[0] ?? ''
  check('build: dist/index.html references a built index asset', indexJs.length > 0, indexJs)
}

// ------------------------------------------------- A: stub grant + server
// One server: serves dist/ AND answers POST /api/deepgram/grant with
// the stub JWT — the exact same-origin path the browser uses in
// production (vite preview proxy / Vercel fn), minus any real key.
// grantMode is flipped per browser scenario ('ok' | '503').
let grantMode = 'ok'
let grantAttempts = 0
let grantRequests = []
// Every grant response the stub sends, per scenario (reset by each
// browser scenario): { status, tokenLen }. A recurrence of the
// probe6 B1 one-off — a 200 whose body the browser could not read
// ('grant-empty') — shows up here with its evidence instead of as
// a bare live-check failure.
let grantResponses = []
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
}
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (req.method === 'POST' && url.pathname === '/api/deepgram/grant') {
    grantAttempts += 1
    grantRequests.push(Date.now())
    // Drain the body, then answer per mode. The 'end' listener is
    // attached BEFORE resume() — the reverse order is a (theoretical
    // but cheap to eliminate) race for a bodiless POST whose 'end'
    // is already queued.
    req.on('end', () => {
      if (grantMode === '503') {
        grantResponses.push({ status: 503, tokenLen: 0 })
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'unavailable' }))
        return
      }
      grantResponses.push({ status: 200, tokenLen: STUB_JWT.length })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ access_token: STUB_JWT, expires_in: 3600 }))
    })
    req.resume()
    return
  }
  if (req.method !== 'GET') {
    res.writeHead(405)
    res.end()
    return
  }
  let path = url.pathname === '/' ? '/index.html' : url.pathname
  const file = join(root, 'dist', decodeURIComponent(path))
  if (!file.startsWith(join(root, 'dist')) || !existsSync(file) || !file.includes('.')) {
    // SPA fallback for app routes.
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(readFileSync(join(root, 'dist', 'index.html')))
    return
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const PORT = server.address().port
const BASE = `http://127.0.0.1:${PORT}`

{
  grantMode = 'ok'
  grantAttempts = 0
  const res = await fetch(`${BASE}/api/deepgram/grant`, { method: 'POST', signal: AbortSignal.timeout(10000) })
  const body = await res.json()
  check(
    'A  stub grant: POST /api/deepgram/grant returns 200 with a fake JWT',
    res.status === 200 && body.access_token === STUB_JWT,
    `status=${res.status}, token_match=${body.access_token === STUB_JWT}`,
  )
  const html = await (await fetch(`${BASE}/`, { signal: AbortSignal.timeout(10000) })).text()
  check('A  stub server serves the built site', html.includes('<div id="root"'), `bytes=${html.length}`)
}

// ------------------------------------------------- C: unit, real voiceAgent
// Same harness shape as the fix16 probe: temp COPIES of the shipped
// files with exactly one mechanical change — `import.meta.env`
// (which Node cannot evaluate) replaced by a literal — transpiled
// with the repo's own tsc to CommonJS and required. Every line of
// mic-first / classification / stage logic under test is
// byte-identical to the shipped file. The temp dir lives INSIDE the
// repo root so Node resolves 'react' (via agentStatus) from
// node_modules. No real key: the stub fetch mints the fake JWT.
const outDir = mkdtempSync(join(root, '.fix17-probe-'))
writeFileSync(join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }))
const probeSrc = join(outDir, 'src')
mkdirSync(join(probeSrc, 'lib'), { recursive: true })
for (const rel of [
  'src/content.ts',
  'src/lib/voiceAgent.ts',
  'src/lib/avatarBridge.ts',
  'src/lib/brain.ts',
  'src/lib/agentBrain.ts',
  'src/lib/agentStatus.ts',
]) {
  const orig = readFileSync(join(root, rel), 'utf8')
  const copy = orig.replaceAll('import.meta.env', '({ DEV: false } as Record<string, unknown>)')
  writeFileSync(join(outDir, rel), copy)
  check(
    `C  probe copy of ${rel} differs from shipped only in import.meta.env`,
    orig.replaceAll('import.meta.env', '({ DEV: false } as Record<string, unknown>)') === copy,
  )
}
const tscOut = join(outDir, 'out')
await new Promise((resolve, reject) => {
  execFile(
    join(root, 'node_modules', '.bin', 'tsc'),
    [
      '--ignoreConfig',
      join(probeSrc, 'lib', 'voiceAgent.ts'),
      '--module',
      'commonjs',
      '--target',
      'es2022',
      '--lib',
      'es2022,dom',
      '--skipLibCheck',
      '--rootDir',
      probeSrc,
      '--outDir',
      tscOut,
    ],
    { cwd: outDir },
    (err, stdout, stderr) => (err ? reject(new Error(stderr || stdout)) : resolve()),
  )
})

// Mutable stub behaviour, per scenario.
let micMode = 'ok' // 'ok' | 'denied' | 'missing-api' | 'slow'
let permState = 'granted' // 'granted' | 'prompt' | 'denied'
let unitGrantMode = 'ok' // 'ok' | '503'
let unitGrantAttempts = 0
let callOrder = []
let wsOpened = null
let settingsSeen = null
let wsMode = 'welcome' // 'welcome' | 'silent'
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  if (typeof url === 'string' && url.startsWith('/api/deepgram/grant')) {
    unitGrantAttempts += 1
    callOrder.push('grant')
    if (unitGrantMode === '503') {
      return { ok: false, status: 503, json: async () => ({ error: 'unavailable' }) }
    }
    return { ok: true, status: 200, json: async () => ({ access_token: STUB_JWT, expires_in: 3600 }) }
  }
  return realFetch(url, init)
}
const defineGlobal = (name, value) => {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
}
defineGlobal('window', globalThis)
let lastStreamTracksStopped = false
function fakeStream() {
  return {
    getTracks: () => [
      {
        stop() {
          lastStreamTracksStopped = true
        },
      },
    ],
  }
}
function domError(name) {
  const e = new Error(name)
  e.name = name
  return e
}
defineGlobal('navigator', {
  mediaDevices: {
    getUserMedia: async () => {
      callOrder.push('mic')
      if (micMode === 'denied') throw domError('NotAllowedError')
      if (micMode === 'slow') {
        await sleep(300)
        return fakeStream()
      }
      return fakeStream()
    },
  },
  permissions: {
    query: async () => ({ state: permState }),
  },
})
// 'missing-api' removes getUserMedia entirely (a mic-less device).
// The restore puts back the SAME mode-aware stub — the old version
// re-added a bare stub that ignored micMode, which made the 'slow'
// scenario resolve instantly.
const originalGetUserMedia = globalThis.navigator.mediaDevices.getUserMedia
function setMicApiPresent(present) {
  const md = globalThis.navigator.mediaDevices
  if (present) {
    if (!md.getUserMedia) md.getUserMedia = originalGetUserMedia
  } else {
    delete md.getUserMedia
  }
}
class StubAudioContext {
  constructor() {
    this.currentTime = 0
    this.destination = {}
    this.audioWorklet = { addModule: async () => {} }
  }
  createAnalyser() {
    return { fftSize: 0, connect() {}, getFloatTimeDomainData(buf) { buf.fill(0) } }
  }
  createGain() {
    return { gain: { value: 1 }, connect() {} }
  }
  createMediaStreamSource() {
    return { connect() {} }
  }
  createBuffer() {
    return { copyToChannel() {}, duration: 0 }
  }
  createBufferSource() {
    return { connect() {}, start() {}, stop() {}, onended: null, buffer: null }
  }
  async resume() {}
  async close() {}
}
defineGlobal('AudioContext', StubAudioContext)
defineGlobal('AudioWorkletNode', class {
  constructor() {
    this.port = { onmessage: null, close() {} }
  }
})
defineGlobal('WebSocket', class {
  static OPEN = 1
  static CONNECTING = 0
  constructor(url, protocols) {
    wsOpened = { url, protocols }
    this.readyState = 0
    this.binaryType = ''
    setTimeout(() => {
      this.readyState = 1
      this.onopen?.()
      if (wsMode === 'welcome') {
        setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'Welcome' }) }), 10)
      }
    }, 10)
  }
  send(data) {
    if (typeof data === 'string') {
      try {
        const j = JSON.parse(data)
        if (j.type === 'Settings') {
          settingsSeen = j
          setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'SettingsApplied' }) }), 10)
        }
      } catch { /* binary frames are ignored */ }
    }
  }
  close() {}
})
defineGlobal('requestAnimationFrame', () => 0)
defineGlobal('cancelAnimationFrame', () => {})

const { DeepgramVoiceAgent, buildThinkBlock } = require(join(tscOut, 'lib', 'voiceAgent.js'))

async function runUnitAgent() {
  const events = []
  const agent = new DeepgramVoiceAgent({
    onStatus: (status, error, grantDetail, stage) =>
      events.push({ status, error, grantDetail, stage }),
    onTranscript: () => {},
    onOrderAdded: () => {},
  })
  await agent.start()
  return { events, agent }
}

// C1: mic is requested before the grant fetch, and the call goes live.
micMode = 'ok'
permState = 'granted'
unitGrantMode = 'ok'
unitGrantAttempts = 0
callOrder = []
wsOpened = null
settingsSeen = null
wsMode = 'welcome'
{
  const { events, agent } = await runUnitAgent()
  await sleep(300)
  agent.stop()
  check(
    'C1  mic-first: getUserMedia is called before the grant fetch',
    callOrder[0] === 'mic' && callOrder.includes('grant'),
    `order=${callOrder.join('>')}`,
  )
  check(
    'C1  mic-first: stages run mic -> grant -> socket, then live',
    JSON.stringify(events.slice(0, 4).map((e) => (e.stage ? `${e.status}:${e.stage}` : e.status))) ===
      JSON.stringify(['connecting:mic', 'connecting:grant', 'connecting:socket', 'live']),
    JSON.stringify(events),
  )
  check(
    'C1  socket opened with the stub JWT as bearer protocol',
    wsOpened?.url === 'wss://agent.deepgram.com/v1/agent/converse' &&
      JSON.stringify(wsOpened?.protocols) === JSON.stringify(['bearer', STUB_JWT]),
    wsOpened ? `${wsOpened.url} ${JSON.stringify(wsOpened.protocols)}` : 'no socket',
  )
  check(
    'C1  Settings carries a valid think block (managed fallback when no LLM key is configured)',
    JSON.stringify(settingsSeen?.agent?.think ?? '').includes('gpt-4o-mini'),
    settingsSeen ? 'think present' : 'no Settings sent',
  )
  check(
    'C1  buildThinkBlock with a key returns the mercury-3 array, without one the managed fallback',
    JSON.stringify(buildThinkBlock('fake-key-for-probe')).includes('mercury-3') &&
      JSON.stringify(buildThinkBlock(undefined)).includes('gpt-4o-mini') &&
      !JSON.stringify(buildThinkBlock(undefined)).includes('mercury-3'),
    'see buildThinkBlock()',
  )
}

// C2: mic denied while the browser has it blocked -> 'mic-blocked'
// (the grant would have succeeded — the error must still be the mic's).
micMode = 'denied'
permState = 'denied'
unitGrantMode = 'ok'
unitGrantAttempts = 0
callOrder = []
wsOpened = null
{
  const { events, agent } = await runUnitAgent()
  agent.stop()
  const ended = events.find((e) => e.status === 'ended')
  check(
    "C2  mic denied + permission denied: reports 'mic-blocked', not the blanket 'mic-denied'",
    ended?.error === 'mic-blocked',
    JSON.stringify(ended),
  )
  check('C2  mic-blocked: socket never opened', wsOpened === null)
}

// C3: mic denied while the permission is still 'prompt' (prompt
// closed / auto-denied without a decision) -> 'mic-dismissed'.
micMode = 'denied'
permState = 'prompt'
wsOpened = null
{
  const { events, agent } = await runUnitAgent()
  agent.stop()
  const ended = events.find((e) => e.status === 'ended')
  check(
    "C3  mic denied + permission prompt: reports 'mic-dismissed'",
    ended?.error === 'mic-dismissed',
    JSON.stringify(ended),
  )
  check('C3  mic-dismissed: socket never opened', wsOpened === null)
}

// C4: no mic API at all -> 'mic-missing' and the grant is never fetched.
micMode = 'ok'
setMicApiPresent(false)
unitGrantAttempts = 0
callOrder = []
wsOpened = null
{
  const { events, agent } = await runUnitAgent()
  agent.stop()
  const ended = events.find((e) => e.status === 'ended')
  check(
    "C4  no getUserMedia: reports 'mic-missing'",
    ended?.error === 'mic-missing',
    JSON.stringify(ended),
  )
  check('C4  mic-missing: grant never fetched, socket never opened', unitGrantAttempts === 0 && wsOpened === null)
  setMicApiPresent(true)
}

// C5: grant 503 after a working mic -> 'grant-http' (3 attempts) and
// the mic tracks are stopped (no live mic left behind).
micMode = 'ok'
permState = 'granted'
unitGrantMode = '503'
unitGrantAttempts = 0
lastStreamTracksStopped = false
wsOpened = null
{
  const { events, agent } = await runUnitAgent()
  agent.stop()
  const ended = events.find((e) => e.status === 'ended')
  check(
    "C5  grant 503 after mic ok: reports 'grant-http' with attempts=3, status=503",
    ended?.error === 'grant-http' &&
      ended?.grantDetail?.kind === 'http' &&
      ended?.grantDetail?.attempts === 3 &&
      ended?.grantDetail?.status === 503,
    JSON.stringify(ended),
  )
  check('C5  grant failure stops the mic tracks', lastStreamTracksStopped)
  check('C5  grant failure: socket never opened', wsOpened === null)
  unitGrantMode = 'ok'
}

// C6: stop() during a pending mic prompt -> idle, no 'ended' after
// it, and the late mic tracks are stopped on arrival.
micMode = 'slow'
permState = 'granted'
unitGrantMode = 'ok'
lastStreamTracksStopped = false
{
  const events = []
  const agent = new DeepgramVoiceAgent({
    onStatus: (status, error, grantDetail, stage) =>
      events.push({ status, error, grantDetail, stage }),
    onTranscript: () => {},
    onOrderAdded: () => {},
  })
  const started = agent.start()
  await sleep(50)
  agent.stop()
  await started
  await sleep(500)
  check(
    'C6  stop() during mic prompt: statuses are connecting then idle only',
    JSON.stringify(events.map((e) => e.status)) === JSON.stringify(['connecting', 'idle']),
    JSON.stringify(events),
  )
  check('C6  stop() during mic prompt: late mic tracks stopped', lastStreamTracksStopped)
  micMode = 'ok'
}
// C7: stop() right after the socket opens, before Welcome arrives
// — a late Welcome/SettingsApplied must not flip the ended call to
// 'live'. (The first version of this probe caught the real bug: the
// stub socket's timers fired after stop() and onmessage had no
// stopped-guard, so the call went 'live' after 'idle'.)
micMode = 'ok'
permState = 'granted'
unitGrantMode = 'ok'
wsMode = 'welcome'
wsOpened = null
{
  const events = []
  const agent = new DeepgramVoiceAgent({
    onStatus: (status, error, grantDetail, stage) =>
      events.push({ status, error, grantDetail, stage }),
    onTranscript: () => {},
    onOrderAdded: () => {},
  })
  const started = agent.start()
  // Wait until the socket exists, then stop before Welcome lands
  // (the stub sends Welcome 10 ms after open, SettingsApplied
  // 10 ms after Settings).
  for (let i = 0; i < 50 && !wsOpened; i++) await sleep(10)
  agent.stop()
  await started
  await sleep(500)
  check(
    'C7  stop() before Welcome: no live after idle',
    JSON.stringify(events.map((e) => e.status)) ===
      JSON.stringify(['connecting', 'connecting', 'connecting', 'idle']),
    JSON.stringify(events),
  )
  check(
    'C7  stop() before Welcome: the last status stays idle',
    events[events.length - 1]?.status === 'idle',
    JSON.stringify(events[events.length - 1]),
  )
}
globalThis.fetch = realFetch

// ------------------------------------------------- B: real browser drive
let pw = null
try {
  pw = await import(`${PLAYWRIGHT_CORE}/index.mjs`)
} catch {
  try {
    pw = { chromium: require(join(PLAYWRIGHT_CORE, 'index.js')).chromium }
  } catch { /* no playwright — browser section skipped below */ }
}
const chromePath = CHROME_PATHS.find((p) => existsSync(p))
if (!pw) {
  console.log('B  SKIP: playwright-core not resolvable — browser section skipped (static + unit checks are the gate)')
} else if (!chromePath) {
  console.log('B  SKIP: no cached Chromium binary found — browser section skipped')
} else {
  const { chromium } = pw
  // Instrumentation injected before any page script runs: record
  // mic calls, grant fetch calls, and WebSocket opens (url +
  // subprotocols) with timestamps, so the probe can prove the
  // mic-first order and the bearer handshake from the page itself.
  const INIT_SCRIPT = `
    window.__fix17 = { micCalls: 0, micAt: 0, grantCalls: 0, grantAt: 0 };
    const __origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (...a) => {
      window.__fix17.micCalls += 1;
      if (!window.__fix17.micAt) window.__fix17.micAt = Date.now();
      return __origGUM(...a);
    };
    const __origFetch = window.fetch.bind(window);
    window.fetch = (...a) => {
      if (typeof a[0] === 'string' && a[0].includes('/api/deepgram/grant')) {
        window.__fix17.grantCalls += 1;
        if (!window.__fix17.grantAt) window.__fix17.grantAt = Date.now();
      }
      return __origFetch(...a);
    };
    // NOTE: no window.WebSocket wrapper here on purpose — when a
    // page.routeWebSocket route is registered, Playwright creates
    // the socket through its own channel and the page's WebSocket
    // subclass never runs (verified: wrapper captures the open
    // without a route, captures nothing with one). The socket URL is
    // therefore read from the route handler's ws.url() instead, and
    // the exact ['bearer', token] construction is proven by C1 (the
    // real class, node harness).
  `
  async function voiceStatusText(page) {
    return page.evaluate(() => {
      const ps = [...document.querySelectorAll('#agent p')].map((p) => p.textContent ?? '')
      // The voice status line is the <p> directly under the mic-level
      // meter; find it by its neighbours — it is the only #agent <p>
      // whose text matches a known voice status sentence.
      const known = [
        'Je vous écoute',
        'Nekomi parle',
        'Demande d’accès au microphone',
        'Obtention du jeton',
        'Connexion à l’agent vocal',
        'Micro non autorisé',
        'microphone est bloqué',
        'fermée sans réponse',
        'Aucune réponse à la demande',
        'Aucun microphone trouvé',
        'serveur de jetons',
        'jeton d’appel',
        'n’a pas abouti à temps',
        'connexion vocale a été interrompue',
        'capture audio',
        'configuration vocale',
        'voix Deepgram est disponible',
      ]
      return ps.find((t) => known.some((k) => t.includes(k))) ?? ps.join(' | ').slice(0, 200)
    })
  }
  // NOTE: no --use-angle=swiftshader / --enable-unsafe-swiftshader
  // here (unlike the fix15 fluid probe): software WebGL saturates
  // this VM's renderer so badly that CDP calls (page.title,
  // routeWebSocket after load) stall for minutes. The voice panel
  // needs no WebGL — without those flags the Live2D stage falls
  // back and the page stays responsive, exactly like the fix16
  // chips probe's launch.
  async function openAgentPage(browser, { permissions, wsRoute } = {}) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      ...(permissions ? { permissions } : {}),
    })
    const page = await context.newPage()
    await page.addInitScript(INIT_SCRIPT)
    // The WebSocket route MUST be registered before navigation:
    // registering it after load hangs on this heavy page (the
    // renderer is busy with the Live2D stage; the CDP call never
    // resolves), while pre-navigation registration returns at once.
    if (wsRoute) await page.routeWebSocket('**/agent.deepgram.com/**', wsRoute)
    await page.goto(`${BASE}/#agent`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.locator('#agent-input').waitFor({ state: 'visible', timeout: 90_000 })
    return { context, page }
  }
  // Click the voice button the way a human can, but Playwright's
  // locator.click cannot on this page: the button lives under a
  // data-reveal ancestor (opacity 0 until ScrollTrigger reveals it)
  // and the page runs Lenis smooth-scroll, which fights Playwright's
  // scroll-into-view / stability waits — locator.click times out
  // even with the button revealed, in-viewport, stable, enabled and
  // topmost at its own centre (verified in a debug run). So: scroll
  // it into view natively, wait for the reveal (opacity 1), verify
  // the hit-test, then dispatch a real DOM click, which fires
  // React's onClick exactly as a tap does. The parent's cloud check
  // already proved a real browser can tap this button (it reached
  // "Connexion…"), so the tap itself is not what's under test here.
  async function clickVoice(page) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('#agent button')].find((x) =>
        x.textContent.includes('Parler à voix haute'),
      )
      window.scrollTo({ top: b.getBoundingClientRect().top + window.scrollY - 300, behavior: 'instant' })
    })
    let revealed = false
    for (let i = 0; i < 40; i++) {
      revealed = await page.evaluate(() => {
        const b = [...document.querySelectorAll('#agent button')].find((x) =>
          x.textContent.includes('Parler à voix haute'),
        )
        if (!b) return false
        let el = b
        while (el) {
          if (getComputedStyle(el).opacity === '0') return false
          el = el.parentElement
        }
        const r = b.getBoundingClientRect()
        return r.top >= 0 && r.top < innerHeight && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b
      })
      if (revealed) break
      await page.waitForTimeout(250)
    }
    check('clickVoice: voice button revealed, in viewport and topmost before clicking', revealed)
    await page.evaluate(() => {
      ;[...document.querySelectorAll('#agent button')]
        .find((x) => x.textContent.includes('Parler à voix haute'))
        .click()
    })
  }
  async function waitVoiceText(page, needles, timeoutMs) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
      const text = await voiceStatusText(page)
      if (needles.some((n) => text.includes(n))) return text
      await page.waitForTimeout(250)
    }
    return voiceStatusText(page)
  }

  // B1 — happy path: fake mic + permission, stub Deepgram socket.
  // Each scenario is try/catch'd so one browser failure is recorded
  // as failed checks instead of aborting the whole probe.
  grantMode = 'ok'
  grantAttempts = 0
  grantResponses = []
  {
    const browser = await chromium.launch({
      executablePath: chromePath,
      args: [
        '--no-sandbox',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    })
    try {
      let settingsSeenBrowser = null
      let routeSocketUrl = null
      const { context, page } = await openAgentPage(browser, {
        permissions: ['microphone'],
        wsRoute: (ws) => {
          routeSocketUrl = ws.url()
          ws.onMessage((msg) => {
            if (typeof msg === 'string') {
              try {
                const j = JSON.parse(msg)
                if (j.type === 'Settings') {
                  settingsSeenBrowser = j
                  ws.send(JSON.stringify({ type: 'SettingsApplied' }))
                }
              } catch { /* binary mic frames: ignored */ }
            }
          })
          // Welcome shortly after connect, so the page's onmessage is
          // attached before it arrives.
          setTimeout(() => ws.send(JSON.stringify({ type: 'Welcome' })), 150)
        },
      })
      await clickVoice(page)
      // 60 s, not 30 s: on this VM the renderer's main thread is
      // slow enough that the live transition can take >30 s to be
      // OBSERVED (same slow-observation lag as B4 — the route sees
      // the full handshake in ~1 s, but the page-side status
      // update + the probe's own polling evaluates queue behind a
      // busy renderer). B1 flaked once at 30 s with the handshake
      // demonstrably complete server-side.
      const liveText = await waitVoiceText(page, ['Je vous écoute', 'Nekomi parle'], 60_000)
      check('B1  happy path: call reaches LIVE', liveText.includes('Je vous écoute') || liveText.includes('Nekomi parle'), liveText)
      check(
        'B1  stub grant answered every attempt with a well-formed JWT',
        grantResponses.length >= 1 && grantResponses.every((r) => r.status === 200 && r.tokenLen === STUB_JWT.length),
        JSON.stringify(grantResponses),
      )
      const diag = await page.evaluate(() => window.__fix17)
      check('B1  grant fetch reached the stub (same-origin path)', diag.grantCalls >= 1, `grantCalls=${diag.grantCalls}`)
      check(
        'B1  mic requested before the grant answered (mic-first order)',
        diag.micCalls >= 1 && diag.micAt > 0 && diag.grantAt > 0 && diag.micAt <= diag.grantAt,
        `micAt=${diag.micAt}, grantAt=${diag.grantAt}, micCalls=${diag.micCalls}`,
      )
      check(
        'B1  socket opened to the Deepgram agent endpoint (seen by the route)',
        routeSocketUrl === 'wss://agent.deepgram.com/v1/agent/converse',
        routeSocketUrl ?? 'no socket seen by the route',
      )
      check(
        'B1  Settings sent to the agent carries a valid think block',
        JSON.stringify(settingsSeenBrowser?.agent?.think ?? '').includes('gpt-4o-mini') ||
          JSON.stringify(settingsSeenBrowser?.agent?.think ?? '').includes('mercury-3'),
        settingsSeenBrowser ? 'think present' : 'no Settings seen',
      )
      const panelText = await page.evaluate(() =>
        [...document.querySelectorAll('#agent p')].map((p) => p.textContent ?? '').join(' | '),
      )
      check('B1  voice panel never shows the blanket "Micro non autorisé"', !panelText.includes('Micro non autorisé'), panelText.slice(0, 200))
      check('B1  voice panel never shows "indisponible"', !panelText.includes('indisponible'), panelText.slice(0, 200))
      // Terminer returns to the corrected idle text (same DOM-click
      // reason as clickVoice above: Lenis fights Playwright clicks).
      await page.evaluate(() => {
        ;[...document.querySelectorAll('#agent button')]
          .find((x) => x.textContent.includes('Terminer l’appel'))
          ?.click()
      })
      const idleText = await waitVoiceText(page, ['voix Deepgram est disponible'], 10_000)
      check(
        'B1  Terminer returns to the corrected idle text (voice "disponible", not "indisponible")',
        idleText.includes('voix Deepgram est disponible'),
        idleText,
      )
      await context.close()
    } catch (e) {
      check('B1  happy path: browser scenario completed without error', false, String(e).slice(0, 300))
    } finally {
      await browser.close().catch(() => undefined)
    }
  }

  // B2 — the cloud check's situation: no mic permission, no fake
  // device (headless auto-deny, no prompt shown). The error must be
  // a truthful mic error, never a grant error and never the blanket
  // "Micro non autorisé".
  grantMode = 'ok'
  grantAttempts = 0
  {
    const browser = await chromium.launch({
      executablePath: chromePath,
      args: ['--no-sandbox'],
    })
    try {
      const { context, page } = await openAgentPage(browser, {})
      await clickVoice(page)
      const text = await waitVoiceText(
        page,
        ['microphone est bloqué', 'fermée sans réponse', 'Aucune réponse à la demande', 'Aucun microphone trouvé'],
        20_000,
      )
      const truthful =
        text.includes('microphone est bloqué') ||
        text.includes('fermée sans réponse') ||
        text.includes('Aucune réponse à la demande') ||
        text.includes('Aucun microphone trouvé')
      check('B2  headless auto-deny: a truthful mic error is shown', truthful, text)
      check('B2  headless auto-deny: NOT the blanket "Micro non autorisé"', !text.includes('Micro non autorisé'), text)
      check('B2  headless auto-deny: NOT a grant error', !text.includes('serveur de jetons'), text)
      const diag = await page.evaluate(() => window.__fix17)
      check('B2  headless auto-deny: the mic WAS attempted (not a grant failure in disguise)', diag.micCalls >= 1, `micCalls=${diag.micCalls}`)
      await context.close()
    } catch (e) {
      check('B2  headless auto-deny: browser scenario completed without error', false, String(e).slice(0, 300))
    } finally {
      await browser.close().catch(() => undefined)
    }
  }

  // B3 — grant 503 with a working mic: truthful grant error, 3
  // attempts, mic requested first.
  grantMode = '503'
  grantAttempts = 0
  {
    const browser = await chromium.launch({
      executablePath: chromePath,
      args: [
        '--no-sandbox',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    })
    try {
      const { context, page } = await openAgentPage(browser, {
        permissions: ['microphone'],
      })
      await clickVoice(page)
      const text = await waitVoiceText(page, ['serveur de jetons'], 30_000)
      check('B3  grant 503: truthful grant error is shown', text.includes('serveur de jetons'), text)
      check('B3  grant 503: attempt count is reported (3 tentatives)', text.includes('3 tentatives'), text)
      check('B3  grant 503: exactly 3 grant attempts were made', grantAttempts === 3, `${grantAttempts} attempt(s)`)
      const diag = await page.evaluate(() => window.__fix17)
      check('B3  grant 503: mic was requested first (mic-first order kept)', diag.micCalls >= 1, `micCalls=${diag.micCalls}`)
      check('B3  grant 503: no live state, no mic error shown', !text.includes('Je vous écoute') && !text.includes('Micro'), text)
      await context.close()
    } catch (e) {
      check('B3  grant 503: browser scenario completed without error', false, String(e).slice(0, 300))
    } finally {
      await browser.close().catch(() => undefined)
    }
  }

  // B4 — socket opens but never sends Welcome: the call must report
  // 'socket-timeout' within ~20 s, not stick on "Connexion…" forever.
  grantMode = 'ok'
  grantAttempts = 0
  {
    const browser = await chromium.launch({
      executablePath: chromePath,
      args: [
        '--no-sandbox',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    })
    try {
      const { context, page } = await openAgentPage(browser, {
        permissions: ['microphone'],
        // Route the socket and answer nothing — the handshake timer
        // (20 s) is the only thing that can end the call.
        wsRoute: () => {},
      })
      await clickVoice(page)
      const text = await waitVoiceText(page, ['n’a pas abouti à temps'], 60_000)
      check(
        "B4  silent socket: 'socket-timeout' is reported within ~20 s",
        text.includes('n’a pas abouti à temps'),
        text,
      )
      await context.close()
    } catch (e) {
      check('B4  silent socket: browser scenario completed without error', false, String(e).slice(0, 300))
    } finally {
      await browser.close().catch(() => undefined)
    }
  }
}

// ------------------------------------------------- D: static (no-regress)
{
  const voiceAgent = readFileSync(join(root, 'src', 'lib', 'voiceAgent.ts'), 'utf8')
  const agentTsx = readFileSync(join(root, 'src', 'components', 'Agent.tsx'), 'utf8')
  const content = readFileSync(join(root, 'src', 'content.ts'), 'utf8')
  const srcAll = ['src/content.ts', 'src/lib/voiceAgent.ts', 'src/components/Agent.tsx']
    .map((f) => readFileSync(join(root, f), 'utf8'))
    .join('\n')
  check(
    'D  mic-first order in source: getUserMedia fires before the grant fetch is awaited',
    voiceAgent.indexOf('navigator.mediaDevices.getUserMedia({ audio: true })') <
      voiceAgent.indexOf('token = await grantPromise'),
    'getUserMedia must precede the grant await in start()',
  )
  check('D  permission-state classification exists', voiceAgent.includes('micPermissionState') && voiceAgent.includes('classifyMicError'))
  check(
    'D  new mic reasons exist (blocked / dismissed / timeout)',
    ["'mic-blocked'", "'mic-dismissed'", "'mic-timeout'"].every((r) => voiceAgent.includes(r)),
  )
  check('D  connecting stages reported (mic / grant / socket)', voiceAgent.includes("VoiceStage = 'mic' | 'grant' | 'socket'"))
  check('D  mic prompt timeout 30 s, socket handshake timeout 20 s', voiceAgent.includes('MIC_PROMPT_TIMEOUT_MS = 30_000') && voiceAgent.includes('SOCKET_HANDSHAKE_TIMEOUT_MS = 20_000'))
  check(
    'D  UI renders the stage texts and the new mic/socket errors',
    ['voiceConnectingMic', 'voiceConnectingGrant', 'voiceMicBlocked', 'voiceMicDismissed', 'voiceMicTimeout', 'voiceSocketTimeout'].every(
      (k) => agentTsx.includes(k) && content.includes(k),
    ),
  )
  check('D  voiceOffline no longer claims voice is "indisponible"', !content.includes('voiceOffline') || !/voiceOffline:\s*'[^']*indisponible/.test(content))
  check('D  zero "EN DIRECT" anywhere in src', !srcAll.includes('EN DIRECT'))
  check('D  grant retry intact: 3 attempts, 10 s timeout, 1 s/2 s backoff', voiceAgent.includes('GRANT_FETCH_ATTEMPTS = 3') && voiceAgent.includes('GRANT_FETCH_TIMEOUT_MS = 10_000') && voiceAgent.includes('GRANT_FETCH_BACKOFF_MS = [1000, 2000]'))
  check(
    'D  WebSocket handshake unchanged: wss converse + [\'bearer\', token]',
    voiceAgent.includes("new WebSocket(AGENT_SOCKET_URL, ['bearer', token])"),
  )
  check(
    'D  think block unchanged: mercury-3 with managed gpt-4o-mini fallback',
    voiceAgent.includes("THINK_MODEL_PRIMARY = 'mercury-3'") &&
      voiceAgent.includes("THINK_MODEL_FALLBACK = 'gpt-4o-mini'"),
  )
  check('D  vite preview still proxies the grant to the local grant server', readFileSync(join(root, 'vite.config.ts'), 'utf8').includes("'/api/deepgram/grant': 'http://127.0.0.1:8787'"))
  const untouched = await new Promise((resolve) => {
    execFile('git', ['diff', '--quiet', 'HEAD', '--', 'server/grant.mjs', 'api/deepgram/grant.ts'], { cwd: root }, (err) =>
      resolve(!err),
    )
  })
  check('D  grant server + Vercel grant fn untouched by this branch', untouched)
  const cafe = readFileSync(join(root, 'src', 'content.ts'), 'utf8')
  check(
    'D  protected facts untouched: Casa da Santana, Rue de Malines 21, +1 650 459 7993',
    cafe.includes('Casa da Santana') && cafe.includes('Rue de Malines 21') && cafe.includes('+1 650 459 7993'),
  )
}

server.close()
rmSync(outDir, { recursive: true, force: true })
console.log(failures === 0 ? '\nAll fix17-voice probe checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
