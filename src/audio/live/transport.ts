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
  /** Calls `listener` with each frame of someone else's voice, by their seat's id. */
  onFrame(listener: (voice: string, frame: Uint8Array) => void): () => void
  /** Stops sending and listening. */
  close(): void
}
