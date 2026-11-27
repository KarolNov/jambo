import { useEffect, useState } from 'react'
import type { Awareness } from 'y-protocols/awareness'
import { AGENT_AUTHOR_PREFIX, isAgentAuthor } from '../../shared/agent'
import { CONTROL_KEYS } from '../../shared/board'
import { type ColorName, toColorName } from '../../shared/colors'
import { type LiveVoice, toLiveVoice } from '../../shared/live'
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
 * Who is live, from the room's own state only (the one state with no person), so a browser can't
 * show anyone as live: each voice once, as the room publishes them.
 */
export function listLive(states: Iterable<unknown>): LiveVoice[] {
  const live = new Map<string, LiveVoice>()
  for (const state of states) {
    const s = state as { person?: unknown; live?: unknown } | null
    if (s?.person || !Array.isArray(s?.live)) continue
    for (const raw of s.live) {
      const voice = toLiveVoice(raw)
      if (voice && !live.has(voice.voice)) live.set(voice.voice, voice)
    }
  }
  return [...live.values()]
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

const sameLive = (a: LiveVoice[], b: LiveVoice[]) =>
  a.length === b.length &&
  a.every((v, i) => v.voice === b[i]!.voice && v.name === b[i]!.name && v.color === b[i]!.color)

/** Who is live (see `listLive`), re-rendering only when that changes. */
export function useLive(awareness: Awareness): LiveVoice[] {
  const [live, setLive] = useState(() => listLive(awareness.getStates().values()))
  useEffect(() => {
    const onChange = () => {
      const next = listLive(awareness.getStates().values())
      setLive((was) => (sameLive(was, next) ? was : next))
    }
    awareness.on('change', onChange)
    onChange()
    return () => awareness.off('change', onChange)
  }, [awareness])
  return live
}

/** A loop's knob or fader as presence names it: `track.<trackId>.<control>`. See `CONTROL_KEYS`. */
export const controlKey = CONTROL_KEYS.track

/** This browser tab as presence knows it: who you are, and this tab's awareness client id. */
export type Self = { id: string; clientID: number }

/**
 * Who else holds each control, by control key. When several hold one at once, the lowest
 * awareness client id keeps it; if that is this tab, nobody else is listed for it, and if it is
 * someone else while this tab holds it too, this tab has lost it and should let go. Your other
 * tabs never count, either way: that is still you turning it.
 */
export function listHolders(
  states: Iterable<readonly [clientID: number, state: unknown]>,
  self: Self,
): Map<string, Person> {
  const winners = new Map<string, { clientID: number; person?: Person }>()
  for (const [clientID, state] of states) {
    const s = state as { person?: unknown; control?: unknown } | null
    if (typeof s?.control !== 'string') continue
    const mine = clientID === self.clientID
    const person = mine ? undefined : toPerson(s.person)
    if (!mine && (!person || person.id === self.id)) continue
    const was = winners.get(s.control)
    if (!was || clientID < was.clientID) winners.set(s.control, { clientID, person })
  }
  const holders = new Map<string, Person>()
  for (const [control, { person }] of winners) if (person) holders.set(control, person)
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

const readHolders = (awareness: Awareness, meId: string) =>
  listHolders(awareness.getStates().entries(), { id: meId, clientID: awareness.clientID })

const sameHolders = (a: Map<string, Person>, b: Map<string, Person>) =>
  a.size === b.size && [...a].every(([k, p]) => b.get(k) === p || sameHolder(b.get(k), p))
const sameHolder = (a: Person | undefined, b: Person) =>
  a?.id === b.id && a.name === b.name && a.color === b.color

/**
 * Who else holds which control (see `listHolders`), re-rendering only when that changes. A control
 * listed here is locked for you; one you hold that shows up here is one you lost to a simultaneous
 * grab.
 */
export function useHolders(awareness: Awareness, meId: string): Map<string, Person> {
  const [holders, setHolders] = useState(() => readHolders(awareness, meId))
  useEffect(() => {
    const onChange = () => {
      const next = readHolders(awareness, meId)
      setHolders((was) => (sameHolders(was, next) ? was : next))
    }
    awareness.on('change', onChange)
    onChange()
    return () => awareness.off('change', onChange)
  }, [awareness, meId])
  return holders
}
