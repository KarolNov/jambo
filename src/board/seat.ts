import type YProvider from 'y-partyserver/provider'
import type { ColorName } from '../../shared/colors'
import { hello, parseSeatMessage } from '../../shared/seats'

/**
 * This person in this jam: their id, and their colour here. It starts as their usual colour and
 * becomes the one the room seats them with, which differs when someone here already has theirs.
 */
export class Me {
  readonly id: string
  /** Their usual colour, asked for on every (re)connect. */
  readonly usual: ColorName
  private current: ColorName
  private readonly listeners = new Set<() => void>()

  constructor(identity: { id: string; color: ColorName }) {
    this.id = identity.id
    this.usual = identity.color
    this.current = identity.color
  }

  get color(): ColorName {
    return this.current
  }

  setColor(color: ColorName) {
    if (color === this.current) return
    this.current = color
    for (const l of this.listeners) l()
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }
}

/**
 * Asks the jam's room for a seat each time the connection opens, and takes the colour it gives.
 * Until it answers, and while offline, `me` keeps the colour it has.
 */
export function takeSeat(provider: YProvider, me: Me) {
  const ask = () => provider.sendMessage(hello(me.id, me.usual))
  const onStatus = ({ status }: { status: string }) => {
    if (status === 'connected') ask()
  }
  const onMessage = (message: string) => {
    const seat = parseSeatMessage(message)
    if (seat?.t === 'seat') me.setColor(seat.color)
  }
  provider.on('status', onStatus)
  provider.on('custom-message', onMessage)
  if (provider.wsconnected) ask()
  return () => {
    provider.off('status', onStatus)
    provider.off('custom-message', onMessage)
  }
}
