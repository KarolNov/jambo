import { useSyncExternalStore } from 'react'
import type YProvider from 'y-partyserver/provider'
import type { ColorName } from '../../shared/colors'
import { hello, parseSeatMessage } from '../../shared/seats'

type Seating = { name: string; color: ColorName }

/**
 * This person in this jam: their id, and their name and colour here. They start as their usual
 * ones and become the ones the room seats them with, which differ when someone here already has
 * theirs.
 */
export class Me {
  readonly id: string
  /** Private to this browser and the room, which seats by it. */
  readonly key: string
  /** Their usual name and colour, asked for when they first join. */
  readonly usual: Seating
  private current: Seating
  /** Whether the room has seated them yet; until then others might already have their usual ones. */
  seated = false
  private readonly listeners = new Set<() => void>()

  constructor(identity: { id: string; key: string; name: string; color: ColorName }) {
    this.id = identity.id
    this.key = identity.key
    this.usual = { name: identity.name, color: identity.color }
    this.current = this.usual
  }

  get name(): string {
    return this.current.name
  }

  get color(): ColorName {
    return this.current.color
  }

  /** Takes the name and colour the room seated this person with. */
  seat(seat: Seating) {
    const same = seat.name === this.current.name && seat.color === this.current.color
    if (same && this.seated) return
    this.seated = true
    if (!same) this.current = { name: seat.name, color: seat.color }
    for (const l of this.listeners) l()
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  /** The current name and colour; a new object only when they change. */
  readonly snapshot = (): Seating => this.current
}

/** This person's name and colour in the jam, re-rendering when the room seats them. */
export const useSeat = (me: Me) => useSyncExternalStore(me.subscribe, me.snapshot)

/**
 * Asks the jam's room for a seat each time the connection opens, and takes the name and colour it
 * gives. It asks for the ones it has, so a reconnect keeps them while nobody else took them; until
 * the room answers, and while offline, `me` keeps them too.
 */
export function takeSeat(provider: YProvider, me: Me) {
  const ask = () => provider.sendMessage(hello(me.key, me.name, me.color))
  const onStatus = ({ status }: { status: string }) => {
    if (status === 'connected') ask()
  }
  const onMessage = (message: string) => {
    const seat = parseSeatMessage(message)
    if (seat?.t === 'seat') me.seat(seat)
  }
  provider.on('status', onStatus)
  provider.on('custom-message', onMessage)
  if (provider.wsconnected) ask()
  return () => {
    provider.off('status', onStatus)
    provider.off('custom-message', onMessage)
  }
}
