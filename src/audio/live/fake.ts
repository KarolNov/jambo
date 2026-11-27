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

  close() {
    this.provider.off('custom-message', this.onMessage)
    this.listeners.clear()
  }

  private onMessage = (message: string) => {
    const msg = parseRelayMessage(message)
    if (!msg?.v) return
    const frame = fromBase64(msg.f)
    if (frame) for (const l of this.listeners) l(msg.v, frame)
  }
}
