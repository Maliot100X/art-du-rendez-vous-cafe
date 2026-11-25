// Fix pass 15, group 6 — Deepgram grant backend probe.
//
// NO network, NO real key. Drives the REAL server/grant.mjs with a
// DUMMY DEEPGRAM_API_KEY against a LOCAL stub HTTP server standing in
// for api.deepgram.com (the real Deepgram is never contacted).
//
// The shipped server hardcodes the real upstream URL, so the stub
// tests run a temp COPY of server/grant.mjs with exactly one line
// changed — the UPSTREAM_URL constant pointed at the stub. The probe
// diffs the copy against the original and fails if anything else
// differs, so the forwarded-request assertions still cover the
// shipped code path (same fetch call, same headers, same body).
//
// Checks:
//   A  Server refuses to start without DEEPGRAM_API_KEY: non-zero
//      exit and a clear error naming the variable.
//   B  With a dummy key, the server forwards the grant call to the
//      upstream with POST, path /v1/auth/grant, header
//      `Authorization: Token <dummy key>`, Content-Type
//      application/json, and body {"ttl_seconds": 3600} — asserted
//      on what the stub actually received.
//   C  The server returns the stub JWT shape
//      {"access_token","expires_in"} with HTTP 200.
//   D  Upstream failure is passed through as the upstream status
//      with a generic body (never the upstream body verbatim).
//   E  Non-grant paths / wrong methods answer 404 (no key leak via
//      a stray route).
//   F  vite preview proxy routes /api/deepgram/grant to
//      http://127.0.0.1:8787, and package.json has the "grant" script.
//   G  voiceAgent.ts fetches exactly POST /api/deepgram/grant and
//      opens wss://agent.deepgram.com/v1/agent/converse with
//      ['bearer', token]; the think block is still mercury-3 with
//      managed gpt-4o-mini fallback (unchanged by this pass).
//   H  api/deepgram/grant.ts (Vercel function) mirrors the same
//      upstream call, TTL, and response shape, reading
//      process.env.DEEPGRAM_API_KEY.
//   I  Secret scan of src/, server/, api/: no 40-hex-char
//      API-key-shaped literal and no "sk_" literal. (The built
//      bundle legitimately contains the Inception LLM key supplied
//      at build time — that lives in dist/ and is NOT scanned here;
//      the check is scoped to Deepgram-shaped values in source.)
//
// Usage: node scripts/fix15-grant-probe.mjs  (from the repo root)
// Exit 0 = all checks pass, 1 = at least one fails.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const GRANT_PORT = 8787
const DUMMY_KEY = 'dummy-test-key'
let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

const grantSrc = readFileSync(join(root, 'server', 'grant.mjs'), 'utf8')

// --- A: refuses to start without the env var. -------------------------------
async function checkNoEnvRefusal() {
  const env = { ...process.env }
  delete env.DEEPGRAM_API_KEY
  const child = spawn('node', [join(root, 'server', 'grant.mjs')], { env })
  let stderr = ''
  child.stderr.on('data', (d) => {
    stderr += d
  })
  const code = await new Promise((resolve) => child.on('close', resolve))
  check('A  refuses to start without DEEPGRAM_API_KEY', code !== 0, `exit=${code}`)
  check(
    'A  error names DEEPGRAM_API_KEY',
    stderr.includes('DEEPGRAM_API_KEY'),
    stderr.trim().split('\n')[0] ?? '',
  )
}

// --- Local stub standing in for api.deepgram.com. ---------------------------
let stubSaw = null
let stubMode = 'ok'
const stub = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => {
    body += c
  })
  req.on('end', () => {
    stubSaw = {
      method: req.method,
      path: req.url,
      authorization: req.headers.authorization ?? '',
      contentType: req.headers['content-type'] ?? '',
      body,
    }
    if (stubMode === 'fail') {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ err_code: 'INVALID_CREDENTIALS', secret: 'must-not-echo' }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ access_token: 'stub-jwt-token', expires_in: 3600 }))
  })
})
await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve))
const stubPort = stub.address().port
const stubUrl = `http://127.0.0.1:${stubPort}/v1/auth/grant`

