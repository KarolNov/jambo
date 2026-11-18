import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), cloudflare()],
  // One copy of Yjs for the app, duratom and y-partyserver: two copies break Yjs's type checks.
  resolve: { dedupe: ['yjs'] },
  optimizeDeps: { include: ['yjs', 'duratom', 'duratom/core', 'y-partyserver/provider'] },
})
