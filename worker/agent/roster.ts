import {
  AGENT_LIMITS,
  agentIdOf,
  DEFAULT_KIND,
  isAgentKey,
  newAgentKey,
  seatAgent,
  toAgentName,
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
  /** A one-way tag of the caller's address in this jam, for the per-address cap; never shown. */
  from?: string
  /** When it last acted, in ms since the epoch. */
  lastSeen: number
}

/**
 * Who an agent was when it left, kept so it comes back as itself. Stored by its public id, which
 * only its private key can produce, so nobody else can take the identity and storage holds no key.
 */
interface AwayAgent {
  kind: string
  name: string
  color: ColorName
  /** When it left, in ms since the epoch. */
  leftAt: number
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
  /** A one-way tag of the caller's address in this jam (see `addressTag`). */
  from?: string
}

/** Why a new agent wasn't seated: the jam or the caller already has as many as allowed. */
export const jamFull = (perAddress: boolean) => ({
  error: perAddress
    ? `You already have ${AGENT_LIMITS.perAddress} agents in this jam; pass your agentKey to rejoin as one of them`
    : `This jam has ${AGENT_LIMITS.perJam} agents; pass your agentKey to rejoin as yourself`,
})

const PRESENT_KEY = 'agents'
const AWAY_KEY = 'agentsAway'

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
  /** Agents that left, by public id, oldest first. */
  private away: Map<string, AwayAgent> | undefined

  /** `jam` names the jam, so an agent's public id differs from one jam to the next. */
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly jam: () => string,
  ) {}

  async load(): Promise<Map<string, PresentAgent>> {
    if (!this.present || !this.away) {
      const [saved, away] = await Promise.all([
        this.storage.get<PresentAgent[]>(PRESENT_KEY),
        this.storage.get<[string, AwayAgent][]>(AWAY_KEY),
      ])
      // Another load may have finished while this one waited.
      this.present ??= new Map((saved ?? []).map((a) => [a.key, a]))
      this.away ??= new Map(away ?? [])
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
   * the people's seats right now. The agent keeps its seat while present, taking a kind, name or
   * colour it asks for when nobody else here has it. A new one is seated like a person; one coming
   * back after it left or idled out asks, by default, for the kind, name and colour it had. A key
   * the room didn't make, or a kind that isn't one, is ignored. A new or returning agent is refused
   * when the jam, or the caller's address, already has its most.
   */
  async join(
    hello: AgentHello,
    people: readonly Seat[],
    summary?: string,
    now = Date.now(),
  ): Promise<PresentAgent | { error: string }> {
    const present = await this.load()
    const key = isAgentKey(hello.key) ? hello.key : newAgentKey()
    const id = present.get(key)?.id ?? (await agentIdOf(key, this.jam()))
    // From here no awaits until the seat is in the map, so seats can't race.
    let agent = present.get(key)
    if (agent) {
      agent.lastSeen = now
      restyle(agent, hello, [...people, ...this.seats(key)])
    } else {
      const others = [...present.values()]
      if (others.length >= AGENT_LIMITS.perJam) return jamFull(false)
      if (
        hello.from !== undefined &&
        others.filter((a) => a.from === hello.from).length >= AGENT_LIMITS.perAddress
      )
        return jamFull(true)
      const was = this.recall(id, now)
      const kind = toKind(hello.kind) ?? was?.kind ?? DEFAULT_KIND
      const usual = {
        name: hello.name ?? (was?.kind === kind ? was.name : undefined),
        color: hello.color ?? was?.color,
      }
      const seat = seatAgent([...people, ...this.seats(key)], key, kind, usual)
      agent = { key, id, kind, name: seat.name, color: seat.color, lastSeen: now }
      if (hello.from !== undefined) agent.from = hello.from
      present.set(key, agent)
      this.away!.delete(id)
    }
    if (summary !== undefined) agent.summary = summary
    await this.save()
    return agent
  }

  async leave(key: string, now = Date.now()): Promise<boolean> {
    const present = await this.load()
    const agent = present.get(key)
    if (!agent) return false
    present.delete(key)
    this.remember(agent, now)
    await this.save()
    return true
  }

  /** Removes agents idle for `AGENT_LIMITS.idleMs`; true when any went. */
  async expire(now = Date.now()): Promise<boolean> {
    const present = await this.load()
    let any = false
    for (const [key, a] of present) {
      if (now - a.lastSeen >= AGENT_LIMITS.idleMs) {
        present.delete(key)
        this.remember(a, now)
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

  /** Keeps who `agent` was for its return, forgetting the longest gone past `awayMax`. */
  private remember(agent: PresentAgent, now: number) {
    const away = this.away!
    away.delete(agent.id)
    away.set(agent.id, { kind: agent.kind, name: agent.name, color: agent.color, leftAt: now })
    for (const id of away.keys()) {
      if (away.size <= AGENT_LIMITS.awayMax) break
      away.delete(id)
    }
  }

  /** Who the agent with public id `id` was when it left, unless that was too long ago. */
  private recall(id: string, now: number): AwayAgent | undefined {
    const was = this.away!.get(id)
    return was && now - was.leftAt < AGENT_LIMITS.awayMs ? was : undefined
  }

  private async save(now = Date.now()) {
    const away = this.away!
    for (const [id, a] of away) if (now - a.leftAt >= AGENT_LIMITS.awayMs) away.delete(id)
    await this.storage.put({ [PRESENT_KEY]: this.list(), [AWAY_KEY]: [...away] })
  }
}

/**
 * Gives a present `agent` the kind, name and colour it asks for in `hello` when nobody in `others`
 * has them. A new kind its name doesn't fit gets it a fresh name of that kind.
 */
function restyle(agent: PresentAgent, hello: AgentHello, others: readonly Seat[]) {
  const kind = toKind(hello.kind)
  if (kind) agent.kind = kind
  const names = new Set(others.map((s) => s.name.toLowerCase()))
  const wanted = hello.name === undefined ? undefined : toAgentName(hello.name, agent.kind)
  if (wanted && !names.has(wanted.toLowerCase())) agent.name = wanted
  else if (!toAgentName(agent.name, agent.kind))
    agent.name = seatAgent(others, agent.key, agent.kind, { color: agent.color }).name
  if (hello.color && !others.some((s) => s.color === hello.color)) agent.color = hello.color
}
