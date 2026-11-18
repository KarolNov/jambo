import type YProvider from 'y-partyserver/provider'
import {
  type ClockSample,
  SAMPLE_WINDOW,
  bestSample,
  nextOffset,
  parseClockMessage,
  ping,
  sampleFrom,
} from '../../shared/clock'

const BURST = 8
const BURST_GAP_MS = 100
const EVERY_MS = 15_000

/** This client's time, in Unix ms: monotonic, unlike Date.now(). */
export const clientNow = () => performance.timeOrigin + performance.now()

/**
 * Agrees this client's clock with the jam's room, NTP-style, over the board connection: a burst of
 * pings on every (re)connect, then one every 15 s. The estimate is the lowest-round-trip sample of
 * the last few. Offline, the last estimate is kept.
 */
export class JamClock {
  /** Room time minus client time, in ms; undefined until the first pong. */
  offset?: number
  /** The round trip of the sample behind `offset`, in ms. */
  rtt?: number
  private samples: ClockSample[] = []
  private timers: ReturnType<typeof setTimeout>[] = []
  private interval?: ReturnType<typeof setInterval>
  private listeners = new Set<() => void>()

  constructor(private provider: YProvider) {
    provider.on('custom-message', this.onMessage)
    provider.on('status', this.onStatus)
    if (provider.wsconnected) this.burst()
    this.interval = setInterval(() => this.send(), EVERY_MS)
  }

  get synced() {
    return this.offset !== undefined
  }

  /** The room's time now, in ms; undefined until synced. */
  now(): number | undefined {
    return this.offset === undefined ? undefined : clientNow() + this.offset
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose() {
    this.provider.off('custom-message', this.onMessage)
    this.provider.off('status', this.onStatus)
    for (const t of this.timers) clearTimeout(t)
    clearInterval(this.interval)
  }

  private onStatus = ({ status }: { status: string }) => {
    if (status === 'connected') this.burst()
  }

  private burst() {
    for (const t of this.timers) clearTimeout(t)
    this.timers = Array.from({ length: BURST }, (_, i) =>
      setTimeout(() => this.send(), i * BURST_GAP_MS),
    )
  }

  private send() {
    if (this.provider.wsconnected) this.provider.sendMessage(ping(clientNow()))
  }

  private onMessage = (message: string) => {
    // Stamp arrival before parsing, so decoding doesn't count as part of the trip.
    const receivedAt = clientNow()
    const msg = parseClockMessage(message)
    if (msg?.t !== 'pong') return
    this.samples.push(sampleFrom(msg.c, msg.s, receivedAt))
    this.samples = this.samples.slice(-SAMPLE_WINDOW)
    const best = bestSample(this.samples)!
    const offset = nextOffset(this.offset, best.offset)
    const changed = offset !== this.offset || best.rtt !== this.rtt
    this.offset = offset
    this.rtt = best.rtt
    if (changed) for (const l of this.listeners) l()
  }
}
