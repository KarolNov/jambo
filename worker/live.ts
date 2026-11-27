/**
 * Live voice in the Worker. For now only the fake transport's relay: the room passes one person's
 * stamped frames to everyone else over the board connection, so local dev and the e2e tests can
 * sing live with no Realtime app. It relays only for connections made to a local Worker, so a
 * deployed room never carries audio.
 */

import { LIVE } from '../shared/live'

/** The hosts a local Worker answers on. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Whether the room relays fake live frames for a connection opened to `url`. */
export function relaysFake(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}

/** How long without a frame before a voice counts as stopped, in ms. */
export const VOICE_IDLE_MS = 2_000

/**
 * The room's live voices, for `LIVE`'s limits: at most `maxVoices` at once (a new voice past that
 * is refused until one stops), and none longer than `maxMs` (its frames are refused after that,
 * until it has been quiet for `VOICE_IDLE_MS` and starts again).
 */
export class LiveVoices {
  private voices = new Map<string, { since: number; last: number }>()

  /** Whether a frame from `voice` at time `now` (ms) is relayed. */
  admit(voice: string, now: number): boolean {
    for (const [id, v] of this.voices) if (now - v.last > VOICE_IDLE_MS) this.voices.delete(id)
    const v = this.voices.get(voice)
    if (!v) {
      if (this.voices.size >= LIVE.maxVoices) return false
      this.voices.set(voice, { since: now, last: now })
      return true
    }
    v.last = now
    return now - v.since <= LIVE.maxMs
  }
}
