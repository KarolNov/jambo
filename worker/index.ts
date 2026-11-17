import { Hono } from 'hono'
import { partyserverMiddleware } from 'hono-party'
import { BOARD_CLASS } from '../shared/parties'
import { isJamSlug, newJamSlug } from '../shared/slug'

export { Board } from './board'

type AppEnv = { Bindings: Env }

const app = new Hono<AppEnv>()

app.get('/api/health', (c) => c.json({ ok: true }))

/** Creates a jam: today a jam is just a fresh slug; its board appears on first connect. */
app.post('/api/jams', (c) => c.json({ slug: newJamSlug() }, 201))

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

// A jam page: a well-formed slug gets the SPA, anything else is not found.
app.get('/jam/:slug', async (c) => {
  if (!isJamSlug(c.req.param('slug'))) return c.notFound()
  return c.env.ASSETS.fetch(new URL('/index.html', c.req.url))
})

app.notFound((c) => c.text('Not found', 404))

export default app satisfies ExportedHandler<Env>
