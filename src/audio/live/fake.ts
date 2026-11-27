import type YProvider from 'y-partyserver/provider'
import { fromBase64, parseRelayMessage, relayOut } from '../../../shared/live'
import type { LiveTransport } from './transport'

/**
 * The fake live transport: frames go over the jam's board connection, and the room relays them to
 * everyone else connected. The room only relays for connections to a local Worker (`worker/live.ts`),
 * so this carries voice in local dev and the e2e tests, and nowhere else.
 */
export class FakeTransport implements LiveTransport {
  private listeners = new Set<(voice: string, frame: Uint8Array) => void>()
  /** Voices not listened to. The room relays every frame over the one connection, so they are
   * dropped here, as they arrive. */
  private muted = new Set<string>()

  constructor(private readonly provider: YProvider) {
    provider.on('custom-message', this.onMessage)
  }

  send(frame: Uint8Array) {
    if (this.provider.wsconnected) this.provider.sendMessage(relayOut(frame))
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
  }

  /** Nothing to do: the room relays only a slot holder's frames, whichever voice that is. */
  publish() {}

  /** Never: there is nothing to publish. */
  onPublishFailed() {
    return () => {}
  }

  close() {
    this.provider.off('custom-message', this.onMessage)
    this.listeners.clear()
  }

  private onMessage = (message: string) => {
    const msg = parseRelayMessage(message)
    if (!msg?.v || this.muted.has(msg.v)) return
    const frame = fromBase64(msg.f)
    if (frame) for (const l of this.listeners) l(msg.v, frame)
  }
}
