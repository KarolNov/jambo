import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { apply, type Origin, ROOTS, type Sound } from '../shared/board'
import { isUploadId, newUploadId, UPLOAD_HEADERS, UPLOADS } from '../shared/sounds'
import { encodeWav } from '../shared/wav'
import { SOUND_RETENTION_MS, soundKey } from '../worker/board'
import { getServerByName } from 'partyserver'
import { connectBoard, until } from './client'

/** The room's own origin, for the operations only it may apply. */
const ROOM: Origin = { kind: 'system', id: 'room' }

let address = 0
/** A fresh client address per test, so the write limit of one test doesn't spill into another. */
const newAddress = () => `203.0.113.${++address}`

const fetchApp = (path: string, init?: RequestInit) =>
  exports.default.fetch(`http://jambo.test${path}`, init)

const wav = (seconds = 0.5) =>
  encodeWav(
    Float32Array.from(
      { length: Math.round(seconds * UPLOADS.sampleRate) },
      (_, i) => Math.sin(i / 10) * 0.5,
    ),
    UPLOADS.sampleRate,
  )

function upload(
  slug: string,
  opts: { body?: BodyInit; name?: string; ip?: string; headers?: Record<string, string> } = {},
) {
  return fetchApp(`/api/jams/${slug}/sounds`, {
    method: 'POST',
    body: opts.body ?? wav(),
    headers: {
      'CF-Connecting-IP': opts.ip ?? newAddress(),
      [UPLOAD_HEADERS.name]: encodeURIComponent(opts.name ?? 'Vox'),
      [UPLOAD_HEADERS.author]: 'me',
      [UPLOAD_HEADERS.color]: 'teal',
      ...opts.headers,
    },
  })
}

const remove = (slug: string, id: string, ip = newAddress()) =>
  fetchApp(`/api/jams/${slug}/sounds/${id}`, {
    method: 'DELETE',
    headers: { 'CF-Connecting-IP': ip },
  })

const soundsOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>(ROOTS.sounds)
const pads = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>(ROOTS.pads)

