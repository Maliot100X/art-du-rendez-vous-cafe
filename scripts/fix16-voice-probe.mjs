// Fix pass 16, group 4 — voice grant fetch retry probe.
//
// The fix-15 cloud check showed one transient tunnel flake killing the
// whole voice call: the grant fetch ran ONCE with no timeout and no
// retry, and the UI then showed the generic "Deepgram n'a pas fourni
// de jeton d'appel". This probe verifies the fix in voiceAgent.ts:
//
//   A  LIVE TUNNEL: curl POST via the live pinggy tunnel
//      (https://ctwao-87-81-229-125.free.pinggy.net/api/deepgram/grant),
//      several attempts — the fetch path the browser actually uses.
//      NOTE: the tunnel expires ~23:03 CET 2026-11-25. If this section
//      fails after that, the tunnel is gone, not the fix — re-run it
//      against a fresh tunnel URL.
//   B  LOCAL GRANT: the grant server on 127.0.0.1:8787 answers a POST
//      with a real JWT (proves the local end of the same path).
//   C  RETRY LOGIC, LIVE: the REAL shipped DeepgramVoiceAgent class
//      (esbuild-bundled from src/lib/voiceAgent.ts, browser globals
//      stubbed) is driven against a local flaky stub grant endpoint:
//        C1  fail (reset) + 502, then success  -> token obtained after
//            3 attempts, mic requested, socket opened with
//            ['bearer', <stub JWT>]; no 'ended' status.
//        C2  always 503                        -> 'ended' / 'grant-http'
//            with detail {kind:'http', attempts:3, status:503}; mic
//            never requested, socket never opened.
//        C3  connection refused (network)      -> 'ended' /
//            'grant-network', attempts 3, no mic, no socket.
//        C4  first attempt hangs past the 10 s timeout, then success
//            -> token obtained after 2 attempts, socket opened.
//        C5  HTTP 401 (not transient)          -> exactly 1 attempt,
//            'ended' / 'grant-http', status 401.
//        C6  HTTP 200 with no token            -> exactly 1 attempt,
//            'ended' / 'grant-empty'.
//   D  STATIC: retry constants (3 attempts, 10 s timeout, 1 s/2 s
//      backoff), AbortController signal on the fetch, 5xx retried /
//      4xx not, WebSocket handshake and think block UNCHANGED
//      (wss://agent.deepgram.com/v1/agent/converse, ['bearer', token];
//      mercury-3 with managed gpt-4o-mini fallback), and the grant
//      server (server/grant.mjs) + Vercel fn (api/deepgram/grant.ts)
//      untouched vs master.
//
// No real Deepgram key is used anywhere: the stub mints its own fake
// JWT, and the tunnel/local checks only read the already-running
// grant server's real JWT shape (never its key).
//
// Usage: node scripts/fix16-voice-probe.mjs  (from the repo root)
// Exit 0 = all checks pass, 1 = at least one fails.
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const TUNNEL_URL = 'https://ctwao-87-81-229-125.free.pinggy.net/api/deepgram/grant'
let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- A: live tunnel grant check (run first — tunnel expires ~23:03 CET). ---
async function curlGrant() {
  return new Promise((resolve) => {
    execFile(
      'curl',
      ['-s', '-m', '20', '-o', '/tmp/fix16-tunnel-grant.json', '-w', '%{http_code} %{time_total}', '-X', 'POST', TUNNEL_URL, '-H', 'Content-Type: application/json', '-d', '{}'],
      (err, stdout) => resolve({ err, stdout: stdout.trim() }),
    )
  })
}
{
  let okCount = 0
  let times = []
  for (let i = 1; i <= 5; i++) {
    const { err, stdout } = await curlGrant()
    const [code, secs] = stdout.split(' ')
    let tokenLen = 0
    try {
      const body = JSON.parse(readFileSync('/tmp/fix16-tunnel-grant.json', 'utf8'))
      tokenLen = (body.access_token ?? body.token ?? '').length
    } catch { /* not JSON */ }
    const ok = !err && code === '200' && tokenLen > 100
    if (ok) {
      okCount += 1
      times.push(Number(secs))
    }
    console.log(`  tunnel attempt ${i}: HTTP ${code ?? '?'} in ${secs ?? '?'}s, token_len=${tokenLen}`)
  }
  check('A  tunnel grant: 5/5 POSTs return a real JWT', okCount === 5, `${okCount}/5 ok`)
  if (times.length) {
    check(
      'A  tunnel grant latency leaves headroom under the 10 s attempt timeout',
      Math.max(...times) < 10,
      `slowest ${Math.max(...times).toFixed(2)}s of ${times.map((t) => t.toFixed(2)).join(', ')}s`,
    )
  }
}

