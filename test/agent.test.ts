import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { apply, seedBoard, type Track } from '../shared/board'
import {
  isAgentAuthor,
  isAgentKey,
  isAgentName,
  jamSlugOf,
  newAgentId,
  newAgentKey,
  prepare,
  snapshotOf,
  toAgentName,
  toKind,
  checkSummary,
} from '../shared/agent'

const agent = { id: 'pub1', color: 'sky' } as const
const SYSTEM = { kind: 'system', id: 't' } as const

const track = (name: string): Track => ({
  name,
  author: 'p1',
  color: 'teal',
  bars: 1,
  hits: [{ padId: 'r0c0', beat: 0 }],
  gain: 1,
  mute: false,
  quantize: 0.25,
  effects: [],
})

describe('jam links', () => {
  it('reads a full URL, a path and a bare slug', () => {
    expect(jamSlugOf('https://jambo.example/jam/funky-otter-k7q2')).toBe('funky-otter-k7q2')
    expect(jamSlugOf('https://jambo.example/jam/funky-otter-k7q2/?x=1#y')).toBe('funky-otter-k7q2')
    expect(jamSlugOf('/jam/funky-otter-k7q2')).toBe('funky-otter-k7q2')
    expect(jamSlugOf(' funky-otter-k7q2 ')).toBe('funky-otter-k7q2')
  })

  it('refuses anything that is not a jam', () => {
    expect(jamSlugOf('not a jam')).toBeUndefined()
    expect(jamSlugOf('https://jambo.example/jam/nope')).toBeUndefined()
    expect(jamSlugOf('')).toBeUndefined()
  })
})

describe('agent identity', () => {
  it('title-cases a one-word kind and refuses others', () => {
    expect(toKind('claude')).toBe('Claude')
    expect(toKind('CODEX')).toBe('Codex')
    expect(toKind('two words')).toBeUndefined()
    expect(toKind('x'.repeat(20))).toBe('X' + 'x'.repeat(19))
    expect(toKind('x'.repeat(21))).toBeUndefined()
    expect(toKind(3)).toBeUndefined()
  })

  it('accepts only an adjective followed by the kind as a name', () => {
    expect(isAgentName('Groovy Claude', 'Claude')).toBe(true)
    expect(isAgentName('groovy claude', 'Claude')).toBe(true)
    expect(isAgentName('Groovy Otter', 'Claude')).toBe(false)
    expect(isAgentName('Notaword Claude', 'Claude')).toBe(false)
    expect(isAgentName('Groovy Claude', 'Codex')).toBe(false)
  })

  it('writes an agent name one way, whatever its case and spacing', () => {
    expect(toAgentName('  groovy   CLAUDE ', 'Claude')).toBe('Groovy Claude')
    expect(toAgentName('Groovy Otter', 'Claude')).toBeUndefined()
  })

  it('makes keys and public ids that are unrelated', () => {
    const key = newAgentKey()
    const id = newAgentId()
    expect(isAgentKey(key)).toBe(true)
    expect(id).toMatch(/^[0-9a-f]{16}$/)
    expect(key).not.toContain(id)
    expect(isAgentKey('short')).toBe(false)
  })

  it('tells agent authors apart', () => {
    expect(isAgentAuthor('agent:abc')).toBe(true)
    expect(isAgentAuthor('p1')).toBe(false)
  })
})

describe('run limits', () => {
  it('needs a summary of 1 to 140 characters', () => {
    expect(checkSummary('')).toEqual({ error: 'A run needs a summary' })
    expect(checkSummary('  ')).toEqual({ error: 'A run needs a summary' })
    expect(checkSummary('x'.repeat(141))).toHaveProperty('error')
    expect(checkSummary(' beat ')).toEqual({ summary: 'beat' })
  })
})

describe('snapshot', () => {
  it('holds tempo, pads, kit and uploads, readable tracks and who is here', () => {
    const doc = new Y.Doc()
    seedBoard(doc)
    apply(doc, [{ op: 'addTrack', id: 't1', track: track('One') }], SYSTEM)
    apply(doc, [{ op: 'addTrack', id: 't2', track: track('Two') }], SYSTEM)
    // An unreadable track is left out.
    const broken = new Y.Map<unknown>()
    broken.set('name', 'Broken')
    doc.getMap('tracks').set('t3', broken)
    apply(
      doc,
      [
        {
          op: 'addSound',
          id: 'u-abcdefghijkl',
          sound: {
            name: 'Vox',
            author: 'p1',
            authorName: 'Groovy Otter',
            color: 'teal',
            durationMs: 2000,
            bytes: 1000,
            createdAt: 1,
          },
        },
      ],
      SYSTEM,
    )
    const here = [{ name: 'Groovy Otter', kind: 'person', color: 'teal' } as const]
    const snap = snapshotOf(doc, here)
    expect(snap.bpm).toBe(100)
    expect(snap.pads.length).toBeGreaterThan(0)
    expect(snap.pads[0]).toMatchObject({ id: expect.any(String), key: expect.any(String) })
    expect(snap.sounds.find((s) => s.id === 'kick')).toMatchObject({ kind: 'kit' })
    expect(snap.sounds.find((s) => s.id === 'u-abcdefghijkl')).toEqual({
      id: 'u-abcdefghijkl',
      name: 'Vox',
      kind: 'upload',
      by: 'Groovy Otter',
      durationMs: 2000,
    })
    expect(snap.tracks.map((t) => t.name)).toEqual(['One', 'Two'])
    expect(snap.tracks[0]).toMatchObject({ id: 't1', author: 'p1', bars: 1 })
    expect(snap.here).toEqual(here)
    // Plain data: survives a JSON round trip unchanged.
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap)
  })
})

