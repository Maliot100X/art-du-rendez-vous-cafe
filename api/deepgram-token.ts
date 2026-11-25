/**
 * Vercel serverless token broker.
 * Reads process.env.DEEPGRAM_API_KEY on the server only and returns a
 * short-lived JWT from POST https://api.deepgram.com/v1/auth/grant.
 * The browser never sees the API key.
 */
const GRANT_URL = 'https://api.deepgram.com/v1/auth/grant';

type NodeRes = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
};

type NodeReq = { method?: string };

async function grant() {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return {status: 503, body: {error: 'voice_unavailable'}};
  try {
    const r = await fetch(GRANT_URL, {
      method: 'POST',
      headers: {Authorization: `Token ${key}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({ttl_seconds: 60}),
    });
    const j = (await r.json().catch(() => ({}))) as {access_token?: string; expires_in?: number};
    if (!r.ok || !j.access_token) {
      return {status: 502, body: {error: 'grant_failed', status: r.status}};
    }
    return {status: 200, body: {access_token: j.access_token, expires_in: j.expires_in}};
  } catch {
    return {status: 502, body: {error: 'grant_failed'}};
  }
}

export default async function handler(req: NodeReq, res: NodeRes) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'POST' && method !== 'GET') {
    res.statusCode = 405;
    res.end(JSON.stringify({error: 'method_not_allowed'}));
    return;
  }
  const {status, body} = await grant();
  res.statusCode = status;
  res.end(JSON.stringify(body));
}
