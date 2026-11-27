import * as encoding from 'lib0/encoding'
import type { Connection, ConnectionContext } from 'partyserver'
import * as awarenessProtocol from 'y-protocols/awareness'
import { YServer } from 'y-partyserver'
import * as Y from 'yjs'
import {
  AGENT_AUTHOR_PREFIX,
  AGENT_LIMITS,
  type Change,
  changesBetween,
  checkSummary,
  type Holding,
  holdingOf,
  holdsOf,
  LISTEN,
  prepare,
  type Snapshot,
  type SnapshotPresence,
  snapshotOf,
  stampRepeats,
  withoutHeld,
} from '../shared/agent'
import {
  apply,
  BEATS_PER_BAR,
  BPM,
  countClips,
  countUploads,
  kindOf,
  LIMITS,
  ROOTS,
  Sound,
  type SoundKind,
  type Origin,
  unnamedClips,
} from '../shared/board'
import { seedBoard } from '../shared/board/seed'
import { parseClockMessage, pong } from '../shared/clock'
import {
  LIVE,
  type LiveVoice,
  parseRelayMessage,
  parseSlotMessage,
  relayIn,
  slotFull,
  slotGrant,
  slotStop,
} from '../shared/live'
import type { ColorName } from '../shared/colors'
import { assignSeat, parseSeatMessage, type Seat, seated } from '../shared/seats'
import { CLIPS, newUploadId, PAUSED_MESSAGES, UPLOADS } from '../shared/sounds'
import { parseUploadWav } from '../shared/wav'
import { type AgentHello, type AgentView, type PresentAgent, Roster, toView } from './agent/roster'
import { relaysFake } from './live'
import { quota } from './quota'

const SNAPSHOT_KEY = 'doc'
/**
 * When the jam's audio is due for deletion. The one alarm serves both retention and agents idling
 * out, so it is set to whichever comes first; this records the retention side.
 */
const RETAIN_KEY = 'retainUntil'
/** Set once alarms are scheduled through `schedule`; before that every alarm was retention. */
const ALARM_V2_KEY = 'alarmV2'
/** How often the room re-sends its agents: browsers drop a remote state after 30 s without one. */
const AGENT_REFRESH_MS = 10_000
/** y-protocols' message type for awareness updates. */
const MESSAGE_AWARENESS = 1
/** Set by the retention alarm when the doc wasn't loaded, so the next load unlists the uploads. */
const EXPIRED_KEY = 'soundsExpired'
/**
 * Every upload id this jam has issued, so none is ever issued twice. The value is the bytes the
 * id's file holds against the budget, or 0 once they were given back.
 */
const ISSUED_PREFIX = 'issued:'
const EXPIRING_MESSAGE = 'This jam’s old sounds are being cleared, try again in a moment'
/**
 * Clips nothing names, with when each was first seen that way, so their grace survives the room
 * being evicted.
 */
const ORPHANS_KEY = 'orphanClips'
/**
 * How long a clip may go unnamed by any track before the room frees it: the longest take (every
 * bar at the slowest tempo), since its track is added only once the take ends, plus a minute for
 * uploads and the track to land.
 */
export const ORPHAN_CLIP_MS = (LIMITS.bars * BEATS_PER_BAR * 60_000) / BPM.min + 60_000
/** How long the room lets edits settle before checking for orphan clips. */
const ORPHAN_WATCH_MS = 1000

const DAY_MS = 24 * 60 * 60 * 1000
/** A jam's uploaded audio is deleted after this long with nobody connecting. */
export const SOUND_RETENTION_MS = 90 * DAY_MS

const ROOM: Origin = { kind: 'system', id: 'room' }

/** Where a connection's seat (who holds it, and their colour here) lives in its state. */
const SEAT_KEY = 'seat'
/** Set on connections made to a local Worker: the room relays fake live frames between them. */
const FAKE_LIVE_KEY = 'fakeLive'
/**
 * Where a person's live slot lives: on every connection holding their seat, so it lasts while any
 * of their tabs is connected and goes with the last. `voice` is the public id their frames carry
 * (never the seat's id, which is private); `since` is when it was granted (ms).
 */
const LIVE_KEY = 'live'
type LiveSlot = { voice: string; since: number }
type SeatState = {
  [SEAT_KEY]?: Seat
  [FAKE_LIVE_KEY]?: true
  [LIVE_KEY]?: LiveSlot
} & Record<string, unknown>

/** Where an upload's audio lives in R2: under the jam's prefix, so a jam's audio can go at once. */
export const soundPrefix = (slug: string) => `jams/${slug}/`
export const soundKey = (slug: string, id: string) => `${soundPrefix(slug)}${id}.wav`