describe('prepare', () => {
  let n = 0
  const mint = () => `minted-${n++}`

  it('stamps the agent on an added track, whatever the agent sent', () => {
    n = 0
    const [p] = prepare(
      [
        {
          op: 'addTrack',
          ref: 'new:0',
          track: {
            name: 'Beat',
            bars: 1,
            hits: [{ padId: 'r0c0', beat: 0 }],
            author: 'p1',
            color: 'teal',
            mute: true,
            effects: ['x'],
          },
        },
      ],
      agent,
      mint,
    )
    expect(p).toEqual({
      id: 'minted-0',
      op: {
        op: 'addTrack',
        id: 'minted-0',
        track: {
          name: 'Beat',
          author: 'agent:pub1',
          color: 'sky',
          bars: 1,
          hits: [{ padId: 'r0c0', beat: 0 }],
          gain: 1,
          mute: false,
          quantize: 0.25,
          effects: [],
        },
      },
    })
  })

  it('resolves refs to the ids it minted', () => {
    n = 0
    const out = prepare(
      [
        {
          op: 'addTrack',
          ref: 'new:0',
          track: { name: 'A', bars: 1, hits: [{ padId: 'r0c0', beat: 0 }] },
        },
        { op: 'setTrack', id: 'new:0', patch: { gain: 0.5 } },
        { op: 'removeTrack', id: 'new:0' },
        { op: 'removeTrack', id: 't9' },
      ],
      agent,
      mint,
    )
    expect(out.slice(1)).toEqual([
      { op: { op: 'setTrack', id: 'minted-0', patch: { gain: 0.5 } } },
      { op: { op: 'removeTrack', id: 'minted-0' } },
      { op: { op: 'removeTrack', id: 't9' } },
    ])
  })

  it('refuses a ref that is not new: and up to 32 letters, digits, _ or -', () => {
    for (const ref of ['t9', 'new:', `new:${'a'.repeat(33)}`, 'new:a b', 'new:kick!']) {
      expect(
        prepare(
          [
            {
              op: 'addTrack',
              ref,
              track: { name: 'A', bars: 1, hits: [{ padId: 'r0c0', beat: 0 }] },
            },
          ],
          agent,
          mint,
        )[0],
      ).toHaveProperty('issues')
    }
    expect(
      prepare(
        [
          {
            op: 'addTrack',
            ref: `new:${'a'.repeat(32)}`,
            track: { name: 'A', bars: 1, hits: [{ padId: 'r0c0', beat: 0 }] },
          },
        ],
        agent,
        mint,
      )[0],
    ).toHaveProperty('op')
  })

  it('refuses a reused ref, an unknown ref and a ref whose track was refused', () => {
    n = 0
    const hit = [{ padId: 'r0c0', beat: 0 }]
    const out = prepare(
      [
        { op: 'addTrack', ref: 'new:a', track: { name: 'A', bars: 1, hits: hit } },
        { op: 'addTrack', ref: 'new:a', track: { name: 'B', bars: 1, hits: hit } },
        { op: 'setTrack', id: 'new:zz', patch: { mute: true } },
        // A hit past the end of a 1-bar loop.
        {
          op: 'addTrack',
          ref: 'new:b',
          track: { name: 'C', bars: 1, hits: [{ padId: 'r0c0', beat: 5 }] },
        },
        { op: 'removeTrack', id: 'new:b' },
      ],
      agent,
      mint,
    )
    expect(out[0]).toHaveProperty('id', 'minted-0')
    expect(out[1]).toEqual({
      issues: [{ message: 'Ref new:a is already used in this run', path: ['ref'] }],
    })
    expect(out[2]).toEqual({
      issues: [{ message: 'No track new:zz added earlier in this run', path: ['id'] }],
    })
    expect(out[3]).toEqual({
      issues: [{ message: 'Every hit must fall inside the track', path: ['track', 'hits'] }],
    })
    expect(out[4]).toEqual({ issues: [{ message: "Track new:b wasn't added", path: ['id'] }] })
  })

  it('refuses uploads and anything else an agent may not send', () => {
    const out = prepare(
      [{ op: 'addSound', id: 'u-x' }, { op: 'expireSounds' }, { nope: 1 }, null],
      agent,
      mint,
    )
    expect(out[0]).toEqual({ issues: [{ message: "Agents can't addSound" }] })
    expect(out[1]).toEqual({ issues: [{ message: "Agents can't expireSounds" }] })
    expect(out[2]).toHaveProperty('issues')
    expect(out[3]).toHaveProperty('issues')
  })

  it('passes tempo, pads and sound swaps through', () => {
    expect(
      prepare(
        [
          { op: 'setTempo', bpm: 110 },
          { op: 'assignPad', padId: 'r0c0', soundId: 'kick' },
          { op: 'replaceSound', from: 'kick', to: 'snare' },
        ],
        agent,
        mint,
      ),
    ).toEqual([
      { op: { op: 'setTempo', bpm: 110 } },
      { op: { op: 'assignPad', padId: 'r0c0', soundId: 'kick' } },
      { op: { op: 'replaceSound', from: 'kick', to: 'snare' } },
    ])
  })
})
