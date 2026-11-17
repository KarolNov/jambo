import { evictDurableObject, listDurableObjectIds } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { BOARD_CLASS, BOARD_PARTY, boardPath } from '../shared/parties'
import { isJamSlug } from '../shared/slug'
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
