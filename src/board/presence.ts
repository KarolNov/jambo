import { useEffect, useState } from 'react'
import type { Awareness } from 'y-protocols/awareness'
import { type ColorName, toColorName } from '../../shared/colors'

/** A person in the jam, as their awareness state carries them: the parts of their identity others see. */
export interface Person {
  id: string
  /** Their colour, by name. */
  color: ColorName
}

/** The person an awareness state carries, if it carries a valid one (legacy hex colours read as names). */
const toPerson = (v: unknown): Person | undefined => {
  const p = v as { id?: unknown; color?: unknown } | null
  const color = toColorName(p?.color)
  return typeof p?.id === 'string' && color ? { id: p.id, color } : undefined
}

/** Everyone in `states`, once per identity (two tabs of one browser are one person), `me` first. */
export function listPeople(states: Iterable<unknown>, me: Person): Person[] {
  const others = new Map<string, Person>()
  for (const state of states) {
    const person = toPerson((state as { person?: unknown } | null)?.person)
    if (person && person.id !== me.id && !others.has(person.id)) others.set(person.id, person)
  }
  return [me, ...others.values()]
}

/**
 * Puts this person into the jam's awareness for as long as the jam is open, and keeps their colour
 * there current when the room seats them with another.
 */
export function joinPresence(
  awareness: Awareness,
  me: Person & { subscribe?: (l: () => void) => () => void },
) {
  const publish = () => {
    const person = { id: me.id, color: me.color }
    awareness.setLocalState({ ...awareness.getLocalState(), person })
  }
  publish()
  const stop = me.subscribe?.(publish)
  return () => {
    stop?.()
    awareness.setLocalState(null)
  }
}

/** Everyone in the jam, re-rendering as people come and go. */
export function usePeople(awareness: Awareness, me: Person): Person[] {
  const [people, setPeople] = useState(() => listPeople(awareness.getStates().values(), me))
  useEffect(() => {
    const onChange = () => setPeople(listPeople(awareness.getStates().values(), me))
    awareness.on('change', onChange)
    onChange()
    return () => awareness.off('change', onChange)
  }, [awareness, me])
  return people
}