// Temp copy of the server with only the upstream URL repointed.
const outDir = mkdtempSync(join(tmpdir(), 'fix15-grant-probe-'))
const patched = grantSrc.replace(
  "const UPSTREAM_URL = 'https://api.deepgram.com/v1/auth/grant'",
  `const UPSTREAM_URL = '${stubUrl}'`,
)
if (patched === grantSrc) {
  check('B  shipped server contains the real upstream URL', false, 'URL constant not found')
} else {
  check('B  shipped server contains the real upstream URL', true)
}
const patchedPath = join(outDir, 'grant.mjs')
writeFileSync(patchedPath, patched)
// The copy must differ from the original in exactly the URL line.
const origLines = grantSrc.split('\n')
const patchedLines = patched.split('\n')
const diffLines = origLines.filter((line, i) => line !== patchedLines[i])
check(
  'B  stub copy differs from shipped file in exactly one line (the URL)',
  diffLines.length === 1 && diffLines[0].includes('api.deepgram.com'),
  `${diffLines.length} differing line(s)`,
)

function startGrantServer(envExtra = {}) {
  const child = spawn('node', [patchedPath], {
    env: { ...process.env, DEEPGRAM_API_KEY: DUMMY_KEY, ...envExtra },
  })
  let stderr = ''
  child.stderr.on('data', (d) => {
    stderr += d
  })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`grant server did not start: ${stderr}`)), 5000)
    const onData = () => {
      clearTimeout(timer)
      child.stdout.off('data', onData)
      resolve(child)
    }
    child.stdout.on('data', onData)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

async function stop(child) {
  child.kill('SIGTERM')
  await new Promise((resolve) => child.on('close', resolve))
}

await checkNoEnvRefusal()

// --- B/C: forwarded grant call + JWT shape. ---------------------------------
const server = await startGrantServer()
try {
  stubMode = 'ok'
  stubSaw = null
  const res = await fetch(`http://127.0.0.1:${GRANT_PORT}/api/deepgram/grant`, { method: 'POST' })
  const body = await res.json()
  check('C  grant returns HTTP 200', res.status === 200, `status=${res.status}`)
  check(
    'C  grant returns stub JWT shape {"access_token","expires_in"}',
    body.access_token === 'stub-jwt-token' && body.expires_in === 3600,
    JSON.stringify(body),
  )
  check('B  stub saw POST', stubSaw?.method === 'POST', stubSaw?.method ?? 'no request')
  check('B  stub saw path /v1/auth/grant', stubSaw?.path === '/v1/auth/grant', stubSaw?.path ?? '')
  check(
    'B  stub saw Authorization: Token <dummy key>',
    stubSaw?.authorization === `Token ${DUMMY_KEY}`,
    stubSaw?.authorization ?? '',
  )
  check(
    'B  stub saw Content-Type application/json',
    (stubSaw?.contentType ?? '').includes('application/json'),
    stubSaw?.contentType ?? '',
  )
  check(
    'B  stub saw body {"ttl_seconds": 3600}',
    stubSaw?.body === JSON.stringify({ ttl_seconds: 3600 }),
    stubSaw?.body ?? '',
  )

  // --- D: upstream failure -> upstream status, generic body. ---------------
  stubMode = 'fail'
  const failRes = await fetch(`http://127.0.0.1:${GRANT_PORT}/api/deepgram/grant`, {
    method: 'POST',
  })
  const failBody = await failRes.json()
  check('D  upstream 401 passes through as 401', failRes.status === 401, `status=${failRes.status}`)
  check(
    'D  failure body is generic (upstream body never echoed)',
    failBody.error === 'deepgram_grant_failed' && !JSON.stringify(failBody).includes('must-not-echo'),
    JSON.stringify(failBody),
  )

  // --- E: wrong method / path -> 404. --------------------------------------
  const getRes = await fetch(`http://127.0.0.1:${GRANT_PORT}/api/deepgram/grant`)
  check('E  GET /api/deepgram/grant is 404', getRes.status === 404, `status=${getRes.status}`)
  const otherRes = await fetch(`http://127.0.0.1:${GRANT_PORT}/other`, { method: 'POST' })
  check('E  POST /other is 404', otherRes.status === 404, `status=${otherRes.status}`)
} finally {
  await stop(server)
}
stub.close()

