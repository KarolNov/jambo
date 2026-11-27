import { describe, expect, it } from 'vitest'
import type YProvider from 'y-partyserver/provider'
import { parseSlotMessage, slotFull, slotGrant, slotStop } from '../shared/live'
import { LiveSlot, type SlotEnd } from '../src/audio/live/slot'

/** A stand-in for the board connection: records what is sent, and lets a test play the room. */
class FakeProvider {
  wsconnected = true
  sent: string[] = []
  private handlers = new Map<string, Set<(arg: never) => void>>()

  on(event: string, handler: (arg: never) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(handler)
  }

  off(event: string, handler: (arg: never) => void) {
    this.handlers.get(event)?.delete(handler)
  }

  sendMessage(message: string) {
    this.sent.push(message)
  }

  /** The room sends `message`. */
  room(message: string) {
    for (const h of this.handlers.get('custom-message') ?? []) (h as (m: string) => void)(message)
  }

  status(status: string) {
    this.wsconnected = status === 'connected'
    for (const h of this.handlers.get('status') ?? [])
      (h as (s: { status: string }) => void)({ status })
  }

  /** The slot messages sent so far, by kind. */
  slotSent() {
    return this.sent.map((m) => parseSlotMessage(m)?.s)
  }
}

function setup() {
  const provider = new FakeProvider()
  const slot = new LiveSlot(provider as unknown as YProvider)
  const ended: SlotEnd[] = []
  slot.onEnd((why) => ended.push(why))
  return { provider, slot, ended }
}

describe('a live slot, as the client asks for it', () => {
  it('answers offline at once, asking nothing, while not connected', async () => {
    const { provider, slot } = setup()
    provider.wsconnected = false
    expect(await slot.request()).toEqual({ granted: false, why: 'offline' })
    expect(provider.sent).toEqual([])
  })

  it('takes a grant, and answers a second ask with the slot it holds', async () => {
    const { provider, slot } = setup()
    const asked = slot.request()
    provider.room(slotGrant('v1'))
    expect(await asked).toEqual({ granted: true, voice: 'v1' })
    expect(slot.voice).toBe('v1')
    expect(await slot.request()).toEqual({ granted: true, voice: 'v1' })
    expect(provider.slotSent()).toEqual(['request'])
  })

  it('shares one ask between two waiting on it', async () => {
    const { provider, slot } = setup()
    const first = slot.request()
    const second = slot.request()
    provider.room(slotFull())
    expect(await first).toEqual({ granted: false, why: 'full' })
    expect(await second).toEqual({ granted: false, why: 'full' })
    expect(provider.slotSent()).toEqual(['request'])
  })

  it('reads unseated as a refusal', async () => {
    const { provider, slot } = setup()
    const asked = slot.request()
    provider.room(slotStop('unseated'))
    expect(await asked).toEqual({ granted: false, why: 'unseated' })
  })

  it('settles an ask released before the answer, and ignores the grant that comes late', async () => {
    const { provider, slot, ended } = setup()
    const asked = slot.request()
    slot.release()
    expect(await asked).toEqual({ granted: false, why: 'offline' })
    expect(provider.slotSent()).toEqual(['request', 'stop'])
    provider.room(slotGrant('v1'))
    expect(slot.voice).toBeUndefined()
    // The room confirming the stop ends nothing: nothing is held.
    provider.room(slotStop('asked'))
    expect(ended).toEqual([])
  })

  it('gives a held slot back, and sends nothing when none is held', () => {
    const { provider, slot } = setup()
    slot.release()
    expect(provider.sent).toEqual([])
    void slot.request()
    provider.room(slotGrant('v1'))
    slot.release()
    expect(slot.voice).toBeUndefined()
    expect(provider.slotSent()).toEqual(['request', 'stop'])
  })

  it.each([
    ['hour', 'hour'],
    ['idle', 'idle'],
    ['asked', 'stopped'],
  ] as const)('ends a held slot when the room stops it (%s)', async (why, end) => {
    const { provider, slot, ended } = setup()
    const asked = slot.request()
    provider.room(slotGrant('v1'))
    await asked
    provider.room(slotStop(why))
    expect(ended).toEqual([end])
    expect(slot.voice).toBeUndefined()
  })

  it('ends a held slot when the connection drops, and settles an ask out', async () => {
    const { provider, slot, ended } = setup()
    const held = slot.request()
    provider.room(slotGrant('v1'))
    await held
    provider.status('disconnected')
    expect(ended).toEqual(['dropped'])

    provider.status('connected')
    const asked = slot.request()
    provider.status('disconnected')
    expect(await asked).toEqual({ granted: false, why: 'offline' })
    expect(ended).toEqual(['dropped'])
  })

  it('hears nothing once disposed', async () => {
    const { provider, slot, ended } = setup()
    const held = slot.request()
    provider.room(slotGrant('v1'))
    await held
    slot.dispose()
    provider.room(slotStop('hour'))
    expect(ended).toEqual([])
  })
})
