import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { getServerByName } from 'partyserver'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { apply, ROOTS, type Track } from '../shared/board'
import { AGENT_LIMITS } from '../shared/agent'
import { hello, parseSeatMessage } from '../shared/seats'
import type { AgentView } from '../worker/agent/roster'
import type { Board } from '../worker/board'
import { connectBoard, until } from './client'

const room = (slug: string) => getServerByName(env.Board, slug)

/** Joins an agent that must be seated. */
async function seated(
  r: Awaited<ReturnType<typeof room>>,
  hello: Parameters<Board['agentJoin']>[0],
) {
  const a = await r.agentJoin(hello)
  if ('error' in a) throw new Error(a.error)
  return a
}

const agentsSeenBy = (awareness: { getStates: () => Map<number, Record<string, unknown>> }) =>
  [...awareness.getStates().values()].flatMap((s) => (s.agents as AgentView[] | undefined) ?? [])

const tracks = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>(ROOTS.tracks)

const beat = {
  op: 'addTrack',
  track: { name: 'Beat', bars: 1, hits: [{ padId: 'r0c0', beat: 0 }] },
}

const seatOf = (client: { custom: string[] }) => {
  const last = client.custom
    .map(parseSeatMessage)
    .filter((m) => m?.t === 'seat')
    .at(-1)
  return last?.t === 'seat' ? { name: last.name, color: last.color } : undefined
}

/** Ages every agent present in `slug` past the idle limit, as if 5 minutes passed. */
const ageAgents = (slug: string) =>
  runInDurableObject(env.Board.getByName(slug), async (instance) => {
    const roster = (
      instance as unknown as { roster: { load(): Promise<Map<string, { lastSeen: number }>> } }
    ).roster
    for (const a of (await roster.load()).values()) a.lastSeen -= AGENT_LIMITS.idleMs + 1000
  })

describe('agents in the room', () => {
  // @scenario collab/agent: First action
  it('seats an agent with a key, an adjective-and-kind name and a public id', async () => {
    const r = await room('funky-otter-ag01')
    const a = await seated(r, { kind: 'Claude' })
    expect(a.key).toMatch(/^[0-9a-f]{32}$/)
    expect(a.name).toMatch(/^[A-Z][a-z]+ Claude$/)
    expect(a.id).not.toBe(a.key)
    // The same key is the same agent.
    const again = await seated(r, { key: a.key, kind: 'Claude' })
    expect(again).toMatchObject({ id: a.id, name: a.name, color: a.color })
  })

  // @scenario collab/agent: Two Claudes
  it('gives two Claudes asking for one name different names', async () => {
    const r = await room('funky-otter-ag02')
    const a = await seated(r, { kind: 'Claude', name: 'Groovy Claude', color: 'sky' })
    const b = await seated(r, { kind: 'Claude', name: 'Groovy Claude', color: 'sky' })
    expect(a.name).toBe('Groovy Claude')
    expect(b.name).toMatch(/ Claude$/)
    expect(b.name).not.toBe('Groovy Claude')
    expect(b.color).not.toBe('sky')
  })

  it('writes a chosen name one way, so spacing and case make no second Groovy Claude', async () => {
    const r = await room('funky-otter-ag14')
    const a = await seated(r, { kind: 'Claude', name: 'groovy  CLAUDE' })
    const b = await seated(r, { kind: 'Claude', name: 'Groovy Claude' })
    expect(a.name).toBe('Groovy Claude')
    expect(b.name).not.toBe('Groovy Claude')
  })

  it('ignores a key the room did not make and a kind that is not one', async () => {
    const r = await room('funky-otter-ag15')
    const a = await seated(r, { key: 'pk', kind: 'claude' })
    expect(a.key).toMatch(/^[0-9a-f]{32}$/)
    expect(a.kind).toBe('Claude')
    const b = await seated(r, { kind: 'not one word' })
    expect(b.kind).toBe('Agent')
  })

  // @scenario collab/agent: Person-style name
  it('keeps an agent from taking a person-style name', async () => {
    const r = await room('funky-otter-ag03')
    const a = await seated(r, { kind: 'Claude', name: 'Groovy Otter' })
    expect(a.name).toMatch(/^[A-Z][a-z]+ Claude$/)
  })

  // @scenario collab/agent: Key stays private
  // @scenario collab/room: Late joiner
  it('shows the agent to everyone, late joiners too, without its key', async () => {
    const slug = 'funky-otter-ag04'
    const early = await connectBoard(slug)
    const r = await room(slug)
    const a = await seated(r, { kind: 'Claude' })
    await until(() => agentsSeenBy(early.awareness).some((x) => x.id === a.id))
    const late = await connectBoard(slug)
    await until(() => agentsSeenBy(late.awareness).some((x) => x.id === a.id))
    expect(JSON.stringify([...late.awareness.getStates().values()])).not.toContain(a.key)
    expect(agentsSeenBy(late.awareness)[0]).toEqual({
      id: a.id,
      kind: 'Claude',
      name: a.name,
      color: a.color,
    })
    early.close()
    late.close()
  })

  // @scenario collab/agent: Leave
  it('takes an agent out when it leaves', async () => {
    const slug = 'funky-otter-ag05'
    const client = await connectBoard(slug)
    const r = await room(slug)
    const a = await seated(r, { kind: 'Claude' })
    await until(() => agentsSeenBy(client.awareness).length === 1)
    expect(await r.agentLeave(a.key)).toBe(true)
    await until(() => agentsSeenBy(client.awareness).length === 0)
    client.close()
  })

  // @scenario collab/agent: Idle
  it('removes an idle agent on the alarm, even with nobody connected', async () => {
    const slug = 'funky-otter-ag06'
    const r = await room(slug)
    await r.agentJoin({ kind: 'Claude' })
    const stub = env.Board.getByName(slug)
    const alarm = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm())
    expect(alarm).toBeGreaterThan(Date.now() + AGENT_LIMITS.idleMs - 60_000)
    await ageAgents(slug)
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect((await r.snapshot()).here).toEqual([])
    expect(await runInDurableObject(stub, (_i, state) => state.storage.getAlarm())).toBeNull()
  })

  it('lists people and agents in the snapshot', async () => {
    const slug = 'funky-otter-ag07'
    const person = await connectBoard(slug)
    person.sendCustom(hello('pk', 'Groovy Otter', 'teal'))
    await until(() => seatOf(person) !== undefined)
    const r = await room(slug)
    const a = await seated(r, { kind: 'Codex' })
    expect((await r.snapshot()).here).toEqual([
      { name: 'Groovy Otter', kind: 'person', color: 'teal' },
      { name: a.name, kind: 'Codex', color: a.color },
    ])
    person.close()
  })
})

