import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// Tests run inside the Workers runtime (Miniflare) against wrangler.jsonc: the real Hono app,
// the real Board Durable Object, isolated storage per test file.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: { include: ['test/**/*.test.ts'] },
})
