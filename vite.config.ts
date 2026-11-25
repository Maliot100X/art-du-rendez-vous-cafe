import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';
// @ts-expect-error plain ESM helper
import {deepgramTokenPlugin} from './server/deepgram.mjs';

export default defineConfig({
  plugins: [react(), tailwindcss(), deepgramTokenPlugin()],
  build: {
    // Frame sequence and loop video live in public/ and are served as-is.
    target: 'es2020',
  },
});
