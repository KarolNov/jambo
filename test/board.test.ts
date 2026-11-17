import { read } from 'duratom/core'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { apply, board, Meta, Pad, ROOTS, SHAPES, Track, type Op } from '../shared/board'

const me = { kind: 'user', id: 'me' } as const

const track = (over: Partial<Track> = {}): Track => ({
  name: 'Teal 1',
  author: 'me',
  color: '#2ab7ca',
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
