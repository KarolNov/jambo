import { read } from 'duratom/core'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { apply, board, Meta, Pad, ROOTS, SHAPES, Sound, Track, type Op } from '../shared/board'
import { isUploadId, newUploadId, SOUNDS, UPLOADS } from '../shared/sounds'

const me = { kind: 'user', id: 'me' } as const

const track = (over: Partial<Track> = {}): Track => ({
  name: 'Teal 1',
  author: 'me',
  color: 'teal',
  bars: 1,
  hits: [{ padId: 'r0c0', beat: 0 }],
  gain: 1,
  mute: false,
  quantize: 0.25,
  effects: [],
  ...over,
})

function seededDoc() {
  const doc = new Y.Doc()
  const pads = doc.getMap(ROOTS.pads)
  const pad = new Y.Map<unknown>()
  for (const [k, v] of Object.entries({ row: 0, col: 0, key: '1', soundId: 'kick' })) pad.set(k, v)
  pads.set('r0c0', pad)
  return doc
}

/** The value of a schema result, or undefined when missing or invalid. */
const v = <T>(r: { value: T } | { issues: unknown } | undefined): T | undefined =>
  r && 'value' in r ? r.value : undefined

const tracksOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>(ROOTS.tracks)
const readTrack = (doc: Y.Doc, id: string) => read(Track, SHAPES.track, tracksOf(doc).get(id))

