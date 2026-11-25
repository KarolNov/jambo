import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { ROOTS } from '../shared/board'
import { UPLOADS } from '../shared/sounds'
import { encodeWav } from '../shared/wav'
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

const KNOBS = ['reverb', 'echo', 'tone', 'pitch', 'pan']
const MASTER = ['drive', 'width', 'swing', 'filter', 'throw', 'lofi', 'repeat']
const OPS = [
  'setTempo',
  'assignPad',
  'replaceSound',
  'addTrack',
  'setTrack',
  'removeTrack',
  'setMaster',
  'setFx',
]

describe('the MCP server', () => {
  // @scenario collab/agent: Client without the skill
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
    for (const word of [
      ...OPS,
      'bpm',
      'pads',
      'sounds',
      'tracks',
      'master',
      'here',
      ...KNOBS,
      ...MASTER,
      'Held by',
    ])
      expect(instructions).toContain(word)
    const list = await rpc('tools/list', {}, ip)
    const tools: { name: string; inputSchema: unknown }[] = list.result.tools
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['join', 'run', 'leave']))
    const runSchema = JSON.stringify(tools.find((t) => t.name === 'run')!.inputSchema)
    for (const op of OPS) expect(runSchema).toContain(`"${op}"`)
    for (const knob of KNOBS) expect(runSchema).toContain(`"${knob}"`)
    for (const control of MASTER) expect(runSchema).toContain(`"${control}"`)
  })

  // @scenario collab/agent: Bad jam
  it('refuses a jam that is not one', async () => {
    const out = await call('join', { jam: 'not a jam' })
    expect(out).toEqual({ isError: true, body: { error: '"not a jam" is not a jam link' } })
  })

  // @scenario collab/agent: Link as key
  // @scenario collab/agent: First action
  // @scenario collab/agent: Auto join
  // @scenario collab/agent: Leave
  it('runs operations on the jam a full URL names; everyone sees the change and the agent', async () => {
    const slug = 'funky-otter-mc02'
    const person = await connectBoard(slug)
    const out = await call('run', {
      jam: `http://jambo.test/jam/${slug}`,
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

  // @scenario collab/agent: Track with echo
  it('adds a track with echo and pan that everyone in the jam gets', async () => {
    const slug = 'funky-otter-mc0e'
    const person = await connectBoard(slug)
    const out = await call('run', {
      jam: slug,
      kind: 'claude',
      summary: 'A wide echoing snare',
      ops: [
        {
          op: 'addTrack',
          track: {
            name: 'Echoes',
            bars: 1,
            hits: [{ padId: 'r0c1', beat: 1 }],
            echo: 0.4,
            pan: 0.5,
          },
        },
      ],
    })
    expect(out.isError).toBe(false)
    expect(out.body.ops[0]).toMatchObject({ op: 'addTrack', ok: true })
    const id = out.body.ops[0].id
    await until(() => tracks(person.doc).has(id))
    expect(tracks(person.doc).get(id)?.get('echo')).toBe(0.4)
    expect(tracks(person.doc).get(id)?.get('pan')).toBe(0.5)

    const read = await call('join', { jam: slug, agentKey: out.body.agent.agentKey })
    expect(read.body.board.tracks[0]).toMatchObject({ name: 'Echoes', echo: 0.4, pan: 0.5 })
    person.close()
  })

  // @scenario collab/agent: Malformed run
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

  // @scenario collab/agent: Too many operations
  it('refuses a run of more than 64 operations', async () => {
    const slug = 'funky-otter-mc09'
    const ops = Array.from({ length: 65 }, () => ({ op: 'setTempo', bpm: 120 }))
    expect(await refused('run', { jam: slug, summary: 'Lots', ops })).toBe(true)
    const person = await connectBoard(slug)
    expect(person.doc.getMap(ROOTS.meta).get('bpm')).toBe(100)
    person.close()
  })

  // @scenario collab/agent: No summary
  it('refuses a run without a summary', async () => {
    const slug = 'funky-otter-mc04'
    const out = await call('run', { jam: slug, summary: '', ops: [{ op: 'setTempo', bpm: 120 }] })
    expect(out).toEqual({ isError: true, body: { error: 'A run needs a summary' } })
    const person = await connectBoard(slug)
    expect(agentsSeenBy(person.awareness)).toEqual([])
    person.close()
  })

  // @scenario collab/agent: Fourth from one address
  it('seats at most 3 agents from one address; a key gets back in', async () => {
    const ip = newAddress()
    const jam = 'funky-otter-mc07'
    const keys: string[] = []
    for (let i = 0; i < 3; i++) keys.push((await call('join', { jam }, ip)).body.agent.agentKey)
    const fourth = await call('join', { jam }, ip)
    expect(fourth.isError).toBe(true)
    expect(fourth.body.error).toMatch(/pass your agentKey/)
    expect((await call('join', { jam, agentKey: keys[0] }, ip)).isError).toBe(false)
    expect((await call('join', { jam })).isError).toBe(false)
  })

  // @scenario collab/agent: 21st call
  it('refuses the 21st call from one address within a minute', async () => {
    const ip = newAddress()
    let agentKey: string | undefined
    for (let i = 0; i < 20; i++) {
      const jam = { jam: 'funky-otter-mc05', kind: 'claude', ...(agentKey ? { agentKey } : {}) }
      const out = await call('join', jam, ip)
      expect(out.isError).toBe(false)
      agentKey = out.body.agent.agentKey
    }
    const out = await call('join', { jam: 'funky-otter-mc05', agentKey }, ip)
    expect(out).toEqual({
      isError: true,
      body: { error: 'too many requests, try again in a minute' },
    })
  })
})

const base64 = (bytes: Uint8Array) => {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

const monoWav = (seconds: number) =>
  encodeWav(
    Float32Array.from({ length: Math.round(seconds * UPLOADS.sampleRate) }, (_, i) =>
      Math.sin(i / 10),
    ),
    UPLOADS.sampleRate,
  )

/** A 16-bit stereo WAV header with a little silence: the room takes mono only. */
function stereoWav() {
  const data = 4 * 1000
  const buf = new ArrayBuffer(44 + data)
  const v = new DataView(buf)
  const text = (at: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  v.setUint32(4, 36 + data, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 2, true)
  v.setUint32(24, UPLOADS.sampleRate, true)
  v.setUint32(28, UPLOADS.sampleRate * 4, true)
  v.setUint16(32, 4, true)
  v.setUint16(34, 16, true)
  text(36, 'data')
  v.setUint32(40, data, true)
  return new Uint8Array(buf)
}

describe('agent uploads', () => {
  // @scenario collab/agent: Upload
  it('uploads a WAV the agent is author of, which a run can put on a pad', async () => {
    const slug = 'funky-otter-mc06'
    const person = await connectBoard(slug)
    const up = await call('upload_sound', {
      jam: slug,
      kind: 'claude',
      soundName: 'Vox',
      wav: base64(monoWav(2)),
    })
    expect(up.isError).toBe(false)
    expect(up.body.sound).toMatchObject({
      name: 'Vox',
      author: `agent:${up.body.agent.id}`,
      authorName: up.body.agent.name,
      color: up.body.agent.color,
      durationMs: 2000,
    })
    await until(() => person.doc.getMap(ROOTS.sounds).has(up.body.id))
    const run = await call('run', {
      jam: slug,
      agentKey: up.body.agent.agentKey,
      summary: 'Vox on Q',
      ops: [{ op: 'assignPad', padId: 'r1c0', soundId: up.body.id }],
    })
    expect(run.body.ops).toEqual([{ op: 'assignPad', ok: true }])
    person.close()
  })

  // @scenario collab/agent: WAV from ffmpeg
  it('takes a WAV with extra chunks, as base64url wrapped in CRLF lines', async () => {
    // What ffmpeg writes: a LIST chunk between fmt and data.
    const plain = monoWav(1)
    const list = new Uint8Array(
      [...'LIST', 6, 0, 0, 0, ...'INFOab'].map((c) =>
        typeof c === 'string' ? c.charCodeAt(0) : c,
      ),
    )
    const wav = new Uint8Array(plain.length + list.length)
    wav.set(plain.subarray(0, 36))
    wav.set(list, 36)
    wav.set(plain.subarray(36), 36 + list.length)
    new DataView(wav.buffer).setUint32(4, wav.length - 8, true)
    const url = base64(wav).replace(/\+/g, '-').replace(/\//g, '_')
    const out = await call('upload_sound', {
      jam: 'funky-otter-mc11',
      soundName: 'Tagged',
      wav: url.replace(/.{76}/g, '$&\r\n'),
    })
    expect(out.isError).toBe(false)
    expect(out.body.sound).toMatchObject({ durationMs: 1000, bytes: plain.length })
  })

  it('refuses a file bigger than an upload can be', async () => {
    const out = await call('upload_sound', {
      jam: 'funky-otter-mc12',
      soundName: 'Huge',
      wav: base64(new Uint8Array(UPLOADS.maxBytes + 3)),
    })
    expect(out).toMatchObject({ isError: true, body: { error: 'The file is too big' } })
  })

  it('refuses the 11th upload from one address within a minute', async () => {
    const ip = newAddress()
    const args = { jam: 'funky-otter-mc13', soundName: 'X', wav: '%%%' }
    for (let i = 0; i < 10; i++)
      expect((await call('upload_sound', args, ip)).body.error).toBe('wav is not base64')
    expect((await call('upload_sound', args, ip)).body.error).toBe(
      'Too many uploads, try again in a minute',
    )
  })

  // @scenario collab/agent: Wrong format
  it('refuses a stereo WAV and stores nothing', async () => {
    const slug = 'funky-otter-mc10'
    const out = await call('upload_sound', {
      jam: slug,
      soundName: 'Wide',
      wav: base64(stereoWav()),
    })
    expect(out).toMatchObject({ isError: true, body: { error: 'Only mono is accepted' } })
    const person = await connectBoard(slug)
    expect(person.doc.getMap(ROOTS.sounds).size).toBe(0)
    const listed = await env.SOUND_FILES.list({ prefix: `jams/${slug}/` })
    expect(listed.objects).toEqual([])
    person.close()
  })

  it('refuses something that is not base64', async () => {
    const out = await call('upload_sound', { jam: 'funky-otter-mc08', soundName: 'X', wav: '%%%' })
    expect(out).toMatchObject({ isError: true, body: { error: 'wav is not base64' } })
  })
})