// --- B: local grant server (same path the preview proxy serves). -----------
{
  try {
    const res = await fetch('http://127.0.0.1:8787/api/deepgram/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10000),
    })
    const body = await res.json()
    check('B  local grant server answers HTTP 200 with a JWT', res.status === 200 && typeof body.access_token === 'string' && body.access_token.length > 100, `status=${res.status}, token_len=${(body.access_token ?? '').length}`)
  } catch (err) {
    check('B  local grant server answers HTTP 200 with a JWT', false, String(err))
  }
}

// --- C: live retry logic against a flaky stub grant endpoint. -------------
// Stub browser globals BEFORE importing the bundled voiceAgent.
const openSockets = new Set()
let stubMode = 'ok'
let stubCount = 0
const stub = createServer((req, res) => {
  stubCount += 1
  const n = stubCount
  openSockets.add(req.socket)
  req.socket.on('close', () => openSockets.delete(req.socket))
  const tokenBody = () => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ access_token: 'stub-jwt-token', expires_in: 3600 }))
  }
  if (stubMode === 'flake-then-ok') {
    if (n === 1) return req.socket.destroy() // connection reset -> 'network'
    if (n === 2) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: 'bad gateway' }))
    }
    return tokenBody()
  }
  if (stubMode === 'always-503') {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: 'unavailable' }))
  }
  if (stubMode === 'always-401') {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: 'unauthorized' }))
  }
  if (stubMode === 'empty-200') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({}))
  }
  if (stubMode === 'hang-then-ok') {
    if (n === 1) return // never answer: the 10 s attempt timeout must fire
    return tokenBody()
  }
  return tokenBody()
})
await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve))
const stubPort = stub.address().port

// Route the agent's relative fetch to the stub (or to a closed port for
// the network-failure scenario). Everything else passes through.
const realFetch = globalThis.fetch
let grantTarget = `http://127.0.0.1:${stubPort}`
globalThis.fetch = (url, init) => {
  if (typeof url === 'string' && url.startsWith('/api/deepgram/grant')) {
    return realFetch(grantTarget + url, init)
  }
  return realFetch(url, init)
}

// (Node 24 ships getter-only navigator/WebSocket globals, so the
// stubs are installed with defineProperty, not assignment.)
const defineGlobal = (name, value) => {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
}
defineGlobal('window', globalThis)
let micRequested = false
let wsOpened = null
defineGlobal('navigator', {
  mediaDevices: {
    getUserMedia: async () => {
      micRequested = true
      return { getTracks: () => [{ stop() {} }] }
    },
  },
})
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
  }
  send() {}
  close() {}
})
defineGlobal('requestAnimationFrame', () => 0)
defineGlobal('cancelAnimationFrame', () => {})

// Bundle the REAL shipped voiceAgent.ts (imports content/avatarBridge/
// brain/agentBrain — all pure TS, no browser top-level side effects).
//
// No bundler is installed in this repo (vite 7 uses rolldown, and
// esbuild is not a dependency), so the probe does what the fix15
// grant probe did for the server: it works on temp COPIES of the
// shipped files with exactly one mechanical change — `import.meta.env`
// (which Node cannot evaluate) replaced by the literal
// `({ DEV: false } as Record<string, unknown>)` — and asserts the
// copies differ from the originals ONLY in that replacement. The copies are then transpiled with the repo's own
// tsc to CommonJS (so extensionless relative imports resolve) and
// required. Every line of retry logic under test is byte-identical
// to the shipped file.
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
// Fix 16 (merge): temp dir lives INSIDE the repo root, not /tmp —
// brain.ts now imports agentStatus (single status store), which
// imports 'react' (useSyncExternalStore), and Node can only resolve
// that from a path under the repo's node_modules. Same pattern as
// fix14-think-probe / fix15-brain-probe. Cleaned up before exit.
const outDir = mkdtempSync(join(root, '.fix16-voice-probe-'))
// The tsc output below is CommonJS (see --module commonjs), but the
// repo root package.json says "type": "module" — without this, Node
// would load the transpiled files as ESM and `exports` would be
// undefined. (When the temp dir lived in /tmp there was no parent
// package.json, so CommonJS was the silent default.)
writeFileSync(join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }))
const probeSrc = join(outDir, 'src')
mkdirSync(join(probeSrc, 'lib'), { recursive: true })
for (const rel of ['src/content.ts', 'src/lib/voiceAgent.ts', 'src/lib/avatarBridge.ts', 'src/lib/brain.ts', 'src/lib/agentBrain.ts', 'src/lib/agentStatus.ts']) {
  const orig = readFileSync(join(root, rel), 'utf8')
  const copy = orig.replaceAll('import.meta.env', '({ DEV: false } as Record<string, unknown>)')
  writeFileSync(join(outDir, rel), copy)
  check(
    `C  probe copy of ${rel} differs from shipped only in import.meta.env`,
    readFileSync(join(outDir, rel), 'utf8') === copy &&
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
      '--module', 'commonjs',
      '--target', 'es2022',
      '--lib', 'es2022,dom',
      '--skipLibCheck',
      '--rootDir', probeSrc,
      '--outDir', tscOut,
    ],
    { cwd: outDir },
    (err, stdout, stderr) => (err ? reject(new Error(stderr || stdout)) : resolve()),
  )
})
const require = createRequire(import.meta.url)
const { DeepgramVoiceAgent } = require(join(tscOut, 'lib', 'voiceAgent.js'))

