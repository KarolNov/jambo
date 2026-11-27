import { Hono } from 'hono'
import { partyserverMiddleware } from 'hono-party'
import { BOARD_CLASS } from '../shared/parties'
import { isJamSlug, newJamSlug } from '../shared/slug'
import { handleMcp } from './agent/mcp'
import { live } from './live'
import { quota } from './quota'
import { sounds } from './sounds'

export { Board } from './board'
export { SoundQuota } from './quota'

type AppEnv = { Bindings: Env }

const app = new Hono<AppEnv>()

app.get('/api/health', (c) => c.json({ ok: true }))

/** Creates a jam: today a jam is just a fresh slug; its board appears on first connect. */
app.post('/api/jams', (c) => c.json({ slug: newJamSlug() }, 201))

// Whether the app's sound budget allows uploads and downloads right now.
app.get('/api/sounds/status', async (c) => c.json(await quota(c.env).status()))

// A jam's uploaded sounds: upload, fetch and remove.
app.route('/api/jams', sounds)

// Live voice: which transport this Worker offers, and the Realtime session route.
app.route('/api', live)

// Board WebSockets: /parties/board/:slug, one Board Durable Object per slug.
// onBeforeConnect is the one gate every connection passes; accounts would be checked here too.
app.use(
  '/parties/*',
  partyserverMiddleware<AppEnv>({
    options: {
      onBeforeConnect: (_req, lobby) => {
        if (lobby.className !== BOARD_CLASS || !isJamSlug(lobby.name)) {
          return new Response('Not found', { status: 404 })
        }
      },
      onBeforeRequest: () => new Response('Not found', { status: 404 }),
    },
  }),
)

// Agents in a jam, over MCP (stateless streamable HTTP). The jam link is the only key.
// Hono's ExecutionContext type predates the runtime's; the object is the runtime's own.
app.all('/mcp', (c) => handleMcp(c.req.raw, c.env, c.executionCtx as unknown as ExecutionContext))

// The about page lives at /about; /docs, a name people guess, redirects there.
app.get('/docs', (c) => c.redirect('/about', 301))
app.get('/docs/', (c) => c.redirect('/about', 301))

// A jam page: a well-formed slug gets the SPA, anything else is not found.
app.get('/jam/:slug', async (c) => {
  if (!isJamSlug(c.req.param('slug'))) return c.notFound()
  return c.env.ASSETS.fetch(new URL('/index.html', c.req.url))
})

app.notFound((c) => c.text('Not found', 404))

export default app satisfies ExportedHandler<Env>
