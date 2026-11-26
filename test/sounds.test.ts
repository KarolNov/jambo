import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { apply, type Origin, ROOTS, type Sound, type Track } from '../shared/board'
import { CLIPS, isUploadId, newUploadId, UPLOAD_HEADERS, UPLOADS } from '../shared/sounds'
import { encodeWav } from '../shared/wav'
import { ORPHAN_CLIP_MS, SOUND_RETENTION_MS, soundKey } from '../worker/board'
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
  opts: {
    body?: BodyInit
    name?: string
    ip?: string
    headers?: Record<string, string>
    path?: 'sounds' | 'clips'
  } = {},
) {
  return fetchApp(`/api/jams/${slug}/${opts.path ?? 'sounds'}`, {
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
      const download = () =>
        fetchApp(`/api/jams/funky-otter-dx01/sounds/${newUploadId()}`, {
          headers: { 'CF-Connecting-IP': ip },
        })
      // The 120 allowed at once: one after another they take about 5 s, past the test timeout
      // when the suite is busy. Then the one over the limit, on its own so it is the one refused.
      const allowed = await Promise.all(Array.from({ length: 120 }, download))
      const last = await download()
      if (minute() !== start && attempt === 0) continue
      expect(allowed.every((r) => r.status === 404)).toBe(true)
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

const clip = (slug: string, opts: Parameters<typeof upload>[1] = {}) =>
  upload(slug, { name: 'Teal 1 · voice 1', ...opts, path: 'clips' })

const ME: Origin = { kind: 'user', id: 'me' }

const voiceTrack = (soundIds: string[]): Track => ({
  name: 'Teal 1',
  author: 'me',
  color: 'teal',
  bars: 1,
  hits: [{ padId: 'r0c0', beat: 0 }, ...soundIds.map((soundId, i) => ({ soundId, beat: i + 1 }))],
  gain: 1,
  mute: false,
  quantize: 0.25,
  effects: [],
})

/** Makes every clip the room counts as unnamed look unnamed for over a minute already. */
const backdateOrphans = (slug: string) =>
  runInDurableObject(env.Board.getByName(slug), (instance) => {
    const orphans = (instance as unknown as { orphans: Map<string, number> }).orphans
    for (const id of orphans.keys()) orphans.set(id, Date.now() - ORPHAN_CLIP_MS - 1)
    return [...orphans.keys()]
  })

/** Waits for the room to note `id` as unnamed: it checks once edits settle. */
const noted = (slug: string, id: string) =>
  until(async () =>
    runInDurableObject(env.Board.getByName(slug), async (_i, state) => {
      const stored = await state.storage.get<Record<string, number>>('orphanClips')
      return stored?.[id] !== undefined
    }),
  )

const issued = (slug: string, id: string) =>
  runInDurableObject(env.Board.getByName(slug), (_i, state) =>
    state.storage.get<number>(`issued:${id}`),
  )

describe('voice clips', () => {
  it('stores a clip as its own kind, served like any upload', async () => {
    const slug = 'funky-otter-ck01'
    const client = await connectBoard(slug)
    const res = await clip(slug)
    expect(res.status).toBe(201)
    const { id, sound } = (await res.json()) as { id: string; sound: Sound }
    expect(isUploadId(id)).toBe(true)
    expect(sound).toMatchObject({ kind: 'clip', name: 'Teal 1 · voice 1', durationMs: 500 })
    await until(() => soundsOf(client.doc).get(id)?.get('kind') === 'clip')
    expect((await fetchApp(`/api/jams/${slug}/clips`)).status).toBe(404)
    const file = await fetchApp(`/api/jams/${slug}/sounds/${id}`)
    expect(file.status).toBe(200)
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(wav())
    client.close()
  })

  it('refuses a clip that is not a WAV of the upload format', async () => {
    const slug = 'funky-otter-ck02'
    const res = await clip(slug, { body: encodeWav(new Float32Array(100), 48_000) })
    expect(res.status).toBe(400)
    expect((await env.SOUND_FILES.list({ prefix: `jams/${slug}/` })).objects).toEqual([])
    expect((await clip(slug, { body: new Uint8Array(UPLOADS.maxBytes + 1) })).status).toBe(413)
  })

  // @scenario board/ops: Uploads don't fill clips
  it(`counts clips apart from uploads, and refuses the ${CLIPS.perJam + 1}th clip`, async () => {
    const slug = 'funky-otter-ck03'
    const first = await upload(slug)
    const { sound } = (await first.json()) as { sound: Sound }
    // Listed in the room directly: that many real uploads outlast the test timeout on CI.
    await runInDurableObject(env.Board.getByName(slug), (instance) => {
      const doc = (instance as unknown as { document: Y.Doc }).document
      const add = (s: Sound) => apply(doc, [{ op: 'addSound', id: newUploadId(), sound: s }], ROOM)
      for (let i = 1; i < UPLOADS.perJam; i++) expect(add(sound)[0]?.ok).toBe(true)
      for (let i = 0; i < 10; i++) expect(add({ ...sound, kind: 'clip' })[0]?.ok).toBe(true)
    })
    expect((await upload(slug)).status).toBe(409)
    expect((await clip(slug)).status).toBe(201)

    await runInDurableObject(env.Board.getByName(slug), (instance) => {
      const doc = (instance as unknown as { document: Y.Doc }).document
      for (let i = 11; i < CLIPS.perJam; i++) {
        const [r] = apply(
          doc,
          [{ op: 'addSound', id: newUploadId(), sound: { ...sound, kind: 'clip' } }],
          ROOM,
        )
        expect(r?.ok).toBe(true)
      }
    })
    const res = await clip(slug)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: `This jam already has ${CLIPS.perJam} voice clips` })
  })

  // @scenario collab/room: Many clips in one take
  it('allows 30 clip writes a minute from one address, apart from upload writes', async () => {
    const minute = () => Math.floor(Date.now() / 60_000)
    for (let attempt = 0; ; attempt++) {
      const ip = newAddress()
      const start = minute()
      // A take's worth at once, then up to the limit, then one over it.
      const take = await Promise.all(
        Array.from({ length: 15 }, () => clip('funky-otter-ck04', { ip })),
      )
      const rest = await Promise.all(
        Array.from({ length: 15 }, () => clip('funky-otter-ck04', { ip })),
      )
      const over = await clip('funky-otter-ck04', { ip })
      const uploaded = await upload('funky-otter-ck04', { ip })
      if (minute() !== start && attempt === 0) continue
      expect([...take, ...rest].map((r) => r.status)).toEqual(Array(30).fill(201))
      expect(over.status).toBe(429)
      expect(uploaded.status).toBe(201)
      return
    }
  })

  // @scenario collab/room: Track removed
  it('frees clips a minute after the track naming them is removed', async () => {
    const slug = 'funky-otter-ck05'
    const client = await connectBoard(slug)
    const ids: string[] = []
    for (let i = 0; i < 3; i++) ids.push(((await (await clip(slug)).json()) as { id: string }).id)
    const [a, b, kept] = ids as [string, string, string]
    await until(() => ids.every((id) => soundsOf(client.doc).has(id)))
    const added = apply(
      client.doc,
      [
        { op: 'addTrack', id: 't1', track: voiceTrack([a, b]) },
        { op: 'addTrack', id: 't2', track: voiceTrack([kept]) },
      ],
      ME,
    )
    expect(added.every((r) => r.ok)).toBe(true)
    // Named by tracks: nothing is unnamed, so nothing is freed.
    await until(async () => (await backdateOrphans(slug)).length === 0)
    const stub = env.Board.getByName(slug)

    expect(apply(client.doc, [{ op: 'removeTrack', id: 't1' }], ME)[0]?.ok).toBe(true)
    await until(async () => (await backdateOrphans(slug)).length === 2)
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    await until(() => !soundsOf(client.doc).has(a) && !soundsOf(client.doc).has(b))
    for (const id of [a, b]) {
      expect(await env.SOUND_FILES.head(soundKey(slug, id))).toBeNull()
      expect(await issued(slug, id)).toBe(0)
    }
    expect(soundsOf(client.doc).has(kept)).toBe(true)
    expect(await env.SOUND_FILES.head(soundKey(slug, kept))).not.toBeNull()
    expect(await issued(slug, kept)).toBeGreaterThan(0)
    client.close()
  })

  it('keeps a clip whose grace has not run out', async () => {
    const slug = 'funky-otter-ck06'
    const client = await connectBoard(slug)
    const { id } = (await (await clip(slug)).json()) as { id: string }
    await until(() => soundsOf(client.doc).has(id))
    await noted(slug, id)
    const stub = env.Board.getByName(slug)
    const alarm = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm())
    expect(alarm).toBeLessThanOrEqual(Date.now() + ORPHAN_CLIP_MS)
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(soundsOf(client.doc).has(id)).toBe(true)
    expect(await env.SOUND_FILES.head(soundKey(slug, id))).not.toBeNull()
    // The track lands in time: the clip is named and stays.
    apply(client.doc, [{ op: 'addTrack', id: 't1', track: voiceTrack([id]) }], ME)
    await until(async () => (await backdateOrphans(slug)).length === 0)
    client.close()
  })

  // @scenario collab/room: Track never added
  it('frees a clip whose track was never added, even after the room was evicted', async () => {
    const slug = 'funky-otter-ck07'
    const client = await connectBoard(slug)
    const { id } = (await (await clip(slug)).json()) as { id: string }
    await until(() => soundsOf(client.doc).has(id))
    await noted(slug, id)
    client.close()
    const stub = env.Board.getByName(slug)
    await until(async () =>
      runInDurableObject(stub, (instance) => [...instance.getConnections()].length === 0),
    )
    await runInDurableObject(stub, (instance) => instance.onSave())
    // The grace passes with the room asleep: the stored times are all it has.
    await runInDurableObject(stub, (_i, state) =>
      state.storage.put('orphanClips', { [id]: Date.now() - ORPHAN_CLIP_MS - 1 }),
    )
    await evictDurableObject(stub)
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await env.SOUND_FILES.head(soundKey(slug, id))).toBeNull()
    expect(await issued(slug, id)).toBe(0)

    const back = await connectBoard(slug)
    expect(soundsOf(back.doc).has(id)).toBe(false)
    back.close()
  })
})
