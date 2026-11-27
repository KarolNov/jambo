import { cloudflareTest } from '@cloudflare/vitest-plugin'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import { commands } from './vitest.commands.ts'
import { fakeRealtime, TEST_REALTIME_TOKEN } from './vitest.realtime.ts'

export default defineConfig({
  test: {
    projects: [
      // Inside the Workers runtime (Miniflare) against wrangler.jsonc: the real Hono app,
      // the real Board Durable Object, isolated storage per test file.
      {
        // Realtime is stubbed (`vitest.realtime.ts`) under a test token: no real app is called.
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              bindings: { REALTIME_APP_TOKEN: TEST_REALTIME_TOKEN },
              outboundService: fakeRealtime,
            },
          }),
        ],
        test: {
          name: 'workers',
          include: ['test/**/*.test.ts'],
          exclude: ['test/browser/**'],
        },
      },
      // Inside a real headless Chromium page: the DOM, React and Web Audio the client uses.
      {
        plugins: [react()],
        // One copy of Yjs for the app, duratom and y-partyserver, as in vite.config.ts.
        resolve: { dedupe: ['yjs'] },
        optimizeDeps: {
          include: [
            'yjs',
            'duratom',
            'duratom/core',
            'duratom/react',
            'y-partyserver/provider',
            'y-protocols/awareness',
            'web-haptics',
            'react',
            'react-dom',
            'react-dom/client',
            'react/jsx-dev-runtime',
            'jotai',
            'vitest-browser-react',
          ],
        },
        test: {
          name: 'browser',
          include: ['test/browser/**/*.test.{ts,tsx}'],
          setupFiles: ['test/browser/setup.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            commands,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
