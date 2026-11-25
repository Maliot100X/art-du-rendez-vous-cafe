/**
 * Server-side Deepgram token broker (vite dev + preview middleware).
 * The API key is read from process.env.DEEPGRAM_API_KEY on the server only;
 * the browser gets a short-lived JWT from POST /v1/auth/grant, never the key.
 */
export function deepgramTokenPlugin() {
  const handler = async (req, res, next) => {
    if (!req.url?.startsWith('/api/deepgram/token')) return next();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) {
      res.statusCode = 503;
      res.end(JSON.stringify({error: 'voice_unavailable'}));
      return;
    }
    try {
      const r = await fetch('https://api.deepgram.com/v1/auth/grant', {
        method: 'POST',
        headers: {Authorization: `Token ${key}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({ttl_seconds: 60}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.access_token) {
        res.statusCode = 502;
        res.end(JSON.stringify({error: 'grant_failed', status: r.status}));
        return;
      }
      res.end(JSON.stringify({access_token: j.access_token, expires_in: j.expires_in}));
    } catch {
      res.statusCode = 502;
      res.end(JSON.stringify({error: 'grant_failed'}));
    }
  };
  return {
    name: 'deepgram-token',
    configureServer(s) {
      s.middlewares.use(handler);
    },
    configurePreviewServer(s) {
      s.middlewares.use(handler);
    },
  };
}
