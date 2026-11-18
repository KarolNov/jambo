/** The transport's rules, kept apart from React so they can be tested. */
import { BPM } from '../../shared/board'

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

/** What the transport says when a typed tempo was out of range. */
export const TEMPO_RANGE = `Tempo is ${BPM.min}–${BPM.max} BPM`
