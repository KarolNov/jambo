import { useEffect, useState } from 'react'
import type { Awareness } from 'y-protocols/awareness'
import { AGENT_AUTHOR_PREFIX, isAgentAuthor } from '../../shared/agent'
import { CONTROL_KEYS } from '../../shared/board'
import { type ColorName, toColorName } from '../../shared/colors'
import { toName } from '../../shared/names'
import type { Me } from './seat'

/** A person in the jam, as their awareness state carries them: the parts of their identity others see. */
export interface Person {
  id: string
  /** Their name in this jam; undefined from clients older than names. */
  name?: string
  /** Their colour, by name. */
  color: ColorName
  /** An AI agent in the jam over MCP. Agents' ids read `agent:<id>`. */
  agent?: true
}

/** The person an awareness state carries, if it carries a valid one (legacy hex colours read as names). */
const toPerson = (v: unknown): Person | undefined => {
  const p = v as { id?: unknown; name?: unknown; color?: unknown } | null
  const color = toColorName(p?.color)
  // `agent:` ids are agents', which only the room lists.
  if (typeof p?.id !== 'string' || isAgentAuthor(p.id) || !color) return undefined
  const name = toName(p.name)
  return name ? { id: p.id, name, color } : { id: p.id, color }
}

/** An agent the room lists in its own state, as a person entry marked as an agent. */
const toAgent = (v: unknown): Person | undefined => {
  const a = v as { id?: unknown; name?: unknown; color?: unknown } | null
  const color = toColorName(a?.color)
  const name = toName(a?.name)
  if (typeof a?.id !== 'string' || !color || !name) return undefined
  return { id: AGENT_AUTHOR_PREFIX + a.id, name, color, agent: true }
}

/**
 * Everyone in `states`, once per identity (two tabs of one browser are one person), `me` first,
 * then people, then the agents the room lists in its own state (the one state with no person, so a
 * browser can't add agents alongside itself).
 */
export function listPeople(states: Iterable<unknown>, me: Person): Person[] {
  const others = new Map<string, Person>()
  const agents = new Map<string, Person>()
  for (const state of states) {
    const s = state as { person?: unknown; agents?: unknown } | null
    const person = toPerson(s?.person)
    if (person && person.id !== me.id && !others.has(person.id)) others.set(person.id, person)
    if (!s?.person && Array.isArray(s?.agents))
      for (const raw of s.agents) {
        const agent = toAgent(raw)
        if (agent && !agents.has(agent.id)) agents.set(agent.id, agent)
      }
  }
  return [me, ...others.values(), ...agents.values()]
}

/**
 * Puts this person into the jam's awareness once the room seats them, so others never see a name or
 * colour someone else holds, and keeps their name and colour there current; until the jam closes.
 */
export function joinPresence(awareness: Awareness, me: Me) {
  const publish = () => {
    if (!me.seated) return
    const person = { id: me.id, name: me.name, color: me.color }
    awareness.setLocalState({ ...awareness.getLocalState(), person })
  }
  publish()
  const stop = me.subscribe(publish)
  return () => {
    stop()
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

/** A loop's knob or fader as presence names it: `<trackId>.<control>`. See `CONTROL_KEYS`. */
export const controlKey = CONTROL_KEYS.track

/**
 * Who else is turning each control, by control key: the first person found per control. Never you,
 * even from another tab of yours, since that is still you turning it.
 */
export function listHolders(states: Iterable<unknown>, meId: string): Map<string, Person> {
  const holders = new Map<string, Person>()
  for (const state of states) {
    const s = state as { person?: unknown; control?: unknown } | null
    if (typeof s?.control !== 'string') continue
    const person = toPerson(s.person)
    if (person && person.id !== meId && !holders.has(s.control)) holders.set(s.control, person)
  }
  return holders
}

/**
 * Tells everyone this browser is turning `control` (`held`), or has let it go. Letting go clears it
 * only while it is still the one published, so a second finger's drag isn't cleared by the first.
 */
export function holdControl(awareness: Awareness, control: string, held: boolean) {
  const state = awareness.getLocalState()
  if (!state) return // Left the jam.
  if (held) awareness.setLocalState({ ...state, control })
  else if (state.control === control) {
    const { control: _, ...rest } = state
    awareness.setLocalState(rest)
  }
}

const sameHolders = (a: Map<string, Person>, b: Map<string, Person>) =>
  a.size === b.size && [...a].every(([k, p]) => b.get(k) === p || sameHolder(b.get(k), p))
const sameHolder = (a: Person | undefined, b: Person) =>
  a?.id === b.id && a.name === b.name && a.color === b.color

/** Who else is turning which control, re-rendering only when that changes. */
export function useHolders(awareness: Awareness, meId: string): Map<string, Person> {
  const [holders, setHolders] = useState(() => listHolders(awareness.getStates().values(), meId))
  useEffect(() => {
    const onChange = () => {
      const next = listHolders(awareness.getStates().values(), meId)
      setHolders((was) => (sameHolders(was, next) ? was : next))
    }
    awareness.on('change', onChange)
    onChange()
    return () => awareness.off('change', onChange)
  }, [awareness, meId])
  return holders
}