describe('apply', () => {
  it('applies valid operations', () => {
    const doc = seededDoc()
    const results = apply(
      doc,
      [
        { op: 'setTempo', bpm: 120 },
        { op: 'assignPad', padId: 'r0c0', soundId: 'snare' },
        { op: 'addTrack', id: 't1', track: track() },
        { op: 'setTrack', id: 't1', patch: { mute: true, name: 'Beat' } },
      ],
      me,
    )
    expect(results.every((r) => r.ok)).toBe(true)
    expect(v(read(Meta, SHAPES.meta, doc.getMap(ROOTS.meta)))).toEqual({ bpm: 120 })
    expect(
      v(read(Pad, SHAPES.pad, doc.getMap<Y.Map<unknown>>(ROOTS.pads).get('r0c0')))?.soundId,
    ).toBe('snare')
    expect(v(readTrack(doc, 't1'))).toMatchObject({ mute: true, name: 'Beat' })
  })

  it('stores colours by name, reads legacy hexes as names, and refuses anything else', () => {
    const doc = seededDoc()
    const results = apply(
      doc,
      [
        { op: 'addTrack', id: 't1', track: track() },
        { op: 'addTrack', id: 't2', track: track({ color: 'pink' }) },
        { op: 'addTrack', id: 't3', track: track({ color: '#123456' as never }) },
      ],
      me,
    )
    expect(results.map((r) => r.ok)).toEqual([true, true, false])
    expect(v(readTrack(doc, 't1'))?.color).toBe('teal')
    expect(v(readTrack(doc, 't2'))?.color).toBe('pink')
    expect(tracksOf(doc).has('t3')).toBe(false)
    // Jams recorded before colour names hold a hex; it reads as its name.
    tracksOf(doc).get('t1')!.set('color', '#2AB7CA')
    expect(v(readTrack(doc, 't1'))?.color).toBe('teal')
  })

  it('keeps the jam bar a track was recorded on, which no patch can change', () => {
    const doc = seededDoc()
    const results = apply(
      doc,
      [
        { op: 'addTrack', id: 't1', track: track({ startBar: 897_500_123 }) },
        { op: 'addTrack', id: 't2', track: track() },
        { op: 'setTrack', id: 't1', patch: { startBar: 4, gain: 0.5 } },
      ],
      me,
    )
    expect(results.every((r) => r.ok)).toBe(true)
    expect(v(readTrack(doc, 't1'))).toMatchObject({ startBar: 897_500_123, gain: 0.5 })
    expect(v(readTrack(doc, 't2'))?.startBar).toBeUndefined()
  })

  it.each([-1, 2.5])('rejects a track starting on jam bar %s', (startBar) => {
    const [result] = apply(
      seededDoc(),
      [{ op: 'addTrack', id: 't1', track: track({ startBar }) }],
      me,
    )
    expect(result?.ok).toBe(false)
  })

  it('rejects a bad operation and still applies the rest of the batch', () => {
    const doc = seededDoc()
    apply(doc, [{ op: 'addTrack', id: 't1', track: track() }], me)
    const results = apply(
      doc,
      [
        { op: 'addTrack', id: 't2', track: track() },
        { op: 'setTrack', id: 't1', patch: { gain: -1 } },
      ],
      me,
    )
    expect(results[0]).toEqual({ ok: true })
    expect(results[1]?.ok).toBe(false)
    expect(v(readTrack(doc, 't2'))).toBeDefined()
    expect(v(readTrack(doc, 't1'))?.gain).toBe(1)
  })

  it.each([
    ['unknown op', { op: 'explode' }],
    [
      'hit outside the track',
      { op: 'addTrack', id: 'x', track: track({ hits: [{ padId: 'r0c0', beat: 4 }] }) },
    ],
    ['empty track', { op: 'addTrack', id: 'x', track: track({ hits: [] }) }],
    ['blank name', { op: 'setTrack', id: 't1', patch: { name: '  ' } }],
    ['unknown quantize', { op: 'setTrack', id: 't1', patch: { quantize: 0.3 } }],
    ['missing track', { op: 'removeTrack', id: 'nope' }],
    ['missing pad', { op: 'assignPad', padId: 'nope', soundId: 'kick' }],
    ['unknown sound', { op: 'assignPad', padId: 'r0c0', soundId: 'kik' }],
    ['tempo out of range', { op: 'setTempo', bpm: 400 }],
  ])('rejects %s and changes nothing', (_name, op) => {
    const doc = seededDoc()
    apply(doc, [{ op: 'addTrack', id: 't1', track: track() }], me)
    const before = Y.encodeStateAsUpdate(doc)
    const [result] = apply(doc, [op], me)
    expect(result?.ok).toBe(false)
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
  })

  it('locks the tempo while the jam has tracks', () => {
    const doc = seededDoc()
    apply(doc, [{ op: 'addTrack', id: 't1', track: track() }], me)
    const [result] = apply(doc, [{ op: 'setTempo', bpm: 90 }], me)
    expect(result).toMatchObject({
      ok: false,
      issues: [{ message: expect.stringContaining('locked') }],
    })
  })

  it('does not let unreadable tracks lock the tempo', () => {
    const doc = seededDoc()
    const legacy = new Y.Map<unknown>()
    legacy.set('name', new Y.Text('old toy track'))
    tracksOf(doc).set('legacy', legacy)
    expect(apply(doc, [{ op: 'setTempo', bpm: 90 }], me)).toEqual([{ ok: true }])
  })

  it('writes a batch as one transaction tagged with its origin', () => {
    const doc = seededDoc()
    const origins: unknown[] = []
    doc.on('afterTransaction', (tr) => origins.push(tr.origin))
    apply(
      doc,
      [
        { op: 'addTrack', id: 't1', track: track() },
        { op: 'addTrack', id: 't2', track: track() },
        { op: 'setTrack', id: 't1', patch: { gain: 0.5 } },
      ],
      me,
    )
    expect(origins).toEqual([me])
  })

  it('replays the same operations to the same board', () => {
    const ops: Op[] = [
      { op: 'setTempo', bpm: 90 },
      { op: 'addTrack', id: 't1', track: track() },
      { op: 'setTrack', id: 't1', patch: { quantize: 0 } },
      { op: 'addTrack', id: 't2', track: track({ bars: 2 }) },
      { op: 'removeTrack', id: 't1' },
    ]
    const a = seededDoc()
    const b = seededDoc()
    apply(a, ops, me)
    apply(b, ops, me)
    expect(a.getMap(ROOTS.tracks).toJSON()).toEqual(b.getMap(ROOTS.tracks).toJSON())
    expect(a.getMap(ROOTS.meta).toJSON()).toEqual(b.getMap(ROOTS.meta).toJSON())
  })
})

