import { read } from 'duratom/core'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  apply,
  board,
  CONTROL_KEYS,
  FX_MODES,
  fxOn,
  LIMITS,
  MASTER_DEFAULTS,
  MASTER_KNOBS,
  masterOf,
  Meta,
  Pad,
  ROOTS,
  SHAPES,
  Sound,
  SOUND_KNOB_NAMES,
  SOUND_KNOBS,
  soundOf,
  Track,
  type Op,
} from '../shared/board'
import { isUploadId, newUploadId, SOUNDS, UPLOADS } from '../shared/sounds'
import { docAtom } from 'duratom'
import { createStore } from 'jotai'
import { masterAtom, tracksAtom } from '../src/board/model'

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

  // @scenario board/ops: Mute and rename
  it('sets mute and name without touching the hits', () => {
    const doc = seededDoc()
    const hits = [
      { padId: 'r0c0', beat: 0 },
      { padId: 'r0c0', beat: 2.5 },
    ]
    apply(doc, [{ op: 'addTrack', id: 't1', track: track({ hits }) }], me)
    const [r] = apply(doc, [{ op: 'setTrack', id: 't1', patch: { mute: true, name: 'Beat' } }], me)
    expect(r?.ok).toBe(true)
    expect(v(readTrack(doc, 't1'))).toMatchObject({ mute: true, name: 'Beat', hits })
  })

  // @scenario board/ops: Full jam
  it('refuses a track past the 32-track limit', () => {
    const doc = seededDoc()
    const adds: Op[] = Array.from({ length: LIMITS.tracks }, (_, i) => ({
      op: 'addTrack',
      id: `t${i}`,
      track: track(),
    }))
    expect(apply(doc, adds, me).every((r) => r.ok)).toBe(true)
    const [r] = apply(doc, [{ op: 'addTrack', id: 'one-more', track: track() }], me)
    expect(r?.ok).toBe(false)
    expect(tracksOf(doc).size).toBe(LIMITS.tracks)
    expect(tracksOf(doc).has('one-more')).toBe(false)
  })

  // @scenario audio/looper: Two people record
  it('keeps takes two people add at the same time', () => {
    const a = seededDoc()
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    const misty = { kind: 'user', id: 'misty' } as const
    apply(a, [{ op: 'addTrack', id: 'ta', track: track({ name: 'Groovy Otter 1' }) }], me)
    apply(
      b,
      [{ op: 'addTrack', id: 'tb', track: track({ name: 'Misty Yak 1', author: 'misty' }) }],
      misty,
    )
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    for (const doc of [a, b]) {
      expect(v(readTrack(doc, 'ta'))).toMatchObject({ name: 'Groovy Otter 1', author: 'me' })
      expect(v(readTrack(doc, 'tb'))).toMatchObject({ name: 'Misty Yak 1', author: 'misty' })
    }
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

  // @scenario board/session: One bad operation in a batch
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

  // @scenario board/ops: Hit outside the loop
  // @scenario board/ops: Remove a missing track
  // @scenario board/ops: Unknown sound
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

  // @scenario board/ops: Locked
  it('locks the tempo while the jam has tracks', () => {
    const doc = seededDoc()
    apply(doc, [{ op: 'addTrack', id: 't1', track: track() }], me)
    const [result] = apply(doc, [{ op: 'setTempo', bpm: 90 }], me)
    expect(result).toMatchObject({
      ok: false,
      issues: [{ message: expect.stringContaining('locked') }],
    })
  })

  // @scenario board/ops: Unreadable track
  it('does not let unreadable tracks lock the tempo', () => {
    const doc = seededDoc()
    const legacy = new Y.Map<unknown>()
    legacy.set('name', new Y.Text('old toy track'))
    tracksOf(doc).set('legacy', legacy)
    expect(apply(doc, [{ op: 'setTempo', bpm: 90 }], me)).toEqual([{ ok: true }])
  })

  // @scenario board/ops: Batch with origin
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

  // @scenario board/ops: Replay
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

describe('sound knobs', () => {
  // @scenario audio/looper: Older jam
  it('reads a track without knobs at the defaults, so older jams sound the same', () => {
    const doc = seededDoc()
    apply(doc, [{ op: 'addTrack', id: 't1', track: track() }], me)
    const t = v(readTrack(doc, 't1'))!
    expect(t.reverb).toBeUndefined()
    expect(soundOf(t)).toEqual({ reverb: 0, echo: 0, tone: 0, pitch: 0, pan: 0 })
    for (const k of SOUND_KNOB_NAMES) expect(soundOf(t)[k]).toBe(SOUND_KNOBS[k].default)
  })

  it('adds a track with knobs and fills only the missing ones with defaults', () => {
    const doc = seededDoc()
    const [result] = apply(
      doc,
      [{ op: 'addTrack', id: 't1', track: track({ echo: 0.4, pan: 0.5 }) }],
      me,
    )
    expect(result).toEqual({ ok: true })
    const t = v(readTrack(doc, 't1'))!
    expect(t).toMatchObject({ echo: 0.4, pan: 0.5 })
    expect(soundOf(t)).toEqual({ reverb: 0, echo: 0.4, tone: 0, pitch: 0, pan: 0.5 })
  })

  // @scenario board/ops: Set sound knobs
  it('sets knobs and leaves the other settings as they were', () => {
    const doc = seededDoc()
    apply(doc, [{ op: 'addTrack', id: 't1', track: track({ gain: 0.8, tone: -0.4 }) }], me)
    const before = v(readTrack(doc, 't1'))!
    expect(board(doc, me).track('t1').set({ reverb: 0.5, pan: -0.3 })).toEqual({ ok: true })
    expect(v(readTrack(doc, 't1'))).toEqual({ ...before, reverb: 0.5, pan: -0.3 })
  })

  it('takes every knob at both ends of its range', () => {
    const doc = seededDoc()
    apply(doc, [{ op: 'addTrack', id: 't1', track: track() }], me)
    for (const k of SOUND_KNOB_NAMES) {
      const { min, max } = SOUND_KNOBS[k]
      expect(
        board(doc, me)
          .track('t1')
          .set({ [k]: min }),
      ).toEqual({ ok: true })
      expect(
        board(doc, me)
          .track('t1')
          .set({ [k]: max }),
      ).toEqual({ ok: true })
      expect(v(readTrack(doc, 't1'))?.[k]).toBe(max)
    }
  })

  // @scenario board/ops: Pitch out of range
  it.each([
    ['reverb', -0.1],
    ['reverb', 1.1],
    ['echo', 2],
    ['tone', -1.5],
    ['pan', 1.01],
    ['pitch', 13],
    ['pitch', -13],
    ['pitch', 2.5],
  ] as const)('refuses %s %s and keeps the track as it was', (k, value) => {
    const doc = seededDoc()
    apply(doc, [{ op: 'addTrack', id: 't1', track: track({ pitch: 3 }) }], me)
    const before = Y.encodeStateAsUpdate(doc)
    const [set] = apply(doc, [{ op: 'setTrack', id: 't1', patch: { [k]: value } }], me)
    expect(set?.ok).toBe(false)
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
    expect(v(readTrack(doc, 't1'))?.pitch).toBe(3)
    const [add] = apply(doc, [{ op: 'addTrack', id: 't2', track: track({ [k]: value }) }], me)
    expect(add?.ok).toBe(false)
    expect(tracksOf(doc).has('t2')).toBe(false)
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

  // @scenario board/ops: Upload
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

  it("keeps the uploader's name, and reads sounds uploaded before names", () => {
    const doc = seededDoc()
    const named = sound({ authorName: 'Groovy Otter' })
    const results = apply(
      doc,
      [
        { op: 'addSound', id, sound: named },
        { op: 'addSound', id: 'u-bbbbbbbbbbbb', sound: sound() },
        { op: 'addSound', id: 'u-cccccccccccc', sound: sound({ authorName: 'x'.repeat(41) }) },
      ],
      room,
    )
    expect(results.map((r) => r.ok)).toEqual([true, true, false])
    expect(v(read(Sound, SHAPES.sound, soundsOf(doc).get(id)))).toEqual(named)
    expect(
      v(read(Sound, SHAPES.sound, soundsOf(doc).get('u-bbbbbbbbbbbb')))?.authorName,
    ).toBeUndefined()
  })

  it('refuses a pad on an upload the jam does not list', () => {
    const doc = seededDoc()
    const [r] = apply(doc, [{ op: 'assignPad', padId: 'r0c0', soundId: id }], me)
    expect(r?.ok).toBe(false)
    expect(padSound(doc, 'r0c0')).toBe('kick')
  })

  // @scenario board/ops: Kit id
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

  // @scenario audio/sounds: In use
  // @scenario board/ops: Remove in use
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

  // @scenario board/ops: Two pads
  it('moves both pads on an upload to the clap in one change', () => {
    const doc = twoPadDoc()
    const hat = new Y.Map<unknown>()
    for (const [k, val] of Object.entries({ row: 0, col: 2, key: '3', soundId: 'hat' }))
      hat.set(k, val)
    doc.getMap(ROOTS.pads).set('r0c2', hat)
    apply(
      doc,
      [
        { op: 'addSound', id, sound: sound() },
        { op: 'assignPad', padId: 'r0c0', soundId: id },
        { op: 'assignPad', padId: 'r0c1', soundId: id },
      ],
      room,
    )
    let changes = 0
    doc.on('afterTransaction', () => changes++)
    expect(board(doc, me).replaceSound(id, 'clap')).toEqual({ ok: true })
    expect(changes).toBe(1)
    expect(padSound(doc, 'r0c0')).toBe('clap')
    expect(padSound(doc, 'r0c1')).toBe('clap')
    expect(padSound(doc, 'r0c2')).toBe('hat')
  })

  // @scenario board/ops: Replace with an unknown sound
  it('refuses to replace a sound with one the jam does not list, even with no pad on it', () => {
    const doc = seededDoc()
    expect(board(doc, me).replaceSound('u-unusedunused', id).ok).toBe(false)
  })

  // @scenario board/ops: Not the room
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

describe('board model', () => {
  // @scenario board/session: Malformed track in the doc
  it('shows only the tracks that pass the schema', () => {
    const doc = seededDoc()
    apply(
      doc,
      [
        { op: 'addTrack', id: 'good', track: track() },
        { op: 'addTrack', id: 'bad', track: track({ name: 'Broken' }) },
      ],
      me,
    )
    // A peer with an older or buggy client stored a track with no hits.
    tracksOf(doc).get('bad')!.set('hits', [])
    const store = createStore()
    store.set(docAtom, doc)
    expect([...store.get(tracksAtom).keys()]).toEqual(['good'])
  })
})

describe('master settings', () => {
  const masterOfDoc = (doc: Y.Doc) => masterOf(doc.getArray(ROOTS.master))
  const entries = (doc: Y.Doc) =>
    doc
      .getArray<{ key: string }>(ROOTS.master)
      .toArray()
      .map((e) => e.key)

  it('reads every default from a jam with no master entries', () => {
    expect(masterOfDoc(new Y.Doc())).toEqual(MASTER_DEFAULTS)
    for (const [k, { default: d }] of Object.entries(MASTER_KNOBS))
      expect(MASTER_DEFAULTS[k as keyof typeof MASTER_KNOBS]).toBe(d)
    for (const m of Object.keys(FX_MODES))
      expect(MASTER_DEFAULTS[m as keyof typeof FX_MODES]).toMatchObject({ x: 0, y: 0 })
  })

  // @scenario board/ops: Set the drive
  it('sets one master knob and leaves the others', () => {
    const doc = new Y.Doc()
    const b = board(doc, me)
    expect(b.master({ tone: -0.6, swing: 0.5 }).ok).toBe(true)
    expect(b.master({ drive: 0.4 }).ok).toBe(true)
    expect(masterOfDoc(doc)).toEqual({ ...MASTER_DEFAULTS, tone: -0.6, swing: 0.5, drive: 0.4 })
  })

  it('refuses a knob out of range or unknown, changing nothing', () => {
    const doc = new Y.Doc()
    const b = board(doc, me)
    b.master({ width: 0.5 })
    const out = apply(doc, [{ op: 'setMaster', set: { width: -1, drive: 1.5 } }], me)[0]!
    expect(out.ok).toBe(false)
    expect(!out.ok && out.issues[0]!.path).toEqual(['set', 'drive'])
    expect(apply(doc, [{ op: 'setMaster', set: { volume: 1 } }], me)[0]!.ok).toBe(false)
    expect(apply(doc, [{ op: 'setMaster', set: { filter: 0 } }], me)[0]!.ok).toBe(false)
    expect(masterOfDoc(doc).width).toBe(0.5)
  })

  it('counts a touchpad mode on only where it sounds', () => {
    expect(fxOn('filter', { x: 0, y: 0.5 })).toBe(false)
    expect(fxOn('filter', { x: -0.01, y: 0 })).toBe(true)
    expect(fxOn('lofi', { x: 0, y: 0.5 })).toBe(true)
    expect(fxOn('repeat', { x: 0.5, y: 0 })).toBe(false)
  })

  it('sets and resets a touchpad mode', () => {
    const doc = new Y.Doc()
    const b = board(doc, me)
    expect(b.fx('filter').set(-0.4, 0.3).ok).toBe(true)
    expect(b.fx('lofi').set(0.7, 0.8).ok).toBe(true)
    expect(masterOfDoc(doc).filter).toEqual({ x: -0.4, y: 0.3 })
    expect(b.fx('lofi').reset().ok).toBe(true)
    expect(masterOfDoc(doc).lofi).toEqual({ x: 0, y: 0 })
    expect(masterOfDoc(doc).filter).toEqual({ x: -0.4, y: 0.3 })
  })

  // @scenario board/ops: Out of range
  it('refuses a mode position out of range or an unknown mode', () => {
    const doc = new Y.Doc()
    const b = board(doc, me)
    b.fx('filter').set(0.2, 0)
    expect(b.fx('filter').set(-1.5, 0).ok).toBe(false)
    expect(b.fx('throw').set(-0.1, 0).ok).toBe(false)
    expect(apply(doc, [{ op: 'setFx', mode: 'chorus', x: 0, y: 0 }], me)[0]!.ok).toBe(false)
    expect(masterOfDoc(doc).filter).toEqual({ x: 0.2, y: 0 })
    expect(masterOfDoc(doc).throw).toEqual({ x: 0, y: 0 })
  })

  it('stores the start beat for repeat only, keeping it when left out', () => {
    const doc = new Y.Doc()
    const b = board(doc, me)
    expect(b.fx('repeat').set(0.1, 1, 12).ok).toBe(true)
    expect(b.fx('repeat').set(0.6, 1).ok).toBe(true)
    expect(masterOfDoc(doc).repeat).toEqual({ x: 0.6, y: 1, startBeat: 12 })
    expect(b.fx('repeat').set(0, 0, -1).ok).toBe(false)
    expect(b.fx('filter').set(0, 0, 4).ok).toBe(false)
  })

  it('takes a start beat counted from the epoch, on the 16th grid', () => {
    const b = board(new Y.Doc(), me)
    // Jam beats now at the fastest tempo run to about 7e9.
    expect(b.fx('repeat').set(0.1, 1, 7_041_234_567.75).ok).toBe(true)
    expect(b.fx('repeat').set(0.1, 1, 7_041_234_567.7).ok).toBe(false)
  })

  // @scenario board/ops: Two controls at once
  it('keeps concurrent changes to different controls, last write wins on the same one', () => {
    const a = new Y.Doc()
    const c = new Y.Doc()
    board(a, me).fx('filter').set(-0.5, 0)
    Y.applyUpdate(c, Y.encodeStateAsUpdate(a))
    // Offline: each changes a different control, and both change drive.
    board(a, me).fx('filter').set(-0.8, 0.2)
    board(a, me).master({ drive: 0.2 })
    board(c, me).fx('throw').set(0.9, 0.8)
    board(c, me).master({ drive: 0.7 })
    Y.applyUpdate(a, Y.encodeStateAsUpdate(c))
    Y.applyUpdate(c, Y.encodeStateAsUpdate(a))
    const ma = masterOfDoc(a)
    expect(ma).toEqual(masterOfDoc(c))
    expect(ma.filter).toEqual({ x: -0.8, y: 0.2 })
    expect(ma.throw).toEqual({ x: 0.9, y: 0.8 })
    expect([0.2, 0.7]).toContain(ma.drive)
    // Both drives stay until the next write to drive, which drops the older one.
    board(a, me).master({ drive: 0.5 })
    Y.applyUpdate(c, Y.encodeStateAsUpdate(a))
    expect(masterOfDoc(c).drive).toBe(0.5)
    expect(entries(a).sort()).toEqual(['drive', 'filter', 'throw'])
    expect(entries(c).sort()).toEqual(['drive', 'filter', 'throw'])
  })

  // @scenario board/ops: Lots of moves
  it('stores one entry per control after many moves', () => {
    const doc = new Y.Doc()
    const b = board(doc, me)
    for (let i = 0; i <= 200; i++) {
      b.fx('filter').set(i % 2 ? -0.5 : 0.5, i / 200)
      b.fx('throw').set(i / 200, 0.5)
      b.master({ tone: i % 2 ? -1 : 1 })
    }
    expect(entries(doc).sort()).toEqual(['filter', 'throw', 'tone'])
    expect(masterOfDoc(doc)).toMatchObject({
      tone: 1,
      filter: { x: 0.5, y: 1 },
      throw: { x: 1, y: 0.5 },
    })
  })

  it('reads the current entry per key, and an unreadable one as its default', () => {
    const doc = new Y.Doc()
    doc.getArray(ROOTS.master).push([
      { key: 'tone', val: -0.5 },
      { key: 'swing', val: 0.3 },
      { key: 'swing', val: 7 },
      { key: 'filter', val: { x: 'left' } },
      { key: 'volume', val: 1 },
    ])
    expect(masterOfDoc(doc)).toEqual({ ...MASTER_DEFAULTS, tone: -0.5 })
    // Writing a valid value repairs it.
    board(doc, me).master({ swing: 0.4 })
    expect(masterOfDoc(doc).swing).toBe(0.4)
    expect(masterOf(undefined)).toEqual(MASTER_DEFAULTS)
  })

  // @scenario audio/master: Older jam
  it('masterAtom reads defaults, then follows changes', () => {
    const doc = seededDoc()
    const store = createStore()
    store.set(docAtom, doc)
    expect(store.get(masterAtom)).toEqual(MASTER_DEFAULTS)
    store.sub(masterAtom, () => {})
    board(doc, me).master({ swing: 0.5 })
    board(doc, me).fx('filter').set(-0.4, 0)
    expect(store.get(masterAtom)).toEqual({
      ...MASTER_DEFAULTS,
      swing: 0.5,
      filter: { x: -0.4, y: 0 },
    })
  })

  it('names master knobs and modes for presence apart from loops', () => {
    expect(CONTROL_KEYS.master('tone')).toBe('master.tone')
    expect(CONTROL_KEYS.fx('filter')).toBe('fx.filter')
    expect(CONTROL_KEYS.track('0abc-12', 'reverb')).toBe('track.0abc-12.reverb')
    expect(CONTROL_KEYS.track('master', 'tone')).not.toBe(CONTROL_KEYS.master('tone'))
  })
})