async function runAgent() {
  const statuses = []
  micRequested = false
  wsOpened = null
  const agent = new DeepgramVoiceAgent({
    onStatus: (status, error, grantDetail) => statuses.push({ status, error, grantDetail }),
    onTranscript: () => {},
    onOrderAdded: () => {},
  })
  await agent.start()
  agent.stop()
  return statuses
}

// C1: flake (reset + 502) then success.
stubMode = 'flake-then-ok'
stubCount = 0
{
  const t0 = Date.now()
  const statuses = await runAgent()
  const ms = Date.now() - t0
  check('C1  flake-then-ok: 3 grant attempts then success', stubCount === 3, `${stubCount} attempt(s) in ${(ms / 1000).toFixed(1)}s`)
  check('C1  flake-then-ok: mic requested after the token arrived', micRequested)
  check(
    'C1  flake-then-ok: socket opened with the stub JWT as bearer protocol',
    wsOpened?.url === 'wss://agent.deepgram.com/v1/agent/converse' &&
      JSON.stringify(wsOpened?.protocols) === JSON.stringify(['bearer', 'stub-jwt-token']),
    wsOpened ? `${wsOpened.url} ${JSON.stringify(wsOpened.protocols)}` : 'no socket',
  )
  check(
    'C1  flake-then-ok: no grant-failure status reported',
    !statuses.some((s) => s.status === 'ended'),
    JSON.stringify(statuses),
  )
}

// C2: always 503.
stubMode = 'always-503'
stubCount = 0
{
  const statuses = await runAgent()
  const ended = statuses.find((s) => s.status === 'ended')
  check('C2  always-503: 3 attempts then gives up', stubCount === 3, `${stubCount} attempt(s)`)
  check(
    "C2  always-503: reports 'grant-http' with attempts=3, status=503",
    ended?.error === 'grant-http' &&
      ended?.grantDetail?.kind === 'http' &&
      ended?.grantDetail?.attempts === 3 &&
      ended?.grantDetail?.status === 503,
    JSON.stringify(ended),
  )
  check('C2  always-503: mic never requested, socket never opened', !micRequested && wsOpened === null)
}

// C3: connection refused (grant target = a port nothing listens on).
{
  // Grab a free port, then close it: nothing listens there afterwards.
  const probe = createServer()
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const closedPort = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  grantTarget = `http://127.0.0.1:${closedPort}`
  stubCount = 0
  const statuses = await runAgent()
  const ended = statuses.find((s) => s.status === 'ended')
  check(
    "C3  connection-refused: reports 'grant-network' with attempts=3",
    ended?.error === 'grant-network' &&
      ended?.grantDetail?.kind === 'network' &&
      ended?.grantDetail?.attempts === 3,
    JSON.stringify(ended),
  )
  check('C3  connection-refused: mic never requested, socket never opened', !micRequested && wsOpened === null)
  grantTarget = `http://127.0.0.1:${stubPort}`
}

// C4: first attempt hangs past the 10 s timeout, then success.
stubMode = 'hang-then-ok'
stubCount = 0
{
  const t0 = Date.now()
  const statuses = await runAgent()
  const ms = Date.now() - t0
  check('C4  hang-then-ok: 2 attempts (timeout, then success)', stubCount === 2, `${stubCount} attempt(s) in ${(ms / 1000).toFixed(1)}s`)
  check('C4  hang-then-ok: the hung attempt actually timed out (~10 s)', ms >= 10000 && ms < 20000, `${(ms / 1000).toFixed(1)}s total`)
  check(
    'C4  hang-then-ok: socket opened with the stub JWT',
    wsOpened?.url === 'wss://agent.deepgram.com/v1/agent/converse' &&
      JSON.stringify(wsOpened?.protocols) === JSON.stringify(['bearer', 'stub-jwt-token']),
    wsOpened ? JSON.stringify(wsOpened.protocols) : 'no socket',
  )
  check(
    'C4  hang-then-ok: no grant-failure status reported',
    !statuses.some((s) => s.status === 'ended'),
    JSON.stringify(statuses),
  )
}

