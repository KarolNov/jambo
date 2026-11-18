import { useEffect, useState } from 'react'
import type { Awareness } from 'y-protocols/awareness'
import { AGENT_AUTHOR_PREFIX, toKind } from '../../shared/agent'
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
  /** An AI agent in the jam over MCP, and its kind (Claude, Codex…). Agents' ids read `agent:<id>`. */
  agent?: { kind: string }
}

/** The person an awareness state carries, if it carries a valid one (legacy hex colours read as names). */
const toPerson = (v: unknown): Person | undefined => {
  const p = v as { id?: unknown; name?: unknown; color?: unknown } | null
  const color = toColorName(p?.color)
  if (typeof p?.id !== 'string' || !color) return undefined
  const name = toName(p.name)
  return name ? { id: p.id, name, color } : { id: p.id, color }
}

/** An agent the room lists in its own state, as a person entry marked as an agent. */
const toAgent = (v: unknown): Person | undefined => {
  const a = v as { id?: unknown; name?: unknown; color?: unknown; kind?: unknown } | null
  const color = toColorName(a?.color)
  const name = toName(a?.name)
  if (typeof a?.id !== 'string' || !color || !name) return undefined
  return { id: AGENT_AUTHOR_PREFIX + a.id, name, color, agent: { kind: toKind(a.kind) ?? 'Agent' } }
}

/**
 * Everyone in `states`, once per identity (two tabs of one browser are one person), `me` first,
 * then people, then the agents the room lists in its own state.
 */
export function listPeople(states: Iterable<unknown>, me: Person): Person[] {
  const others = new Map<string, Person>()
  const agents = new Map<string, Person>()
  for (const state of states) {
    const s = state as { person?: unknown; agents?: unknown } | null
    const person = toPerson(s?.person)
    if (person && person.id !== me.id && !others.has(person.id)) others.set(person.id, person)
    if (Array.isArray(s?.agents))
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