describe('agent seats and people', () => {
  // @scenario collab/room: Agent holds a colour
  // @scenario collab/room: Agent idles out
  it('gives a person another colour while an agent holds theirs, and theirs once it idles out', async () => {
    const slug = 'funky-otter-ag08'
    const r = await room(slug)
    await r.agentJoin({ kind: 'Claude', name: 'Groovy Claude', color: 'sky' })
    const p = await connectBoard(slug)
    p.sendCustom(hello('p1', 'Groovy Otter', 'sky'))
    await until(() => seatOf(p) !== undefined)
    expect(seatOf(p)?.color).not.toBe('sky')
    p.close()

    await ageAgents(slug)
    expect(await runDurableObjectAlarm(env.Board.getByName(slug))).toBe(true)
    const q = await connectBoard(slug)
    q.sendCustom(hello('p2', 'Groovy Otter', 'sky'))
    await until(() => seatOf(q) !== undefined)
    expect(seatOf(q)?.color).toBe('sky')
    q.close()
  })
})

/** Ages every agent remembered as away in `slug` by `ms`. */
const ageAway = (slug: string, ms: number) =>
  runInDurableObject(env.Board.getByName(slug), async (instance) => {
    const roster = (
      instance as unknown as {
        roster: { load(): Promise<unknown>; away: Map<string, { leftAt: number }> }
      }
    ).roster
    await roster.load()
    for (const a of roster.away.values()) a.leftAt -= ms
  })

/** Idles every agent in `slug` out, as the alarm does. */
async function idleOut(slug: string) {
  await ageAgents(slug)
  expect(await runDurableObjectAlarm(env.Board.getByName(slug))).toBe(true)
}

