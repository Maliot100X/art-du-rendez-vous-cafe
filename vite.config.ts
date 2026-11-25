import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import glsl from 'vite-plugin-glsl'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), glsl()],
  preview: {
    // Allow tunnel hosts (pinggy / cloudflare) so the site can be viewed on a phone
    allowedHosts: true,
    // Fix pass 15, group 6: the Deepgram grant endpoint is served
    // same-origin in preview by the tiny grant server
    // (server/grant.mjs, `npm run grant`, 127.0.0.1:8787), so the
    // browser client (src/lib/voiceAgent.ts) can POST
    // /api/deepgram/grant exactly as it does on the Vercel deploy
    // (api/deepgram/grant.ts). The dev server (vite dev) does NOT
    // proxy this path — use `npm run grant` + `npm run preview`.
    proxy: {
      '/api/deepgram/grant': 'http://127.0.0.1:8787',
    },
  },
})
