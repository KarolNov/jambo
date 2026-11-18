import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { ROOTS } from '../shared/board'
import type { AgentView } from '../worker/agent/roster'
import { connectBoard, until } from './client'

let address = 0
/** A fresh client address per test, so one test's rate limit doesn't spill into another. */
const newAddress = () => `198.51.100.${++address}`

let rpcId = 0
async function rpc(method: string, params: object, ip: string) {
  const res = await exports.default.fetch('http://jambo.test/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-06-18',
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  })
  const text = await res.text()
  const data = text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => l.slice(6))
    .join('')
  return JSON.parse(data || text) as { result?: any; error?: { message: string } }
}

/** Calls a tool; returns its parsed JSON answer and whether it was an error. */
async function call(name: string, args: object, ip = newAddress()) {
  const { result, error } = await rpc('tools/call', { name, arguments: args }, ip)
  if (error) throw new Error(error.message)
  return {
    isError: !!result.isError,
    body: JSON.parse(result.content[0].text) as any,
  }
}

const agentsSeenBy = (awareness: { getStates: () => Map<number, Record<string, unknown>> }) =>
  [...awareness.getStates().values()].flatMap((s) => (s.agents as AgentView[] | undefined) ?? [])

const tracks = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>(ROOTS.tracks)

/** True when the server refused a call, whether as a tool error or a protocol error. */
async function refused(name: string, args: object) {
  const { result, error } = await rpc('tools/call', { name, arguments: args }, newAddress())
  return !!error || !!result?.isError
}

const OPS = ['setTempo', 'assignPad', 'replaceSound', 'addTrack', 'setTrack', 'removeTrack']

describe('the MCP server', () => {
  it('offers join, run and leave, and describes the jam and every operation', async () => {
    const ip = newAddress()
    const init = await rpc(
      'initialize',
      {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      },
      ip,
    )
    expect(init.result.serverInfo.name).toBe('jambo')
    const instructions: string = init.result.instructions
    for (const word of [...OPS, 'bpm', 'pads', 'sounds', 'tracks', 'here'])
      expect(instructions).toContain(word)
    const list = await rpc('tools/list', {}, ip)
    const tools: { name: string; inputSchema: unknown }[] = list.result.tools
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['join', 'run', 'leave']))
    const runSchema = JSON.stringify(tools.find((t) => t.name === 'run')!.inputSchema)
    for (const op of OPS) expect(runSchema).toContain(`"${op}"`)
  })

  it('refuses a jam that is not one', async () => {
    const out = await call('join', { jam: 'not a jam' })
    expect(out).toEqual({ isError: true, body: { error: '"not a jam" is not a jam link' } })
  })

  it('runs operations on the jam a full URL names; everyone sees the change and the agent', async () => {
    const slug = 'funky-otter-mc02'
    const person = await connectBoard(slug)
    const out = await call('run', {
      jam: `https://jambo.example/jam/${slug}`,
      kind: 'claude',
      summary: 'A kick on every beat',
      ops: [
        { op: 'assignPad', padId: 'r0c0', soundId: 'kick' },
        {
          op: 'addTrack',
          ref: 'new:kicks',
          track: {
            name: 'Kicks',
            bars: 1,
            hits: [0, 1, 2, 3].map((beat) => ({ padId: 'r0c0', beat })),
          },
        },
        { op: 'setTrack', id: 'new:kicks', patch: { gain: 0.8 } },
        { op: 'setTrack', id: 'missing', patch: { mute: true } },
      ],
    })
    expect(out.isError).toBe(false)
    expect(out.body).toMatchObject({
      summary: 'A kick on every beat',
      agent: { kind: 'Claude', name: expect.stringMatching(/ Claude$/) },
    })
    expect(out.body.ops.map((o: { op: string; ok: boolean }) => [o.op, o.ok])).toEqual([
      ['assignPad', true],
      ['addTrack', true],
      ['setTrack', true],
      ['setTrack', false],
    ])
    const id = out.body.ops[1].id
    await until(() => tracks(person.doc).get(id)?.get('gain') === 0.8)
    expect(tracks(person.doc).get(id)?.get('author')).toBe(`agent:${out.body.agent.id}`)
    await until(() => agentsSeenBy(person.awareness).some((a) => a.id === out.body.agent.id))

    // The same key is the same agent; join reads the jam with the track and the agent.
    const again = await call('join', { jam: slug, agentKey: out.body.agent.agentKey })
    expect(again.body.agent.id).toBe(out.body.agent.id)
    expect(again.body.board.tracks.map((t: { name: string }) => t.name)).toEqual(['Kicks'])
    expect(again.body.board.here.map((p: { name: string }) => p.name)).toEqual([
      out.body.agent.name,
    ])

    const left = await call('leave', { jam: slug, agentKey: out.body.agent.agentKey })
    expect(left.body).toEqual({ jam: slug, left: true })
    await until(() => agentsSeenBy(person.awareness).length === 0)
    person.close()
  })

  it('applies nothing when an operation is one agents cannot send', async () => {
    const slug = 'funky-otter-mc03'
    expect(
      await refused('run', {
        jam: slug,
        summary: 'Oops',
        ops: [{ op: 'setTempo', bpm: 120 }, { op: 'expireSounds' }],
      }),
    ).toBe(true)
    const person = await connectBoard(slug)
    expect(person.doc.getMap(ROOTS.meta).get('bpm')).toBe(100)
    person.close()
  })

  it('refuses a run of more than 64 operations', async () => {
    const slug = 'funky-otter-mc06'
    const ops = Array.from({ length: 65 }, () => ({ op: 'setTempo', bpm: 120 }))
    expect(await refused('run', { jam: slug, summary: 'Lots', ops })).toBe(true)
    const person = await connectBoard(slug)
    expect(person.doc.getMap(ROOTS.meta).get('bpm')).toBe(100)
    person.close()
  })

  it('refuses a run without a summary', async () => {
    const slug = 'funky-otter-mc04'
    const out = await call('run', { jam: slug, summary: '', ops: [{ op: 'setTempo', bpm: 120 }] })
    expect(out).toEqual({ isError: true, body: { error: 'A run needs a summary' } })
    const person = await connectBoard(slug)
    expect(agentsSeenBy(person.awareness)).toEqual([])
    person.close()
  })

  it('refuses the 21st call from one address within a minute', async () => {
    const ip = newAddress()
    for (let i = 0; i < 20; i++) {
      const out = await call('join', { jam: 'funky-otter-mc05', kind: 'claude' }, ip)
      expect(out.isError).toBe(false)
    }
    const out = await call('join', { jam: 'funky-otter-mc05' }, ip)
    expect(out).toEqual({
      isError: true,
      body: { error: 'too many requests, try again in a minute' },
    })
  })
})