/** One operation's result, as an agent gets it. */
export interface AgentOpResult {
  op: string
  ok: boolean
  issues?: { message: string; path?: (string | number)[] }[]
  /** The id minted for an added track. */
  id?: string
}

/** What applying a run came to. */
export interface AgentRunResult {
  agent: AgentView & { key: string }
  summary: string
  ops: AgentOpResult[]
}

/** What a listen came to: what changed since the agent last looked, or the whole board. */
export interface AgentListenResult {
  agent: AgentView & { key: string }
  changes: Change[]
  /** Who is turning which control right now. */
  holding: Holding[]
  /** The whole jam, when the room has no record of what this agent last saw. */
  board?: Snapshot
}

/** What one agent last saw, so a listen can answer only what changed since. */
interface Seen {
  board: Snapshot
  /** Others' changes the agent hadn't seen yet when its own run moved `board` on. */
  carried: Change[]
  holding: Holding[]
  answeredAt: number
}

const sameHolding = (a: Holding[], b: Holding[]) =>
  a.length === b.length && a.every((h, i) => h.control === b[i]!.control && h.by === b[i]!.by)

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)))

/** What an upload or removal came to: a result, or an HTTP status and a message for people. */
export type SoundResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; status: 400 | 404 | 409 | 503; error: string }

export interface UploadInput {
  wav: ArrayBuffer
  name: string
  author: string
  /** The uploader's name in the jam; older clients send none. */
  authorName?: string
  color: string
  /** A voice clip sung into a take, held to `CLIPS.perJam`; an upload when missing. */
  kind?: SoundKind
}

/**
 * One Durable Object per jam: holds the jam's board doc, relays edits and presence between everyone
 * connected, keeps a snapshot of the doc in its own SQLite-backed storage, and is the jam's clock.
 * It seats each person with a name nobody else in the jam has, and a colour while one is free.
 * It also lists and unlists uploaded sounds, storing their audio in R2, and deletes that audio
 * once the jam goes unvisited for `SOUND_RETENTION_MS`.
 */
export class Board extends YServer<Env> {
  static override callbackOptions = {
    debounceWait: 1000,
    debounceMaxWait: 5000,
    timeout: 5000,
  }

  /** Whether the doc is in memory: the retention alarm can fire without loading it. */
  private loaded = false
  /** Whether the retention alarm is deleting this jam's audio right now. */
  private expiring = false
  /** Agents present in this jam over MCP. */
  private readonly roster = new Roster(this.ctx.storage, () => this.name)
  private agentRefresh: ReturnType<typeof setInterval> | null = null
  /** What each agent last saw, by agent id. In memory: after an eviction a listen sends the board. */
  private readonly seen = new Map<string, Seen>()
  /** Listens waiting for the jam to change. */
  private readonly wakers = new Set<() => void>()
  /** Clips nothing names, and since when (ms); mirrored in storage under ORPHANS_KEY. */
  private orphans = new Map<string, number>()
  /** The live voices last published in the room's state, to publish again only on a change. */
  private publishedLive = '[]'

  override async onLoad() {
    const saved = await this.ctx.storage.get<Uint8Array>(SNAPSHOT_KEY)
    if (saved) Y.applyUpdate(this.document, saved)
    seedBoard(this.document)
    this.loaded = true
    const wake = () => {
      for (const w of [...this.wakers]) w()
    }
    this.document.on('update', wake)
    this.document.awareness.on('change', wake)
    this.orphans = new Map(
      Object.entries((await this.ctx.storage.get<Record<string, number>>(ORPHANS_KEY)) ?? {}),
    )
    // Once per settled burst of edits, not per update: knob drags send many.
    let watching = false
    const watch = () => {
      if (watching) return
      watching = true
      this.ctx.waitUntil(
        sleep(ORPHAN_WATCH_MS).then(() => {
          watching = false
          return this.watchOrphans()
        }),
      )
    }
    this.document.getMap(ROOTS.tracks).observeDeep(watch)
    this.document.getMap(ROOTS.sounds).observeDeep(watch)
    await this.roster.load()
    this.publishRoom()
    if (await this.ctx.storage.get(EXPIRED_KEY)) {
      apply(this.document, [{ op: 'expireSounds' }], ROOM)
      await this.onSave()
      await this.ctx.storage.delete(EXPIRED_KEY)
    }
    await this.watchOrphans()
  }

  // Called a moment after edits, and when the last client leaves.
  override async onSave() {
    await this.ctx.storage.put(SNAPSHOT_KEY, Y.encodeStateAsUpdate(this.document))
  }

