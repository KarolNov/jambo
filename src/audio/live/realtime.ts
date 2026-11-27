import type { Awareness } from 'y-protocols/awareness'
import { CHANNEL_POLICY, type Description, type LiveCall } from '../../../shared/live'
import { listLive } from '../../board/presence'
import type { LiveTransport } from './transport'

/**
 * The most a voice channel may have queued before the singer drops a frame instead of sending it,
 * in bytes: about two frames. With no retransmits SCTP still queues under congestion, and a queued
 * frame only arrives later; a dropped one leaves a short gap and the rest stay on time (spike,
 * group 1: on a lossy 800 ms link, queueing made most frames late; dropping kept them on time).
 */
export const MAX_BUFFERED = 400

/** How long to wait for ICE gathering before answering with what is gathered, in ms. */
const GATHER_MS = 3_000
/** How long a connection may take to come up before it is given up, in ms. */
const CONNECT_MS = 30_000
/** Waits between tries at publishing or subscribing after a failure, in ms. */
const RETRY_MS = [500, 1_000, 2_000, 4_000, 8_000]

/** A connection to Realtime: one peer connection and its session, opened through the Worker. */
interface Connection {
  pc: RTCPeerConnection
  session: string
  ticket: string
}

/** A voice this client receives: its channel once subscribed. */
interface Subscription {
  /** The voice's publish count as last listed (`LiveVoice.rev`), 0 before it is published. */
  rev: number
  /** Whether a subscribe is under way for it. */
  trying?: boolean
  channel?: RTCDataChannel
  id?: number
  /** The connection `id` was allocated on. */
  on?: Connection
  /** Set when it should stop: muted, gone, or the transport closed. */
  ended?: boolean
}

/** The voice this client publishes, and its channel once open. */
interface Publishing {
  voice: string
  channel?: RTCDataChannel
  id?: number
  /** The connection `id` was allocated on. */
  on?: Connection
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

class RouteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/**
 * The real live transport: Cloudflare Realtime DataChannels, unordered and never retransmitted.
 * The Worker's session route (`worker/live.ts`) makes every Realtime API call; this client holds
 * one peer connection, publishes its voice on a channel of its own while it holds a live slot, and
 * subscribes to every other voice the room lists as live (Who's here), except those muted here.
 * It connects only once there is a voice to send or hear, and reconnects after a drop.
 */
export class RealtimeTransport implements LiveTransport {
  private listeners = new Set<(voice: string, frame: Uint8Array) => void>()
  private connection?: Promise<Connection>
  /** The connection once open, until it drops: channel ids are only closed on the one they're on. */
  private current?: Connection
  /** Realtime API calls on one session go one at a time, as it asks. */
  private queue: Promise<unknown> = Promise.resolve()
  private subs = new Map<string, Subscription>()
  private muted = new Set<string>()
  /** The voice this client publishes now, and its channel once open. */
  private publishing?: Publishing
  private failedListeners = new Set<() => void>()
  private closed = false
  /** Frames dropped on a full channel instead of sent, for the `?debug` readout. */
  dropped = 0

  constructor(
    private readonly slug: string,
    private readonly key: string,
    private readonly awareness: Awareness,
  ) {
    awareness.on('change', this.reconcile)
    this.reconcile()
  }

  send(frame: Uint8Array) {
    const channel = this.publishing?.channel
    if (channel?.readyState !== 'open') return
    if (channel.bufferedAmount > MAX_BUFFERED) {
      this.dropped++
      return
    }
    channel.send(frame as Uint8Array<ArrayBuffer>)
  }

