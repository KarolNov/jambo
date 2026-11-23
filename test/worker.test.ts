import { evictDurableObject, listDurableObjectIds } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { apply, ROOTS, type Track } from '../shared/board'
import { BOARD_CLASS, BOARD_PARTY, boardPath } from '../shared/parties'
import { isJamSlug } from '../shared/slug'
import { SOUNDS } from '../shared/sounds'
import { parseClockMessage, ping } from '../shared/clock'
import { hello, parseSeatMessage } from '../shared/seats'
import { connectBoard, until } from './client'

const fetchApp = (path: string, init?: RequestInit) =>
  exports.default.fetch(`http://jambo.test${path}`, init)

const tracksOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('tracks')

function addTrack(doc: Y.Doc, id: string, name: string) {
  const track = new Y.Map<unknown>()
  track.set('name', new Y.Text(name))
  tracksOf(doc).set(id, track)
}

const names = (doc: Y.Doc) => [...tracksOf(doc).values()].map((t) => String(t.get('name'))).sort()

describe('api', () => {
  it('answers health', async () => {
    const res = await fetchApp('/api/health')
    expect(await res.json()).toEqual({ ok: true })
  })

  // @scenario collab/jams: Visit the root
  it('creates a jam with a fresh slug whose board starts at the defaults', async () => {
    const res = await fetchApp('/api/jams', { method: 'POST' })
    expect(res.status).toBe(201)
    const { slug } = (await res.json()) as { slug: string }
    expect(isJamSlug(slug)).toBe(true)
    const a = await connectBoard(slug)
    expect(a.doc.getMap(ROOTS.meta).get('bpm')).toBe(100)
    expect(a.doc.getMap(ROOTS.pads).size).toBe(16)
    expect(a.doc.getMap(ROOTS.tracks).size).toBe(0)
    a.close()
  })
})

describe('pages', () => {
  // @scenario collab/jams: Old docs link
  it.each(['/docs', '/docs/'])('redirects %s to /about', async (path) => {
    const res = await fetchApp(path, { redirect: 'manual' })
    expect(res.status).toBe(301)
    expect(res.headers.get('Location')).toBe('/about')
  })
})

describe('malformed jam links', () => {
  // @scenario collab/jams: Bad slug
  it('serves not found for a malformed jam page', async () => {
    expect((await fetchApp('/jam/not-a-slug')).status).toBe(404)
  })

  // @scenario collab/jams: Bad slug
  it('refuses a board connection for a malformed slug, creating no board', async () => {
    const res = await fetchApp(boardPath('not-a-slug'), { headers: { Upgrade: 'websocket' } })
    expect(res.status).toBe(404)
    expect(res.webSocket).toBeNull()
    const ids = await listDurableObjectIds(env.Board)
    expect(ids.find((id) => id.equals(env.Board.idFromName('not-a-slug')))).toBeUndefined()
  })

  // @scenario collab/room: Plain request
  it('refuses parties other than board', async () => {
    const res = await fetchApp('/parties/other/funky-otter-k7q2', {
      headers: { Upgrade: 'websocket' },
    })
    expect(res.status).toBe(404)
  })

  // @scenario collab/room: Plain request
  it('refuses plain HTTP requests to a board', async () => {
    expect((await fetchApp(boardPath('funky-otter-k7q2'))).status).toBe(404)
  })
})

describe('board party name', () => {
  it('is the Board binding in kebab case, as partyserver routes it', () => {
    expect(BOARD_PARTY).toBe(BOARD_CLASS.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase())
    expect(env[BOARD_CLASS]).toBeDefined()
  })
})

describe('room', () => {
  // @scenario collab/room: Two people edit
  // @scenario collab/jams: Share the link
  it('syncs edits between two clients of the same jam, keeping concurrent edits', async () => {
    const a = await connectBoard('funky-otter-aaaa')
    const b = await connectBoard('funky-otter-aaaa')

    addTrack(a.doc, '1', 'Drums')
    addTrack(b.doc, '2', 'Bass')

    await until(() => names(a.doc).length === 2 && names(b.doc).length === 2)
    expect(names(a.doc)).toEqual(['Bass', 'Drums'])
    expect(names(b.doc)).toEqual(['Bass', 'Drums'])
    a.close()
    b.close()
  })

  // @scenario collab/room: Two jams
  it('keeps jams isolated', async () => {
    const a = await connectBoard('jazzy-panda-bbbb')
    const b = await connectBoard('jazzy-tuba-cccc')
    addTrack(a.doc, '1', 'Keys')
    const probe = await connectBoard('jazzy-panda-bbbb')
    await until(() => names(probe.doc).length === 1)
    expect(names(b.doc)).toEqual([])
    a.close()
    b.close()
    probe.close()
  })

  // @scenario collab/room: Come back later
  // @scenario collab/room: Server restart
  it('keeps the board after everyone leaves and the Durable Object restarts', async () => {
    const slug = 'mellow-whale-dddd'
    const a = await connectBoard(slug)
    addTrack(a.doc, '1', 'Pads')
    addTrack(a.doc, '2', 'Lead')
    addTrack(a.doc, '3', 'Vox')

    // The last client leaving triggers onSave; wait until the snapshot is in storage.
    const stub = env.Board.getByName(slug)
    const probe = await connectBoard(slug)
    await until(() => names(probe.doc).length === 3)
    a.close()
    probe.close()
    await until(async () => {
      const snapshot = await stubStorage(stub)
      if (!snapshot) return false
      const saved = new Y.Doc()
      Y.applyUpdate(saved, snapshot)
      return names(saved).length === 3
    })

    await evictDurableObject(stub, { webSockets: 'close' })

    const back = await connectBoard(slug)
    expect(names(back.doc)).toEqual(['Lead', 'Pads', 'Vox'])
    back.close()
  })
})