describe('board SDK', () => {
  it('emits one documented operation per method', () => {
    const doc = seededDoc()
    const seen: unknown[] = []
    doc.on('afterTransaction', (tr) => seen.push(tr.origin))
    const b = board(doc, me)
    expect(b.tempo(110)).toEqual({ ok: true })
    expect(b.pad('r0c0').assign('clap')).toEqual({ ok: true })
    expect(b.addTrack('t1', track())).toEqual({ ok: true })
    expect(b.track('t1').set({ mute: true })).toEqual({ ok: true })
    expect(b.track('t1').remove()).toEqual({ ok: true })
    expect(seen).toHaveLength(5)
    expect(tracksOf(doc).size).toBe(0)
  })
})

const sound = (over: Partial<Sound> = {}): Sound => ({
  name: 'Vox',
  author: 'me',
  color: 'teal',
  durationMs: 1200,
  bytes: 105_884,
  createdAt: 1_700_000_000_000,
  ...over,
})

const room = { kind: 'system', id: 'room' } as const
const soundsOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>(ROOTS.sounds)
const padSound = (doc: Y.Doc, id: string) =>
  v(read(Pad, SHAPES.pad, doc.getMap<Y.Map<unknown>>(ROOTS.pads).get(id)))?.soundId

function twoPadDoc() {
  const doc = seededDoc()
  const pad = new Y.Map<unknown>()
  for (const [k, val] of Object.entries({ row: 0, col: 1, key: '2', soundId: 'snare' }))
    pad.set(k, val)
  doc.getMap(ROOTS.pads).set('r0c1', pad)
  return doc
}

describe('upload ids', () => {
  it('never look like a kit id', () => {
    expect(SOUNDS.filter((s) => isUploadId(s.id))).toEqual([])
  })

  it('are fresh each time', () => {
    const ids = new Set(Array.from({ length: 1000 }, newUploadId))
    expect(ids.size).toBe(1000)
    expect([...ids].every(isUploadId)).toBe(true)
  })
})

