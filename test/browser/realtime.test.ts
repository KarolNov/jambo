import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { RealtimeTransport } from '../../src/audio/live/realtime'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** A data channel as RealtimeTransport uses one: open at once, closed on `close`. */
class FakeChannel {
  readyState = 'open'
  bufferedAmount = 0
  binaryType = 'blob'
  onmessage?: (e: { data: ArrayBuffer }) => void
  constructor(
    readonly label: string,
    readonly id: number,
  ) {}
  send() {}
  close() {
    this.readyState = 'closed'
  }
}

/** A peer connection that connects at once, and fails when a test says so. */
class FakePeer extends EventTarget {
  static all: FakePeer[] = []
  iceGatheringState = 'complete'
  connectionState = 'connected'
  localDescription?: { type: string; sdp: string }
  channels: FakeChannel[] = []
  constructor() {
    super()
    FakePeer.all.push(this)
  }
  async setRemoteDescription() {}
  async createAnswer() {
    return { type: 'answer', sdp: 'v=0 answer' }
  }
  async setLocalDescription(d: { type: string; sdp: string }) {
    this.localDescription = d
  }
  createDataChannel(label: string, { id }: { id: number }) {
    const channel = new FakeChannel(label, id)
    this.channels.push(channel)
    return channel
  }
  close() {
    this.connectionState = 'closed'
  }
  fail() {
    this.connectionState = 'failed'
    this.dispatchEvent(new Event('connectionstatechange'))
  }
}

type Call = { call: string; body: Record<string, unknown> }
type Reply = Response | Promise<Response>

/**
 * The session route as a test scripts it: each call is recorded, then answered by `reply`, or as
 * the route would when all goes well (a session per `session`, a channel id per channel call).
 */
function route(reply: (c: Call) => Reply | undefined = () => undefined) {
  const calls: Call[] = []
  let sessions = 0
  let ids = 0
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const call = url.split('/').pop()!
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    const c = { call, body }
    calls.push(c)
    const scripted = reply(c)
    if (scripted) return scripted
    if (call === 'session')
      return Response.json(
        { session: `s${++sessions}`, ticket: 't', offer: { type: 'offer', sdp: 'v=0' } },
        { status: 201 },
      )
    if (call === 'publish' || call === 'subscribe')
      return Response.json({ id: ++ids }, { status: 201 })
    return new Response(null, { status: 204 })
  })
  vi.stubGlobal('RTCPeerConnection', FakePeer)
  FakePeer.all = []
  return calls
}

/** The room's state as a listener reads it: who is live, and how often each was published. */
function room() {
  const awareness = new Awareness(new Y.Doc())
  const setLive = (live: { voice: string; rev?: number }[]) =>
    awareness.setLocalState({
      live: live.map((l) => ({ ...l, name: 'Misty Yak', color: 'teal' })),
    })
  awareness.setLocalState(null)
  return { awareness, setLive }
}

const settle = () => new Promise((r) => setTimeout(r, 0))
const named = (calls: Call[], name: string) => calls.filter((c) => c.call === name)

describe('RealtimeTransport', () => {
  it('waits for a live voice to be published, then subscribes again each time it is', async () => {
    let published = false
    const calls = route((c) =>
      c.call === 'subscribe' && !published
        ? Response.json({ error: 'Not published yet' }, { status: 409 })
        : undefined,
    )
    const { awareness, setLive } = room()
    const t = new RealtimeTransport('funky-otter-k7q2', 'k', awareness)
    setLive([{ voice: 'v1' }])
    await vi.waitUntil(() => named(calls, 'subscribe').length === 1)
    await new Promise((r) => setTimeout(r, 700))
    // Not asked again until it is published: no polling.
    expect(named(calls, 'subscribe')).toHaveLength(1)

    published = true
    setLive([{ voice: 'v1', rev: 1 }])
    await vi.waitUntil(() => named(calls, 'subscribe').length === 2)
    await settle()
    const first = FakePeer.all[0]!.channels.at(-1)!
    expect(first.readyState).toBe('open')

    // The singer reconnected and published again: the old channel is let go, a new one asked for.
    setLive([{ voice: 'v1', rev: 2 }])
    await vi.waitUntil(() => named(calls, 'subscribe').length === 3)
    expect(first.readyState).toBe('closed')
    await vi.waitUntil(() => named(calls, 'close').length === 1)
    expect(named(calls, 'close')[0]!.body.ids).toEqual([first.id])
    t.close()
  })

  it("doesn't close a channel id from a dropped connection on the new one", async () => {
    let answer!: (r: Response) => void
    const held = new Promise<Response>((r) => (answer = r))
    const calls = route((c) =>
      c.call === 'subscribe' && c.body.session === 's1' ? held : undefined,
    )
    const { awareness, setLive } = room()
    const t = new RealtimeTransport('funky-otter-k7q2', 'k', awareness)
    setLive([{ voice: 'v1', rev: 1 }])
    await vi.waitUntil(() => named(calls, 'subscribe').length === 1)
    // The connection drops while Realtime is still answering the subscribe on it.
    FakePeer.all[0]!.fail()
    await vi.waitUntil(() => named(calls, 'session').length === 2)
    answer(Response.json({ id: 1 }, { status: 201 }))
    await vi.waitUntil(() => named(calls, 'subscribe').length === 2)
    await new Promise((r) => setTimeout(r, 50))
    // Id 1 was on the dropped session: closing it on the new one would close another channel.
    expect(named(calls, 'close')).toEqual([])
    t.close()
  })

  it('tries publishing again after a failure, and says so when it never works', async () => {
    vi.useFakeTimers()
    let failing = 1
    const calls = route((c) =>
      c.call === 'publish' && failing-- > 0
        ? Response.json({ error: "Couldn't reach live voice, try again" }, { status: 502 })
        : undefined,
    )
    const { awareness } = room()
    const t = new RealtimeTransport('funky-otter-k7q2', 'k', awareness)
    const failed = vi.fn()
    t.onPublishFailed(failed)
    t.publish('v1')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(named(calls, 'publish')).toHaveLength(2)
    expect(FakePeer.all[0]!.channels.map((c) => c.label)).toEqual(['voice-v1'])
    expect(failed).not.toHaveBeenCalled()

    t.publish(undefined)
    failing = Infinity
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    t.publish('v2')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(named(calls, 'publish')).toHaveLength(2 + 6)
    expect(failed).toHaveBeenCalledOnce()
    t.close()
  })
})