async function stubStorage(stub: DurableObjectStub) {
  const { runInDurableObject } = await import('cloudflare:test')
  return runInDurableObject(stub, (_instance, state) => state.storage.get<Uint8Array>('doc'))
}

describe('looper board', () => {
  const loop = (name: string): Track => ({
    name,
    author: 'a',
    color: 'teal',
    bars: 1,
    hits: [{ padId: 'r0c0', beat: 0 }],
    gain: 1,
    mute: false,
    quantize: 0.25,
    effects: [],
  })
  const loops = (doc: Y.Doc) =>
    [...doc.getMap<Y.Map<unknown>>(ROOTS.tracks).values()].map((t) => t.get('name')).sort()

  // @scenario collab/room: First open
  // @scenario collab/jams: Unused but well-formed link
  it('starts a new jam with the default tempo and 16 pads', async () => {
    const a = await connectBoard('sunny-bongo-eeee')
    expect(a.doc.getMap(ROOTS.meta).get('bpm')).toBe(100)
    expect(a.doc.getMap(ROOTS.pads).size).toBe(16)
    a.close()
  })

  // @scenario board/pads: New jam
  it('gives every pad of a new jam a kit sound, the kick on 1 and tonal sounds on ZXCV', async () => {
    const a = await connectBoard('sunny-bongo-ffff')
    const pads = [...a.doc.getMap<Y.Map<unknown>>(ROOTS.pads).values()]
    const soundOn = new Map(pads.map((p) => [String(p.get('key')), String(p.get('soundId'))]))
    const categoryOf = (key: string) => SOUNDS.find((s) => s.id === soundOn.get(key))?.category
    expect(soundOn.size).toBe(16)
    for (const id of soundOn.values()) expect(SOUNDS.map((s) => s.id)).toContain(id)
    expect(soundOn.get('1')).toBe('kick')
    expect([...'zxcv'].map(categoryOf)).toEqual(['tonal', 'tonal', 'tonal', 'tonal'])
    a.close()
  })

  // @scenario collab/room: Existing jam
  it('leaves a set tempo and reassigned pads alone when the jam is opened again', async () => {
    const slug = 'sunny-bongo-ex01'
    const a = await connectBoard(slug)
    apply(
      a.doc,
      [
        { op: 'setTempo', bpm: 120 },
        { op: 'assignPad', padId: 'r0c0', soundId: 'clap' },
      ],
      { kind: 'user', id: 'a' },
    )
    const stub = env.Board.getByName(slug)
    await until(async () => {
      const snapshot = await stubStorage(stub)
      if (!snapshot) return false
      const saved = new Y.Doc()
      Y.applyUpdate(saved, snapshot)
      return saved.getMap(ROOTS.meta).get('bpm') === 120
    })
    a.close()
    await evictDurableObject(stub, { webSockets: 'close' })

    const back = await connectBoard(slug)
    expect(back.doc.getMap(ROOTS.meta).get('bpm')).toBe(120)
    expect(back.doc.getMap<Y.Map<unknown>>(ROOTS.pads).get('r0c0')?.get('soundId')).toBe('clap')
    expect(back.doc.getMap(ROOTS.pads).size).toBe(16)
    back.close()
  })

  // @scenario audio/looper: Mute someone's loop
  it('keeps loops two people record at the same time, and syncs controls', async () => {
    const a = await connectBoard('sunny-bongo-ffff')
    const b = await connectBoard('sunny-bongo-ffff')
    apply(a.doc, [{ op: 'addTrack', id: '1', track: loop('A 1') }], { kind: 'user', id: 'a' })
    apply(b.doc, [{ op: 'addTrack', id: '2', track: loop('B 1') }], { kind: 'user', id: 'b' })
    await until(() => loops(a.doc).length === 2 && loops(b.doc).length === 2)
    expect(loops(b.doc)).toEqual(['A 1', 'B 1'])

    apply(b.doc, [{ op: 'setTrack', id: '1', patch: { mute: true } }], { kind: 'user', id: 'b' })
    await until(() => a.doc.getMap<Y.Map<unknown>>(ROOTS.tracks).get('1')?.get('mute') === true)
    a.close()
    b.close()
  })
})