describe('uploading a sound', () => {
  // @scenario collab/room: Serve
  it('stores the file, lists it for everyone, and serves it cacheable forever', async () => {
    const slug = 'funky-otter-sp01'
    const other = await connectBoard(slug)
    const res = await upload(slug, { name: 'Vox ✨' })
    expect(res.status).toBe(201)
    const { id, sound } = (await res.json()) as { id: string; sound: { name: string } }
    expect(isUploadId(id)).toBe(true)
    expect(sound).toMatchObject({ name: 'Vox ✨', durationMs: 500, author: 'me' })

    await until(() => soundsOf(other.doc).has(id))
    expect(String(soundsOf(other.doc).get(id)?.get('name'))).toBe('Vox ✨')

    const file = await fetchApp(`/api/jams/${slug}/sounds/${id}`)
    expect(file.status).toBe(200)
    expect(file.headers.get('Cache-Control')).toBe('public, max-age=86400')
    expect(file.headers.get('Content-Type')).toBe('audio/wav')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(wav())
    other.close()
  })

  it("keeps the uploader's name, and accepts uploads from clients older than names", async () => {
    const slug = 'funky-otter-sp0a'
    const named = await upload(slug, {
      headers: { [UPLOAD_HEADERS.authorName]: encodeURIComponent('Groovy Otter') },
    })
    expect(((await named.json()) as { sound: object }).sound).toMatchObject({
      authorName: 'Groovy Otter',
    })
    const older = await upload(slug, { name: 'Old' })
    expect(older.status).toBe(201)
    expect(((await older.json()) as { sound: object }).sound).not.toHaveProperty('authorName')
  })

  // @scenario collab/room: Bad file
  it('refuses a file that is not a WAV of the upload format, storing nothing', async () => {
    const slug = 'funky-otter-sp02'
    const res = await upload(slug, { body: encodeWav(new Float32Array(100), 48_000) })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Only 44100 Hz is accepted' })
    expect((await env.SOUND_FILES.list({ prefix: `jams/${slug}/` })).objects).toEqual([])
  })

  it('refuses a body over the size cap', async () => {
    const res = await upload('funky-otter-sp03', { body: new Uint8Array(UPLOADS.maxBytes + 1) })
    expect(res.status).toBe(413)
  })

  it('refuses a sound without a name', async () => {
    const res = await upload('funky-otter-sp04', { name: '  ' })
    expect(res.status).toBe(400)
  })

  // @scenario audio/sounds: Full jam
  it(`refuses the ${UPLOADS.perJam + 1}th sound in a jam`, async () => {
    const slug = 'funky-otter-sp05'
    // A real upload first and last, the rest listed in the room directly: 32 uploads in a row
    // outlast the test timeout on CI, and the cap counts what the board lists.
    const first = await upload(slug)
    expect(first.status).toBe(201)
    const { sound } = (await first.json()) as { sound: Sound }
    await runInDurableObject(env.Board.getByName(slug), (instance) => {
      const doc = (instance as unknown as { document: Y.Doc }).document
      for (let i = 2; i < UPLOADS.perJam; i++) {
        const [r] = apply(doc, [{ op: 'addSound', id: newUploadId(), sound }], ROOM)
        expect(r?.ok).toBe(true)
      }
    })
    const last = await upload(slug)
    expect(last.status).toBe(201)
    const { id } = (await last.json()) as { id: string }
    expect(await env.SOUND_FILES.head(soundKey(slug, id))).not.toBeNull()
    const res = await upload(slug)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: `This jam already has ${UPLOADS.perJam} sounds` })
  })

  // @scenario collab/room: Too many writes
  it('allows 10 writes a minute from one address', async () => {
    // The limiter counts per clock minute, so a burst that crosses one is retried from a new address.
    const minute = () => Math.floor(Date.now() / 60_000)
    for (let attempt = 0; ; attempt++) {
      const ip = newAddress()
      const start = minute()
      const statuses = []
      for (let i = 0; i < 11; i++) statuses.push((await upload('funky-otter-sp06', { ip })).status)
      const removed = (await remove('funky-otter-sp06', 'u-aaaaaaaaaaaa', ip)).status
      if (minute() !== start && attempt === 0) continue
      expect(statuses).toEqual([...Array(10).fill(201), 429])
      expect(removed).toBe(429)
      return
    }
  })

  // @scenario collab/room: Too many downloads
  it('allows 120 downloads that miss the edge cache a minute from one address', async () => {
    // Unknown ids never reach the cache, so each one counts; the limiter counts per clock minute.
    const minute = () => Math.floor(Date.now() / 60_000)
    for (let attempt = 0; ; attempt++) {
      const ip = newAddress()
      const start = minute()
      const responses = []
      for (let i = 0; i < 121; i++)
        responses.push(
          await fetchApp(`/api/jams/funky-otter-dx01/sounds/${newUploadId()}`, {
            headers: { 'CF-Connecting-IP': ip },
          }),
        )
      if (minute() !== start && attempt === 0) continue
      expect(responses.slice(0, 120).every((r) => r.status === 404)).toBe(true)
      const last = responses[120]!
      expect(last.status).toBe(429)
      expect(await last.json()).toEqual({ error: 'Too many downloads, try again in a minute' })
      return
    }
  })

  // @scenario collab/room: Clearing old sounds
  it('refuses uploads while the jam’s old audio is being cleared', async () => {
    const slug = 'funky-otter-cx01'
    const client = await connectBoard(slug)
    const stub = env.Board.get(env.Board.idFromName(slug))
    const setExpiring = (on: boolean) =>
      runInDurableObject(stub, (instance) => {
        ;(instance as unknown as { expiring: boolean }).expiring = on
      })
    await setExpiring(true)
    const res = await upload(slug)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      error: 'This jam’s old sounds are being cleared, try again in a moment',
    })
    expect((await env.SOUND_FILES.list({ prefix: `jams/${slug}/` })).objects).toEqual([])
    expect(soundsOf(client.doc).size).toBe(0)
    await setExpiring(false)
    expect((await upload(slug)).status).toBe(201)
    client.close()
  })

  it('serves not found for unknown sounds and malformed slugs', async () => {
    expect((await fetchApp('/api/jams/funky-otter-sp07/sounds/u-aaaaaaaaaaaa')).status).toBe(404)
    expect((await fetchApp('/api/jams/funky-otter-sp07/sounds/kick')).status).toBe(404)
    expect((await upload('not-a-slug')).status).toBe(404)
  })
})

