// Deepgram grant server — fix pass 15, group 6.
//
// Mints the short-lived JWT the browser voice agent needs for the
// wss://agent.deepgram.com/v1/agent/converse handshake (browsers
// cannot set an Authorization header on a WebSocket, so the JWT
// travels as the Sec-WebSocket-Protocol value — see the voice-agent
// skill and src/lib/voiceAgent.ts).
//
//   POST /api/deepgram/grant  ->  {"access_token","expires_in"}
//
// The upstream call is POST https://api.deepgram.com/v1/auth/grant
// with header `Authorization: Token <key>` and JSON body
// {"ttl_seconds": 3600}. The key is read from process.env
// DEEPGRAM_API_KEY ONLY — there is no default, no file, no fallback.
// If the variable is unset the server exits with a clear error
// (exit code 1) instead of starting in a broken state.
//
// KEY HANDLING — read this before touching this file:
//   * Never hardcode a key, never log one, never echo one in a
//     response, and never echo the upstream error body verbatim —
//     it could contain credentials. Failures return the upstream
//     HTTP status with a generic {"error": ...} object.
//   * The key is supplied at start time via the environment (the
//     parent starts the server with the key read from stdin into
//     the env var — never a file, never a command argument).
//
// RUNNING (local preview):
//   npm run grant            # listens on 127.0.0.1:8787
//   npm run preview          # vite preview proxies /api/deepgram/grant
//                            # to http://127.0.0.1:8787 (see vite.config.ts)
//
// The same logic exists as a Vercel serverless function in
// api/deepgram/grant.ts for the Phase 9 deploy — keep the two in
// sync (same upstream call, same response shape, same error rules).
//
// Plain Node, no dependencies. Node >= 18 (global fetch).

import { createServer } from 'node:http'

export const GRANT_PORT = 8787
export const GRANT_HOST = '127.0.0.1'
export const GRANT_TTL_SECONDS = 3600
const UPSTREAM_URL = 'https://api.deepgram.com/v1/auth/grant'

const apiKey = process.env.DEEPGRAM_API_KEY
if (!apiKey) {
  console.error(
    'ERROR: DEEPGRAM_API_KEY is not set. Start the grant server with the key in the environment, e.g.:\n' +
      '  read -s DEEPGRAM_API_KEY && DEEPGRAM_API_KEY="$DEEPGRAM_API_KEY" npm run grant\n' +
      '(never put the key in a file or a command argument).',
  )
  process.exit(1)
}

/** Generic error body — never echoes the key or the upstream body. */
function errorBody(status) {
  return { error: 'deepgram_grant_failed', status }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  if (req.method !== 'POST' || url.pathname !== '/api/deepgram/grant') {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not_found' }))
    return
  }

  // Drain any request body (the client sends none, but do not hang).
  for await (const _chunk of req) {
    // Discard.
  }

  let upstream
  try {
    upstream = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl_seconds: GRANT_TTL_SECONDS }),
    })
  } catch {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(errorBody(502)))
    return
  }

  if (!upstream.ok) {
    // Upstream status, generic body — the upstream body is never
    // echoed verbatim (it could contain credentials).
    res.writeHead(upstream.status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(errorBody(upstream.status)))
    return
  }

  let body
  try {
    body = await upstream.json()
  } catch {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(errorBody(502)))
    return
  }

  const token = body?.access_token
  const expiresIn = body?.expires_in
  if (typeof token !== 'string' || token.length === 0 || typeof expiresIn !== 'number') {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(errorBody(502)))
    return
  }

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ access_token: token, expires_in: expiresIn }))
})

server.listen(GRANT_PORT, GRANT_HOST, () => {
  console.log(`Deepgram grant server listening on http://${GRANT_HOST}:${GRANT_PORT}`)
})