// --- F: vite preview proxy + npm script. ------------------------------------
const viteConfig = readFileSync(join(root, 'vite.config.ts'), 'utf8')
check(
  'F  vite preview proxy routes /api/deepgram/grant to 127.0.0.1:8787',
  viteConfig.includes("'/api/deepgram/grant'") && viteConfig.includes('127.0.0.1:8787'),
)
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
check('F  package.json has "grant" script (node server/grant.mjs)', pkg.scripts?.grant === 'node server/grant.mjs', pkg.scripts?.grant ?? '')

// --- G: voiceAgent fetch + handshake (unchanged behaviour). ------------------
const voiceAgent = readFileSync(join(root, 'src', 'lib', 'voiceAgent.ts'), 'utf8')
check(
  'G  voiceAgent fetches exactly POST /api/deepgram/grant',
  voiceAgent.includes("fetch('/api/deepgram/grant', { method: 'POST' })"),
)
check(
  'G  voiceAgent opens socket with ["bearer", token] (Sec-WebSocket-Protocol)',
  voiceAgent.includes("new WebSocket(AGENT_SOCKET_URL, ['bearer', token])"),
)
check(
  'G  think block still mercury-3 with managed gpt-4o-mini fallback',
  voiceAgent.includes("THINK_MODEL_PRIMARY = 'mercury-3'") &&
    voiceAgent.includes("THINK_MODEL_FALLBACK = 'gpt-4o-mini'"),
)
check(
  'G  no stale "does not exist yet" grant claim in voiceAgent',
  !voiceAgent.includes('does not exist yet') && !voiceAgent.includes('No such backend exists yet'),
)

// --- H: Vercel function mirrors the local server. ---------------------------
const vercelFn = readFileSync(join(root, 'api', 'deepgram', 'grant.ts'), 'utf8')
check('H  Vercel fn calls POST https://api.deepgram.com/v1/auth/grant', vercelFn.includes('https://api.deepgram.com/v1/auth/grant'))
check('H  Vercel fn uses ttl_seconds 3600', vercelFn.includes('ttl_seconds') && vercelFn.includes('3600'))
check('H  Vercel fn uses `Token ${apiKey}` auth', vercelFn.includes('Authorization: `Token ${apiKey}`'))
check('H  Vercel fn reads process.env.DEEPGRAM_API_KEY', vercelFn.includes('process.env.DEEPGRAM_API_KEY'))
check('H  Vercel fn returns {"access_token","expires_in"}', vercelFn.includes('access_token: token') && vercelFn.includes('expires_in: expiresIn'))
check('H  Vercel fn never echoes the upstream body', !vercelFn.includes('upstream.text()') && !vercelFn.includes('.json(body)'))

// --- I: secret scan of src/, server/, api/. ---------------------------------
const KEY_SHAPE = /[0-9a-f]{40}/
const SK_LITERAL = /sk_/
let scanned = 0
let keyHits = []
function scanDir(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      scanDir(path)
      continue
    }
    if (!/\.(ts|tsx|js|mjs|json)$/.test(entry)) continue
    scanned += 1
    const text = readFileSync(path, 'utf8')
    for (const [name, re] of [
      ['40-hex-char API-key-shaped literal', KEY_SHAPE],
      ['"sk_" literal', SK_LITERAL],
    ]) {
      if (re.test(text)) keyHits.push(`${path}: ${name}`)
    }
  }
}
for (const dir of ['src', 'server', 'api']) scanDir(join(root, dir))
check(
  'I  no Deepgram-shaped key literal in src/, server/, api/',
  keyHits.length === 0,
  keyHits.length ? keyHits.join('; ') : `${scanned} files scanned`,
)

console.log(failures === 0 ? '\nAll fix15-grant probe checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
