/** The transport's rules, kept apart from React so they can be tested. */
import { BEATS_PER_BAR, BPM, type Hit, LIMITS } from '../../shared/board'
import { EARLY_HIT_BEATS } from '../../shared/looper'

/**
 * What a new take is called: the recorder's name and the next number after the jam's takes with
 * that name, so after "Groovy Otter 2" comes "Groovy Otter 3", whoever had the name before.
 */
export function takeName(name: string, tracks: Iterable<{ name: string }>): string {
  let last = 0
  for (const t of tracks) {
    if (!t.name.startsWith(`${name} `)) continue
    const n = t.name.slice(name.length + 1)
    if (/^\d+$/.test(n)) last = Math.max(last, Number(n))
  }
  return `${name} ${last + 1}`
}

/**
 * The tempo to set for a typed `value`, rounded and held to the allowed range; `clamped` says the
 * range was hit. Undefined when there is nothing to change.
 */
export function tempoFor(
  value: number,
  bpm: number,
): { bpm: number; clamped: boolean } | undefined {
  if (!Number.isFinite(value) || value === bpm) return undefined
  const next = Math.round(Math.min(BPM.max, Math.max(BPM.min, value)))
  return { bpm: next, clamped: next !== value }
}

/** The snap a new take's track starts with: 1/16. */
export const TAKE_QUANTIZE = 0.25

/** What the transport says when a typed tempo was out of range. */
export const TEMPO_RANGE = `Tempo is ${BPM.min}–${BPM.max} BPM`

/**
 * What the take lane shows `beat` beats into a take (negative before its first beat): waiting for
 * the count-in, the count-in's count (1–4), or the bar and beat being recorded (both from 1) on a
 * lane of `bars`, which grows a bar at a time up to the longest loop.
 */
export type TakeView =
  | { stage: 'waiting' }
  | { stage: 'count-in'; count: number }
  | { stage: 'recording'; bar: number; beat: number; bars: number }

export function takeView(beat: number): TakeView {
  if (beat < -BEATS_PER_BAR) return { stage: 'waiting' }
  if (beat < 0) return { stage: 'count-in', count: Math.floor(beat) + BEATS_PER_BAR + 1 }
  const bar = Math.floor(beat / BEATS_PER_BAR)
  return {
    stage: 'recording',
    bar: bar + 1,
    beat: Math.floor(beat - bar * BEATS_PER_BAR) + 1,
    bars: Math.min(LIMITS.bars, bar + 1),
  }
}

/**
 * Where a take's hits will play on a lane of `bars`, in beats: snapped as the new track will be,
 * a hit just before the first beat on it, and the hits past the lane left out.
 */
export function takeMarks(hits: readonly Hit[], bars: number): { padId: string; beat: number }[] {
  const length = bars * BEATS_PER_BAR
  return hits
    .filter((h) => h.beat >= -EARLY_HIT_BEATS)
    .map((h) => ({
      padId: h.padId,
      beat: Math.max(0, Math.round(h.beat / TAKE_QUANTIZE) * TAKE_QUANTIZE),
    }))
    .filter((h) => h.beat < length)
}
