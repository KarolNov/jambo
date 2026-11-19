import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { getServerByName } from 'partyserver'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { apply, ROOTS, type Track } from '../shared/board'
import { AGENT_LIMITS } from '../shared/agent'
import { hello, parseSeatMessage } from '../shared/seats'
import type { AgentView } from '../worker/agent/roster'
import { connectBoard, until } from './client'

const room = (slug: string) => getServerByName(env.Board, slug)

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
  it('seats an agent with a key, an adjective-and-kind name and a public id', async () => {
    const r = await room('funky-otter-ag01')
    const a = await r.agentJoin({ kind: 'Claude' })
    expect(a.key).toMatch(/^[0-9a-f]{32}$/)
    expect(a.name).toMatch(/^[A-Z][a-z]+ Claude$/)
    expect(a.id).not.toBe(a.key)
    // The same key is the same agent.
    const again = await r.agentJoin({ key: a.key, kind: 'Claude' })
    expect(again).toMatchObject({ id: a.id, name: a.name, color: a.color })
  })

  it('gives two Claudes asking for one name different names', async () => {
    const r = await room('funky-otter-ag02')
    const a = await r.agentJoin({ kind: 'Claude', name: 'Groovy Claude', color: 'sky' })
    const b = await r.agentJoin({ kind: 'Claude', name: 'Groovy Claude', color: 'sky' })
    expect(a.name).toBe('Groovy Claude')
    expect(b.name).toMatch(/ Claude$/)
    expect(b.name).not.toBe('Groovy Claude')
    expect(b.color).not.toBe('sky')
  })

  it('writes a chosen name one way, so spacing and case make no second Groovy Claude', async () => {
    const r = await room('funky-otter-ag14')
    const a = await r.agentJoin({ kind: 'Claude', name: 'groovy  CLAUDE' })
    const b = await r.agentJoin({ kind: 'Claude', name: 'Groovy Claude' })
    expect(a.name).toBe('Groovy Claude')
    expect(b.name).not.toBe('Groovy Claude')
  })

  it('ignores a key the room did not make and a kind that is not one', async () => {
    const r = await room('funky-otter-ag15')
    const a = await r.agentJoin({ key: 'pk', kind: 'claude' })
    expect(a.key).toMatch(/^[0-9a-f]{32}$/)
    expect(a.kind).toBe('Claude')
    const b = await r.agentJoin({ kind: 'not one word' })
    expect(b.kind).toBe('Agent')
  })

  it('keeps an agent from taking a person-style name', async () => {
    const r = await room('funky-otter-ag03')
    const a = await r.agentJoin({ kind: 'Claude', name: 'Groovy Otter' })
    expect(a.name).toMatch(/^[A-Z][a-z]+ Claude$/)
  })

  it('shows the agent to everyone, late joiners too, without its key', async () => {
    const slug = 'funky-otter-ag04'
    const early = await connectBoard(slug)
    const r = await room(slug)
    const a = await r.agentJoin({ kind: 'Claude' })
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

  it('takes an agent out when it leaves', async () => {
    const slug = 'funky-otter-ag05'
    const client = await connectBoard(slug)
    const r = await room(slug)
    const a = await r.agentJoin({ kind: 'Claude' })
    await until(() => agentsSeenBy(client.awareness).length === 1)
    expect(await r.agentLeave(a.key)).toBe(true)
    await until(() => agentsSeenBy(client.awareness).length === 0)
    client.close()
  })

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
    const a = await r.agentJoin({ kind: 'Codex' })
    expect((await r.snapshot()).here).toEqual([
      { name: 'Groovy Otter', kind: 'person', color: 'teal' },
      { name: a.name, kind: 'Codex', color: a.color },
    ])
    person.close()
  })
})

describe('agent seats and people', () => {
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
