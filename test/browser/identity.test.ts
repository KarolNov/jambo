import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type YProvider from 'y-partyserver/provider'
import { hello, seated } from '../../shared/seats'
import { identity } from '../../src/board/identity'
import { Me, takeSeat } from '../../src/board/seat'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('identity', () => {
  // @scenario board/session: Come back
  it('is the same on every visit from one browser', () => {
    const first = identity()
    // Another tab, another jam, another day: the same browser storage.
    const again = identity()
    expect(again).toEqual(first)
    expect(first.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
  })

  // @scenario board/session: Storage blocked
  it('gives a fresh identity for the page when storage is blocked', () => {
    const blocked = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked)
    const a = identity()
    expect(a.id).toBeTruthy()
    expect(a.key).toBeTruthy()
    expect(a.name).toBeTruthy()
    expect(a.color).toBeTruthy()
    // Nothing is kept, so the next page gets another one.
    expect(identity().id).not.toBe(a.id)
  })
})

/** Just enough of a y-partyserver provider to drive `takeSeat`. */
function fakeProvider() {
  const handlers = new Map<string, Set<(arg: never) => void>>()
  const sent: string[] = []
  const provider = {
    wsconnected: false,
    sendMessage: (m: string) => void sent.push(m),
    on: (event: string, h: (arg: never) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(h)
    },
    off: (event: string, h: (arg: never) => void) => void handlers.get(event)?.delete(h),
  }
  const emit = (event: string, arg: unknown) => {
    for (const h of handlers.get(event) ?? []) h(arg as never)
  }
  return { provider: provider as unknown as YProvider, sent, emit }
}

describe('takeSeat', () => {
  // @scenario board/session: Connection blip
  it('keeps the seat the room gave across a reconnect', () => {
    const me = new Me({ id: 'id', key: 'key', name: 'Groovy Otter', color: 'sky' })
    const { provider, sent, emit } = fakeProvider()
    takeSeat(provider, me)

    emit('status', { status: 'connected' })
    expect(sent).toEqual([hello('key', 'Groovy Otter', 'sky')])
    // Someone here already has Groovy Otter and Sky.
    emit('custom-message', seated({ name: 'Sunny Puffin', color: 'coral' }))
    expect([me.name, me.color]).toEqual(['Sunny Puffin', 'coral'])

    // The connection drops: they stay Sunny Puffin while offline...
    emit('status', { status: 'disconnected' })
    expect([me.name, me.color]).toEqual(['Sunny Puffin', 'coral'])
    // ...and ask for it back, not for their usual name, when it returns.
    emit('status', { status: 'connected' })
    expect(sent.at(-1)).toBe(hello('key', 'Sunny Puffin', 'coral'))
    emit('custom-message', seated({ name: 'Sunny Puffin', color: 'coral' }))
    expect([me.name, me.color]).toEqual(['Sunny Puffin', 'coral'])
  })
})
