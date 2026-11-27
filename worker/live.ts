/**
 * Live voice in the Worker: the Realtime session route, and the fake transport's relay.
 *
 * The real transport is Cloudflare Realtime DataChannels. The app token never leaves the Worker:
 * the route makes every Realtime API call for a browser, and only for a person seated in a
 * well-formed jam (the room checks their private seat key); only the holder of a live slot may
 * publish a voice, and listeners subscribe through the room, which knows where each voice is
 * published. A session id comes back with a ticket (an HMAC under the token over jam, seat and
 * session), so later calls can only touch a session the same person opened in the same jam.
 *
 * The fake transport passes a slot holder's stamped frames to everyone else over the board
 * connection, so local dev and the e2e tests sing live with no Realtime app. The room relays it
 * only for connections made to a local Worker, so a deployed room never carries audio. The slots
 * themselves are the room's (`worker/board.ts`).
 */
import { Hono } from 'hono'
import { getServerByName } from 'partyserver'
import {
  CHANNEL_POLICY,
  type Description,
  LIVE_CALLS,
  LIVE_UNAVAILABLE,
  type LiveCall,
  type LiveTransportKind,
} from '../shared/live'
import { isJamSlug } from '../shared/slug'

/**
 * `REALTIME_APP_TOKEN` is a secret (`wrangler secret put`), absent where it was never set (previews,
 * local dev without `.dev.vars`): typed here, since `wrangler types` only sees secrets in `.dev.vars`.
 */
export type LiveEnv = Env & { REALTIME_APP_TOKEN?: string }

type AppEnv = { Bindings: LiveEnv }

/** Where a live voice is published on Realtime: the singer's session and the channel's name. */
export interface LiveSource {
  session: string
  channel: string
}

/** The hosts a local Worker answers on. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Whether the room relays fake live frames for a connection opened to `url`. */
export function relaysFake(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}

/** The Realtime app's id and token, when both are set. */
function credentials(env: LiveEnv): { app: string; token: string } | undefined {
  const app = env.REALTIME_APP_ID
  const token = env.REALTIME_APP_TOKEN
  return app && token ? { app, token } : undefined
}

/**
 * How live voice travels for a page served from `url`: the fake relay on a local Worker (so local
 * dev and e2e never need Realtime), else Realtime where its credentials are set, else not at all.
 */
export function liveTransport(url: string, env: LiveEnv): LiveTransportKind {
  if (relaysFake(url)) return 'fake'
  return credentials(env) ? 'realtime' : 'none'
}

const REALTIME_API = 'https://rtc.live.cloudflare.com/v1/apps'

class RealtimeError extends Error {}