  override onConnect(connection: Connection, ctx: ConnectionContext) {
    super.onConnect(connection, ctx)
    if (relaysFake(ctx.request.url))
      connection.setState((prev: SeatState | null) => ({ ...prev, [FAKE_LIVE_KEY]: true }))
    // A visit keeps the jam's audio for another retention period.
    this.ctx.waitUntil(this.keepSounds())
    // Someone is here to see the agents now: keep their state fresh.
    this.refreshAgents()
  }

  override onCustomMessage(connection: Connection, message: string) {
    // The jam clock: answers a ping, to that client alone, with its own timestamp and the room's
    // time. Each message is its own event, so Date.now() is fresh.
    const msg = parseClockMessage(message)
    if (msg?.t === 'ping') return this.sendCustomMessage(connection, pong(msg.c, Date.now()))
    // A client saying who it is: seat it with a name nobody else in the jam has, and a colour
    // nobody else has while one is free.
    const seat = parseSeatMessage(message)
    if (seat?.t === 'hello') return this.seat(connection, seat.key, seat)
    const slot = parseSlotMessage(message)
    if (slot?.s === 'request') return this.grantSlot(connection as Connection<SeatState>)
    if (slot?.s === 'stop') return this.stopSlot(connection as Connection<SeatState>, 'asked')
    const live = parseRelayMessage(message)
    if (live) this.relayLive(connection as Connection<SeatState>, live.f)
  }

  override onClose(connection: Connection, code: number, reason: string, wasClean: boolean) {
    super.onClose(connection, code, reason, wasClean)
    this.leftLive(connection as Connection<SeatState>)
  }

  override onError(connection: Connection, error: unknown) {
    this.leftLive(connection as Connection<SeatState>)
    return super.onError(connection, error)
  }

  /**
   * A connection went: when it held a slot that none of its person's other connections still
   * holds, the slot is free, and everyone hears so.
   */
  private leftLive(connection: Connection<SeatState>) {
    if (!connection.state?.[LIVE_KEY]) return
    this.publishRoom()
    this.ctx.waitUntil(this.schedule())
  }

  /** Every open connection of the person seated as `seatId`. */
  private *connectionsOf(seatId: string) {
    for (const c of this.getConnections<SeatState>())
      if (c.state?.[SEAT_KEY]?.id === seatId) yield c
  }

  /** Live slots held now, by seat id, each with the seat that holds it. */
  private slots(): Map<string, LiveSlot & { seat: Seat }> {
    const slots = new Map<string, LiveSlot & { seat: Seat }>()
    for (const c of this.getConnections<SeatState>()) {
      const seat = c.state?.[SEAT_KEY]
      const slot = c.state?.[LIVE_KEY]
      if (seat && slot && !slots.has(seat.id)) slots.set(seat.id, { ...slot, seat })
    }
    return slots
  }

  /** Who is live, as everyone reads it from the room's state: oldest slot first. */
  private liveVoices(): LiveVoice[] {
    return [...this.slots().values()]
      .sort((a, b) => a.since - b.since)
      .map((s) => ({ voice: s.voice, name: s.seat.name, color: s.seat.color }))
  }

  /**
   * A seated person asks to go live: grants them a slot while fewer than `LIVE.maxVoices` are held,
   * else answers full. Messages are handled one at a time and this does no I/O before deciding, so
   * two asking for the last slot at once get one grant and one full. Asking again while live
   * answers the slot they hold.
   */
  private grantSlot(connection: Connection<SeatState>) {
    const seat = connection.state?.[SEAT_KEY]
    if (!seat) return this.sendCustomMessage(connection, slotStop('unseated'))
    const slots = this.slots()
    const held = slots.get(seat.id)
    if (held) return this.sendCustomMessage(connection, slotGrant(held.voice))
    if (slots.size >= LIVE.maxVoices) return this.sendCustomMessage(connection, slotFull())
    const slot: LiveSlot = { voice: crypto.randomUUID(), since: Date.now() }
    for (const c of this.connectionsOf(seat.id))
      c.setState((prev: SeatState | null) => ({ ...prev, [LIVE_KEY]: slot }))
    this.sendCustomMessage(connection, slotGrant(slot.voice))
    this.publishRoom()
    this.ctx.waitUntil(this.schedule())
  }

  /** Frees the slot `connection`'s person holds, telling each of their connections why. */
  private stopSlot(connection: Connection<SeatState>, why: 'asked' | 'hour') {
    const seat = connection.state?.[SEAT_KEY]
    if (!seat) return
    let held = false
    for (const c of this.connectionsOf(seat.id)) {
      if (!c.state?.[LIVE_KEY]) continue
      held = true
      c.setState((prev: SeatState | null) => {
        const { [LIVE_KEY]: _, ...rest } = prev ?? {}
        return rest
      })
      this.sendCustomMessage(c, slotStop(why))
    }
    if (!held) return
    this.publishRoom()
    this.ctx.waitUntil(this.schedule())
  }

