import { Hono } from 'hono'
import { getServerByName } from 'partyserver'
import { isJamSlug } from '../shared/slug'
import { isUploadId, UPLOADS } from '../shared/sounds'
import { soundKey } from './board'

type AppEnv = { Bindings: Env }

/** Upload ids are never reused, so a sound's file never changes. */
const IMMUTABLE = 'public, max-age=31536000, immutable'

/** Header names for an upload's details; the body is the WAV itself. */
export const SOUND_HEADERS = {
  name: 'X-Sound-Name',
  author: 'X-Sound-Author',
  color: 'X-Sound-Color',
} as const

/**
 * A jam's uploaded sounds, under /api/jams/:slug/sounds. Uploads and removals go through the
 * jam's Board, which lists them on the board; files are read straight from R2.
 */
export const sounds = new Hono<AppEnv>()

sounds.use('/:slug/*', async (c, next) => {
  if (!isJamSlug(c.req.param('slug'))) return c.notFound()
  await next()
})

/** One budget per client address for uploads and removals. */
async function overLimit(c: { env: Env; req: { header(name: string): string | undefined } }) {
  const key = c.req.header('CF-Connecting-IP') ?? 'unknown'
  const { success } = await c.env.SOUND_WRITES.limit({ key })
  return !success
}

sounds.post('/:slug/sounds', async (c) => {
  if (await overLimit(c)) return c.json({ error: 'Too many uploads, try again in a minute' }, 429)
  const declared = Number(c.req.header('Content-Length') ?? 0)
  if (declared > UPLOADS.maxBytes) return c.json({ error: 'The file is too big' }, 413)
  const wav = await c.req.arrayBuffer()
  if (wav.byteLength > UPLOADS.maxBytes) return c.json({ error: 'The file is too big' }, 413)
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
    name: header(SOUND_HEADERS.name),
    author: header(SOUND_HEADERS.author),
    color: header(SOUND_HEADERS.color),
  })
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ id: result.id, sound: result.sound }, 201)
})

sounds.get('/:slug/sounds/:id', async (c) => {
  const id = c.req.param('id')
  if (!isUploadId(id)) return c.notFound()
  const object = await c.env.SOUND_FILES.get(soundKey(c.req.param('slug'), id))
  if (!object) return c.notFound()
  return new Response(object.body, {
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': String(object.size),
      'Cache-Control': IMMUTABLE,
      ETag: object.httpEtag,
    },
  })
})

sounds.delete('/:slug/sounds/:id', async (c) => {
  if (await overLimit(c)) return c.json({ error: 'Too many changes, try again in a minute' }, 429)
  const id = c.req.param('id')
  if (!isUploadId(id)) return c.notFound()
  const board = await getServerByName(c.env.Board, c.req.param('slug'))
  const result = await board.removeSound(id)
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.body(null, 204)
})
