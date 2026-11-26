import { BEATS_PER_BAR, isSoundHit, LIMITS, type Hit, type Track } from './board/schema'
import { audioToRoom } from './clock'

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
  const bars = takeBars(elapsedBeats)
  const length = bars * BEATS_PER_BAR
  const kept = hits
    .filter((h) => h.beat >= -EARLY_HIT_BEATS && h.beat < length)
    .map((h): Hit => {
      const beat = Math.max(0, h.beat)
      return isSoundHit(h) ? { soundId: h.soundId, beat } : { padId: h.padId, beat }
    })
    .slice(0, LIMITS.hitsPerTrack)
  return kept.length ? { bars, hits: kept } : null
}

/**
 * How many bars a take stopped `elapsedBeats` after its first beat loops for: rounded up to whole
 * bars (within `STOP_GRACE_BARS`), at least one, at most the longest loop.
 */
export function takeBars(elapsedBeats: number): number {
  const elapsedBars = elapsedBeats / BEATS_PER_BAR
  const whole = Math.floor(elapsedBars)
  return Math.min(
    LIMITS.bars,
    Math.max(1, elapsedBars - whole <= STOP_GRACE_BARS ? whole : Math.ceil(elapsedBars)),
  )
}

/**
 * The take beat a voice clip was sung on: `capturedAt` is the context time of its first captured
 * sample, which reached the context `roundTrip` seconds after the singer heard what was leaving
 * the speakers then (mic in, plus the jam's audio out). Mapped back by `shift` to room time, as the
 * clicks were scheduled, it is the beat they heard as they started. `recordStart` is the take's
 * first beat in room ms. Never quantized: snapping it would move the whole phrase.
 */
export function sungBeat(
  capturedAt: number,
  roundTrip: number,
  shift: number,
  recordStart: number,
  bpm: number,
): number {
  return (audioToRoom(capturedAt - roundTrip, shift) - recordStart) / (beatSeconds(bpm) * 1000)
}

/**
 * The part of a clip sung from take beat `beat` for `seconds` that a loop of `lengthBeats` keeps:
 * nothing before its first beat and nothing past its end. `skip` and `keep` are seconds into the
 * clip, `beat` where what is kept starts. Undefined when none of it is in the loop.
 */
export function clipSpan(
  beat: number,
  seconds: number,
  lengthBeats: number,
  bpm: number,
): { skip: number; keep: number; beat: number } | undefined {
  const b = beatSeconds(bpm)
  const from = Math.max(0, beat * b)
  const to = Math.min(beat * b + seconds, lengthBeats * b)
  if (to <= from) return undefined
  return { skip: from - beat * b, keep: to - from, beat: Math.max(0, beat) }
}

/** Where a hit sounds within its loop, in beats: snapped to `quantize` (0 = off), wrapped. */
export function playBeat(beat: number, quantize: number, lengthBeats: number): number {
  const snapped = quantize > 0 ? Math.round(beat / quantize) * quantize : beat
  if (snapped >= 0 && snapped < lengthBeats) return snapped
  return ((snapped % lengthBeats) + lengthBeats) % lengthBeats
}

/**
 * A loop hit due to sound: what it plays (a pad or a sound), when (`time`), and the beat it sounds
 * on within its loop. A sound hit also has `until`, its loop cycle's end, where it is cut.
 */
export type Sounding = ({ padId: string } | { soundId: string; until: number }) & {
  time: number
  beat: number
}

/**
 * The hits of a looping track that sound in the time window [from, to), as audio times, each with
 * the beat it sounds on within its loop. Pad hits snap to the track's quantize; sound hits keep
 * their stored beat and are cut at the end of their cycle. The track's first cycle starts at
 * `startAt`; nothing sounds before it.
 */
export function hitsInWindow(
  track: Pick<Track, 'bars' | 'hits' | 'quantize'>,
  startAt: number,
  bpm: number,
  from: number,
  to: number,
): Sounding[] {
  const beat = beatSeconds(bpm)
  const loop = track.bars * BEATS_PER_BAR * beat
  const out: Sounding[] = []
  const start = Math.max(from, startAt)
  if (to <= start) return out
  const firstCycle = Math.floor((start - startAt) / loop)
  const lastCycle = Math.floor((to - startAt) / loop)
  for (let k = firstCycle; k <= lastCycle; k++) {
    const cycleStart = startAt + k * loop
    for (const hit of track.hits) {
      const sound = isSoundHit(hit)
      const at = playBeat(hit.beat, sound ? 0 : track.quantize, track.bars * BEATS_PER_BAR)
      const time = cycleStart + at * beat
      if (time < start || time >= to) continue
      out.push(
        sound
          ? { soundId: hit.soundId, until: cycleStart + loop, time, beat: at }
          : { padId: hit.padId, time, beat: at },
      )
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

/**
 * How late swing plays a hit at `beat` (beats from a bar line), in beats: off-beat 16ths (the
 * second and fourth of each beat) move by up to half a 16th at swing 1; every other hit stays.
 * Applied at playback only, after a track's snap, so stored hits never change.
 */
export function swingDelay(beat: number, swing: number): number {
  if (swing <= 0) return 0
  const n = beat / SIXTEENTH
  const r = Math.round(n)
  // Only hits on the grid swing: an unsnapped hit between 16ths is not an off-beat 16th.
  if (Math.abs(n - r) > 1e-6 || r % 2 === 0) return 0
  return (swing * SIXTEENTH) / 2
}

/** Beat repeat's slice in each of its four X zones, in beats: 1/4, 1/8, 1/16, 1/32. */
export const REPEAT_SLICES = [1, 0.5, 0.25, 0.125] as const

/** Which of repeat's four X zones `x` (0..1) is in. */
export const repeatZone = (x: number) =>
  Math.min(REPEAT_SLICES.length - 1, Math.floor(x * REPEAT_SLICES.length))

/** Repeat's slice at `x`, in beats. */
export const repeatSlice = (x: number): number => REPEAT_SLICES[repeatZone(x)]!

/** Room ms → beats on the jam's grid, counted from the epoch as bars are. */
export const jamBeat = (roomMs: number, bpm: number) => roomMs / (beatSeconds(bpm) * 1000)

/** When jam beat `beat` starts, in room ms. */
export const jamBeatMs = (beat: number, bpm: number) => beat * beatSeconds(bpm) * 1000

/**
 * The jam beat a repeat change takes effect on: the first line at or after room time `roomMs` of
 * a grid of `slice` beats, but never finer than a 16th, so it is always on the 16th grid that
 * `startBeat` is stored on. Every client finds the same line.
 */
export function repeatLine(roomMs: number, bpm: number, slice: number = SIXTEENTH): number {
  const step = Math.max(slice, SIXTEENTH)
  return ceilNear(jamBeat(roomMs, bpm) / step) * step
}

/**
 * The start beat to store with a move of repeat from `from` to `to` at room time `roomMs`, or
 * undefined when the move only changes the repeats' level, which applies at once. Engaging (Y
 * leaving 0) and moving to another slice zone capture a new slice at its next grid line; letting go
 * (Y back to 0) stops at the next 1/16. The stored beat says when the move takes effect.
 */
export function repeatStamp(
  from: { x: number; y: number },
  to: { x: number; y: number },
  roomMs: number,
  bpm: number,
): number | undefined {
  const was = from.y > 0
  const is = to.y > 0
  if (is && (!was || repeatZone(from.x) !== repeatZone(to.x)))
    return repeatLine(roomMs, bpm, repeatSlice(to.x))
  if (was && !is) return repeatLine(roomMs, bpm)
  return undefined
}
