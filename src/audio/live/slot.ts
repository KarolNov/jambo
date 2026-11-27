import type YProvider from 'y-partyserver/provider'
import { parseSlotMessage, slotRequest, slotStop } from '../../../shared/live'

/** What asking the room for a live slot came to. */
export type SlotAnswer =
  | { granted: true; voice: string }
  | { granted: false; why: 'full' | 'unseated' | 'offline' }

/**
 * Why a held slot ended without this client giving it back: its hour ran out, the room heard no
 * frame from it for a while, the connection dropped, or another tab of this person stopped it or
 * took it over.
 */
export type SlotEnd = 'hour' | 'idle' | 'dropped' | 'stopped'

/**
 * This client's live slot, asked of the jam's room over the board connection (see `shared/live.ts`).
 * The room decides: a slot is held only once it grants one, and ends when the room says so, or when
 * the connection drops (the room frees it then, and a reconnect does not take it back).
 */
export class LiveSlot {
  private pending?: (answer: SlotAnswer) => void
  /** The voice id of the slot held now, if one is. */
  voice?: string
  private endListeners = new Set<(why: SlotEnd) => void>()

  constructor(private readonly provider: YProvider) {
    provider.on('custom-message', this.onMessage)
    provider.on('status', this.onStatus)
  }

  /** Asks for a slot; answers once the room does, or at once while offline. */
  request(): Promise<SlotAnswer> {
    if (!this.provider.wsconnected) return Promise.resolve({ granted: false, why: 'offline' })
    if (this.voice) return Promise.resolve({ granted: true, voice: this.voice })
    // A second ask while one is out shares its answer.
    return new Promise((resolve) => {
      const was = this.pending
      this.pending = (answer) => {
        was?.(answer)
        resolve(answer)
      }
      if (!was) this.provider.sendMessage(slotRequest())
    })
  }

  /** Gives the slot back, if one is held or asked for. */
  release() {
    const asked = this.voice !== undefined || this.pending !== undefined
    this.voice = undefined
    this.answer({ granted: false, why: 'offline' })
    if (asked && this.provider.wsconnected) this.provider.sendMessage(slotStop())
  }

  /** Calls `listener` when a held slot ends without `release`. */
  onEnd(listener: (why: SlotEnd) => void) {
    this.endListeners.add(listener)
    return () => {
      this.endListeners.delete(listener)
    }
  }

  dispose() {
    this.provider.off('custom-message', this.onMessage)
    this.provider.off('status', this.onStatus)
    this.endListeners.clear()
    this.pending = undefined
    this.voice = undefined
  }

  private answer(answer: SlotAnswer) {
    const pending = this.pending
    this.pending = undefined
    pending?.(answer)
  }

  private end(why: SlotEnd) {
    if (this.voice === undefined) return
    this.voice = undefined
    for (const l of this.endListeners) l(why)
  }

  private onMessage = (message: string) => {
    const m = parseSlotMessage(message)
    if (!m) return
    if (m.s === 'grant') {
      // A grant nobody waits for any more was released already; the room frees it on our stop.
      if (!this.pending) return
      this.voice = m.v
      this.answer({ granted: true, voice: m.v })
    } else if (m.s === 'full') this.answer({ granted: false, why: 'full' })
    else if (m.s === 'stop') {
      if (m.why === 'unseated') this.answer({ granted: false, why: 'unseated' })
      else if (m.why === 'hour') this.end('hour')
      else if (m.why === 'idle') this.end('idle')
      // `asked`: the room confirming a release, or another tab of this person taking the slot.
      else this.end('stopped')
    }
  }

  private onStatus = ({ status }: { status: string }) => {
    if (status === 'connected') return
    this.answer({ granted: false, why: 'offline' })
    this.end('dropped')
  }
}
