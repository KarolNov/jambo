import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { changesBetween, type Snapshot } from '../shared/agent'
import { apply, masterOf, type Track } from '../shared/board'
import { connectBoard } from './client'

let address = 0
const newAddress = () => `198.51.101.${++address}`

let rpcId = 0
/** Calls a tool over the Worker's /mcp; returns its parsed answer and whether it was an error. */
async function call(name: string, args: object, ip = newAddress(), host = 'jambo.test') {
  const res = await exports.default.fetch(`http://${host}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-06-18',
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++rpcId,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const text = await res.text()
  const data = text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => l.slice(6))
    .join('')
  const { result, error } = JSON.parse(data || text) as {
    result?: any
    error?: { message: string }
  }
  if (error) throw new Error(error.message)
  return { isError: !!result.isError, body: JSON.parse(result.content[0].text) as any }
}

const PERSON = { kind: 'user', id: 'p1' } as const

const track = (name: string, gain = 1): Track => ({
  name,
  author: 'p1',
  color: 'teal',
  bars: 1,
  hits: [{ padId: 'r0c0', beat: 0 }],
  gain,
  mute: false,
  quantize: 0.25,
  effects: [],
})

const board = (over: Partial<Snapshot> = {}): Snapshot => ({
  bpm: 100,
  pads: [{ id: 'r0c0', key: '1', row: 0, col: 0, soundId: 'kick' }],
  sounds: [{ id: 'kick', name: 'Kick', kind: 'kit', category: 'drums' }],
  tracks: [],
  master: masterOf(undefined),
  here: [{ name: 'Misty Yak', kind: 'person', color: 'teal' }],
  ...over,
})

describe('changesBetween', () => {
  it('is empty for the same jam', () => {
    expect(changesBetween(board(), board())).toEqual([])
  })

  it('names what changed, with only the changed fields of a track and the master', () => {
    const before = board({
      tracks: [
        { id: 'a', ...track('Kick') },
        { id: 'b', ...track('Hats') },
      ],
    })
    const after = board({
      bpm: 100,
      pads: [{ id: 'r0c0', key: '1', row: 0, col: 0, soundId: 'snare' }],
      tracks: [
        { id: 'a', ...track('Kick', 0.5) },
        { id: 'c', ...track('Bass') },
      ],
      master: { ...masterOf(undefined), drive: 0.7, lofi: { x: 0.3, y: 0.2 } },
      here: [{ name: 'Groovy Claude', kind: 'Claude', color: 'teal' }],
    })
    expect(changesBetween(before, after)).toEqual([
      { what: 'pad', id: 'r0c0', soundId: 'snare' },
      { what: 'trackChanged', id: 'a', name: 'Kick', set: { gain: 0.5 } },
      { what: 'trackAdded', track: { id: 'c', ...track('Bass') } },
      { what: 'trackRemoved', id: 'b', name: 'Hats' },
      { what: 'master', set: { drive: 0.7, lofi: { x: 0.3, y: 0.2 } } },
      { what: 'joined', who: { name: 'Groovy Claude', kind: 'Claude', color: 'teal' } },
      { what: 'left', who: { name: 'Misty Yak', kind: 'person', color: 'teal' } },
    ])
  })
})

describe('listen over MCP', () => {
  it("answers a person's change and leaves out the agent's own run", async () => {
    const slug = 'funky-otter-mw01'
    const person = await connectBoard(slug)
    const ip = newAddress()
    const joined = await call('join', { jam: slug, kind: 'Claude' }, ip)
    const agentKey = joined.body.agent.agentKey

    await call(
      'run',
      {
        jam: slug,
        agentKey,
        summary: 'Swing',
        ops: [{ op: 'setMaster', set: { swing: 0.3 } }],
      },
      ip,
    )
    const heard = call('listen', { jam: slug, agentKey, wait: 10 }, ip)
    await new Promise((r) => setTimeout(r, 200))
    apply(person.doc, [{ op: 'setMaster', set: { drive: 0.6 } }], PERSON)
    const out = await heard
    expect(out.isError).toBe(false)
    expect(out.body.changes).toEqual([{ what: 'master', set: { drive: 0.6 } }])
    expect(out.body.board).toBeUndefined()
    person.close()
  })

  it("tells repeat's x and y, without the beat the jam stamps it with", async () => {
    const slug = 'funky-otter-mw06'
    const person = await connectBoard(slug)
    const ip = newAddress()
    const joined = await call('join', { jam: slug }, ip)
    expect(joined.body.board.master.repeat).toEqual({ x: 0, y: 0 })
    const heard = call('listen', { jam: slug, agentKey: joined.body.agent.agentKey, wait: 10 }, ip)
    await new Promise((r) => setTimeout(r, 200))
    apply(person.doc, [{ op: 'setFx', mode: 'repeat', x: 0.5, y: 1, startBeat: 12 }], PERSON)
    expect((await heard).body.changes).toEqual([
      { what: 'master', set: { repeat: { x: 0.5, y: 1 } } },
    ])
    person.close()
  })

  it('says who is turning what, and answers nothing changed when nothing did', async () => {
    const slug = 'funky-otter-mw02'
    const person = await connectBoard(slug)
    const ip = newAddress()
    const agentKey = (await call('join', { jam: slug }, ip)).body.agent.agentKey
    person.awareness.setLocalState({
      person: { id: 'p1', name: 'Misty Yak', color: 'teal' },
      control: 'master.tone',
    })
    const held = await call('listen', { jam: slug, agentKey, wait: 5 }, ip)
    expect(held.body.holding).toEqual([{ control: 'master.tone', by: 'Misty Yak' }])
    const quiet = await call('listen', { jam: slug, agentKey, wait: 0 }, ip)
    expect(quiet.body).toMatchObject({ changes: [], holding: held.body.holding })
    person.close()
  })

  it('answers the board when it has no record of what the agent saw', async () => {
    const slug = 'funky-otter-mw03'
    const ip = newAddress()
    const agentKey = (
      await call(
        'run',
        {
          jam: slug,
          summary: 'Tempo',
          ops: [{ op: 'setTempo', bpm: 90 }],
        },
        ip,
      )
    ).body.agent.agentKey
    const out = await call('listen', { jam: slug, agentKey, wait: 0 }, ip)
    expect(out.body.changes).toEqual([])
    expect(out.body.board.bpm).toBe(90)
  })

  it('needs an agentKey, and is not counted toward the call limit', async () => {
    const slug = 'funky-otter-mw04'
    expect((await call('listen', { jam: slug })).body.error).toMatch(/agentKey/)
    // The limiter counts per clock minute, so a burst that crosses one is retried from a new address.
    const minute = () => Math.floor(Date.now() / 60_000)
    for (let attempt = 0; ; attempt++) {
      const ip = newAddress()
      const start = minute()
      const agentKey = (await call('join', { jam: slug }, ip)).body.agent.agentKey
      for (let i = 0; i < 20; i++) await call('join', { jam: slug, agentKey }, ip)
      const limited = await call('join', { jam: slug, agentKey }, ip)
      const out = await call('listen', { jam: slug, agentKey, wait: 0 }, ip)
      if (minute() !== start && attempt === 0) continue
      expect(limited.body.error).toMatch(/too many/)
      expect(out.isError).toBe(false)
      return
    }
  })
})

describe('jam links on another host', () => {
  it('refuses them, naming the server to add', async () => {
    const out = await call('join', { jam: 'https://jambo.example/jam/funky-otter-mw05' })
    expect(out).toEqual({
      isError: true,
      body: {
        error:
          'That jam is on jambo.example, and this server is jambo.test: add https://jambo.example/mcp to play in it',
      },
    })
    const same = await call('join', { jam: 'http://jambo.test/jam/funky-otter-mw05' })
    expect(same.isError).toBe(false)
  })
})