describe('removing a sound', () => {
  it('refuses while a pad uses it, then removes the listing and the file', async () => {
    const slug = 'funky-otter-rm91'
    const client = await connectBoard(slug)
    const { id } = (await (await upload(slug)).json()) as { id: string }
    await until(() => soundsOf(client.doc).has(id))
    pads(client.doc).get('r0c1')!.set('soundId', id)
    await until(async () => (await remove(slug, id)).status === 409)

    pads(client.doc).get('r0c1')!.set('soundId', 'snare')
    await until(async () => (await remove(slug, id)).status === 204)
    await until(() => !soundsOf(client.doc).has(id))
    expect(await env.SOUND_FILES.head(soundKey(slug, id))).toBeNull()
    expect((await remove(slug, id)).status).toBe(404)
    client.close()
  })
})

describe('retention', () => {
  // @scenario collab/room: An agent keeps the sounds
  it('counts an agent acting in the jam as a visit', async () => {
    const slug = 'funky-otter-rex9'
    const client = await connectBoard(slug)
    const { id } = (await (await upload(slug)).json()) as { id: string }
    await until(() => soundsOf(client.doc).has(id))
    client.close()

    const stub = env.Board.get(env.Board.idFromName(slug))
    // Nobody has opened it for 89 days: one day of retention left.
    const DAY = 24 * 60 * 60 * 1000
    await runInDurableObject(stub, (_i, state) =>
      state.storage.put('retainUntil', Date.now() + DAY),
    )
    const r = await getServerByName(env.Board, slug)
    const out = await r.runAgentOps({ kind: 'Claude' }, [{ op: 'setTempo', bpm: 100 }], 'Hi')
    expect('error' in out).toBe(false)
    const retainUntil = await runInDurableObject(stub, (_i, state) =>
      state.storage.get<number>('retainUntil'),
    )
    expect(retainUntil).toBeGreaterThan(Date.now() + SOUND_RETENTION_MS - 60_000)
  })

  // @scenario audio/sounds: Abandoned jam
  it('deletes an unvisited jam’s audio and unlists its sounds, keeping the board', async () => {
    const slug = 'funky-otter-rex1'
    const client = await connectBoard(slug)
    const { id } = (await (await upload(slug)).json()) as { id: string }
    pads(client.doc).get('r0c0')!.set('soundId', id)
    await until(() => soundsOf(client.doc).has(id))
    client.close()

    const stub = env.Board.get(env.Board.idFromName(slug))
    const alarm = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm())
    expect(alarm).toBeGreaterThan(Date.now() + SOUND_RETENTION_MS - 60_000)
    // Wait for the server to see the close, then fire the alarm early.
    await until(async () =>
      runInDurableObject(stub, (instance) => [...instance.getConnections()].length === 0),
    )
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await env.SOUND_FILES.head(soundKey(slug, id))).toBeNull()

    const back = await connectBoard(slug)
    expect(soundsOf(back.doc).size).toBe(0)
    expect(pads(back.doc).get('r0c0')?.get('soundId')).toBe(id)
    expect(pads(back.doc).size).toBe(16)
    back.close()
  })

  it('unlists the sounds on the next load when the alarm finds the jam asleep', async () => {
    const slug = 'funky-otter-rex3'
    const client = await connectBoard(slug)
    const { id } = (await (await upload(slug)).json()) as { id: string }
    await until(() => soundsOf(client.doc).has(id))
    client.close()
    const stub = env.Board.get(env.Board.idFromName(slug))
    await until(async () =>
      runInDurableObject(stub, (instance) => [...instance.getConnections()].length === 0),
    )
    // Once the last save lists the sound, drop the object from memory.
    const saved = () =>
      runInDurableObject(stub, async (_i, state) => {
        const doc = new Y.Doc()
        const bytes = await state.storage.get<Uint8Array>('doc')
        if (bytes) Y.applyUpdate(doc, bytes)
        return soundsOf(doc).has(id)
      })
    await until(saved)
    await evictDurableObject(stub)
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await env.SOUND_FILES.head(soundKey(slug, id))).toBeNull()

    const back = await connectBoard(slug)
    expect(soundsOf(back.doc).size).toBe(0)
    back.close()
  })

  it('keeps the audio while someone is connected', async () => {
    const slug = 'funky-otter-rex2'
    const client = await connectBoard(slug)
    const { id } = (await (await upload(slug)).json()) as { id: string }
    const stub = env.Board.get(env.Board.idFromName(slug))
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await env.SOUND_FILES.head(soundKey(slug, id))).not.toBeNull()
    await until(() => soundsOf(client.doc).has(id))
    client.close()
  })
})