  onFrame(listener: (voice: string, frame: Uint8Array) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  listen(voice: string, on: boolean) {
    if (on) this.muted.delete(voice)
    else {
      this.muted.add(voice)
      this.unsubscribe(voice)
    }
    this.reconcile()
  }

  publish(voice: string | undefined) {
    if (this.publishing?.voice === voice) return
    const was = this.publishing
    this.publishing = voice ? { voice } : undefined
    if (was) this.closeChannel(was.channel, was.id, was.on)
    if (this.publishing) void this.startPublishing(this.publishing)
  }

  onPublishFailed(listener: () => void) {
    this.failedListeners.add(listener)
    return () => {
      this.failedListeners.delete(listener)
    }
  }

  close() {
    this.closed = true
    this.awareness.off('change', this.reconcile)
    this.listeners.clear()
    this.failedListeners.clear()
    for (const voice of [...this.subs.keys()]) this.unsubscribe(voice, false)
    this.publishing?.channel?.close()
    this.publishing = undefined
    void this.connection?.then((c) => c.pc.close()).catch(() => undefined)
    this.connection = undefined
    this.current = undefined
  }

  /**
   * Subscribes to every voice listed live that isn't heard yet, again to one published anew (its
   * `rev` went up: the singer reconnected, or published for the first time), and drops those gone.
   */
  private reconcile = () => {
    if (this.closed) return
    const live = new Map(
      listLive(this.awareness.getStates().values()).map((l) => [l.voice, l.rev ?? 0]),
    )
    for (const voice of [...this.subs.keys()]) if (!live.has(voice)) this.unsubscribe(voice, false)
    for (const [voice, rev] of live) {
      if (this.muted.has(voice) || this.publishing?.voice === voice) continue
      const sub = this.subs.get(voice)
      if (!sub) {
        const fresh: Subscription = { rev }
        this.subs.set(voice, fresh)
        void this.subscribe(voice, fresh)
      } else if (sub.rev !== rev) {
        sub.rev = rev
        // One under way reads the new `rev` when it answers, and asks again.
        if (!sub.trying) void this.subscribe(voice, sub)
      }
    }
  }

  private async subscribe(voice: string, sub: Subscription) {
    sub.trying = true
    try {
      await this.trySubscribe(voice, sub)
    } finally {
      sub.trying = false
    }
  }

  private async trySubscribe(voice: string, sub: Subscription) {
    for (let attempt = 0; !sub.ended;) {
      const asked = sub.rev
      // Whatever channel it held came from an earlier publish, and carries nothing now.
      this.dropChannel(sub)
      try {
        const c = await this.connect()
        if (sub.ended) return
        const { id } = await this.call<{ id: number }>('subscribe', { voice }, c)
        if (sub.ended) return this.closeChannel(undefined, id, c)
        const channel = this.openChannel(c, voice, id)
        Object.assign(sub, { id, on: c, channel })
        channel.onmessage = (e: MessageEvent<ArrayBuffer>) => {
          if (sub.ended || sub.channel !== channel) return
          const bytes = new Uint8Array(e.data)
          for (const l of this.listeners) l(voice, bytes)
        }
        // Published again while this was asked for: ask again, for the new one.
        if (sub.rev === asked) return
      } catch (e) {
        // No longer live, or this client's own voice: nothing to hear.
        if (e instanceof RouteError && e.status === 404) return
        // Live but not published yet: its publish lists a new `rev`, and that asks again.
        if (e instanceof RouteError && e.status === 409) {
          if (sub.rev === asked) return
          continue
        }
        // Anything else (not seated yet, a network error) is tried again a little later; past the
        // last try it stays listed, and is asked for again when the voice is next published.
        if (attempt >= RETRY_MS.length) return
        await wait(RETRY_MS[attempt++]!)
      }
    }
  }

  /** Lets go of the channel `sub` holds, if any. */
  private dropChannel(sub: Subscription) {
    this.closeChannel(sub.channel, sub.id, sub.on)
    sub.channel = sub.id = sub.on = undefined
  }

  private unsubscribe(voice: string, tellRealtime = true) {
    const sub = this.subs.get(voice)
    if (!sub) return
    this.subs.delete(voice)
    sub.ended = true
    // A muted voice is really unsubscribed, so its frames stop coming and cost nothing.
    if (tellRealtime) this.closeChannel(sub.channel, sub.id, sub.on)
    else sub.channel?.close()
  }

  /**
   * Publishes `p` until it is replaced or published, trying again after a failure; past the last
   * try, tells `onPublishFailed`, since a singer nobody hears must not look live.
   */
  private async startPublishing(p: Publishing) {
    for (let attempt = 0; this.publishing === p; attempt++) {
      try {
        const c = await this.connect()
        if (this.publishing !== p) return
        const { id } = await this.call<{ id: number }>('publish', {}, c)
        if (this.publishing !== p) return this.closeChannel(undefined, id, c)
        p.id = id
        p.on = c
        p.channel = this.openChannel(c, `voice-${p.voice}`, id)
        return
      } catch (e) {
        if (this.publishing !== p) return
        // The slot ended: Live hears that from the room.
        if (e instanceof RouteError && e.status === 403 && e.message === 'Not live') return
        if (attempt >= RETRY_MS.length) {
          console.warn('live: could not publish', e)
          for (const l of this.failedListeners) l()
          return
        }
        await wait(RETRY_MS[attempt]!)
      }
    }
  }

  /** The browser end of a negotiated channel `id`, with the policy every end agrees on. */
  private openChannel(c: Connection, name: string, id: number) {
    const channel = c.pc.createDataChannel(name, { negotiated: true, id, ...CHANNEL_POLICY })
    channel.binaryType = 'arraybuffer'
    return channel
  }

  /**
   * Closes a channel here, and on Realtime once it was allocated there: on the connection `on` it
   * was allocated on, while that is still the one open. Ids are per session, so an id from a
   * dropped connection may name another channel on the new one; the dropped session's are gone.
   */
  private closeChannel(
    channel: RTCDataChannel | undefined,
    id: number | undefined,
    on: Connection | undefined,
  ) {
    channel?.close()
    if (id === undefined || !on || this.closed || on !== this.current) return
    void this.call('close', { ids: [id] }, on).catch(() => undefined)
  }

  /** The connection to Realtime, opening it the first time and after one drops. */
  private connect(): Promise<Connection> {
    this.connection ??= this.open().catch((e) => {
      this.connection = undefined
      throw e
    })
    return this.connection
  }

  private async open(): Promise<Connection> {
    const { session, ticket, offer } = await this.post<{
      session: string
      ticket: string
      offer: Description
    }>('session', {})
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
      bundlePolicy: 'max-bundle',
    })
    const c: Connection = { pc, session, ticket }
    try {
      await pc.setRemoteDescription(offer)
      await pc.setLocalDescription(await pc.createAnswer())
      await gathered(pc)
      const answer = pc.localDescription!
      await this.call('answer', { answer: { type: answer.type, sdp: answer.sdp } }, c)
      await connected(pc)
    } catch (e) {
      pc.close()
      throw e
    }
    if (this.closed) {
      pc.close()
      throw new Error('live: closed')
    }
    this.current = c
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState !== 'failed' && pc.connectionState !== 'closed') return
      void this.reconnect(c)
    })
    return c
  }

  /** The connection dropped: start over on a new one, publishing and subscribing again. */
  private async reconnect(c: Connection) {
    if (this.closed || (await this.connection?.catch(() => undefined)) !== c) return
    c.pc.close()
    this.connection = undefined
    this.current = undefined
    for (const voice of [...this.subs.keys()]) this.unsubscribe(voice, false)
    const voice = this.publishing?.voice
    this.publishing = undefined
    if (voice) this.publish(voice)
    this.reconcile()
  }

  /** A route call on session `c`, queued behind the others on it. */
  private call<T = unknown>(call: LiveCall, body: object, c: Connection): Promise<T> {
    const next = this.queue.then(() =>
      this.post<T>(call, { ...body, session: c.session, ticket: c.ticket }),
    )
    this.queue = next.catch(() => undefined)
    return next
  }

  private async post<T>(call: LiveCall, body: object): Promise<T> {
    const res = await fetch(`/api/jams/${this.slug}/live/${call}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, key: this.key }),
    })
    if (res.status === 204) return undefined as T
    const json = (await res.json().catch(() => ({}))) as T & { error?: string }
    if (!res.ok) throw new RouteError(res.status, json.error ?? `live ${call}: ${res.status}`)
    return json
  }
}

/** Resolves once `pc` has gathered its ICE candidates, or after `GATHER_MS` with what it has. */
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') done()
    }
    const timer = setTimeout(done, GATHER_MS)
    pc.addEventListener('icegatheringstatechange', onChange)
  })
}

/** Resolves once `pc` is connected; rejects if it fails or takes longer than `CONNECT_MS`. */
function connected(pc: RTCPeerConnection): Promise<void> {
  if (pc.connectionState === 'connected') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer)
      pc.removeEventListener('connectionstatechange', onChange)
      if (error) reject(error)
      else resolve()
    }
    const onChange = () => {
      if (pc.connectionState === 'connected') finish()
      else if (pc.connectionState === 'failed' || pc.connectionState === 'closed')
        finish(new Error(`live: connection ${pc.connectionState}`))
    }
    const timer = setTimeout(() => finish(new Error('live: connection timed out')), CONNECT_MS)
    pc.addEventListener('connectionstatechange', onChange)
  })
}
