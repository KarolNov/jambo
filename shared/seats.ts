/**
 * Each person's colour in a jam, assigned by the room: it sees everyone connected and handles one
 * message at a time, so two people joining together never get the same colour.
 */
import { COLOR_NAMES, type ColorName, toColorName } from './colors'

/** Who holds a connection, and their colour in this jam. */
export interface Seat {
  id: string
  color: ColorName
}

/**
 * The colour for person `id` joining a jam where `others` are already seated: the one they already
 * have in another tab; else their usual colour if nobody here has it; else the first free colour;
 * past eight people, the least used (their usual one on a tie).
 */
export function assignColor(others: Iterable<Seat>, id: string, preferred: ColorName): ColorName {
  const people = new Map<string, ColorName>()
  for (const seat of others) if (!people.has(seat.id)) people.set(seat.id, seat.color)
  const own = people.get(id)
  if (own) return own
  const uses = new Map<ColorName, number>(COLOR_NAMES.map((c) => [c, 0]))
  for (const color of people.values()) uses.set(color, uses.get(color)! + 1)
  if (uses.get(preferred) === 0) return preferred
  let best = preferred
  for (const c of COLOR_NAMES) if (uses.get(c)! < uses.get(best)!) best = c
  return best
}

/** Seat messages over the board connection: a client says who it is, the room gives its colour. */
export type SeatMessage =
  | { t: 'hello'; id: string; color: ColorName }
  | { t: 'seat'; color: ColorName }

export const hello = (id: string, color: ColorName) => JSON.stringify({ t: 'hello', id, color })
export const seated = (color: ColorName) => JSON.stringify({ t: 'seat', color })

/** A seat message, or undefined for anything else. */
export function parseSeatMessage(message: string): SeatMessage | undefined {
  try {
    const m = JSON.parse(message) as { t?: unknown; id?: unknown; color?: unknown }
    const color = toColorName(m.color)
    if (!color) return undefined
    if (m.t === 'seat') return { t: 'seat', color }
    if (m.t === 'hello' && typeof m.id === 'string' && m.id.length > 0 && m.id.length <= 64)
      return { t: 'hello', id: m.id, color }
  } catch {
    // Not JSON: not a seat message.
  }
  return undefined
}