  /** When the first live slot reaches `LIVE.maxMs`, if any is held. */
  private liveDue(): number | undefined {
    const since = [...this.slots().values()].map((s) => s.since)
    return since.length > 0 ? Math.min(...since) + LIVE.maxMs : undefined
  }

  /** Ends every live slot held for `LIVE.maxMs`, telling its holder it was the hour. */
  private expireLive() {
    const now = Date.now()
    for (const [seatId, slot] of this.slots()) {
      if (slot.since + LIVE.maxMs > now) continue
      const first = this.connectionsOf(seatId).next().value
      if (first) this.stopSlot(first, 'hour')
    }
  }

  /**
   * The fake live transport: passes a slot holder's frame on to everyone else connected, naming it
   * by their slot's voice id. Only between connections to a local Worker (see `worker/live.ts`).
   */
  private relayLive(connection: Connection<SeatState>, frame: string) {
    const seat = connection.state?.[SEAT_KEY]
    const slot = connection.state?.[LIVE_KEY]
    if (!seat || !slot || !connection.state?.[FAKE_LIVE_KEY]) return
    const out = relayIn(slot.voice, frame)
    // Not to the singer's own connections: their other tabs hold the same seat.
    for (const c of this.getConnections<SeatState>())
      if (c.state?.[SEAT_KEY]?.id !== seat.id && c.state?.[FAKE_LIVE_KEY])
        this.sendCustomMessage(c, out)
  }

  /** People's seats, from their connections; `except` leaves one connection out. */
  private peopleSeats(except?: string): Seat[] {
    const seats: Seat[] = []
    for (const c of this.getConnections<SeatState>()) {
      const s = c.state?.[SEAT_KEY]
      if (c.id !== except && s) seats.push(s)
    }
    return seats
  }

  private seat(connection: Connection, key: string, usual: { name: string; color: ColorName }) {
    // Agents hold seats too: nobody shares a name with one, nor a colour while one is free.
    const others = [...this.peopleSeats(connection.id), ...this.roster.seats()]
    const seat = assignSeat(others, key, usual)
    // A tab opened while its person is live holds their slot too, so it lasts while any is open.
    const slot = this.slots().get(seat.id)
    // Merged in: y-partyserver keeps its own fields in the connection's state.
    connection.setState((prev: SeatState | null) => {
      const { [LIVE_KEY]: _, ...rest } = prev ?? {}
      return slot
        ? { ...rest, [SEAT_KEY]: seat, [LIVE_KEY]: { voice: slot.voice, since: slot.since } }
        : { ...rest, [SEAT_KEY]: seat }
    })
    this.sendCustomMessage(connection, seated(seat))
    // A live person's name or colour may have changed with it.
    if (slot) this.publishRoom()
  }

  /** Who is in the jam, as an agent reads it: people once each, then agents. */
  private here(): SnapshotPresence[] {
    const people = new Map<string, SnapshotPresence>()
    for (const s of this.peopleSeats())
      if (!people.has(s.id)) people.set(s.id, { name: s.name, kind: 'person', color: s.color })
    const agents = this.roster
      .list()
      .map((a): SnapshotPresence => ({ name: a.name, kind: a.kind, color: a.color }))
    return [...people.values(), ...agents]
  }

  /** The jam as an agent reads it. */
  async snapshot(): Promise<Snapshot> {
    await this.roster.load()
    return snapshotOf(this.document, this.here())
  }

  /**
   * Puts an agent in the jam, or renews one already here, and tells everyone. Every tool call
   * comes through here, so each renews the agent's presence.
   */
  async agentJoin(hello: AgentHello): Promise<(AgentView & { key: string }) | { error: string }> {
    const agent = await this.roster.join(hello, this.peopleSeats())
    if ('error' in agent) return agent
    await this.agentActed()
    return { key: agent.key, ...toView(agent) }
  }

  /** `agentJoin` and `snapshot` in one call, so `join` over MCP costs one round trip. */
  async agentJoinAndRead(
    hello: AgentHello,
  ): Promise<{ agent: AgentView & { key: string }; board: Snapshot } | { error: string }> {
    const agent = await this.agentJoin(hello)
    if ('error' in agent) return agent
    const board = snapshotOf(this.document, this.here())
    this.seen.set(agent.id, { board, carried: [], holding: this.holding(), answeredAt: 0 })
    return { agent, board }
  }

  /** Who is turning which control right now. */
  private holding(): Holding[] {
    return holdingOf(holdsOf(this.document.awareness.getStates().values()))
  }

