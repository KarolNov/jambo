/**
 * Each person's name and colour in a jam, assigned by the room: it sees everyone connected and
 * handles one message at a time, so two people joining together never get the same name. Names are
 * always unique; colours are, while one of the eight is free.
 */
import { COLOR_NAMES, type ColorName, toColorName } from './colors'
import { allNames, randomName, toName } from './names'

/**
 * Who holds a connection, and their name and colour in this jam. `id` is the person's private key
 * (not their public id, which anyone in the jam can see), so nobody can claim someone else's seat.
 */
export interface Seat {
  id: string
  name: string
  color: ColorName
}

/**
 * The colour for person `id` joining a jam where `others` are already seated: the one they already
 * have in another tab; else their usual colour if nobody here has it; else the first free colour;
 * past eight people, the least used (their usual one on a tie).
 */
export function assignColor(
  others: Iterable<Pick<Seat, 'id' | 'color'>>,
  id: string,
  preferred: ColorName,
): ColorName {
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

/**
 * The name for person `id` joining a jam where `others` are already seated: the one they already
 * have in another tab; else their usual name if nobody here has it; else a fresh one nobody here
 * has, from `pick`.
 */
export function assignName(
  others: Iterable<Pick<Seat, 'id' | 'name'>>,
  id: string,
  preferred: string,
  pick: () => string = randomName,
): string {
  const taken = new Set<string>()
  for (const seat of others) {
    if (seat.id === id) return seat.name
    taken.add(seat.name.toLowerCase())
  }
  const free = (name: string) => !taken.has(name.toLowerCase())
  if (free(preferred)) return preferred
  // 64 adjectives × 48 animals: a free name turns up within a few picks.
  for (let i = 0; i < 20; i++) {
    const name = pick()
    if (free(name)) return name
  }
  for (const name of allNames()) if (free(name)) return name
  for (let n = 2; ; n++) if (free(`${preferred} ${n}`)) return `${preferred} ${n}`
}

/** A person's seat in a jam, given who is already seated. */
export const assignSeat = (
  others: readonly Seat[],
  id: string,
  usual: { name: string; color: ColorName },
  pick?: () => string,
): Seat => ({
  id,
  name: assignName(others, id, usual.name, pick),
  color: assignColor(others, id, usual.color),
})

/** Seat messages over the board connection: a client says who it is, the room seats it. */
export type SeatMessage =
  | { t: 'hello'; key: string; name: string; color: ColorName }
  | { t: 'seat'; name: string; color: ColorName }

export const hello = (key: string, name: string, color: ColorName) =>
  JSON.stringify({ t: 'hello', key, name, color })
export const seated = (seat: { name: string; color: ColorName }) =>
  JSON.stringify({ t: 'seat', name: seat.name, color: seat.color })

/** A seat message, or undefined for anything else. */
export function parseSeatMessage(message: string): SeatMessage | undefined {
  try {
    const m = JSON.parse(message) as { t?: unknown; key?: unknown; name?: unknown; color?: unknown }
    const color = toColorName(m.color)
    const name = toName(m.name)
    if (!color || !name) return undefined
    if (m.t === 'seat') return { t: 'seat', name, color }
    if (m.t === 'hello' && typeof m.key === 'string' && m.key.length > 0 && m.key.length <= 64)
      return { t: 'hello', key: m.key, name, color }
  } catch {
    // Not JSON: not a seat message.
  }
  return undefined
}