describe('agents coming back', () => {
  // @scenario collab/agent: Back after idling out
  it('comes back after idling out with its kind, name and colour, asking for none', async () => {
    const slug = 'funky-otter-ag22'
    const r = await room(slug)
    const a = await seated(r, { kind: 'Claude', name: 'Funky Claude', color: 'amber' })
    await idleOut(slug)
    expect((await r.snapshot()).here).toEqual([])
    expect(await seated(r, { key: a.key })).toEqual(a)
  })

  it('comes back after leaving as itself, or with what it asks for', async () => {
    const r = await room('funky-otter-ag23')
    const a = await seated(r, { kind: 'Claude', name: 'Funky Claude', color: 'amber' })
    await r.agentLeave(a.key)
    expect(await seated(r, { key: a.key })).toMatchObject({ name: 'Funky Claude', color: 'amber' })
    await r.agentLeave(a.key)
    expect(await seated(r, { key: a.key, name: 'Groovy Claude', color: 'sky' })).toMatchObject({
      id: a.id,
      name: 'Groovy Claude',
      color: 'sky',
    })
  })

  // @scenario collab/agent: Name taken meanwhile
  it("is the agent's key, not its name, that brings an identity back", async () => {
    const slug = 'funky-otter-ag24'
    const r = await room(slug)
    const a = await seated(r, { kind: 'Claude', name: 'Funky Claude', color: 'amber' })
    await idleOut(slug)
    // Someone else takes the free name meanwhile; the returning agent gets another.
    const b = await seated(r, { kind: 'Claude', name: 'Funky Claude', color: 'amber' })
    expect(b.id).not.toBe(a.id)
    const back = await seated(r, { key: a.key })
    expect(back.id).toBe(a.id)
    expect(back.kind).toBe('Claude')
    expect(back.name).not.toBe('Funky Claude')
    expect(back.color).not.toBe('amber')
  })

  // @scenario collab/agent: Gone too long
  it('keeps no key in storage, and forgets an agent gone too long', async () => {
    const slug = 'funky-otter-ag25'
    const r = await room(slug)
    const a = await seated(r, { kind: 'Claude', name: 'Funky Claude', color: 'amber' })
    await r.agentLeave(a.key)
    const stored = await runInDurableObject(env.Board.getByName(slug), (_i, state) =>
      state.storage.get('agentsAway'),
    )
    expect(JSON.stringify(stored)).toContain('Funky Claude')
    expect(JSON.stringify(stored)).not.toContain(a.key)
    await ageAway(slug, AGENT_LIMITS.awayMs)
    const back = await seated(r, { key: a.key })
    expect(back.id).toBe(a.id)
    expect(back.kind).toBe('Agent')
  })

  it('remembers at most awayMax agents, forgetting the longest gone', async () => {
    const r = await room('funky-otter-ag26')
    const first = await seated(r, { kind: 'Claude', name: 'Funky Claude', from: 'x' })
    await r.agentLeave(first.key)
    for (let i = 0; i < AGENT_LIMITS.awayMax; i++) {
      const a = await seated(r, { kind: 'Codex', from: `${i}` })
      await r.agentLeave(a.key)
    }
    expect((await seated(r, { key: first.key })).kind).toBe('Agent')
  })
})

describe('agents changing how they look', () => {
  // @scenario collab/agent: Rename while here
  it('takes a free name and colour it asks for while here, but not one in use', async () => {
    const r = await room('funky-otter-ag27')
    const a = await seated(r, { kind: 'Claude', name: 'Twangy Claude', color: 'coral' })
    await seated(r, { kind: 'Claude', name: 'Groovy Claude', color: 'sky' })
    expect(await seated(r, { key: a.key, name: 'Funky Claude', color: 'amber' })).toMatchObject({
      id: a.id,
      name: 'Funky Claude',
      color: 'amber',
    })
    expect(await seated(r, { key: a.key, name: 'Groovy Claude', color: 'sky' })).toMatchObject({
      name: 'Funky Claude',
      color: 'amber',
    })
  })

  it('takes a new kind, with a fresh name when its name does not fit it', async () => {
    const r = await room('funky-otter-ag28')
    const a = await seated(r, { name: 'Twangy Agent' })
    const b = await seated(r, { key: a.key, kind: 'Claude' })
    expect(b.kind).toBe('Claude')
    expect(b.name).toMatch(/^[A-Z][a-z]+ Claude$/)
    expect((await seated(r, { key: a.key, kind: 'Claude', name: 'Funky Claude' })).name).toBe(
      'Funky Claude',
    )
  })
})

