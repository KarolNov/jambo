import { evictDurableObject, listDurableObjectIds } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { apply, ROOTS, type Track } from '../shared/board'
import { BOARD_CLASS, BOARD_PARTY, boardPath } from '../shared/parties'
import { isJamSlug } from '../shared/slug'
import { parseClockMessage, ping } from '../shared/clock'
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

  it('creates a jam with a fresh slug', async () => {
    const res = await fetchApp('/api/jams', { method: 'POST' })
    expect(res.status).toBe(201)
    const { slug } = (await res.json()) as { slug: string }
    expect(isJamSlug(slug)).toBe(true)
  })
})

describe('malformed jam links', () => {
  it('serves not found for a malformed jam page', async () => {
    expect((await fetchApp('/jam/not-a-slug')).status).toBe(404)
  })

  it('refuses a board connection for a malformed slug, creating no board', async () => {
    const res = await fetchApp(boardPath('not-a-slug'), { headers: { Upgrade: 'websocket' } })
    expect(res.status).toBe(404)
    expect(res.webSocket).toBeNull()
    const ids = await listDurableObjectIds(env.Board)
    expect(ids.find((id) => id.equals(env.Board.idFromName('not-a-slug')))).toBeUndefined()
  })

  it('refuses parties other than board', async () => {
    const res = await fetchApp('/parties/other/funky-otter-k7q2', {
      headers: { Upgrade: 'websocket' },
    })
    expect(res.status).toBe(404)
  })

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

  it('starts a new jam with the default tempo and 16 pads', async () => {
    const a = await connectBoard('sunny-bongo-eeee')
    expect(a.doc.getMap(ROOTS.meta).get('bpm')).toBe(100)
    expect(a.doc.getMap(ROOTS.pads).size).toBe(16)
    a.close()
  })

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

describe('presence', () => {
  const people = (awareness: { getStates: () => Map<number, Record<string, unknown>> }) =>
    [...awareness.getStates().values()].map((s) => (s.person as { id?: string } | undefined)?.id)

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
