import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { apply, MASTER_DEFAULTS, type Op, seedBoard, type Track } from '../shared/board'
import {
  isAgentAuthor,
  isAgentKey,
  isAgentName,
  jamSlugOf,
  agentIdOf,
  newAgentKey,
  prepare,
  snapshotOf,
  toAgentName,
  toKind,
  checkSummary,
  holdsOf,
  stampRepeats,
  withoutHeld,
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

const clip = {
  name: 'Voice 1',
  author: 'p1',
  authorName: 'Groovy Otter',
  color: 'teal',
  durationMs: 1500,
  bytes: 1000,
  createdAt: 1,
  kind: 'clip',
} as const

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

  it('makes keys and public ids that are unrelated', async () => {
    const key = newAgentKey()
    const id = await agentIdOf(key, 'funky-otter-ab12')
    expect(isAgentKey(key)).toBe(true)
    expect(id).toMatch(/^[0-9a-f]{16}$/)
    expect(key).not.toContain(id)
    expect(await agentIdOf(key, 'funky-otter-ab12')).toBe(id)
    expect(await agentIdOf(key, 'funky-otter-cd34')).not.toBe(id)
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
  // @scenario collab/agent: Read tracks
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
    expect(snap.master).toEqual(AGENT_MASTER)
    // Plain data: survives a JSON round trip unchanged.
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap)
  })

  // @scenario collab/agent: Read a voice track
  it('lists a clip with kind clip, and a track with a pad hit and a clip hit', () => {
    const doc = new Y.Doc()
    seedBoard(doc)
    apply(doc, [{ op: 'addSound', id: 'u-cliiiiiiiiip', sound: clip }], SYSTEM)
    apply(
      doc,
      [
        {
          op: 'addTrack',
          id: 't1',
          track: {
            ...track('Voice'),
            hits: [
              { padId: 'r0c0', beat: 0 },
              { soundId: 'u-cliiiiiiiiip', beat: 1.06 },
            ],
          },
        },
      ],
      SYSTEM,
    )
    const snap = snapshotOf(doc, [])
    expect(snap.sounds.find((s) => s.id === 'u-cliiiiiiiiip')).toEqual({
      id: 'u-cliiiiiiiiip',
      name: 'Voice 1',
      kind: 'clip',
      by: 'Groovy Otter',
      durationMs: 1500,
    })
    expect(snap.tracks[0]!.hits).toEqual([
      { padId: 'r0c0', beat: 0 },
      { soundId: 'u-cliiiiiiiiip', beat: 1.06 },
    ])
  })
})

/** The master as agents read it: repeat leaves out the beat the jam stamps it with. */
const AGENT_MASTER = { ...MASTER_DEFAULTS, repeat: { x: 0, y: 0 } }

describe('snapshot of the master', () => {
  // @scenario collab/agent: Read the master
  it('holds the master knobs and touchpad modes, unset ones at their defaults', () => {
    const doc = new Y.Doc()
    seedBoard(doc)
    apply(
      doc,
      [
        { op: 'setFx', mode: 'filter', x: -0.4, y: 0 },
        { op: 'setMaster', set: { swing: 0.5 } },
        { op: 'setFx', mode: 'repeat', x: 0.2, y: 1, startBeat: 8 },
      ],
      SYSTEM,
    )
    const { master } = snapshotOf(doc, [])
    expect(master).toEqual({
      ...AGENT_MASTER,
      filter: { x: -0.4, y: 0 },
      swing: 0.5,
      repeat: { x: 0.2, y: 1 },
    })
    expect(JSON.parse(JSON.stringify(master))).toEqual(master)
  })
})

