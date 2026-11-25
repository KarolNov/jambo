import { CONTROL_KEYS, type Issue, type MasterKnob, type Op, type TrackPatch } from '../board'
import { toName } from '../names'
import { isAgentAuthor } from './identity'

/** Who holds each live control right now: a person's name, by control key (`CONTROL_KEYS`). */
export type Holds = ReadonlyMap<string, string>

/**
 * The controls people hold, from the jam's awareness states: each state's `control` key, named for
 * the person whose state it is. The first holder found per control wins; states without a person
 * (the room's own) hold nothing.
 */
export function holdsOf(states: Iterable<unknown>): Map<string, string> {
  const holds = new Map<string, string>()
  for (const state of states) {
    const s = state as { person?: { id?: unknown; name?: unknown }; control?: unknown } | null
    if (typeof s?.control !== 'string' || typeof s.person?.id !== 'string') continue
    if (isAgentAuthor(s.person.id) || holds.has(s.control)) continue
    holds.set(s.control, toName(s.person.name) ?? 'someone')
  }
  return holds
}

const heldBy = (name: string, path: (string | number)[]): Issue => ({
  message: `Held by ${name}`,
  path,
})

/**
 * `op` without what a person holds right now. A `setFx` on a held mode is refused whole; a
 * `setMaster` or `setTrack` loses only its held knobs or fields, and is refused when none are
 * left. `issues` names each holder; `op` is what may still apply.
 */
export function withoutHeld(op: Op, holds: Holds): { op?: Op; issues: Issue[] } {
  if (holds.size === 0) return { op, issues: [] }
  switch (op.op) {
    case 'setFx': {
      const name = holds.get(CONTROL_KEYS.fx(op.mode))
      return name ? { issues: [heldBy(name, ['mode'])] } : { op, issues: [] }
    }
    case 'setMaster': {
      const { kept, issues } = split(
        op.set,
        (k) => CONTROL_KEYS.master(k as MasterKnob),
        'set',
        holds,
      )
      return { ...(kept ? { op: { ...op, set: kept } } : {}), issues }
    }
    case 'setTrack': {
      const { kept, issues } = split(op.patch, (f) => CONTROL_KEYS.track(op.id, f), 'patch', holds)
      return { ...(kept ? { op: { ...op, patch: kept as TrackPatch } } : {}), issues }
    }
    default:
      return { op, issues: [] }
  }
}

/** The entries of `fields` nobody holds (undefined when none are left), and an issue per held one. */
function split<T extends object>(
  fields: T,
  keyOf: (field: string) => string,
  at: string,
  holds: Holds,
): { kept?: T; issues: Issue[] } {
  const issues: Issue[] = []
  const kept: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(fields)) {
    const name = holds.get(keyOf(field))
    if (name) issues.push(heldBy(name, [at, field]))
    else kept[field] = value
  }
  if (issues.length === 0) return { kept: fields, issues }
  return { ...(Object.keys(kept).length > 0 ? { kept: kept as T } : {}), issues }
}
