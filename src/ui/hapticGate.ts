/** Which haptic ticks get through, kept apart from `haptics.ts` so it can be tested on its own. */

/**
 * The shortest gap, in ms, between two ticks of a kind. Steps come as fast as a hand moves, so a
 * fast drag ticks at most this often instead of buzzing; detents, flips and taps are rare and
 * always tick.
 */
export const MIN_GAP_MS: Partial<Record<string, number>> = { step: 45 }

/**
 * A gate that says whether a tick of `kind` at `now` (ms) may fire. A dropped tick doesn't move
 * the clock, so a steady drag still ticks every `MIN_GAP_MS`.
 */
export function tickGate(gaps: Partial<Record<string, number>> = MIN_GAP_MS) {
  const last = new Map<string, number>()
  return (kind: string, now: number): boolean => {
    const gap = gaps[kind]
    if (!gap) return true
    const prev = last.get(kind)
    if (prev !== undefined && now - prev < gap) return false
    last.set(kind, now)
    return true
  }
}