/** One Realtime API call; throws on an HTTP error or an error reported in the body. */
async function realtime<T>(
  creds: { app: string; token: string },
  method: 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${REALTIME_API}/${creds.app}${path}`, {
    method,
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as T & { errorCode?: string }
  if (!res.ok || json.errorCode) throw new RealtimeError(`${method} ${path}: ${res.status}`)
  return json
}

/** The id Realtime allocated to the one DataChannel asked for, or a RealtimeError. */
function channelId(out: { dataChannels?: { id?: unknown; errorCode?: string }[] }): number {
  const ch = out.dataChannels?.[0]
  if (!ch || ch.errorCode || typeof ch.id !== 'number') throw new RealtimeError('no channel')
  return ch.id
}

const encoder = new TextEncoder()

/** The ticket for `session`, opened by the person seated under `key` in jam `slug`. */
async function ticketFor(token: string, slug: string, key: string, session: string) {
  const hmac = await crypto.subtle.importKey(
    'raw',
    encoder.encode(token),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', hmac, encoder.encode(`${slug}\n${key}\n${session}`))
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Compares two strings in time that doesn't depend on where they differ. */
function sameText(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const isText = (v: unknown, max = 200): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max

const isAnswer = (v: unknown): v is Description => {
  const d = v as { type?: unknown; sdp?: unknown } | null
  return d?.type === 'answer' && isText(d.sdp, 64_000)
}

/** What every call's body holds; the rest is checked per call. */
type Body = {
  key?: unknown
  session?: unknown
  ticket?: unknown
  answer?: unknown
  voice?: unknown
  ids?: unknown
}

/**
 * The live session route, under /api/jams/:slug/live, and `GET /api/live` (which transport this
 * Worker offers). Each call is refused, in this order: a malformed jam (404); past its budget from
 * one address (429: `LIVE_SESSIONS` for `session`, `LIVE_CHANNELS` for the rest); not seated in the jam now (403); publishing without a live slot (403);
 * no Realtime credentials (503); a session or ticket that isn't the caller's (403). Only then does
 * it call Realtime.
 */
export const live = new Hono<AppEnv>()

live.get('/live', (c) => c.json({ transport: liveTransport(c.req.url, c.env) }))

live.post('/jams/:slug/live/:call', async (c) => {
  const slug = c.req.param('slug')
  const call = c.req.param('call')
  if (!isJamSlug(slug) || !LIVE_CALLS.includes(call as LiveCall)) return c.notFound()
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
  // Opening a session is the costly call; the channel calls are many (a subscribe per live voice,
  // for each person behind one address), so they have a budget of their own.
  const limiter = call === 'session' ? c.env.LIVE_SESSIONS : c.env.LIVE_CHANNELS
  if (!(await limiter.limit({ key: ip })).success)
    return c.json({ error: 'Too many live voice requests, try again in a minute' }, 429)
  const body = (await c.req.json().catch(() => ({}))) as Body
  if (!isText(body.key, 64)) return c.json({ error: 'Who are you?' }, 400)
  const key = body.key
  const board = await getServerByName(c.env.Board, slug)
  const seat = await board.liveSeat(key)
  if (!seat.seated) return c.json({ error: 'Join the jam first' }, 403)
  if (call === 'publish' && !seat.voice) return c.json({ error: 'Not live' }, 403)
  const creds = credentials(c.env)
  if (!creds) return c.json({ error: LIVE_UNAVAILABLE }, 503)

  try {
    if (call === 'session') {
      // A DataChannel-only session: the SFU offers its transport, the browser answers (`answer`).
      const { sessionId } = await realtime<{ sessionId: string }>(creds, 'POST', '/sessions/new')
      const est = await realtime<{ sessionDescription: Description }>(
        creds,
        'POST',
        `/sessions/${sessionId}/datachannels/establish`,
        { dataChannel: { location: 'remote', dataChannelName: 'server-events' } },
      )
      const ticket = await ticketFor(creds.token, slug, key, sessionId)
      return c.json({ session: sessionId, ticket, offer: est.sessionDescription }, 201)
    }

    // Every other call acts on a session this person opened in this jam.
    if (!isText(body.session) || !isText(body.ticket)) return c.json({ error: 'No session' }, 400)
    const session = body.session
    if (!sameText(body.ticket, await ticketFor(creds.token, slug, key, session)))
      return c.json({ error: 'Not your session' }, 403)
    const path = `/sessions/${encodeURIComponent(session)}`

    if (call === 'answer') {
      if (!isAnswer(body.answer)) return c.json({ error: 'No answer' }, 400)
      await realtime(creds, 'PUT', `${path}/renegotiate`, { sessionDescription: body.answer })
      return c.body(null, 204)
    }

    if (call === 'publish') {
      const voice = seat.voice!
      const channel = `voice-${voice}`
      const out = await realtime<{ dataChannels?: [] }>(creds, 'POST', `${path}/datachannels/new`, {
        dataChannels: [{ location: 'local', dataChannelName: channel, ...CHANNEL_POLICY }],
      })
      const id = channelId(out)
      // The slot may have ended while Realtime answered: then nobody can subscribe to it, and the
      // channel is closed again, since the browser never learns its id.
      if (!(await board.livePublished(key, voice, { session, channel }))) {
        await realtime(creds, 'PUT', `${path}/datachannels/close`, {
          dataChannels: [{ id }],
        }).catch(() => undefined)
        return c.json({ error: 'Not live' }, 403)
      }
      return c.json({ id, voice }, 201)
    }

    if (call === 'subscribe') {
      if (!isText(body.voice, 64)) return c.json({ error: 'Which voice?' }, 400)
      const source = await board.liveSource(key, body.voice)
      if (source === 'gone') return c.json({ error: 'Not live' }, 404)
      if (source === 'own') return c.json({ error: 'Your own voice' }, 404)
      if (source === 'pending') return c.json({ error: 'Not published yet' }, 409)
      const out = await realtime<{ dataChannels?: [] }>(creds, 'POST', `${path}/datachannels/new`, {
        dataChannels: [
          {
            location: 'remote',
            sessionId: source.session,
            dataChannelName: source.channel,
            ...CHANNEL_POLICY,
          },
        ],
      })
      return c.json({ id: channelId(out) }, 201)
    }

    if (call === 'close') {
      const ids = body.ids
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 8)
        return c.json({ error: 'Which channels?' }, 400)
      if (!ids.every((id) => Number.isInteger(id) && id >= 0 && id < 65_536))
        return c.json({ error: 'Which channels?' }, 400)
      await realtime(creds, 'PUT', `${path}/datachannels/close`, {
        dataChannels: ids.map((id) => ({ id })),
      })
      return c.body(null, 204)
    }
  } catch (e) {
    if (e instanceof RealtimeError) {
      console.error('live:', e.message)
      return c.json({ error: "Couldn't reach live voice, try again" }, 502)
    }
    throw e
  }
  return c.notFound()
})
