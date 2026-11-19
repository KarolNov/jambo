import { COLOR_NAMES, type ColorName } from '../colors'
import { assignSeat, type Seat } from '../seats'
import { allAgentNames, randomAgentName, toAgentName } from './identity'

/**
 * An agent's seat in a jam where `others` (people and other agents) are already seated, keyed by
 * its private `key`. Its usual name counts only when it is an adjective and its `kind`; otherwise,
 * or when someone here has it, it gets a fresh adjective with the same kind. Colours are chosen as
 * for a person.
 */
export function seatAgent(
  others: readonly Seat[],
  key: string,
  kind: string,
  usual: { name?: string; color?: ColorName },
  random: () => number = Math.random,
): Seat {
  const pick = () => randomAgentName(kind, random)
  const name = (usual.name && toAgentName(usual.name, kind)) || pick()
  const color = usual.color ?? COLOR_NAMES[Math.floor(random() * COLOR_NAMES.length)]!
  return assignSeat(others, key, { name, color }, pick, () => allAgentNames(kind))
}
