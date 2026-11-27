/**
 * The seam live voice travels through: a singer sends its stamped frames, and a listener gets
 * everyone else's, each with whose voice it is. The real one is Cloudflare Realtime DataChannels
 * (unordered, no retransmits); `FakeTransport` relays frames through the local Worker instead, so
 * local dev and the e2e tests run offline. Delivery is best effort either way: frames may arrive
 * late, out of order, twice or never, and the jitter buffer sorts that out.
 */
export interface LiveTransport {
  /** Sends one of this client's frames (`encodeFrame`'s bytes) to everyone listening. */
  send(frame: Uint8Array): void
  /** Calls `listener` with each frame of someone else's voice, by the voice id the room granted them. */
  onFrame(listener: (voice: string, frame: Uint8Array) => void): () => void
  /**
   * Stops receiving one voice (`on` false), or starts again: a muted voice is unsubscribed, so its
   * frames stop coming at all. Every voice is received until it is turned off here.
   */
  listen(voice: string, on: boolean): void
  /**
   * Publishes this client's voice as the live slot `voice` the room granted, or stops (undefined).
   * Frames sent while nothing is published go nowhere.
   */
  publish(voice: string | undefined): void
  /** Stops sending and listening. */
  close(): void
}