describe('prepare', () => {
  let n = 0
  const mint = () => `minted-${n++}`

  // @scenario collab/agent: Posing as someone
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

  it('passes the sound knobs an agent sets, and only those', () => {
    n = 0
    const hits = [{ padId: 'r0c0', beat: 0 }]
    const out = prepare(
      [
        {
          op: 'addTrack',
          ref: 'new:wet',
          track: { name: 'Wet', bars: 1, hits, reverb: 0.3, pitch: -2, pan: -0.5 },
        },
        { op: 'setTrack', id: 'new:wet', patch: { echo: 0.2, tone: -0.4 } },
      ],
      agent,
      mint,
    )
    expect(out[0]).toMatchObject({ op: { track: { reverb: 0.3, pitch: -2, pan: -0.5 } } })
    const added = (out[0] as { op: { track: Track } }).op.track
    expect(added).not.toHaveProperty('echo')
    expect(added).not.toHaveProperty('tone')
    expect(out[1]).toEqual({
      op: { op: 'setTrack', id: 'minted-0', patch: { echo: 0.2, tone: -0.4 } },
    })
  })

  it('refuses a sound knob out of range, and a pitch between semitones', () => {
    const hits = [{ padId: 'r0c0', beat: 0 }]
    for (const knobs of [
      { reverb: 1.5 },
      { tone: -2 },
      { pitch: 13 },
      { pitch: 0.5 },
      { pan: 2 },
    ]) {
      const [p] = prepare(
        [{ op: 'addTrack', track: { name: 'A', bars: 1, hits, ...knobs } }],
        agent,
        mint,
      )
      expect(p).toHaveProperty('issues')
      expect((p as { issues: { path?: unknown[] }[] }).issues[0]?.path).toEqual([
        'track',
        Object.keys(knobs)[0],
      ])
    }
  })

  it('refuses a setTrack knob out of range when it applies', () => {
    const doc = new Y.Doc()
    seedBoard(doc)
    apply(doc, [{ op: 'addTrack', id: 't1', track: track('One') }], SYSTEM)
    const [p] = prepare([{ op: 'setTrack', id: 't1', patch: { reverb: 2 } }], agent, mint)
    expect(p).toHaveProperty('op')
    const [r] = apply(doc, [(p as { op: Op }).op], SYSTEM)
    expect(r).toMatchObject({ ok: false })
    expect(doc.getMap('tracks').get('t1')).toBeDefined()
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

  it('passes sound hits, and refuses a hit naming both a pad and a sound, or neither', () => {
    n = 0
    const hits = [
      { padId: 'r0c0', beat: 0 },
      { soundId: 'u-cliiiiiiiiip', beat: 1.06 },
    ]
    const [ok, both, neither] = prepare(
      [
        { op: 'addTrack', track: { name: 'Voice', bars: 1, hits } },
        {
          op: 'addTrack',
          track: { name: 'Both', bars: 1, hits: [{ padId: 'r0c0', soundId: 'kick', beat: 0 }] },
        },
        { op: 'addTrack', track: { name: 'Neither', bars: 1, hits: [{ beat: 0 }] } },
      ],
      agent,
      mint,
    )
    expect(ok).toMatchObject({ op: { op: 'addTrack', track: { hits } } })
    expect(both).toHaveProperty('issues')
    expect(neither).toHaveProperty('issues')
  })

  // @scenario collab/agent: Reuse a voice
  it("adds a track that reuses a listed clip, and refuses one naming a sound the jam doesn't list", () => {
    n = 0
    const doc = new Y.Doc()
    seedBoard(doc)
    apply(doc, [{ op: 'addSound', id: 'u-cliiiiiiiiip', sound: clip }], SYSTEM)
    const prepared = prepare(
      [
        {
          op: 'addTrack',
          track: {
            name: 'Echoes',
            bars: 4,
            hits: [
              { soundId: 'u-cliiiiiiiiip', beat: 0 },
              { soundId: 'u-cliiiiiiiiip', beat: 8 },
            ],
          },
        },
        {
          op: 'addTrack',
          track: { name: 'Ghost', bars: 1, hits: [{ soundId: 'u-aaaaaaaaaaaa', beat: 0 }] },
        },
      ],
      agent,
      mint,
    )
    const ops = prepared.map((p) => ('op' in p ? p.op : undefined)).filter((o) => o !== undefined)
    const results = apply(doc, ops, { kind: 'ai', id: 'pub1' })
    const snap = snapshotOf(doc, [])
    expect(snap.tracks.map((t) => t.name)).toEqual(['Echoes'])
    expect(snap.tracks[0]!.hits).toEqual([
      { soundId: 'u-cliiiiiiiiip', beat: 0 },
      { soundId: 'u-cliiiiiiiiip', beat: 8 },
    ])
    expect(results[0]).toEqual({ ok: true })
    expect(results[1]).toMatchObject({ ok: false })
  })

  it("refuses a track hitting a sound the jam doesn't list, so its ref is never minted", () => {
    n = 0
    const out = prepare(
      [
        {
          op: 'addTrack',
          ref: 'new:v',
          track: { name: 'Ghost', bars: 1, hits: [{ soundId: 'u-aaaaaaaaaaaa', beat: 0 }] },
        },
        { op: 'setTrack', id: 'new:v', patch: { gain: 0.5 } },
        { op: 'addTrack', track: { name: 'Kit', bars: 1, hits: [{ soundId: 'kick', beat: 0 }] } },
        {
          op: 'addTrack',
          track: { name: 'Both', bars: 1, hits: [{ padId: 'r0c0', soundId: 'kick', beat: 0 }] },
        },
      ],
      agent,
      mint,
      (id) => id === 'u-cliiiiiiiiip',
    )
    expect(out[0]).toEqual({
      issues: [{ message: 'No sound u-aaaaaaaaaaaa', path: ['track', 'hits', 0, 'soundId'] }],
    })
    expect(out[1]).toEqual({ issues: [{ message: "Track new:v wasn't added", path: ['id'] }] })
    expect(out[2]).toHaveProperty('op')
    expect(out[3]).toEqual({
      issues: [
        {
          message: 'A hit names a pad (padId) or a sound (soundId), not both',
          path: ['track', 'hits', 0],
        },
      ],
    })
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

  // @scenario collab/agent: Agent drops the filter
  it('passes master knobs and touchpad modes through', () => {
    expect(
      prepare(
        [
          { op: 'setMaster', set: { tone: -0.3, swing: 0.2 } },
          { op: 'setFx', mode: 'filter', x: -0.8, y: 0.3 },
        ],
        agent,
        mint,
      ),
    ).toEqual([
      { op: { op: 'setMaster', set: { tone: -0.3, swing: 0.2 } } },
      { op: { op: 'setFx', mode: 'filter', x: -0.8, y: 0.3 } },
    ])
  })

  it("refuses an unknown master knob or mode, and leaves repeat's start beat to the room", () => {
    const [knob, mode, start] = prepare(
      [
        { op: 'setMaster', set: { loudness: 1 } },
        { op: 'setFx', mode: 'flanger', x: 0, y: 0 },
        { op: 'setFx', mode: 'repeat', x: 0.5, y: 1, startBeat: 4 },
      ],
      agent,
      mint,
    )
    expect(knob).toHaveProperty('issues')
    expect(mode).toHaveProperty('issues')
    expect(start).toEqual({ op: { op: 'setFx', mode: 'repeat', x: 0.5, y: 1 } })
  })
})

describe('held controls', () => {
  const person = (id: string, name: string, control?: string) => ({
    person: { id, name, color: 'teal' },
    ...(control ? { control } : {}),
  })

  it('reads who holds which control from presence, ignoring the room and agents', () => {
    const holds = holdsOf([
      person('p1', 'Misty Yak', 'master.tone'),
      person('p2', 'Groovy Otter', 'master.tone'),
      person('p3', 'Groovy Otter', 'fx.filter'),
      person('p4', 'Calm Heron'),
      { person: { id: 'agent:x', name: 'Groovy Claude', color: 'sky' }, control: 'fx.throw' },
      { agents: [], control: 'fx.lofi' },
      null,
    ])
    expect([...holds]).toEqual([
      ['master.tone', 'Misty Yak'],
      ['fx.filter', 'Groovy Otter'],
    ])
  })

  // @scenario collab/agent: Held control
  it('drops only the held knobs of a setMaster, naming who holds them', () => {
    const holds = new Map([['master.tone', 'Misty Yak']])
    expect(withoutHeld({ op: 'setMaster', set: { tone: 0.2, swing: 0.5 } }, holds)).toEqual({
      op: { op: 'setMaster', set: { swing: 0.5 } },
      issues: [{ message: 'Held by Misty Yak', path: ['set', 'tone'] }],
    })
    expect(withoutHeld({ op: 'setMaster', set: { tone: 0.2 } }, holds)).toEqual({
      issues: [{ message: 'Held by Misty Yak', path: ['set', 'tone'] }],
    })
  })

  it('refuses a held touchpad mode, and leaves the other modes free', () => {
    const holds = new Map([['fx.filter', 'Misty Yak']])
    expect(withoutHeld({ op: 'setFx', mode: 'filter', x: 0, y: 0 }, holds)).toEqual({
      issues: [{ message: 'Held by Misty Yak', path: ['mode'] }],
    })
    const free: Op = { op: 'setFx', mode: 'throw', x: 0.5, y: 0.5 }
    expect(withoutHeld(free, holds)).toEqual({ op: free, issues: [] })
  })

  it("drops a track's held fields, on that track only", () => {
    const holds = new Map([['track.t1.gain', 'Misty Yak']])
    expect(
      withoutHeld({ op: 'setTrack', id: 't1', patch: { gain: 0.5, mute: true } }, holds),
    ).toEqual({
      op: { op: 'setTrack', id: 't1', patch: { mute: true } },
      issues: [{ message: 'Held by Misty Yak', path: ['patch', 'gain'] }],
    })
    const other: Op = { op: 'setTrack', id: 't2', patch: { gain: 0.5 } }
    expect(withoutHeld(other, holds)).toEqual({ op: other, issues: [] })
  })
})

describe('repeat stamps', () => {
  const doc = () => {
    const d = new Y.Doc()
    seedBoard(d)
    apply(d, [{ op: 'setTempo', bpm: 120 }], SYSTEM)
    return d
  }
  const repeat = (x: number, y: number): Op => ({ op: 'setFx', mode: 'repeat', x, y })
  // 120 BPM: room time 1300 ms is jam beat 2.6.
  const NOW = 1300

  it("stamps an agent's repeat moves with the jam beat they take effect on, as a person's are", () => {
    const ops = stampRepeats(
      [repeat(0.1, 1), repeat(0.1, 0.5), repeat(0.9, 0.5), repeat(0.9, 0)],
      doc(),
      NOW,
    )
    expect(ops.map((o) => (o.op === 'setFx' ? o.startBeat : 'other'))).toEqual([
      3, // engages the 1/4 slice at the next beat
      undefined, // only its level
      2.75, // the 1/32 slice, at the next 1/16
      2.75, // lets go at the next 1/16
    ])
  })

  it('stamps against where repeat really is when an earlier move is refused', () => {
    const ops = stampRepeats([repeat(0.1, 1.5), repeat(0.1, 0.8)], doc(), NOW)
    // The first is out of range, so the second still engages repeat from off.
    expect(ops.map((o) => (o.op === 'setFx' ? o.startBeat : 'other'))).toEqual([3, 3])
  })

  it('leaves other ops alone, and reads where repeat is from the board', () => {
    const d = doc()
    apply(d, [{ op: 'setFx', mode: 'repeat', x: 0.1, y: 1, startBeat: 2 }], SYSTEM)
    const other: Op = { op: 'setFx', mode: 'filter', x: -0.5, y: 0 }
    expect(stampRepeats([other, repeat(0.2, 0.4)], d, NOW)).toEqual([other, repeat(0.2, 0.4)])
  })
})
