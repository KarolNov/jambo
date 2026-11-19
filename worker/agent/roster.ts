import {
  AGENT_LIMITS,
  agentIdOf,
  DEFAULT_KIND,
  isAgentKey,
  newAgentKey,
  seatAgent,
  toKind,
} from '../../shared/agent'
import type { ColorName } from '../../shared/colors'
import type { Seat } from '../../shared/seats'

/** An agent present in a jam, as the room holds it. `key` is private; `id` is public. */
export interface PresentAgent {
  key: string
  id: string
  kind: string
  name: string
  color: ColorName
  summary?: string
  /** When it last acted, in ms since the epoch. */
  lastSeen: number
}

/** An agent as everyone in the jam sees it: never its key. */
export interface AgentView {
  id: string
  kind: string
  name: string
  color: ColorName
  summary?: string
}

/** Who an agent says it is when it calls a tool; everything optional. */
export interface AgentHello {
  key?: string
  kind?: string
  name?: string
  color?: ColorName
}

const PRESENT_KEY = 'agents'

export const toView = (a: PresentAgent): AgentView => ({
  id: a.id,
  kind: a.kind,
  name: a.name,
  color: a.color,
  ...(a.summary ? { summary: a.summary } : {}),
})

/**
 * The agents present in one jam, kept in the room's storage so idle removal works after the room
 * was evicted. Seats are worked out synchronously from what the room passes in, so two agents
 * joining at once never share a name.
 */
export class Roster {
  private present: Map<string, PresentAgent> | undefined

  /** `jam` names the jam, so an agent's public id differs from one jam to the next. */
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly jam: () => string,
  ) {}

  async load(): Promise<Map<string, PresentAgent>> {
    if (!this.present) {
      const saved = (await this.storage.get<PresentAgent[]>(PRESENT_KEY)) ?? []
      // Another load may have finished while this one waited.
      this.present ??= new Map(saved.map((a) => [a.key, a]))
    }
    return this.present
  }

  /** The agents present, after `load`. */
  list(): PresentAgent[] {
    return [...(this.present?.values() ?? [])]
  }

  seats(except?: string): Seat[] {
    return this.list()
      .filter((a) => a.key !== except)
      .map((a) => ({ id: a.key, name: a.name, color: a.color }))
  }

  /**
   * Seats an agent, or renews one already present, setting its `summary` when given. `people` are
   * the people's seats right now. The agent keeps its seat while present; a new or returning one
   * is seated like a person. A key the room didn't make, or a kind that isn't one, is ignored.
   */
  async join(
    hello: AgentHello,
    people: readonly Seat[],
    summary?: string,
    now = Date.now(),
  ): Promise<PresentAgent> {
    const present = await this.load()
    const key = isAgentKey(hello.key) ? hello.key : newAgentKey()
    const id = present.get(key)?.id ?? (await agentIdOf(key, this.jam()))
    // From here no awaits until the seat is in the map, so seats can't race.
    let agent = present.get(key)
    if (agent) {
      agent.lastSeen = now
    } else {
      const kind = toKind(hello.kind) ?? DEFAULT_KIND
      const seat = seatAgent([...people, ...this.seats(key)], key, kind, hello)
      agent = { key, id, kind, name: seat.name, color: seat.color, lastSeen: now }
      present.set(key, agent)
    }
    if (summary !== undefined) agent.summary = summary
    await this.save()
    return agent
  }

  async leave(key: string): Promise<boolean> {
    const removed = (await this.load()).delete(key)
    if (removed) await this.save()
    return removed
  }

  /** Removes agents idle for `AGENT_LIMITS.idleMs`; true when any went. */
  async expire(now = Date.now()): Promise<boolean> {
    const present = await this.load()
    let any = false
    for (const [key, a] of present) {
      if (now - a.lastSeen >= AGENT_LIMITS.idleMs) {
        present.delete(key)
        any = true
      }
    }
    if (any) await this.save()
    return any
  }

  /** When the next agent idles out, if any is present. */
  nextExpiry(): number | undefined {
    let next: number | undefined
    for (const a of this.list()) {
      const at = a.lastSeen + AGENT_LIMITS.idleMs
      if (next === undefined || at < next) next = at
    }
    return next
  }

  private async save() {
    await this.storage.put(PRESENT_KEY, this.list())
  }
}