describe('agent caps', () => {
  // @scenario collab/agent: Fourth from one address
  it('seats at most perAddress agents from one address, and any number of returns', async () => {
    const r = await room('funky-otter-ag15')
    const first = await seated(r, { kind: 'Claude', from: 'a' })
    for (let i = 1; i < AGENT_LIMITS.perAddress; i++) await seated(r, { kind: 'Claude', from: 'a' })
    expect(await r.agentJoin({ kind: 'Claude', from: 'a' })).toHaveProperty('error')
    expect(await r.runAgentOps({ kind: 'Claude', from: 'a' }, [beat], 'One more')).toHaveProperty(
      'error',
    )
    expect((await r.snapshot()).tracks).toEqual([])
    // An agent already here gets back in; another address still gets a seat.
    expect(await seated(r, { key: first.key, from: 'a' })).toMatchObject({ id: first.id })
    await seated(r, { kind: 'Claude', from: 'b' })
  })

  it('seats at most perJam agents in one jam', async () => {
    const r = await room('funky-otter-ag16')
    for (let i = 0; i < AGENT_LIMITS.perJam; i++) await seated(r, { kind: 'Claude', from: `${i}` })
    expect(await r.agentJoin({ kind: 'Claude', from: 'new' })).toEqual({
      error: `This jam has ${AGENT_LIMITS.perJam} agents; pass your agentKey to rejoin as yourself`,
    })
    expect((await r.snapshot()).here.filter((p) => p.kind === 'Claude')).toHaveLength(
      AGENT_LIMITS.perJam,
    )
  })
})

