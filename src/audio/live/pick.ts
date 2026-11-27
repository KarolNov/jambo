import type YProvider from 'y-partyserver/provider'
import { type LiveTransportKind, toTransportKind } from '../../../shared/live'
import { FakeTransport } from './fake'
import { RealtimeTransport } from './realtime'
import type { LiveTransport } from './transport'

/**
 * The live transport this Worker offers (`GET /api/live`), behind one that can be used at once:
 * calls made before the answer are kept and passed on. `kind` says which it turned out to be;
 * `none` where live voice isn't set up, and then nothing is sent or heard.
 */
export class PickedTransport implements LiveTransport {
  readonly kind: Promise<LiveTransportKind>
  private inner?: LiveTransport
  private listeners = new Set<(voice: string, frame: Uint8Array) => void>()
  private muted = new Set<string>()
  private voice?: string
  private closed = false

  constructor(slug: string, provider: YProvider, key: string) {
    this.kind = fetch('/api/live')
      .then((res) => (res.ok ? res.json() : {}))
      .then((body: { transport?: unknown }) => toTransportKind(body.transport))
      .catch((): LiveTransportKind => 'none')
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

  close() {
    this.closed = true
    this.listeners.clear()
    this.inner?.close()
  }
}