// C5: HTTP 401 is not transient — exactly 1 attempt.
stubMode = 'always-401'
stubCount = 0
{
  const statuses = await runAgent()
  const ended = statuses.find((s) => s.status === 'ended')
  check('C5  always-401: exactly 1 attempt (4xx is not retried)', stubCount === 1, `${stubCount} attempt(s)`)
  check(
    "C5  always-401: reports 'grant-http' with attempts=1, status=401",
    ended?.error === 'grant-http' &&
      ended?.grantDetail?.kind === 'http' &&
      ended?.grantDetail?.attempts === 1 &&
      ended?.grantDetail?.status === 401,
    JSON.stringify(ended),
  )
}

// C6: HTTP 200 with no token — exactly 1 attempt.
stubMode = 'empty-200'
stubCount = 0
{
  const statuses = await runAgent()
  const ended = statuses.find((s) => s.status === 'ended')
  check('C6  empty-200: exactly 1 attempt (empty body is not retried)', stubCount === 1, `${stubCount} attempt(s)`)
  check(
    "C6  empty-200: reports 'grant-empty' with attempts=1",
    ended?.error === 'grant-empty' &&
      ended?.grantDetail?.kind === 'empty' &&
      ended?.grantDetail?.attempts === 1,
    JSON.stringify(ended),
  )
}
for (const s of openSockets) s.destroy()
stub.close()

// --- D: static checks. ------------------------------------------------------
const voiceAgent = readFileSync(join(root, 'src', 'lib', 'voiceAgent.ts'), 'utf8')
check('D  retry: 3 attempts', voiceAgent.includes('GRANT_FETCH_ATTEMPTS = 3'))
check('D  retry: 10 s per-attempt timeout', voiceAgent.includes('GRANT_FETCH_TIMEOUT_MS = 10_000'))
check('D  retry: backoff 1 s then 2 s', voiceAgent.includes('GRANT_FETCH_BACKOFF_MS = [1000, 2000]'))
check(
  'D  grant fetch is POST /api/deepgram/grant with an AbortSignal',
  voiceAgent.includes("fetch('/api/deepgram/grant', { method: 'POST', signal: controller.signal })"),
)
check('D  failure kinds network/timeout/http/empty exist', ['network', 'timeout', 'http', 'empty'].every((k) => voiceAgent.includes(`'${k}'`)))
check('D  5xx is retried, 4xx gives up immediately', voiceAgent.includes('res.status >= 500') && voiceAgent.includes("throw new GrantError('http', attempt, res.status)"))
check('D  detail (kind/attempts/status) is passed to onStatus', voiceAgent.includes("this.callbacks.onStatus('ended', grantReasonFor(err.kind), err.toDetail())"))
check(
  'D  WebSocket handshake unchanged: wss converse + [\'bearer\', token]',
  voiceAgent.includes("new WebSocket(AGENT_SOCKET_URL, ['bearer', token])"),
)
check(
  'D  think block unchanged: mercury-3 with managed gpt-4o-mini fallback',
  voiceAgent.includes("THINK_MODEL_PRIMARY = 'mercury-3'") &&
    voiceAgent.includes("THINK_MODEL_FALLBACK = 'gpt-4o-mini'"),
)
const agentTsx = readFileSync(join(root, 'src', 'components', 'Agent.tsx'), 'utf8')
check(
  'D  UI maps the four grant reasons to the real-reason sentence',
  ['grant-network', 'grant-timeout', 'grant-http', 'grant-empty'].every((r) => agentTsx.includes(`'${r}'`)),
)
const content = readFileSync(join(root, 'src', 'content.ts'), 'utf8')
check(
  'D  content has the four grant sentence heads',
  ['voiceGrantNetwork', 'voiceGrantTimeout', 'voiceGrantHttp', 'voiceGrantEmpty'].every((k) => content.includes(k)),
)
check(
  'D  generic no-token line kept only for the dev-only fallback',
  content.includes('voiceNoToken') && voiceAgent.includes("throw new Error('no-token')"),
)

console.log(failures === 0 ? '\nAll fix16-voice probe checks passed.' : `\n${failures} check(s) FAILED.`)
rmSync(outDir, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
