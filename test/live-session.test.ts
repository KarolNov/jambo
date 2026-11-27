import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { parseSlotMessage, slotRequest } from '../shared/live'
import { hello, parseSeatMessage } from '../shared/seats'
import { listLive } from '../src/board/presence'
import { liveTransport } from '../worker/live'
import { connectBoard, until } from './client'

// Realtime is the stub in `vitest.realtime.ts`, behind a test token (see vitest.config.ts).

/** The rate limiter's window: a clock minute. */
const minute = () => Math.floor(Date.now() / 60_000)

let address = 0
/** A fresh client address per test, so one test's rate limit doesn't spill into another. */
const newAddress = () => `203.0.113.${++address}`

/** Calls the live session route as a browser at `ip` would. */
async function call(slug: string, name: string, body: object, ip: string) {
  const res = await exports.default.fetch(`http://jambo.test/api/jams/${slug}/live/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  const json = (text.startsWith('{') ? JSON.parse(text) : {}) as Record<string, unknown>
  return { status: res.status, body: json }
}

/** The Realtime API calls the Worker has made so far in this run. */
async function realtimeCalls(): Promise<string[]> {
  return (await fetch('https://rtc.live.cloudflare.com/__calls')).json()
}

/** Connects and seats a person as `name`, under the private key `key`. */
async function person(slug: string, key: string, name: string) {
  const c = await connectBoard(slug)
  c.sendCustom(hello(key, name, 'teal'))
  await until(() => c.custom.some((m) => parseSeatMessage(m)?.t === 'seat'))
  return c
}

/** Asks the room for a live slot for `c`; the voice id granted. */
async function goLive(c: Awaited<ReturnType<typeof person>>) {
  c.sendCustom(slotRequest())
  await until(() => c.custom.some((m) => parseSlotMessage(m)?.s === 'grant'))
  const grant = c.custom.map(parseSlotMessage).find((m) => m?.s === 'grant')
  return grant?.s === 'grant' ? grant.v : ''
}

/** Opens a session for `key` and answers it, as RealtimeTransport does. */
async function openSession(slug: string, key: string, ip: string) {
  const opened = await call(slug, 'session', { key }, ip)
  expect(opened.status).toBe(201)
  const { session, ticket } = opened.body as { session: string; ticket: string }
  const answer = { type: 'answer', sdp: 'v=0 fake answer' }
  expect((await call(slug, 'answer', { key, session, ticket, answer }, ip)).status).toBe(204)
  return { session, ticket }
}

describe('live sessions', () => {
  // @scenario collab/room: Not seated
  it('refuses someone not seated in the jam, and opens nothing', async () => {
    const slug = 'funky-otter-rs01'
    const ip = newAddress()
    const seated = await person(slug, 'k-seated', 'Misty Yak')
    const before = (await realtimeCalls()).length
    const out = await call(slug, 'session', { key: 'k-stranger' }, ip)
    expect(out).toEqual({ status: 403, body: { error: 'Join the jam first' } })
    // Seated in another jam is not seated in this one.
    const elsewhere = await call('funky-otter-rs99', 'session', { key: 'k-seated' }, ip)
    expect(elsewhere.status).toBe(403)
    expect(await realtimeCalls()).toHaveLength(before)
    seated.close()
  })

  // @scenario collab/room: Not seated
  it('refuses a malformed jam, and a call with no seat key', async () => {
    const ip = newAddress()
    const before = (await realtimeCalls()).length
    expect((await call('not-a-jam', 'session', { key: 'k' }, ip)).status).toBe(404)
    expect((await call('funky-otter-rs02', 'session', {}, ip)).status).toBe(400)
    expect((await call('funky-otter-rs02', 'nonsense', { key: 'k' }, ip)).status).toBe(404)
    expect(await realtimeCalls()).toHaveLength(before)
  })

  it('lets only a live slot holder publish a voice', async () => {
    const slug = 'funky-otter-rs03'
    const ip = newAddress()
    const a = await person(slug, 'k-a', 'Misty Yak')
    const { session, ticket } = await openSession(slug, 'k-a', ip)
    const before = (await realtimeCalls()).length
    const refused = await call(slug, 'publish', { key: 'k-a', session, ticket }, ip)
    expect(refused).toEqual({ status: 403, body: { error: 'Not live' } })
    expect(await realtimeCalls()).toHaveLength(before)
    const voice = await goLive(a)
    const published = await call(slug, 'publish', { key: 'k-a', session, ticket }, ip)
    expect(published.status).toBe(201)
    expect(published.body.voice).toBe(voice)
    a.close()
  })

  it("refuses a session that isn't the caller's, or is from another jam", async () => {
    const slug = 'funky-otter-rs04'
    const ip = newAddress()
    const a = await person(slug, 'k-a', 'Misty Yak')
    const b = await person(slug, 'k-b', 'Groovy Otter')
    const { session, ticket } = await openSession(slug, 'k-a', ip)
    const before = (await realtimeCalls()).length
    // B names A's session with A's ticket: the ticket is A's, so it doesn't match B.
    const stolen = await call(slug, 'close', { key: 'k-b', session, ticket, ids: [1] }, ip)
    expect(stolen).toEqual({ status: 403, body: { error: 'Not your session' } })
    const forged = await call(slug, 'close', { key: 'k-a', session, ticket: 'ab', ids: [1] }, ip)
    expect(forged.status).toBe(403)
    // A's own ticket from this jam doesn't open their session from another one.
    const other = await person('funky-otter-rs05', 'k-a', 'Misty Yak')
    const moved = await call(
      'funky-otter-rs05',
      'close',
      { key: 'k-a', session, ticket, ids: [1] },
      ip,
    )
    expect(moved.status).toBe(403)
    expect(await realtimeCalls()).toHaveLength(before)
    for (const c of [a, b, other]) c.close()
  })

  it('subscribes a listener to a published voice, through the room', async () => {
    const slug = 'funky-otter-rs06'
    const ip = newAddress()
    const singer = await person(slug, 'k-s', 'Misty Yak')
    const listener = await person(slug, 'k-l', 'Groovy Otter')
    const s = await openSession(slug, 'k-s', ip)
    const l = await openSession(slug, 'k-l', ip)
    const voice = await goLive(singer)
    // Live, but not published yet: try again shortly.
    expect((await call(slug, 'subscribe', { key: 'k-l', ...l, voice }, ip)).status).toBe(409)
    expect((await call(slug, 'publish', { key: 'k-s', ...s }, ip)).status).toBe(201)
    const sub = await call(slug, 'subscribe', { key: 'k-l', ...l, voice }, ip)
    expect(sub.status).toBe(201)
    expect(typeof sub.body.id).toBe('number')
    // Nobody subscribes to their own voice, nor to one that isn't live.
    expect((await call(slug, 'subscribe', { key: 'k-s', ...s, voice }, ip)).status).toBe(404)
    expect((await call(slug, 'subscribe', { key: 'k-l', ...l, voice: 'gone' }, ip)).status).toBe(
      404,
    )
    const calls = await realtimeCalls()
    expect(calls).toContain(`POST /sessions/${s.session}/datachannels/new`)
    expect(calls).toContain(`POST /sessions/${l.session}/datachannels/new`)
    // Mute: the listener's channel is closed on Realtime.
    const closed = await call(slug, 'close', { key: 'k-l', ...l, ids: [sub.body.id] }, ip)
    expect(closed.status).toBe(204)
    singer.close()
    listener.close()
  })

  it('lists a new publish of a live voice, so listeners subscribe to it again', async () => {
    const slug = 'funky-otter-rs08'
    const ip = newAddress()
    const singer = await person(slug, 'k-s', 'Misty Yak')
    const listener = await person(slug, 'k-l', 'Groovy Otter')
    const revOf = (voice: string) =>
      listLive(listener.awareness.getStates().values()).find((l) => l.voice === voice)?.rev
    const voice = await goLive(singer)
    await until(() => listLive(listener.awareness.getStates().values()).length === 1)
    expect(revOf(voice)).toBeUndefined()
    const first = await openSession(slug, 'k-s', ip)
    expect((await call(slug, 'publish', { key: 'k-s', ...first }, ip)).status).toBe(201)
    await until(() => revOf(voice) === 1)
    // The singer's connection dropped: they publish again on a new session.
    const second = await openSession(slug, 'k-s', ip)
    expect((await call(slug, 'publish', { key: 'k-s', ...second }, ip)).status).toBe(201)
    await until(() => revOf(voice) === 2)
    const l = await openSession(slug, 'k-l', ip)
    expect((await call(slug, 'subscribe', { key: 'k-l', ...l, voice }, ip)).status).toBe(201)
    singer.close()
    listener.close()
  })

  it('refuses the 21st call from one address within a minute', async () => {
    const slug = 'funky-otter-rs07'
    const seated = await person(slug, 'k-a', 'Misty Yak')
    // The limiter counts per clock minute, so a burst that crosses one is retried from a new address.
    for (let attempt = 0; ; attempt++) {
      const ip = newAddress()
      const start = minute()
      const statuses: number[] = []
      for (let i = 0; i < 21; i++)
        statuses.push((await call(slug, 'session', { key: 'k-a' }, ip)).status)
      if (minute() !== start && attempt === 0) continue
      expect(statuses.slice(0, 20)).toEqual(Array(20).fill(201))
      expect(statuses[20]).toBe(429)
      break
    }
    seated.close()
  })

  it('counts channel calls apart from sessions, so many listeners behind one address fit', async () => {
    const slug = 'funky-otter-rs09'
    const seated = await person(slug, 'k-a', 'Misty Yak')
    for (let attempt = 0; ; attempt++) {
      const ip = newAddress()
      const start = minute()
      const { session, ticket } = await openSession(slug, 'k-a', ip)
      for (let i = 0; i < 19; i++) await call(slug, 'session', { key: 'k-a' }, ip)
      // Sessions are spent for this minute; channel calls are not.
      const statuses: number[] = []
      for (let i = 0; i < 30; i++)
        statuses.push(
          (await call(slug, 'close', { key: 'k-a', session, ticket, ids: [1] }, ip)).status,
        )
      const session21 = (await call(slug, 'session', { key: 'k-a' }, ip)).status
      if (minute() !== start && attempt === 0) continue
      expect(statuses).toEqual(Array(30).fill(204))
      expect(session21).toBe(429)
      break
    }
    seated.close()
  })
})

describe('live transport', () => {
  it('relays through the room on a local Worker, and uses Realtime where it is set up', async () => {
    const at = async (host: string) =>
      (await (await exports.default.fetch(`http://${host}/api/live`)).json()) as object
    expect(await at('localhost:5173')).toEqual({ transport: 'fake' })
    expect(await at('jambo.test')).toEqual({ transport: 'realtime' })
  })

  it("isn't available on a deployed Worker without Realtime credentials", () => {
    const { REALTIME_APP_TOKEN: _, ...bare } = env as Env & { REALTIME_APP_TOKEN?: string }
    expect(liveTransport('https://jambo.example/jam/x', bare as Env)).toBe('none')
    expect(liveTransport('http://localhost:5173/', bare as Env)).toBe('fake')
  })
})
