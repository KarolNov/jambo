import { useEffect, useState } from 'react'
import type { Awareness } from 'y-protocols/awareness'

/** A person in the jam, as their awareness state carries them: the parts of their identity others see. */
export interface Person {
  id: string
  color: string
  colorName: string
}

const isPerson = (v: unknown): v is Person => {
  const p = v as Partial<Person> | null
  return typeof p?.id === 'string' && typeof p.color === 'string' && typeof p.colorName === 'string'
}

/** Everyone in `states`, once per identity (two tabs of one browser are one person), `me` first. */
export function listPeople(states: Iterable<unknown>, me: Person): Person[] {
  const others = new Map<string, Person>()
  for (const state of states) {
    const person = (state as { person?: unknown } | null)?.person
    if (isPerson(person) && person.id !== me.id && !others.has(person.id))
      others.set(person.id, { id: person.id, color: person.color, colorName: person.colorName })
  }
  return [me, ...others.values()]
}

/** Puts this person into the jam's awareness for as long as the jam is open. */
export function joinPresence(awareness: Awareness, me: Person) {
  const person = { id: me.id, color: me.color, colorName: me.colorName }
  awareness.setLocalState({ ...awareness.getLocalState(), person })
  return () => awareness.setLocalState(null)
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
