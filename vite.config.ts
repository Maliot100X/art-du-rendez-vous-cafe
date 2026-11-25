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
  },
})