describe('jam clock', () => {
  // @scenario collab/room: Clock request
  it('answers a ping, to the pinging client alone, with its timestamp and the room time', async () => {
    const a = await connectBoard('groovy-otter-gggg')
    const b = await connectBoard('groovy-otter-gggg')
    const before = Date.now()
    a.sendCustom(ping(12.5))
    await until(() => a.custom.length > 0)
    const msg = parseClockMessage(a.custom[0]!)
    expect(msg).toMatchObject({ t: 'pong', c: 12.5 })
    expect(msg?.t === 'pong' && msg.s).toBeGreaterThanOrEqual(before)
    a.sendCustom('not a clock message')
    await new Promise((r) => setTimeout(r, 50))
    expect(a.custom).toHaveLength(1)
    expect(b.custom).toEqual([])
    a.close()
    b.close()
  })
})

describe('seats', () => {
  const seatOf = (client: { custom: string[] }) => {
    const last = client.custom
      .map(parseSeatMessage)
      .filter((m) => m?.t === 'seat')
      .at(-1)
    return last?.t === 'seat' ? { name: last.name, color: last.color } : undefined
  }
  const join = async (slug: string, key: string, name = 'Groovy Otter') => {
    const c = await connectBoard(slug)
    c.sendCustom(hello(key, name, 'sky'))
    await until(() => seatOf(c) !== undefined)
    return c
  }

  // @scenario collab/room: Shared usual name and colour
  // @scenario board/session: Same usual name and colour
  it('seats people who share a usual name and colour with different ones', async () => {
    const a = await join('groovy-otter-mmmm', 'a')
    const b = await join('groovy-otter-mmmm', 'b')
    const c = await join('groovy-otter-mmmm', 'c')
    const seats = [a, b, c].map(seatOf)
    expect(seats.map((s) => s?.color)).toEqual(['sky', 'teal', 'coral'])
    expect(seats[0]?.name).toBe('Groovy Otter')
    expect(new Set(seats.map((s) => s?.name)).size).toBe(3)
    for (const x of [a, b, c]) x.close()
  })

  // @scenario collab/room: Second tab
  it('gives a second tab the name and colour the person already has', async () => {
    const a = await join('groovy-otter-nnnn', 'a')
    const b = await join('groovy-otter-nnnn', 'b')
    const b2 = await join('groovy-otter-nnnn', 'b')
    expect(seatOf(b2)).toEqual(seatOf(b))
    for (const x of [a, b, b2]) x.close()
  })

  // @scenario collab/room: Someone else's id
  it("seats by the private key, so asking with someone's public id gets a seat of your own", async () => {
    const a = await join('groovy-otter-qqqq', 'a-key')
    // Everyone in the jam sees Groovy Otter's public id, never their key.
    a.awareness.setLocalState({ person: { id: 'a-id', name: 'Groovy Otter', color: 'sky' } })
    const b = await join('groovy-otter-qqqq', 'a-id')
    expect(seatOf(a)).toEqual({ name: 'Groovy Otter', color: 'sky' })
    expect(seatOf(b)?.name).not.toBe('Groovy Otter')
    expect(seatOf(b)?.color).not.toBe('sky')
    a.close()
    b.close()
  })

  // @scenario collab/room: Someone leaves
  it('frees a name and colour when their person leaves', async () => {
    const a = await join('groovy-otter-pppp', 'a')
    a.close()
    await new Promise((r) => setTimeout(r, 50))
    const b = await join('groovy-otter-pppp', 'b')
    expect(seatOf(b)).toEqual({ name: 'Groovy Otter', color: 'sky' })
    b.close()
  })
})

describe('presence', () => {
  const people = (awareness: { getStates: () => Map<number, Record<string, unknown>> }) =>
    [...awareness.getStates().values()].map((s) => (s.person as { id?: string } | undefined)?.id)

  // @scenario collab/room: Leave
  // @scenario board/session: Someone joins
  // @scenario board/session: Someone leaves
  it('passes presence to everyone in the jam, and drops it when a client disconnects', async () => {
    const a = await connectBoard('groovy-panda-hhhh')
    const b = await connectBoard('groovy-panda-hhhh')
    a.awareness.setLocalState({ person: { id: 'a', color: 'teal' } })
    b.awareness.setLocalState({ person: { id: 'b', color: 'coral' } })
    await until(() => people(a.awareness).includes('b') && people(b.awareness).includes('a'))

    // A late joiner sees who is already here.
    const c = await connectBoard('groovy-panda-hhhh')
    await until(() => people(c.awareness).includes('a') && people(c.awareness).includes('b'))

    a.close()
    await until(() => !people(b.awareness).includes('a') && !people(c.awareness).includes('a'))
    b.close()
    c.close()
  })
})
