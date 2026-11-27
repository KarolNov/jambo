/**
 * Live voice playback, run on the audio thread: plays each decoded frame of one voice from the
 * context frame it was scheduled for (stamp + one bar), and fades in and out over a few ms at every
 * gap left by a frame that never came, so a dropped frame is a short hole rather than a click.
 * Loaded with `audioWorklet.addModule` (see `./playback`), which registers it as
 * `PLAYBACK_PROCESSOR` there; nothing imports this file.
 *
 * Messages in: `{ id, at, samples }`, a frame to play from context frame `at`; `'clear'` drops
 * everything queued. Messages out: `{ played: id, frame }` once a frame's first sample is out, at
 * the context frame it went out on; `{ late: id }` for a frame whose time had passed.
 */

// The AudioWorklet global scope, which the DOM lib doesn't describe.
declare const sampleRate: number
declare const currentFrame: number
declare function registerProcessor(name: string, processor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

/** How long each fade at a gap lasts, in seconds. */
const FADE_SECONDS = 0.0025
/** Frames this close (in samples) to the one before count as following straight on. */
const TOLERANCE = 2

interface Chunk {
  id: number
  at: number
  samples: Float32Array
  /** Where in the chunk its fade-in starts, once it has started playing; undefined: no fade-in. */
  fadeFrom?: number
  /** Whether it has started playing. */
  started: boolean
  /** Whether it fades out at its end (nothing followed straight on when it got there). */
  fadeOut?: boolean
}

class Playback extends AudioWorkletProcessor {
  /** Frames queued, by `at`. */
  private chunks: Chunk[] = []
  private readonly fade = Math.max(1, Math.round(FADE_SECONDS * sampleRate))
  /** Where the last chunk played ended, and whether it faded out there. */
  private lastEnd = -Infinity
  private lastFaded = true

  constructor() {
    super()
    this.port.onmessage = (
      e: MessageEvent<'clear' | { id: number; at: number; samples: Float32Array }>,
    ) => {
      if (e.data === 'clear') {
        this.chunks = []
        return
      }
      const { id, at, samples } = e.data
      if (at + samples.length <= currentFrame) return this.port.postMessage({ late: id })
      const chunk: Chunk = { id, at, samples, started: false }
      let i = this.chunks.length
      while (i > 0 && this.chunks[i - 1]!.at > at) i--
      this.chunks.splice(i, 0, chunk)
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0]?.[0]
    if (!out) return true
    const start = currentFrame
    const end = start + out.length
    // Frames whose time has wholly passed are gone.
    while (this.chunks.length > 0 && this.chunks[0]!.at + this.chunks[0]!.samples.length <= start) {
      const gone = this.chunks.shift()!
      if (!gone.started) this.port.postMessage({ late: gone.id })
    }
    for (let c = 0; c < this.chunks.length; c++) {
      const chunk = this.chunks[c]!
      if (chunk.at >= end) break
      const n = chunk.samples.length
      const from = Math.max(0, start - chunk.at)
      if (!chunk.started) {
        chunk.started = true
        // Straight on from the last frame: no fade. After a gap, or joined late, fade in.
        const follows = Math.abs(chunk.at - this.lastEnd) <= TOLERANCE && !this.lastFaded
        chunk.fadeFrom = follows && from === 0 ? undefined : from
        this.port.postMessage({ played: chunk.id, frame: chunk.at + from })
      }
      // Near its end, decide whether anything follows straight on.
      if (chunk.fadeOut === undefined && chunk.at + n - this.fade < end) {
        const next = this.chunks[c + 1]
        chunk.fadeOut = !next || Math.abs(next.at - (chunk.at + n)) > TOLERANCE
      }
      for (let k = from; k < n && chunk.at + k < end; k++) {
        let g = 1
        if (chunk.fadeFrom !== undefined) g = Math.min(g, (k - chunk.fadeFrom + 1) / this.fade)
        if (chunk.fadeOut) g = Math.min(g, (n - k) / this.fade)
        out[chunk.at + k - start] = chunk.samples[k]! * g
      }
      if (chunk.at + n <= end) {
        this.lastEnd = chunk.at + n
        this.lastFaded = !!chunk.fadeOut
      }
    }
    return true
  }
}

registerProcessor('jambo-live-playback', Playback)

export {}
