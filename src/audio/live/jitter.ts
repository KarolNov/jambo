import { type LiveFrame, liveDelayMs } from '../../../shared/live'

/**
 * How long before its play time a frame is handed on to be decoded and scheduled, in room ms:
 * time for the decoder, while frames arriving out of order still get put back in order.
 */
export const LEAD_MS = 120

/**
 * How close to its play time a frame may arrive and still be played, in room ms: decoding it and
 * handing it to the audio thread takes a moment.
 */
export const DECODE_MS = 10

/** What became of a frame that arrived. */
export type Arrival =
  /** Kept, to be played on time. */
  | 'queued'
  /** It arrived too late to play on time (more than a bar old), or after a later one was played. */
  | 'late'
  /** It was sung before this listener started listening. */
  | 'before'
  /** It was sung at another tempo than the jam's now. */
  | 'tempo'
  /** The same frame arrived twice. */
  | 'duplicate'

/**
 * One live voice's jitter buffer, on a listener: frames arrive in any order and at any delay, and
 * leave in stamp order shortly before they play, at stamp + one bar. Frames that can't play on time
 * are dropped as they arrive, or as their time passes. Times are room ms.
 */
export class JitterBuffer {
  /** Frames waiting, in stamp order. */
  private frames: LiveFrame[] = []
  /** The stamp of the last frame handed on: anything at or before it is too late to play. */
  private released = -Infinity
  /** How many frames were dropped, for the debug readout. */
  dropped = 0

  /** `since`: when this listener started listening; frames sung before it are dropped. */
  constructor(
    private readonly since: number,
    private readonly leadMs = LEAD_MS,
  ) {}

  /** How many frames are waiting. */
  get size() {
    return this.frames.length
  }

  /** Takes a frame that arrived at room time `now`, with the jam at `bpm`. */
  push(frame: LiveFrame, now: number, bpm: number): Arrival {
    const arrival = this.judge(frame, now, bpm)
    if (arrival !== 'queued') {
      this.dropped++
      return arrival
    }
    // Usually the newest: insert from the end.
    let i = this.frames.length
    while (i > 0 && this.frames[i - 1]!.stamp > frame.stamp) i--
    this.frames.splice(i, 0, frame)
    return arrival
  }

  private judge(frame: LiveFrame, now: number, bpm: number): Arrival {
    if (frame.bpm !== bpm) return 'tempo'
    if (frame.stamp < this.since) return 'before'
    if (frame.stamp <= this.released) return 'late'
    if (frame.stamp + liveDelayMs(bpm) < now + DECODE_MS) return 'late'
    if (this.frames.some((f) => f.seq === frame.seq && f.stamp === frame.stamp)) return 'duplicate'
    return 'queued'
  }

  /**
   * The frames due by room time `now`, in stamp order: those playing within the lead. Frames whose
   * play time has passed meanwhile, or that are on another tempo, are dropped.
   */
  due(now: number, bpm: number): LiveFrame[] {
    const delay = liveDelayMs(bpm)
    const out: LiveFrame[] = []
    while (this.frames.length > 0 && this.frames[0]!.stamp + delay <= now + this.leadMs) {
      const frame = this.frames.shift()!
      this.released = frame.stamp
      if (frame.bpm !== bpm || frame.stamp + delay < now + DECODE_MS) this.dropped++
      else out.push(frame)
    }
    return out
  }
}
