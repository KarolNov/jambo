/**
 * A streaming pitch shifter by pitch-synchronous overlap-add (PSOLA): it cuts the voice into
 * grains two periods long, one period apart, and lays them back down closer together to raise the
 * pitch or further apart to lower it. Laid down unchanged, grains keep the voice's formants, so
 * it still sounds like the same person; read faster or slower (`formant`), they move the formants
 * too, for a chipmunk or a demon. Where the voice has no pitch, grains keep the input's spacing,
 * so breath and consonants pass through with only the formant change.
 *
 * Pure, so it runs on the audio thread (inside `pitch.worklet.ts`) and in unit tests alike.
 * Nothing allocates once built.
 */

import { MIN_HZ } from './yin'

/** The furthest formants move, either way, as a factor. */
export const FORMANT_RANGE = 2
/** The grain spacing where the voice has no pitch, in seconds. */
const UNVOICED_PERIOD = 0.008

/** The longest period the shifter handles at `rate`, in samples: the lowest voice YIN finds. */
const maxPeriod = (rate: number) => Math.ceil(rate / MIN_HZ)

/**
 * The shifter's delay at `rate`, in samples: a grain can only be laid down once the input it
 * reads has arrived, and before the output it covers has gone out.
 */
export function psolaDelay(rate: number) {
  const p = maxPeriod(rate)
  // A grain is laid 1.5 periods behind the input, and reaches back a period / formant before that.
  return Math.ceil(p * (1.5 + FORMANT_RANGE)) + 2
}

export class PsolaShifter {
  /** Samples from a sample in to the same moment out. */
  readonly delay: number
  private readonly mask: number
  private readonly input: Float32Array
  private readonly sum: Float32Array
  private readonly weight: Float32Array
  private readonly unvoiced: number
  private readonly longest: number
  /** Samples taken in so far. */
  private n = 0
  /** Where the next grain is laid, on the input's timeline. */
  private mark = 0
  /** Where it is read from: steps a whole period at a time while voiced, so grains stay in phase. */
  private source = 0

  constructor(rate: number) {
    this.delay = psolaDelay(rate)
    let size = 1
    while (size < 2 * this.delay + 4 * maxPeriod(rate)) size *= 2
    this.mask = size - 1
    this.input = new Float32Array(size)
    this.sum = new Float32Array(size)
    this.weight = new Float32Array(size)
    this.unvoiced = Math.round(UNVOICED_PERIOD * rate)
    this.longest = maxPeriod(rate)
  }

  /**
   * Shifts `input` into `output` (the same length; they may be the same array). `period` is the
   * voice's period in samples, 0 while unvoiced; `ratio` the pitch factor (2 is an octave up);
   * `formant` how far the formants move, as a factor, within `FORMANT_RANGE` either way.
   */
  process(input: Float32Array, output: Float32Array, period: number, ratio: number, formant = 1) {
    const voiced = period > 1
    const p = voiced ? Math.min(period, this.longest) : this.unvoiced
    const f = Math.min(FORMANT_RANGE, Math.max(1 / FORMANT_RANGE, formant))
    const r = voiced && ratio > 0 ? ratio : 1
    for (let i = 0; i < input.length; i++) {
      this.input[this.n & this.mask] = input[i]!
      this.n++
      // Lay every grain whose input has arrived.
      while (this.mark + 1.5 * p + 1 <= this.n) {
        this.lay(p, f, voiced)
        this.mark += voiced ? p / r : p
      }
      output[i] = this.emit()
    }
  }

  /** Lays the grain at `mark`: two periods of input around `source`, read at `f`, windowed. */
  private lay(p: number, f: number, voiced: boolean) {
    const m = this.mark
    if (!voiced || Math.abs(this.source - m) > 2 * p) this.source = m
    else {
      while (this.source + p / 2 < m) this.source += p
      while (this.source - p / 2 > m) this.source -= p
    }
    const c = this.source
    const half = p / f
    const from = Math.ceil(m - half)
    const to = Math.floor(m + half)
    for (let pos = from; pos <= to; pos++) {
      const t = pos - m
      const w = 0.5 + 0.5 * Math.cos((Math.PI * t) / half)
      const at = c + t * f
      const i0 = Math.floor(at)
      const frac = at - i0
      const a = this.input[i0 & this.mask]!
      const b = this.input[(i0 + 1) & this.mask]!
      const k = pos & this.mask
      this.sum[k]! += w * (a + (b - a) * frac)
      this.weight[k]! += w
    }
  }

  /** The output `delay` samples behind the input: what the grains laid over it add up to. */
  private emit() {
    const e = this.n - 1 - this.delay
    if (e < 0) return 0
    const k = e & this.mask
    // Where grains overlap more than a window's worth, scale back to the input's level.
    const y = this.sum[k]! / Math.max(1, this.weight[k]!)
    this.sum[k] = 0
    this.weight[k] = 0
    return y
  }
}