describe('agent runs', () => {
  const person = (name: string): Track => ({
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

  // @scenario collab/agent: Beat with one bad op
  it('applies a run as one change, with one result per operation', async () => {
    const slug = 'funky-otter-ag10'
    const client = await connectBoard(slug)
    const r = await room(slug)
    let changes = 0
    client.doc.on('update', () => changes++)
    const out = await r.runAgentOps(
      { kind: 'Claude' },
      [
        { op: 'assignPad', padId: 'r0c0', soundId: 'snare' },
        beat,
        { op: 'setTrack', id: 'nope', patch: { gain: 0.5 } },
      ],
      'A beat',
    )
    if ('error' in out) throw new Error(out.error)
    expect(out.ops.map((o) => o.ok)).toEqual([true, true, false])
    expect(out.ops[2]?.issues?.[0]?.message).toBe('No track nope')
    const id = out.ops[1]!.id!
    await until(() => tracks(client.doc).has(id))
    expect(changes).toBe(1)
    expect(client.doc.getMap<Y.Map<unknown>>(ROOTS.pads).get('r0c0')?.get('soundId')).toBe('snare')
    expect(out.summary).toBe('A beat')
    await until(() => agentsSeenBy(client.awareness)[0]?.summary === 'A beat')
    client.close()
  })

  // @scenario collab/agent: Posing as someone
  // @scenario collab/agent: Key stays private
  it('stamps the agent on what it adds, whatever the agent sends', async () => {
    const slug = 'funky-otter-ag11'
    const r = await room(slug)
    const out = await r.runAgentOps(
      { kind: 'Claude' },
      [{ op: 'addTrack', track: { ...beat.track, author: 'p1', color: 'teal', mute: true } }],
      'Posing',
    )
    if ('error' in out) throw new Error(out.error)
    const client = await connectBoard(slug)
    const t = tracks(client.doc).get(out.ops[0]!.id!)!
    expect(t.get('author')).toBe(`agent:${out.agent.id}`)
    expect(t.get('color')).toBe(out.agent.color)
    expect(t.get('mute')).toBe(false)
    expect(JSON.stringify(t.toJSON())).not.toContain(out.agent.key)
    client.close()
  })

  // @scenario collab/agent: Remove someone's track
  it('can remove a track a person recorded, but not touch uploads', async () => {
    const slug = 'funky-otter-ag12'
    const client = await connectBoard(slug)
    apply(client.doc, [{ op: 'addTrack', id: 't1', track: person('Mine') }], {
      kind: 'user',
      id: 'p1',
    })
    const r = await room(slug)
    await until(async () => (await r.snapshot()).tracks.length === 1)
    const out = await r.runAgentOps(
      { kind: 'Claude' },
      [{ op: 'removeTrack', id: 't1' }, { op: 'expireSounds' }],
      'Tidy',
    )
    if ('error' in out) throw new Error(out.error)
    expect(out.ops.map((o) => o.ok)).toEqual([true, false])
    await until(() => !tracks(client.doc).has('t1'))
    client.close()
  })

  // @scenario collab/agent: Held control
  it('refuses what a person holds right now, naming them, and applies the rest', async () => {
    const slug = 'funky-otter-mf01'
    const client = await connectBoard(slug)
    client.awareness.setLocalState({
      person: { id: 'p1', name: 'Misty Yak', color: 'teal' },
      control: 'master.tone',
    })
    await until(() =>
      runInDurableObject(env.Board.getByName(slug), (instance) =>
        [...(instance as Board).document.awareness.getStates().values()].some(
          (s) => s.control === 'master.tone',
        ),
      ),
    )
    const r = await room(slug)
    const out = await r.runAgentOps(
      { kind: 'Claude' },
      [
        { op: 'setMaster', set: { tone: -0.6, swing: 0.5 } },
        { op: 'setMaster', set: { tone: 0.3 } },
        { op: 'setFx', mode: 'filter', x: -0.8, y: 0.3 },
      ],
      'Swing and a filter drop',
    )
    if ('error' in out) throw new Error(out.error)
    expect(out.ops).toEqual([
      {
        op: 'setMaster',
        ok: true,
        issues: [{ message: 'Held by Misty Yak', path: ['set', 'tone'] }],
      },
      {
        op: 'setMaster',
        ok: false,
        issues: [{ message: 'Held by Misty Yak', path: ['set', 'tone'] }],
      },
      { op: 'setFx', ok: true },
    ])
    const { master } = await r.snapshot()
    expect(master).toMatchObject({ tone: 0, swing: 0.5, filter: { x: -0.8, y: 0.3 } })
    // Let go: the knob is free for agents again.
    client.awareness.setLocalState({ person: { id: 'p1', name: 'Misty Yak', color: 'teal' } })
    await until(() =>
      runInDurableObject(env.Board.getByName(slug), (instance) =>
        [...(instance as Board).document.awareness.getStates().values()].every((s) => !s.control),
      ),
    )
    const again = await r.runAgentOps(
      { kind: 'Claude' },
      [{ op: 'setMaster', set: { tone: 0.3 } }],
      'Brighter',
    )
    if ('error' in again) throw new Error(again.error)
    expect(again.ops).toEqual([{ op: 'setMaster', ok: true }])
    expect((await r.snapshot()).master.tone).toBe(0.3)
    client.close()
  })

  // @scenario collab/agent: Too many operations
  it('refuses a run with no operations or more than 64', async () => {
    const r = await room('funky-otter-ag14')
    const error = { error: 'A run holds 1 to 64 operations' }
    expect(await r.runAgentOps({ kind: 'Claude' }, [], 'Nothing')).toEqual(error)
    expect(await r.runAgentOps({ kind: 'Claude' }, Array(65).fill(beat), 'Lots')).toEqual(error)
    expect((await r.snapshot()).tracks).toEqual([])
  })

  // @scenario collab/agent: No summary
  it('refuses a run without a summary', async () => {
    const r = await room('funky-otter-ag13')
    expect(await r.runAgentOps({ kind: 'Claude' }, [beat], ' ')).toEqual({
      error: 'A run needs a summary',
    })
    expect((await r.snapshot()).here).toEqual([])
  })
})

describe('one alarm for retention and agents', () => {
  const stored = <T>(slug: string, key: string) =>
    runInDurableObject(env.Board.getByName(slug), (_i, state) => state.storage.get<T>(key))
  const alarmOf = (slug: string) =>
    runInDurableObject(env.Board.getByName(slug), (_i, state) => state.storage.getAlarm())

  it('keeps a retention alarm set before agents as the retention time', async () => {
    const slug = 'funky-otter-ag20'
    const r = await room(slug)
    const legacy = Date.now() + 60_000
    await runInDurableObject(env.Board.getByName(slug), (_i, state) =>
      state.storage.setAlarm(legacy),
    )
    await r.agentJoin({ kind: 'Claude' })
    expect(await stored<number>(slug, 'retainUntil')).toBe(legacy)
    expect(await alarmOf(slug)).toBe(legacy)
  })

  it('holds retention while an agent is here, and runs it once the agent idles out', async () => {
    const slug = 'funky-otter-ag21'
    const r = await room(slug)
    await r.agentJoin({ kind: 'Claude' })
    const due = () =>
      runInDurableObject(env.Board.getByName(slug), (_i, state) =>
        state.storage.put('retainUntil', Date.now() - 1),
      )

    await due()
    expect(await runDurableObjectAlarm(env.Board.getByName(slug))).toBe(true)
    expect((await r.snapshot()).here).toHaveLength(1)
    expect(await stored<number>(slug, 'retainUntil')).toBeGreaterThan(Date.now() + 86_400_000)

    await due()
    await ageAgents(slug)
    expect(await runDurableObjectAlarm(env.Board.getByName(slug))).toBe(true)
    expect((await r.snapshot()).here).toEqual([])
    expect(await stored(slug, 'retainUntil')).toBeUndefined()
    expect(await alarmOf(slug)).toBeNull()
  })
})
