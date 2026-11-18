import type YProvider from 'y-partyserver/provider'
import type { ColorName } from '../../shared/colors'
import { hello, parseSeatMessage } from '../../shared/seats'

/**
 * This person in this jam: their id, and their name and colour here. They start as their usual
 * ones and become the ones the room seats them with, which differ when someone here already has
 * theirs.
 */
export class Me {
  readonly id: string
  /** Their usual name and colour, asked for on every (re)connect. */
  readonly usual: { name: string; color: ColorName }
  private current: { name: string; color: ColorName }
  private readonly listeners = new Set<() => void>()

  constructor(identity: { id: string; name: string; color: ColorName }) {
    this.id = identity.id
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
  seat(seat: { name: string; color: ColorName }) {
    if (seat.name === this.current.name && seat.color === this.current.color) return
    this.current = { name: seat.name, color: seat.color }
    for (const l of this.listeners) l()
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }
}

/**
 * Asks the jam's room for a seat each time the connection opens, and takes the name and colour it
 * gives. Until it answers, and while offline, `me` keeps the ones it has.
 */
export function takeSeat(provider: YProvider, me: Me) {
  const ask = () => provider.sendMessage(hello(me.id, me.usual.name, me.usual.color))
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
