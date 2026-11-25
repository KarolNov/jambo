import { BEATS_PER_BAR, LIMITS, type Hit, type Track } from './board/schema'

/** Seconds per beat and per bar at `bpm`. */
export const beatSeconds = (bpm: number) => 60 / bpm
export const barSeconds = (bpm: number) => beatSeconds(bpm) * BEATS_PER_BAR

/**
 * Stopping up to this much of a bar past a bar line counts as stopping on it: people press stop
 * on the downbeat and are usually a little late. Anything later rounds up to the next bar.
 */
export const STOP_GRACE_BARS = 1 / 8

/** How early before the first beat a hit still counts as on it, in beats. */
export const EARLY_HIT_BEATS = 0.25

/**
 * Turns a take into a track's bars and hits: the length rounds up to whole bars (within
 * `STOP_GRACE_BARS`), at least one; hits outside the loop are dropped; an empty take is null.
 */
export function finishTake(
  hits: readonly Hit[],
  elapsedBeats: number,
): { bars: number; hits: Hit[] } | null {
  const elapsedBars = elapsedBeats / BEATS_PER_BAR
  const whole = Math.floor(elapsedBars)
  const bars = Math.min(
    LIMITS.bars,
    Math.max(1, elapsedBars - whole <= STOP_GRACE_BARS ? whole : Math.ceil(elapsedBars)),
  )
  const length = bars * BEATS_PER_BAR
  const kept = hits
    .filter((h) => h.beat >= -EARLY_HIT_BEATS && h.beat < length)
    .map((h) => ({ padId: h.padId, beat: Math.max(0, h.beat) }))
    .slice(0, LIMITS.hitsPerTrack)
  return kept.length ? { bars, hits: kept } : null
}

/** Where a hit sounds within its loop, in beats: snapped to `quantize` (0 = off), wrapped. */
export function playBeat(beat: number, quantize: number, lengthBeats: number): number {
  const snapped = quantize > 0 ? Math.round(beat / quantize) * quantize : beat
  if (snapped >= 0 && snapped < lengthBeats) return snapped
  return ((snapped % lengthBeats) + lengthBeats) % lengthBeats
}

/**
 * The hits of a looping track that sound in the time window [from, to), as audio times.
 * The track's first cycle starts at `startAt`; nothing sounds before it.
 */
export function hitsInWindow(
  track: Pick<Track, 'bars' | 'hits' | 'quantize'>,
  startAt: number,
  bpm: number,
  from: number,
  to: number,
): { padId: string; time: number }[] {
  const beat = beatSeconds(bpm)
  const loop = track.bars * BEATS_PER_BAR * beat
  const out: { padId: string; time: number }[] = []
  const start = Math.max(from, startAt)
  if (to <= start) return out
  const firstCycle = Math.floor((start - startAt) / loop)
  const lastCycle = Math.floor((to - startAt) / loop)
  for (let k = firstCycle; k <= lastCycle; k++) {
    const cycleStart = startAt + k * loop
    for (const hit of track.hits) {
      const time =
        cycleStart + playBeat(hit.beat, track.quantize, track.bars * BEATS_PER_BAR) * beat
      if (time >= start && time < to) out.push({ padId: hit.padId, time })
    }
  }
  return out.sort((a, b) => a.time - b.time)
}

/**
 * The jam's bar grid, on the room's clock: bar `n` starts at room time `n × barMs` (ms since the
 * Unix epoch). Nothing is stored for it; tempo only changes while the jam has no tracks.
 */
export const barMs = (bpm: number) => barSeconds(bpm) * 1000

/** When jam bar `bar` starts, in room ms. */
export const barStart = (bar: number, bpm: number) => bar * barMs(bpm)

/** The first jam bar starting at or after room time `roomMs`. */
export const nextJamBar = (roomMs: number, bpm: number) => ceilNear(roomMs / barMs(bpm))

/** A sixteenth note, in beats: the grid that grid-timed master changes wait for. */
export const SIXTEENTH = 0.25

/**
 * The first line of the jam's grid of `beats` (a sixteenth by default) at or after room time
 * `roomMs`, in room ms. Lines count from the epoch, as bars do, so every client finds the same one.
 */
export const nextGridLine = (roomMs: number, bpm: number, beats = SIXTEENTH) => {
  const step = beats * beatSeconds(bpm) * 1000
  return ceilNear(roomMs / step) * step
}

/**
 * `Math.ceil`, but a value within rounding error of a whole number is that number. The tolerance
 * is relative: room times since the epoch put bar and beat counts around 1e9, where a fixed 1e-9
 * is far below one unit in the last place.
 */
export function ceilNear(x: number): number {
  const r = Math.round(x)
  return Math.abs(x - r) <= Math.abs(x) * 1e-14 ? r : Math.ceil(x)
}

/**
 * Where a track's loop cycles start, in room ms: its take's jam bar, repeating every length.
 * A track recorded before the jam grid has no `startBar` and cycles on bars divisible by its length.
 */
export const trackStart = (track: Pick<Track, 'startBar'>, bpm: number) =>
  barStart(track.startBar ?? 0, bpm)
