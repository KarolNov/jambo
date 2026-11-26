/**
 * Pitch detection with YIN (de Cheveigné and Kawahara, 2002): the lag at which a frame best
 * matches itself, found through the cumulative mean normalised difference. Pure, so it runs on the
 * audio thread (inside `pitch.worklet.ts`) and in unit tests alike. Nothing here allocates once
 * built, as the audio thread must not.
 */

/** The lowest voice it looks for, in Hz: below a bass's low E, above room rumble. */
export const MIN_HZ = 75
/** The highest, in Hz: above a soprano's top, below the voice's own overtones. */
export const MAX_HZ = 1000

/** A detected pitch. */
export interface Pitch {
  hz: number
  /** How periodic the frame is, 0 to 1: 1 minus YIN's normalised difference at the period. */
  clarity: number
}

/** YIN's threshold: the first dip in the normalised difference below this is the period. */
const THRESHOLD = 0.15
/** Frames less clear than this (a dip that never went below 1 − it) are unvoiced. */
const MIN_CLARITY = 0.6
/** Frames quieter than this RMS are silence, not a voice. */
const MIN_RMS = 0.003

/**
 * Finds the pitch of `frame`, sampled at `rate`, between `minHz` and `maxHz`, or undefined when
 * it is silent or not periodic (breath, a consonant, noise). The frame must hold at least two of
 * the longest periods. `scratch`, if given, must hold `rate / minHz + 2` values; it saves an
 * allocation per call.
 */
export function yin(
  frame: Float32Array,
  rate: number,
  minHz = MIN_HZ,
  maxHz = MAX_HZ,
  scratch?: Float32Array,
): Pitch | undefined {
  const maxLag = Math.min(Math.floor(rate / minHz), Math.floor(frame.length / 2))
  const minLag = Math.max(2, Math.floor(rate / maxHz))
  if (maxLag <= minLag) return undefined
  const width = frame.length - maxLag

  let energy = 0
  for (let j = 0; j < width; j++) energy += frame[j]! * frame[j]!
  if (Math.sqrt(energy / width) < MIN_RMS) return undefined

  // d[τ]: the squared difference between the frame and itself τ later, then normalised in place
  // by the mean of d over 1..τ, so d[τ] near 0 is a good period and 1 is no better than chance.
  const d = scratch && scratch.length >= maxLag + 2 ? scratch : new Float32Array(maxLag + 2)
  d[0] = 1
  let running = 0
  for (let lag = 1; lag <= maxLag + 1 && lag + width <= frame.length; lag++) {
    let sum = 0
    for (let j = 0; j < width; j++) {
      const diff = frame[j]! - frame[j + lag]!
      sum += diff * diff
    }
    running += sum
    d[lag] = running > 0 ? (sum * lag) / running : 1
  }
  const last = Math.min(maxLag, frame.length - width - 1)

  // The first dip under the threshold, followed down to its bottom; failing that, the deepest.
  let best = -1
  for (let lag = minLag; lag <= last; lag++) {
    if (d[lag]! < THRESHOLD) {
      while (lag + 1 <= last && d[lag + 1]! < d[lag]!) lag++
      best = lag
      break
    }
  }
  if (best < 0) {
    best = minLag
    for (let lag = minLag + 1; lag <= last; lag++) if (d[lag]! < d[best]!) best = lag
  }
  const clarity = 1 - d[best]!
  if (clarity < MIN_CLARITY) return undefined

  // A parabola through the dip and its neighbours puts the period between samples.
  let period = best
  if (best > 1 && best < last) {
    const a = d[best - 1]!
    const b = d[best]!
    const c = d[best + 1]!
    const curve = a - 2 * b + c
    if (curve > 0) period += (a - c) / (2 * curve)
  }
  return { hz: rate / period, clarity }
}

/** About how often the tracker looks again, in seconds. */
const HOP_SECONDS = 0.008
/** The rate the tracker detects at, at least: decimating to near it keeps YIN cheap. */
const DETECT_RATE = 16_000
/** The tracker's low-pass before decimating, in Hz: keeps the fundamental, drops what would alias. */
const DETECT_LOWPASS = 3_000

/**
 * Follows the pitch of a stream fed a block at a time: low-passes and decimates it to about
 * 16 kHz, and runs YIN on the latest frame every 8 ms or so. `hz` is the latest pitch, 0 while
 * unvoiced.
 */
export class PitchTracker {
  /** The latest pitch in Hz, 0 while unvoiced or silent. */
  hz = 0
  private readonly factor: number
  private readonly detectRate: number
  private readonly ring: Float32Array
  private readonly frame: Float32Array
  private readonly scratch: Float32Array
  private readonly hop: number
  private readonly pole: number
  private low = 0
  private acc = 0
  private accCount = 0
  private written = 0
  private sinceHop = 0

  constructor(private readonly rate: number) {
    this.factor = Math.max(1, Math.floor(rate / DETECT_RATE))
    this.detectRate = rate / this.factor
    const frameLength = 2 * Math.ceil(this.detectRate / MIN_HZ)
    this.frame = new Float32Array(frameLength)
    this.ring = new Float32Array(frameLength)
    this.scratch = new Float32Array(Math.ceil(this.detectRate / MIN_HZ) + 2)
    this.hop = Math.max(1, Math.round(HOP_SECONDS * this.detectRate))
    this.pole = Math.exp((-2 * Math.PI * DETECT_LOWPASS) / rate)
  }

  /** The latest period in samples at the stream's rate, 0 while unvoiced. */
  get period() {
    return this.hz > 0 ? this.rate / this.hz : 0
  }

  push(block: Float32Array) {
    const n = this.ring.length
    for (let i = 0; i < block.length; i++) {
      this.low = block[i]! + this.pole * (this.low - block[i]!)
      this.acc += this.low
      if (++this.accCount < this.factor) continue
      this.ring[this.written % n] = this.acc / this.factor
      this.acc = 0
      this.accCount = 0
      this.written++
      if (++this.sinceHop >= this.hop && this.written >= n) {
        this.sinceHop = 0
        this.detect()
      }
    }
  }

  private detect() {
    const n = this.ring.length
    const start = this.written % n
    for (let i = 0; i < n; i++) this.frame[i] = this.ring[(start + i) % n]!
    this.hz = yin(this.frame, this.detectRate, MIN_HZ, MAX_HZ, this.scratch)?.hz ?? 0
  }
}
