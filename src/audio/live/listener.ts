import { type LiveFrame, livePlayAt } from '../../../shared/live'
import { JitterBuffer } from './jitter'
import { LivePlayback } from './playback'

/** How often the jitter buffer hands on what is due, in ms. */
const DRAIN_MS = 10

/** Whether this browser can play a live voice. */
export const canDecode = () => typeof AudioDecoder !== 'undefined'

/** The jam's timing as a listener needs it: room → audio shift, tempo, and the room time now. */
export type ListenTiming = () => { shift: number; bpm: number; now: number } | undefined

/** A frame that played, for the debug readout and the e2e tests: its stamp, and when it played. */
export interface Played {
  voice: string
  seq: number
  stamp: number
  /** The room time its first sample went out at, on this listener's shift. */
  at: number
}

/**
 * One live voice on a listener: frames go into its jitter buffer as they arrive, leave it in stamp
 * order shortly before they play, are decoded, and go to the playback worklet to start at stamp +
 * one bar on this context's timeline.
 */
export class LiveListener {
  private readonly jitter: JitterBuffer
  private decoder: AudioDecoder
  private readonly timer: ReturnType<typeof setInterval>
  /**
   * Frames being decoded, in order: Opus gives one output per frame, in order, but timestamps it on
   * its own count, so outputs are matched to frames by order rather than by timestamp.
   */
  private decoding: LiveFrame[] = []
  /** Frames handed to playback, by id, until they play. */
  private pending = new Map<number, LiveFrame>()
  private nextId = 0
  private stopEvents: () => void

  static async open(
    ctx: AudioContext,
    output: AudioNode,
    voice: string,
    timing: ListenTiming,
    onPlayed: (p: Played) => void,
  ): Promise<LiveListener | undefined> {
    const t = timing()
    if (!t || !canDecode()) return undefined
    const playback = await LivePlayback.open(ctx, output)
    return new LiveListener(ctx, playback, voice, t.now, timing, onPlayed)
  }

  private constructor(
    private readonly ctx: AudioContext,
    private readonly playback: LivePlayback,
    private readonly voice: string,
    since: number,
    private readonly timing: ListenTiming,
    private readonly onPlayed: (p: Played) => void,
  ) {
    this.jitter = new JitterBuffer(since)
    this.decoder = this.openDecoder()
    this.timer = setInterval(() => this.drain(), DRAIN_MS)
    this.stopEvents = playback.onEvent((e) => {
      if ('late' in e) {
        this.pending.delete(e.late)
        this.jitter.dropped++
        return
      }
      const frame = this.pending.get(e.played)
      this.pending.delete(e.played)
      const t = this.timing()
      if (!frame || !t) return
      const at = (e.frame / this.ctx.sampleRate - t.shift) * 1000
      this.onPlayed({ voice: this.voice, seq: frame.seq, stamp: frame.stamp, at })
    })
  }

  /** An Opus decoder; one that fails closes, and the next drain opens another. */
  private openDecoder() {
    const decoder = new AudioDecoder({
      output: (data) => this.onDecoded(data),
      error: () => undefined,
    })
    decoder.configure({ codec: 'opus', sampleRate: 48_000, numberOfChannels: 1 })
    return decoder
  }

  /** Frames dropped so far: late, from before listening, or on another tempo. */
  get dropped() {
    return this.jitter.dropped
  }

  /** Takes a frame as it arrives. */
  push(frame: LiveFrame) {
    const t = this.timing()
    if (!t) return
    this.jitter.push(frame, t.now, t.bpm)
    this.drain()
  }

  private drain() {
    const t = this.timing()
    if (!t) return
    if (this.decoder.state === 'closed') {
      this.decoder = this.openDecoder()
      this.decoding = []
    }
    for (const frame of this.jitter.due(t.now, t.bpm)) {
      const timestamp = Math.round(frame.stamp * 1000)
      this.decoding.push(frame)
      this.decoder.decode(
        new EncodedAudioChunk({
          type: 'key',
          timestamp,
          data: frame.payload as Uint8Array<ArrayBuffer>,
        }),
      )
    }
  }

  private onDecoded(data: AudioData) {
    const frame = this.decoding.shift()
    const t = this.timing()
    try {
      if (!frame || !t) return
      const decoded = new Float32Array(data.numberOfFrames)
      data.copyTo(decoded, { planeIndex: 0, format: 'f32-planar' })
      const samples = resample(decoded, data.sampleRate, this.ctx.sampleRate)
      const id = this.nextId++
      this.pending.set(id, frame)
      this.playback.play(id, livePlayAt(frame.stamp, frame.bpm, t.shift), samples)
    } finally {
      data.close()
    }
  }

  close() {
    clearInterval(this.timer)
    this.stopEvents()
    this.playback.close()
    if (this.decoder.state !== 'closed') this.decoder.close()
  }
}

/** `samples` at `from` Hz, linearly resampled to `to` Hz (a copy either way). */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples.slice()
  const n = Math.round((samples.length * to) / from)
  const out = new Float32Array(n)
  const step = from / to
  for (let i = 0; i < n; i++) {
    const x = i * step
    const j = Math.floor(x)
    const a = samples[j] ?? 0
    const b = samples[j + 1] ?? a
    out[i] = a + (b - a) * (x - j)
  }
  return out
}
