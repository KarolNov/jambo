import { Hono } from 'hono'
import { getServerByName } from 'partyserver'
import { isJamSlug } from '../shared/slug'
import { toName } from '../shared/names'
import { isUploadId, PAUSED_MESSAGES, UPLOAD_HEADERS, UPLOADS } from '../shared/sounds'
import { soundKey } from './board'
import { quota } from './quota'

type AppEnv = { Bindings: Env }

/**
 * Upload ids are never reused, so a sound's file never changes, but it can be removed or expire.
 * A day's caching keeps repeat loads off R2 while letting deleted audio stop being served.
 */
const CACHE_CONTROL = 'public, max-age=86400'

/**
 * A jam's uploaded sounds, under /api/jams/:slug/sounds. Uploads and removals go through the
 * jam's Board, which lists them on the board; files are read straight from R2.
 */
export const sounds = new Hono<AppEnv>()

sounds.use('/:slug/*', async (c, next) => {
  if (!isJamSlug(c.req.param('slug'))) return c.notFound()
  await next()
})

/** One budget per client address: `SOUND_WRITES` for uploads and removals, `SOUND_READS` for R2 reads. */
async function overLimit(
  c: { env: Env; req: { header(name: string): string | undefined } },
  limiter: 'SOUND_WRITES' | 'SOUND_READS' = 'SOUND_WRITES',
) {
  const key = c.req.header('CF-Connecting-IP') ?? 'unknown'
  const { success } = await c.env[limiter].limit({ key })
  return !success
}

/** The edge-cache key for a sound file: its URL without a query, so a query can't skip the cache. */
function cacheKeyFor(url: string) {
  const u = new URL(url)
  u.search = ''
  return new Request(u.toString(), { method: 'GET' })
}

/** Reads a request body, giving up (null) as soon as it passes `max` bytes. */
async function readCapped(body: ReadableStream<Uint8Array> | null, max: number) {
  if (!body) return new ArrayBuffer(0)
  const out = new Uint8Array(max)
  let n = 0
  const reader = body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return out.slice(0, n).buffer
    if (n + value.byteLength > max) {
      await reader.cancel()
      return null
    }
    out.set(value, n)
    n += value.byteLength
  }
}

sounds.post('/:slug/sounds', async (c) => {
  if (await overLimit(c)) return c.json({ error: 'Too many uploads, try again in a minute' }, 429)
  const declared = Number(c.req.header('Content-Length') ?? 0)
  if (declared > UPLOADS.maxBytes) return c.json({ error: 'The file is too big' }, 413)
  const wav = await readCapped(c.req.raw.body, UPLOADS.maxBytes)
  if (!wav) return c.json({ error: 'The file is too big' }, 413)
  const header = (name: string) => {
    try {
      return decodeURIComponent(c.req.header(name) ?? '')
    } catch {
      return ''
    }
  }
  const board = await getServerByName(c.env.Board, c.req.param('slug'))
  const result = await board.uploadSound({
    wav,
    name: header(UPLOAD_HEADERS.name),
    author: header(UPLOAD_HEADERS.author),
    authorName: toName(header(UPLOAD_HEADERS.authorName)),
    color: header(UPLOAD_HEADERS.color),
  })
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ id: result.id, sound: result.sound }, 201)
})

sounds.get('/:slug/sounds/:id', async (c) => {
  const id = c.req.param('id')
  if (!isUploadId(id)) return c.notFound()
  // Files never change, so the edge cache answers repeat requests without an R2 read.
  const cache = caches.default
  const cacheKey = cacheKeyFor(c.req.url)
  const hit = await cache.match(cacheKey)
  if (hit) return hit
  // Misses spend the app-wide read budget, so each address gets only so many.
  if (await overLimit(c, 'SOUND_READS'))
    return c.json({ error: 'Too many downloads, try again in a minute' }, 429)
  if (!(await quota(c.env).read())) return c.json({ error: PAUSED_MESSAGES.reads }, 503)
  const object = await c.env.SOUND_FILES.get(soundKey(c.req.param('slug'), id))
  if (!object) return c.notFound()
  const res = new Response(object.body, {
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': String(object.size),
      'Cache-Control': CACHE_CONTROL,
      ETag: object.httpEtag,
    },
  })
  c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()))
  return res
})

sounds.delete('/:slug/sounds/:id', async (c) => {
  if (await overLimit(c)) return c.json({ error: 'Too many changes, try again in a minute' }, 429)
  const id = c.req.param('id')
  if (!isUploadId(id)) return c.notFound()
  const board = await getServerByName(c.env.Board, c.req.param('slug'))
  const result = await board.removeSound(id)
  if (!result.ok) return c.json({ error: result.error }, result.status)
  // Only this location's cache can be purged; elsewhere the copy lapses within CACHE_CONTROL.
  c.executionCtx.waitUntil(caches.default.delete(cacheKeyFor(c.req.url)))
  return c.body(null, 204)
})
