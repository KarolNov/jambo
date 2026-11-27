import type YProvider from 'y-partyserver/provider'
import { type LiveTransportKind, toTransportKind } from '../../../shared/live'
import { FakeTransport } from './fake'
import { RealtimeTransport } from './realtime'
import type { LiveTransport } from './transport'

/** Waits between tries at `GET /api/live` after a failure, in ms; the last repeats. */
const RETRY_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000]

/**
 * Which transport the Worker offers. Only its answer says `none`: a failed request (offline, a
 * deploy in progress) is tried again, so a blip at page load doesn't turn live voice off.
 */
async function askKind(isClosed: () => boolean): Promise<LiveTransportKind> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch('/api/live')
      if (res.ok) {
        const body = (await res.json()) as { transport?: unknown }
        return toTransportKind(body.transport)
      }
    } catch {
      // Tried again below.
    }
    if (isClosed()) return 'none'
    await new Promise((r) => setTimeout(r, RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]))
  }
}

/**
 * The live transport this Worker offers (`GET /api/live`), behind one that can be used at once:
 * calls made before the answer are kept and passed on. `kind` says which it turned out to be;
 * `none` where live voice isn't set up, and then nothing is sent or heard. It waits out a failed
 * request (see `askKind`), so it may be a while before it settles.
 */
export class PickedTransport implements LiveTransport {
  readonly kind: Promise<LiveTransportKind>
  private inner?: LiveTransport
  private listeners = new Set<(voice: string, frame: Uint8Array) => void>()
  private failedListeners = new Set<() => void>()
  private muted = new Set<string>()
  private voice?: string
  private closed = false

  constructor(slug: string, provider: YProvider, key: string) {
    this.kind = askKind(() => this.closed)
    void this.kind.then((kind) => {
      if (this.closed || kind === 'none') return
      const inner =
        kind === 'fake'
          ? new FakeTransport(provider)
          : new RealtimeTransport(slug, key, provider.awareness)
      for (const voice of this.muted) inner.listen(voice, false)
      inner.onFrame((voice, frame) => {
        for (const l of this.listeners) l(voice, frame)
      })
      inner.onPublishFailed(() => {
        for (const l of this.failedListeners) l()
      })
      if (this.voice) inner.publish(this.voice)
      this.inner = inner
    })
  }

  send(frame: Uint8Array) {
    this.inner?.send(frame)
  }

  onFrame(listener: (voice: string, frame: Uint8Array) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  listen(voice: string, on: boolean) {
    if (on) this.muted.delete(voice)
    else this.muted.add(voice)
    this.inner?.listen(voice, on)
  }

  publish(voice: string | undefined) {
    this.voice = voice
    this.inner?.publish(voice)
  }

  onPublishFailed(listener: () => void) {
    this.failedListeners.add(listener)
    return () => {
      this.failedListeners.delete(listener)
    }
  }

  close() {
    this.closed = true
    this.listeners.clear()
    this.failedListeners.clear()
    this.inner?.close()
  }
}