describe('uploaded sounds', () => {
  const id = 'u-abcdefgh2345'

  it('lists an upload, which a pad can then play', () => {
    const doc = seededDoc()
    const results = apply(
      doc,
      [
        { op: 'addSound', id, sound: sound() },
        { op: 'assignPad', padId: 'r0c0', soundId: id },
      ],
      room,
    )
    expect(results.every((r) => r.ok)).toBe(true)
    expect(v(read(Sound, SHAPES.sound, soundsOf(doc).get(id)))).toEqual(sound())
    expect(padSound(doc, 'r0c0')).toBe(id)
  })

  it('refuses a pad on an upload the jam does not list', () => {
    const doc = seededDoc()
    const [r] = apply(doc, [{ op: 'assignPad', padId: 'r0c0', soundId: id }], me)
    expect(r?.ok).toBe(false)
    expect(padSound(doc, 'r0c0')).toBe('kick')
  })

  it.each(['kick', 'u-short', 'U-ABCDEFGH2345'])(
    'refuses to list an upload with the id %s',
    (bad) => {
      const [r] = apply(seededDoc(), [{ op: 'addSound', id: bad, sound: sound() }], room)
      expect(r?.ok).toBe(false)
    },
  )

  it('refuses a duplicate id and an invalid sound', () => {
    const doc = seededDoc()
    const results = apply(
      doc,
      [
        { op: 'addSound', id, sound: sound() },
        { op: 'addSound', id, sound: sound({ name: 'Other' }) },
        { op: 'addSound', id: 'u-bbbbbbbbbbbb', sound: sound({ durationMs: 10_001 }) },
        { op: 'addSound', id: 'u-cccccccccccc', sound: sound({ bytes: UPLOADS.maxBytes + 1 }) },
      ],
      room,
    )
    expect(results.map((r) => r.ok)).toEqual([true, false, false, false])
    expect([...soundsOf(doc).keys()]).toEqual([id])
  })

  it(`holds at most ${UPLOADS.perJam} uploads`, () => {
    const doc = seededDoc()
    const ops: Op[] = Array.from({ length: UPLOADS.perJam + 1 }, (_, i) => ({
      op: 'addSound',
      id: `u-${'a'.repeat(10)}${'abcdefghijklmnopqrstuvwxyz234567'[i >> 5]}${'abcdefghijklmnopqrstuvwxyz234567'[i & 31]}`,
      sound: sound(),
    }))
    const results = apply(doc, ops, room)
    expect(results.filter((r) => r.ok)).toHaveLength(UPLOADS.perJam)
    expect(results.at(-1)?.ok).toBe(false)
  })

  it('refuses to remove an upload a pad uses, naming the pads', () => {
    const doc = twoPadDoc()
    apply(
      doc,
      [
        { op: 'addSound', id, sound: sound() },
        { op: 'assignPad', padId: 'r0c1', soundId: id },
        { op: 'assignPad', padId: 'r0c0', soundId: id },
      ],
      room,
    )
    const [r] = apply(doc, [{ op: 'removeSound', id }], room)
    expect(r).toEqual({
      ok: false,
      issues: [{ message: `Sound ${id} is on pads 1, 2`, path: ['id'] }],
    })
    expect(soundsOf(doc).has(id)).toBe(true)
  })

  it('removes an unused upload, and refuses a missing one', () => {
    const doc = seededDoc()
    apply(doc, [{ op: 'addSound', id, sound: sound() }], room)
    const results = apply(
      doc,
      [
        { op: 'removeSound', id },
        { op: 'removeSound', id },
      ],
      room,
    )
    expect(results.map((r) => r.ok)).toEqual([true, false])
    expect(soundsOf(doc).size).toBe(0)
  })

  it('expires every upload, leaving pads on them unknown', () => {
    const doc = seededDoc()
    apply(
      doc,
      [
        { op: 'addSound', id, sound: sound() },
        { op: 'addSound', id: 'u-bbbbbbbbbbbb', sound: sound() },
        { op: 'assignPad', padId: 'r0c0', soundId: id },
        { op: 'expireSounds' },
      ],
      room,
    )
    expect(soundsOf(doc).size).toBe(0)
    expect(padSound(doc, 'r0c0')).toBe(id)
    const [r] = apply(doc, [{ op: 'assignPad', padId: 'r0c0', soundId: id }], me)
    expect(r?.ok).toBe(false)
  })

  it('replaces a sound on every pad that uses it, in one change', () => {
    const doc = twoPadDoc()
    const next = 'u-bbbbbbbbbbbb'
    apply(
      doc,
      [
        { op: 'addSound', id, sound: sound() },
        { op: 'addSound', id: next, sound: sound({ name: 'Vox 2' }) },
        { op: 'assignPad', padId: 'r0c0', soundId: id },
      ],
      room,
    )
    let changes = 0
    doc.on('afterTransaction', () => changes++)
    const result = board(doc, me).replaceSound(id, next)
    expect(result).toEqual({ ok: true })
    expect(changes).toBe(1)
    expect(padSound(doc, 'r0c0')).toBe(next)
    expect(padSound(doc, 'r0c1')).toBe('snare')
  })

  it('refuses to replace a sound with one the jam does not list, even with no pad on it', () => {
    const doc = seededDoc()
    expect(board(doc, me).replaceSound('u-unusedunused', id).ok).toBe(false)
  })

  it('lets only the room change the uploads list', () => {
    const doc = seededDoc()
    apply(doc, [{ op: 'addSound', id, sound: sound() }], room)
    const results = board(doc, me).apply([
      { op: 'addSound', id: 'u-bbbbbbbbbbbb', sound: sound() },
      { op: 'removeSound', id },
      { op: 'expireSounds' },
    ])
    expect(results.map((r) => r.ok)).toEqual([false, false, false])
    expect([...soundsOf(doc).keys()]).toEqual([id])
  })

  it('refuses to remove an upload an unreadable pad still names', () => {
    const doc = seededDoc()
    apply(
      doc,
      [
        { op: 'addSound', id, sound: sound() },
        { op: 'assignPad', padId: 'r0c0', soundId: id },
      ],
      room,
    )
    doc.getMap<Y.Map<unknown>>(ROOTS.pads).get('r0c0')!.set('row', 99)
    const [r] = apply(doc, [{ op: 'removeSound', id }], room)
    expect(r?.ok).toBe(false)
    expect(soundsOf(doc).has(id)).toBe(true)
  })
})
