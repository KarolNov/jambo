/** The transport's rules, kept apart from React so they can be tested. */
import { BPM } from '../../shared/board'

/**
 * What a new take is called: the recorder's name and their count of tracks, so their third is
 * "Groovy Otter 3". Counts only tracks they recorded, whatever they were called then.
 */
export function takeName(
  name: string,
  author: string,
  tracks: Iterable<{ author: string }>,
): string {
  let mine = 0
  for (const t of tracks) if (t.author === author) mine++
  return `${name} ${mine + 1}`
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

/** What the transport says when a typed tempo was out of range. */
export const TEMPO_RANGE = `Tempo is ${BPM.min}–${BPM.max} BPM`
