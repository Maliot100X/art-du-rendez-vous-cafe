// Vercel serverless function — Deepgram grant endpoint (fix pass 15,
// group 6). Same logic as server/grant.mjs (the local preview server);
// keep the two in sync (same upstream call, same response shape, same
// error rules).
//
//   POST /api/deepgram/grant  ->  {"access_token","expires_in"}
//
// The upstream call is POST https://api.deepgram.com/v1/auth/grant
// with header `Authorization: Token <key>` and JSON body
// {"ttl_seconds": 3600}. The key is read from
// process.env.DEEPGRAM_API_KEY ONLY — set it in the Vercel project
// settings (Environment Variables), never in code. If it is unset
// the endpoint answers 500 with a generic error.
//
// KEY HANDLING: never hardcode a key, never log one, never echo one
// in a response, and never echo the upstream error body verbatim —
// it could contain credentials. Failures return the upstream HTTP
// status with a generic {"error": ...} object.
//
// The browser client (src/lib/voiceAgent.ts) POSTs this same-origin
// endpoint and passes the returned JWT as the Sec-WebSocket-Protocol
// value (["bearer", jwt]) on wss://agent.deepgram.com/v1/agent/converse.

const UPSTREAM_URL = 'https://api.deepgram.com/v1/auth/grant'
const GRANT_TTL_SECONDS = 3600

/** Minimal structural types — no @vercel/node dependency is added. */
interface GrantRequest {
  method?: string
}

interface GrantResponse {
  status: (code: number) => GrantResponse
  json: (body: Record<string, unknown>) => void
}

/** Generic error body — never echoes the key or the upstream body. */
function errorBody(status: number): Record<string, unknown> {
  return { error: 'deepgram_grant_failed', status }
}

export default async function handler(req: GrantRequest, res: GrantResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }

  const apiKey = process.env.DEEPGRAM_API_KEY
  if (!apiKey) {
    res.status(500).json(errorBody(500))
    return
  }

  let upstream: Response
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
    res.status(502).json(errorBody(502))
    return
  }

  if (!upstream.ok) {
    // Upstream status, generic body — the upstream body is never
    // echoed verbatim (it could contain credentials).
    res.status(upstream.status).json(errorBody(upstream.status))
    return
  }

  let body: unknown
  try {
    body = (await upstream.json()) as unknown
  } catch {
    res.status(502).json(errorBody(502))
    return
  }

  const token =
    typeof body === 'object' && body !== null && 'access_token' in body
      ? (body as { access_token?: unknown }).access_token
      : undefined
  const expiresIn =
    typeof body === 'object' && body !== null && 'expires_in' in body
      ? (body as { expires_in?: unknown }).expires_in
      : undefined
  if (typeof token !== 'string' || token.length === 0 || typeof expiresIn !== 'number') {
    res.status(502).json(errorBody(502))
    return
  }

  res.status(200).json({ access_token: token, expires_in: expiresIn })
}