  /** Resolves on the next change to the doc or to anyone's presence, or after `ms`. */
  private nextChange(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        this.wakers.delete(done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      this.wakers.add(done)
    })
  }

  /**
   * Waits up to `waitMs` for the jam to change, then answers what changed since this agent last
   * looked (its own runs left out) and who is turning what. Answers at once when something
   * already changed, and never sooner than `LISTEN.minGapMs` after the agent's last answer. With
   * no record of what the agent saw (it never joined, or the room was evicted), answers the board.
   */
  async agentListen(
    hello: AgentHello,
    waitMs: number,
  ): Promise<AgentListenResult | { error: string }> {
    const agent = await this.agentJoin(hello)
    if ('error' in agent) return agent
    const present = new Set(this.roster.list().map((a) => a.id))
    for (const id of this.seen.keys()) if (!present.has(id)) this.seen.delete(id)

    const seen = this.seen.get(agent.id)
    if (!seen) {
      const board = snapshotOf(this.document, this.here())
      const holding = this.holding()
      this.seen.set(agent.id, { board, carried: [], holding, answeredAt: Date.now() })
      return { agent, changes: [], holding, board }
    }

    const deadline = Date.now() + Math.min(Math.max(waitMs, 0), LISTEN.maxWaitMs)
    const look = () => {
      const board = snapshotOf(this.document, this.here())
      const changes = [...seen.carried, ...changesBetween(seen.board, board)]
      const holding = this.holding()
      return {
        board,
        changes,
        holding,
        moved: changes.length > 0 || !sameHolding(holding, seen.holding),
      }
    }
    let now = look()
    while (!now.moved && Date.now() < deadline) {
      await this.nextChange(deadline - Date.now())
      // Let a drag or a burst of edits settle, so it comes as one answer.
      await sleep(Math.min(LISTEN.settleMs, deadline - Date.now()))
      now = look()
    }
    const gap = seen.answeredAt + LISTEN.minGapMs - Date.now()
    if (gap > 0) {
      await sleep(gap)
      now = look()
    }
    Object.assign(seen, {
      board: now.board,
      carried: [],
      holding: now.holding,
      answeredAt: Date.now(),
    })
    return { agent, changes: now.changes, holding: now.holding }
  }

  /** After an agent joins or acts: tells everyone, and counts it as a visit for retention. */
  private async agentActed() {
    this.publishRoom()
    await this.keepSounds()
    await this.schedule()
  }

  /** Takes an agent out of the jam at once. */
  async agentLeave(key: string): Promise<boolean> {
    const left = await this.roster.leave(key)
    const present = new Set(this.roster.list().map((a) => a.id))
    for (const id of this.seen.keys()) if (!present.has(id)) this.seen.delete(id)
    this.publishRoom()
    await this.schedule()
    return left
  }

  /**
   * Applies a run's operations as one change made by an AI, stamping the agent on what it
   * adds; returns one result per call. Joins or renews the agent first.
   */
  async runAgentOps(
    hello: AgentHello,
    calls: readonly unknown[],
    summaryText: string,
  ): Promise<AgentRunResult | { error: string }> {
    const checked = checkSummary(summaryText)
    if ('error' in checked) return checked
    if (calls.length < 1 || calls.length > AGENT_LIMITS.ops)
      return { error: `A run holds 1 to ${AGENT_LIMITS.ops} operations` }
    const agent = await this.roster.join(hello, this.peopleSeats(), checked.summary)
    if ('error' in agent) return agent
    // Controls people hold right now are theirs: those parts of a run are refused.
    const holds = holdsOf(this.document.awareness.getStates().values())
    const sounds = this.document.getMap<unknown>(ROOTS.sounds)
    const prepared = prepare(calls, { id: agent.id, color: agent.color }, undefined, (id) =>
      sounds.has(id),
    ).map((p) => {
      if (!('op' in p)) return { issues: p.issues }
      const { op, issues } = withoutHeld(p.op, holds)
      return { op, id: p.id, issues }
    })
    // The room's clock is the jam's, so repeat moves land on the same grid line for everyone.
    const ops = stampRepeats(
      prepared.flatMap((p) => (p.op ? [p.op] : [])),
      this.document,
      Date.now(),
    )
    // What others changed since this agent last looked stays news; its own run doesn't.
    const seen = this.seen.get(agent.id)
    if (seen)
      seen.carried.push(...changesBetween(seen.board, snapshotOf(this.document, this.here())))
    const applied = apply(this.document, ops, { kind: 'ai', id: AGENT_AUTHOR_PREFIX + agent.id })
    let next = 0
    const results = prepared.map((p, i): AgentOpResult => {
      const raw = (calls[i] as { op?: unknown } | null)?.op
      const name = typeof raw === 'string' ? raw : 'unknown'
      const held = p.issues.map(plainIssue)
      if (!p.op) return { op: name, ok: false, issues: held }
      const r = applied[next++]!
      if (!r.ok) return { op: name, ok: false, issues: [...held, ...r.issues.map(plainIssue)] }
      // Applied without the held parts, which come back as issues.
      return {
        op: name,
        ok: true,
        ...(held.length > 0 ? { issues: held } : {}),
        ...('id' in p && p.id ? { id: p.id } : {}),
      }
    })
    if (seen) seen.board = snapshotOf(this.document, this.here())
    await this.agentActed()
    return { agent: { key: agent.key, ...toView(agent) }, summary: checked.summary, ops: results }
  }

  /**
   * Publishes the agents present and who is live in the room's awareness state, which every
   * browser receives. Browsers take both only from the room's state, so none can show either.
   */
  private publishRoom() {
    const agents = this.roster.list().map(toView)
    const live = this.liveVoices()
    this.publishedLive = JSON.stringify(live)
    this.setRoomState(
      agents.length > 0 || live.length > 0
        ? { ...(agents.length > 0 ? { agents } : {}), ...(live.length > 0 ? { live } : {}) }
        : null,
    )
    this.refreshAgents()
  }

  /**
   * Keeps re-sending the room's state while agents are here or someone is live, and someone is
   * connected, so browsers don't drop it as stale; with nobody connected there is nobody to send
   * to. Each time it also catches a live slot gone with a connection that closed unannounced.
   */
  private refreshAgents() {
    const needed = () =>
      (this.roster.list().length > 0 || this.publishedLive !== '[]') &&
      [...this.getConnections()].length > 0
    if (!needed()) return this.stopAgentRefresh()
    this.agentRefresh ??= setInterval(() => {
      if (JSON.stringify(this.liveVoices()) !== this.publishedLive) return this.publishRoom()
      if (!needed()) return this.stopAgentRefresh()
      this.setRoomState({ ...this.document.awareness.getLocalState() })
    }, AGENT_REFRESH_MS)
  }

  /**
   * Sets the room's own awareness state and sends it to everyone connected. y-partyserver relays
   * only clients' updates, so the room's own goes out here; late joiners get it on connect.
   */
  private setRoomState(state: Record<string, unknown> | null) {
    const awareness = this.document.awareness
    awareness.setLocalState(state)
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]),
    )
    const message = encoding.toUint8Array(encoder)
    for (const c of this.getConnections()) {
      try {
        c.send(message)
      } catch {
        // A closing connection: it is about to be dropped anyway.
      }
    }
  }

  private stopAgentRefresh() {
    if (this.agentRefresh !== null) clearInterval(this.agentRefresh)
    this.agentRefresh = null
  }

  /**
   * Sets the one alarm to whichever comes first: the jam's audio expiring, an agent idling out, an
   * orphan clip's minute running out, or a live slot's hour.
   */
  private async schedule() {
    let retainUntil = await this.ctx.storage.get<number>(RETAIN_KEY)
    if (!(await this.ctx.storage.get(ALARM_V2_KEY))) {
      // Before agents, any alarm was retention: keep its time.
      const legacy = await this.ctx.storage.getAlarm()
      if (retainUntil === undefined && legacy !== null) {
        retainUntil = legacy
        await this.ctx.storage.put(RETAIN_KEY, legacy)
      }
      await this.ctx.storage.put(ALARM_V2_KEY, true)
    }
    const agentDue = this.roster.nextExpiry()
    const candidates = [retainUntil, agentDue, this.orphansDue(), this.liveDue()].filter(
      (t): t is number => t !== undefined,
    )
    const current = await this.ctx.storage.getAlarm()
    if (candidates.length === 0) {
      if (current !== null) await this.ctx.storage.deleteAlarm()
      return
    }
    const next = Math.min(...candidates)
    if (current !== next) await this.ctx.storage.setAlarm(next)
  }

  /**
   * Stores an uploaded WAV and lists it on the board, as an upload or, with `kind: 'clip'`, as a
   * voice clip held to its own count. The file must already be what the browser makes of an upload
   * (see `parseUploadWav`); the room never decodes audio. A clip no track names yet is freed after
   * `ORPHAN_CLIP_MS`, so its track must be added within that.
   */
  async uploadSound(input: UploadInput): Promise<SoundResult<{ id: string; sound: Sound }>> {
    const info = parseUploadWav(new Uint8Array(input.wav))
    if ('error' in info) return { ok: false, status: 400, error: info.error }
    const parsed = Sound.safeParse({
      name: input.name,
      author: input.author,
      authorName: input.authorName,
      color: input.color,
      durationMs: info.durationMs,
      bytes: input.wav.byteLength,
      createdAt: Date.now(),
      ...(input.kind === 'clip' ? { kind: 'clip' } : {}),
    })
    if (!parsed.success)
      return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? 'Invalid sound' }
    const sounds = this.document.getMap<unknown>(ROOTS.sounds)
    if (kindOf(parsed.data) === 'clip') {
      if (countClips(this.document) >= CLIPS.perJam)
        return { ok: false, status: 409, error: `This jam already has ${CLIPS.perJam} voice clips` }
    } else if (countUploads(this.document) >= UPLOADS.perJam)
      return { ok: false, status: 409, error: `This jam already has ${UPLOADS.perJam} sounds` }
    if (this.expiring) return { ok: false, status: 503, error: EXPIRING_MESSAGE }

    // The app-wide budget: refused once storage or this month's writes run low.
    const bytes = input.wav.byteLength
    const verdict = await quota(this.env).reserveUpload(bytes)
    if (verdict !== 'open') return { ok: false, status: 503, error: PAUSED_MESSAGES[verdict] }

    let id: string
    try {
      id = newUploadId()
      while (sounds.has(id) || (await this.ctx.storage.get(ISSUED_PREFIX + id))) id = newUploadId()
      // From here the room's record owns the reserved bytes; releasing goes through it.
      await this.ctx.storage.put(ISSUED_PREFIX + id, bytes)
    } catch (e) {
      await quota(this.env).release(bytes)
      throw e
    }

    const key = soundKey(this.name, id)
    let added = false
    try {
      await this.env.SOUND_FILES.put(key, input.wav, { httpMetadata: { contentType: 'audio/wav' } })
      // Retention started while the file was going up: it would unlist this sound too.
      if (this.expiring) {
        await this.env.SOUND_FILES.delete(key)
        return { ok: false, status: 503, error: EXPIRING_MESSAGE }
      }
      const [result] = apply(this.document, [{ op: 'addSound', id, sound: parsed.data }], ROOM)
      if (!result?.ok) {
        await this.env.SOUND_FILES.delete(key)
        return { ok: false, status: 409, error: result?.issues[0]?.message ?? 'Not added' }
      }
      added = true
    } finally {
      if (!added) await this.releaseStored(id)
    }
    await this.keepSounds()
    return { ok: true, id, sound: parsed.data }
  }

  /** Unlists an upload or clip no pad or track names, then deletes its audio. */
  async removeSound(id: string): Promise<SoundResult> {
    if (!this.document.getMap<unknown>(ROOTS.sounds).has(id))
      return { ok: false, status: 404, error: 'No such sound' }
    const [result] = apply(this.document, [{ op: 'removeSound', id }], ROOM)
    if (!result?.ok)
      return { ok: false, status: 409, error: result?.issues[0]?.message ?? 'In use' }
    await this.env.SOUND_FILES.delete(soundKey(this.name, id))
    await this.releaseStored(id)
    return { ok: true }
  }

  /**
   * Gives an upload's stored bytes back to the budget, once. The size comes from the room's own
   * record, not the listing, which clients can edit. Claiming zeroes the record before any other
   * I/O, so removal and retention racing for the same file release it only once.
   */
  private async releaseStored(id: string) {
    const bytes = await this.ctx.storage.get<number>(ISSUED_PREFIX + id)
    if (typeof bytes !== 'number' || bytes <= 0) return
    await this.ctx.storage.put(ISSUED_PREFIX + id, 0)
    await quota(this.env).release(bytes)
  }

  /** When the first orphan clip's grace runs out, if any clip is unnamed. */
  private orphansDue(): number | undefined {
    if (this.orphans.size === 0) return undefined
    return Math.min(...this.orphans.values()) + ORPHAN_CLIP_MS
  }

  /**
   * After a change to the tracks or sounds: notes clips that just lost their last track,
   * forgets ones named again or gone, and sets the alarm for when the first must go.
   */
  private async watchOrphans() {
    const now = Date.now()
    const unnamed = unnamedClips(this.document)
    let changed = false
    for (const id of this.orphans.keys()) {
      if (!unnamed.has(id)) {
        this.orphans.delete(id)
        changed = true
      }
    }
    for (const id of unnamed) {
      if (!this.orphans.has(id)) {
        this.orphans.set(id, now)
        changed = true
      }
    }
    if (!changed) return
    if (this.orphans.size > 0)
      await this.ctx.storage.put(ORPHANS_KEY, Object.fromEntries(this.orphans))
    else await this.ctx.storage.delete(ORPHANS_KEY)
    await this.schedule()
  }

  /**
   * Frees every clip no readable track has named for `ORPHAN_CLIP_MS`: unlists it, deletes its
   * audio and gives its bytes back, as removing it would. A clip a pad or an unreadable track still
   * names is refused by `removeSound` and stays, to be tried again on the next change.
   */
  private async freeOrphans() {
    const now = Date.now()
    let freed = false
    for (const [id, since] of [...this.orphans]) {
      if (since + ORPHAN_CLIP_MS > now) continue
      if (!unnamedClips(this.document).has(id)) continue
      const result = await this.removeSound(id)
      if (result.ok) freed = true
      else this.orphans.delete(id)
    }
    if (freed) await this.onSave()
    await this.watchOrphans()
  }

  /**
   * Pushes retention a full period ahead. Skips the write while it is less than a day short of
   * that, so a busy jam doesn't write on every connection.
   */
  private async keepSounds() {
    if (this.document.getMap<unknown>(ROOTS.sounds).size === 0) return
    const target = Date.now() + SOUND_RETENTION_MS
    const current = await this.ctx.storage.get<number>(RETAIN_KEY)
    if (current !== undefined && current >= target - DAY_MS) return
    await this.ctx.storage.put(RETAIN_KEY, target)
    await this.schedule()
  }

  /** The one alarm: agents idling out, orphan clips, live slots' hour, and retention when due. */
  override async alarm() {
    await this.roster.load()
    const agentDue = this.roster.nextExpiry()
    const v2 = await this.ctx.storage.get(ALARM_V2_KEY)
    const retainUntil = await this.ctx.storage.get<number>(RETAIN_KEY)
    // Orphans are known without loading the doc (freeing them needs it); kept in memory so the
    // `schedule` below still sets the alarm for them.
    if (!this.loaded)
      this.orphans = new Map(
        Object.entries((await this.ctx.storage.get<Record<string, number>>(ORPHANS_KEY)) ?? {}),
      )
    const orphansDue = this.orphansDue()
    const liveDue = this.liveDue()
    // Retention runs once it is due, or when it is what the alarm was set for (it comes before any
    // agent idles out, orphan clip or live slot is due); alarms set before agents were all retention.
    const forRetention = v2
      ? retainUntil !== undefined &&
        (retainUntil <= Date.now() ||
          [agentDue, orphansDue, liveDue].every((t) => t === undefined || retainUntil <= t))
      : true
    if (await this.roster.expire()) this.publishRoom()
    this.expireLive()
    if (orphansDue !== undefined && orphansDue <= Date.now()) {
      // Loads the doc (onLoad) the way a request would.
      if (!this.loaded) await super.alarm()
      await this.freeOrphans()
    }
    if (forRetention) await this.retain()
    await this.schedule()
  }

  /** `super.alarm()` loads the room and then calls this; the work is all in `alarm`. */
  override onAlarm() {}

  /**
   * Retention: with nobody here, people or agents, deletes the jam's audio and unlists its
   * uploads. The due time is cleared only once that is done, so a failed run is retried.
   */
  private async retain() {
    if ([...this.getConnections()].length > 0 || this.roster.list().length > 0) {
      await this.ctx.storage.put(RETAIN_KEY, Date.now() + SOUND_RETENTION_MS)
      return
    }
    // Uploads wait until this is done, so expiring can't unlist one that lands meanwhile.
    this.expiring = true
    try {
      // Claim every stored size first, so a removal racing this releases nothing twice.
      let freed = 0
      const stored = await this.ctx.storage.list<unknown>({ prefix: ISSUED_PREFIX })
      for (const [k, bytes] of stored) {
        if (typeof bytes !== 'number' || bytes <= 0) continue
        freed += bytes
        await this.ctx.storage.put(k, 0)
      }
      const prefix = soundPrefix(this.name)
      let cursor: string | undefined
      let lists = 0
      do {
        const page = await this.env.SOUND_FILES.list({ prefix, cursor })
        lists++
        if (page.objects.length > 0)
          await this.env.SOUND_FILES.delete(page.objects.map((o) => o.key))
        cursor = page.truncated ? page.cursor : undefined
      } while (cursor)
      const budget = quota(this.env)
      await budget.countLists(lists)
      if (freed > 0) await budget.release(freed)
      if (this.loaded) {
        apply(this.document, [{ op: 'expireSounds' }], ROOM)
        await this.onSave()
      } else {
        await this.ctx.storage.put(EXPIRED_KEY, true)
      }
      await this.ctx.storage.delete(RETAIN_KEY)
    } finally {
      this.expiring = false
    }
  }
}

const plainIssue = (i: { message: string; path?: readonly PropertyKey[] }) => ({
  message: i.message,
  ...(i.path ? { path: i.path.filter((p): p is string | number => typeof p !== 'symbol') } : {}),
})
