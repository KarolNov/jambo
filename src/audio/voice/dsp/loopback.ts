/**
 * The loopback latency test's sums: the click it plays, and finding it again in what the
 * microphone heard. Pure, so it is unit-tested directly; `measureRoundTrip` in `../input` plays
 * and records.
 */

/** The click's length in seconds, and its pitch: a short tone the browser's noise suppression lets through. */
const CLICK_SECONDS = 0.012
const CLICK_HZ = 1_500
/** The longest round trip looked for, in seconds. */
export const MAX_ROUND_TRIP = 0.5
/** A click counts as heard when it matches what was played at least this well, 0 to 1. */
const MIN_MATCH = 0.5
/** At least this many clicks must be heard, agreeing within `AGREE` seconds of their median. */
const MIN_HEARD = 3
const AGREE = 0.004

/** The click at `rate`: a Hann-windowed tone burst. */
export function loopbackClick(rate: number): Float32Array {
  const n = Math.round(CLICK_SECONDS * rate)
  return Float32Array.from(
    { length: n },
    (_, i) =>
      (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))) *
      Math.sin((2 * Math.PI * CLICK_HZ * i) / rate),
  )
}

/**
 * Finds the round trip, in seconds, from a recording whose first sample is context frame
 * `start`, made while clicks were played at the context frames `emits`. Each click is looked for
 * by normalised cross-correlation within `MAX_ROUND_TRIP` after it was played. Undefined unless
 * enough clicks were heard, and agree.
 */
export function findClicks(
  recording: Float32Array,
  rate: number,
  start: number,
  emits: readonly number[],
): number | undefined {
  const click = loopbackClick(rate)
  let clickEnergy = 0
  for (const c of click) clickEnergy += c * c
  const span = Math.round(MAX_ROUND_TRIP * rate)
  const length = click.length
  // Running energy of the recording, so any window's is a subtraction.
  const energies = new Float64Array(recording.length + 1)
  for (let i = 0; i < recording.length; i++) energies[i + 1] = energies[i]! + recording[i]! ** 2
  /** How well the window at `at` matches the click, -1 to 1; -1 where it is silent. */
  const matchAt = (at: number) => {
    const energy = energies[at + length]! - energies[at]!
    if (energy <= 1e-12) return -1
    let dot = 0
    for (let i = 0; i < length; i++) dot += recording[at + i]! * click[i]!
    return dot / Math.sqrt(energy * clickEnergy)
  }
  // A first pass every eighth of the click's period still lands within 23° of its peak (over 0.9
  // of the match) for a fraction of the cost; an exact pass around the best then finds it.
  const step = Math.max(1, Math.floor(rate / CLICK_HZ / 8))
  const delays: number[] = []
  for (const emit of emits) {
    const from = emit - start
    const last = Math.min(span, recording.length - length - from)
    if (from < 0 || last < 0) continue
    let coarse = 0
    let coarseMatch = -Infinity
    for (let lag = 0; lag <= last; lag += step) {
      const match = matchAt(from + lag)
      if (match > coarseMatch) {
        coarseMatch = match
        coarse = lag
      }
    }
    let best = -1
    let bestMatch = MIN_MATCH
    for (let lag = Math.max(0, coarse - step); lag <= Math.min(last, coarse + step); lag++) {
      const match = matchAt(from + lag)
      if (match > bestMatch) {
        bestMatch = match
        best = lag
      }
    }
    if (best >= 0) delays.push(best / rate)
  }
  if (delays.length < MIN_HEARD) return undefined
  const sorted = [...delays].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]!
  const agreeing = delays.filter((d) => Math.abs(d - median) <= AGREE)
  if (agreeing.length < MIN_HEARD) return undefined
  return agreeing.reduce((s, d) => s + d, 0) / agreeing.length
}
