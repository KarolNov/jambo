import type { IncomingMessage, ServerResponse } from 'node:http'

/** The Realtime token the Worker tests run with: a stand-in, never a real app's. */
export const TEST_REALTIME_TOKEN = 'test-realtime-token'

/** Every Realtime API call the Worker made in this run, as `METHOD /path`. */
const calls: string[] = []
let sessions = 0
let channels = 0

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

/**
 * The Worker tests' outbound handler (Miniflare's `outboundService`, run in Node): answers
 * rtc.live.cloudflare.com as a Realtime app would, recording each call, so tests can check what was
 * opened. `GET https://rtc.live.cloudflare.com/__calls` lists the calls so far. Anything else is
 * refused: the tests reach no other host.
 */
export const fakeRealtime = {
  node: (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `https://${req.headers.host}`)
    if (url.hostname !== 'rtc.live.cloudflare.com') return send(res, 502, { error: 'offline' })
    if (url.pathname === '/__calls') return send(res, 200, calls)
    if (req.headers.authorization !== `Bearer ${TEST_REALTIME_TOKEN}`)
      return send(res, 401, { errorCode: 'unauthorized' })
    const path = url.pathname.replace(/^\/v1\/apps\/[^/]+/, '')
    calls.push(`${req.method} ${path}`)
    if (path === '/sessions/new') return send(res, 201, { sessionId: `session-${++sessions}` })
    if (path.endsWith('/datachannels/establish'))
      return send(res, 201, { sessionDescription: { type: 'offer', sdp: 'v=0 fake offer' } })
    if (path.endsWith('/renegotiate')) return send(res, 200, {})
    if (path.endsWith('/datachannels/new'))
      return send(res, 201, { dataChannels: [{ id: ++channels }] })
    if (path.endsWith('/datachannels/close')) return send(res, 200, { dataChannels: [] })
    return send(res, 404, { errorCode: 'not_found' })
  },
}
