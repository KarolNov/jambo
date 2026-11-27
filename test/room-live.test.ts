import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import {
  LIVE,
  parseRelayMessage,
  parseSlotMessage,
  relayOut,
  type SlotMessage,
  slotRequest,
  slotStop,
} from '../shared/live'
import { hello, parseSeatMessage } from '../shared/seats'
import { listLive } from '../src/board/presence'
import type { Board } from '../worker/board'
import { SLOT_IDLE_MS } from '../worker/live'
import { connectBoard, until } from './client'

type Client = Awaited<ReturnType<typeof connectBoard>>

/** Connects and seats a person as `name`, under the private key `key`. */
async function person(slug: string, key: string, name: string, host?: string) {
  const c = await connectBoard(slug, host)
  c.sendCustom(hello(key, name, 'teal'))
  await until(() => c.custom.some((m) => parseSeatMessage(m)?.t === 'seat'))
  return c
}

const slotMessages = (c: Client) =>
  c.custom.map(parseSlotMessage).filter((m): m is SlotMessage => m !== undefined)

/** Asks for a slot and waits for the room's answer: the voice id granted, or `full`. */
async function goLive(c: Client) {
  const before = slotMessages(c).length
  c.sendCustom(slotRequest())
  await until(() => slotMessages(c).length > before)
  const answer = slotMessages(c)[before]!
  return answer.s === 'grant' ? answer.v : answer.s
}

/** Who `c` sees live, by name, as the room publishes it. */
const liveSeenBy = (c: Client) =>
  listLive(c.awareness.getStates().values())
    .map((l) => l.name)
    .sort()

const sameNames = (c: Client, names: string[]) =>
  JSON.stringify(liveSeenBy(c)) === JSON.stringify([...names].sort())

describe('live slots', () => {
  // @scenario collab/live-voice: Fourth singer
  it('grants at most three slots, and tells a fourth the jam is full', async () => {
    const slug = 'funky-otter-vc01'
    const people = await Promise.all(
      ['Misty Yak', 'Groovy Otter', 'Mellow Fox', 'Sunny Owl'].map((n, i) =>
        person(slug, `k${i}`, n),
      ),
    )
    const [a, b, c, d] = people as [Client, Client, Client, Client]
    const voices = [await goLive(a), await goLive(b), await goLive(c)]
    for (const v of voices) expect(v).toMatch(/^[0-9a-f-]{36}$/)
    expect(new Set(voices).size).toBe(3)
    expect(await goLive(d)).toBe('full')
    await until(() => sameNames(d, ['Misty Yak', 'Groovy Otter', 'Mellow Fox']))
    // Asking again while live keeps the same slot.
    expect(await goLive(a)).toBe(voices[0])
    for (const p of people) p.close()
  })

  // @scenario collab/live-voice: Two at once for the last slot
  it('gives the last slot to exactly one of two asking at the same moment', async () => {
    const slug = 'funky-otter-vc02'
    const a = await person(slug, 'k0', 'Misty Yak')
    const b = await person(slug, 'k1', 'Groovy Otter')
    const c = await person(slug, 'k2', 'Mellow Fox')
    const d = await person(slug, 'k3', 'Sunny Owl')
    await goLive(a)
    await goLive(b)
    const [x, y] = await Promise.all([goLive(c), goLive(d)])
    expect([x, y].filter((v) => v === 'full')).toHaveLength(1)
    await until(() => liveSeenBy(a).length === 3)
    for (const p of [a, b, c, d]) p.close()
  })

  it('frees a slot when its holder stops, and lists them no longer', async () => {
    const slug = 'funky-otter-vc03'
    const a = await person(slug, 'k0', 'Misty Yak')
    const b = await person(slug, 'k1', 'Groovy Otter')
    await goLive(a)
    await until(() => sameNames(b, ['Misty Yak']))
    a.sendCustom(slotStop())
    await until(() => slotMessages(a).some((m) => m.s === 'stop' && m.why === 'asked'))
    await until(() => liveSeenBy(b).length === 0)
    a.close()
    b.close()
  })

  it('refuses a slot to someone the room has not seated', async () => {
    const c = await connectBoard('funky-otter-vc04')
    expect(await goLive(c)).toBe('stop')
    expect(slotMessages(c).at(-1)).toEqual({ t: 'slot', s: 'stop', why: 'unseated' })
    c.close()
  })
})

describe('live slots and leaving', () => {
  // @scenario collab/room: Slot freed on leave
  // @scenario collab/live-voice: Singer drops
  it('frees a slot when the tab holding it closes, and a fourth can go live', async () => {
    const slug = 'funky-otter-vc05'
    const a = await person(slug, 'k0', 'Misty Yak')
    const b = await person(slug, 'k1', 'Groovy Otter')
    const c = await person(slug, 'k2', 'Mellow Fox')
    const d = await person(slug, 'k3', 'Sunny Owl')
    for (const p of [a, b, c]) await goLive(p)
    await until(() => liveSeenBy(d).length === 3)
    // A second tab of Misty Yak's that never asked doesn't hold the slot: closing the live tab
    // frees it.
    const a2 = await person(slug, 'k0', 'Misty Yak')
    a.close()
    await until(() => sameNames(d, ['Groovy Otter', 'Mellow Fox']))
    a2.close()
    expect(await goLive(d)).toMatch(/^[0-9a-f-]{36}$/)
    // Coming back doesn't resume live: they ask again, and the jam is full now.
    const back = await person(slug, 'k0', 'Misty Yak')
    await until(() => liveSeenBy(back).length === 3)
    expect(liveSeenBy(back)).not.toContain('Misty Yak')
    expect(await goLive(back)).toBe('full')
    for (const p of [b, c, d, back]) p.close()
  })

  // @scenario collab/room: Browser posing as live
  it('lists as live only who the room says, never a browser’s own claim', async () => {
    const slug = 'funky-otter-vc06'
    const poser = await person(slug, 'k0', 'Misty Yak')
    const singer = await person(slug, 'k1', 'Groovy Otter')
    const listener = await person(slug, 'k2', 'Mellow Fox')
    poser.awareness.setLocalState({
      person: { id: 'p0', name: 'Misty Yak', color: 'teal' },
      live: [{ voice: 'fake', name: 'Misty Yak', color: 'teal' }],
    })
    await goLive(singer)
    await until(() => sameNames(listener, ['Groovy Otter']))
    await until(() =>
      [...listener.awareness.getStates().values()].some((s) => 'live' in s && s.person),
    )
    expect(liveSeenBy(listener)).toEqual(['Groovy Otter'])
    for (const p of [poser, singer, listener]) p.close()
  })
})

describe('live slots and tabs', () => {
  // @scenario collab/room: Another tab takes over
  it('moves a slot to another tab of its person that asks, under a new voice', async () => {
    const slug = 'funky-otter-vc09'
    const a = await person(slug, 'k0', 'Misty Yak')
    const a2 = await person(slug, 'k0', 'Misty Yak')
    const b = await person(slug, 'k1', 'Groovy Otter')
    const first = await goLive(a)
    await until(() => sameNames(b, ['Misty Yak']))
    const second = await goLive(a2)
    expect(second).toMatch(/^[0-9a-f-]{36}$/)
    expect(second).not.toBe(first)
    // The first tab is told to stop; the person is still live once, on the new voice.
    await until(() => slotMessages(a).some((m) => m.s === 'stop' && m.why === 'asked'))
    await until(() => listLive(b.awareness.getStates().values())[0]?.voice === second)
    expect(liveSeenBy(b)).toEqual(['Misty Yak'])
    // Closing the old tab leaves the slot with the new one.
    a.close()
    await new Promise((r) => setTimeout(r, 100))
    expect(liveSeenBy(b)).toEqual(['Misty Yak'])
    a2.close()
    b.close()
  })
})

/** Moves every live slot in `slug` back by `ms`, as if that long had passed. */
const ageSlots = (slug: string, ms: number) =>
  runInDurableObject(env.Board.getByName(slug), (instance) => {
    for (const c of (instance as Board).getConnections<{ live?: { since: number } }>()) {
      const slot = c.state?.live
      if (slot) c.setState({ ...c.state, live: { ...slot, since: slot.since - ms } })
    }
  })

describe('live slots and the hour', () => {
  // @scenario collab/live-voice: An hour live
  it('ends a slot on the alarm after an hour, saying why, and grants it again', async () => {
    const slug = 'funky-otter-vc07'
    const a = await person(slug, 'k0', 'Misty Yak')
    const b = await person(slug, 'k1', 'Groovy Otter')
    const granted = Date.now()
    const voice = await goLive(a)
    const stub = env.Board.getByName(slug)
    const alarm = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm())
    expect(alarm).toBeGreaterThanOrEqual(granted + LIVE.maxMs)
    expect(alarm).toBeLessThan(Date.now() + LIVE.maxMs + 1000)

    await ageSlots(slug, LIVE.maxMs)
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    await until(() => slotMessages(a).some((m) => m.s === 'stop' && m.why === 'hour'))
    await until(() => liveSeenBy(b).length === 0)
    expect(await runInDurableObject(stub, (_i, state) => state.storage.getAlarm())).toBeNull()

    const again = await goLive(a)
    expect(again).toMatch(/^[0-9a-f-]{36}$/)
    expect(again).not.toBe(voice)
    a.close()
    b.close()
  })
})

describe('the fake relay and slots', () => {
  it('frees a slot no frame has come through for a while, saying why', async () => {
    const slug = 'funky-otter-vc10'
    const a = await person(slug, 'k0', 'Misty Yak', 'localhost')
    const b = await person(slug, 'k1', 'Groovy Otter', 'localhost')
    await goLive(a)
    await ageSlots(slug, SLOT_IDLE_MS + 1)
    // The next ask frees it first.
    expect(await goLive(b)).toMatch(/^[0-9a-f-]{36}$/)
    await until(() => slotMessages(a).some((m) => m.s === 'stop' && m.why === 'idle'))
    await until(() => sameNames(b, ['Groovy Otter']))
    a.close()
    b.close()
  })

  it('relays only a slot holder’s frames, named by their voice, never their key', async () => {
    const slug = 'funky-otter-vc08'
    const a = await person(slug, 'secret-key', 'Misty Yak', 'localhost')
    const b = await person(slug, 'k1', 'Groovy Otter', 'localhost')
    const frames = () => b.custom.map(parseRelayMessage).filter((m) => m?.v)
    a.sendCustom(relayOut(new Uint8Array([1, 2, 3])))
    await new Promise((r) => setTimeout(r, 100))
    expect(frames()).toHaveLength(0)

    const voice = await goLive(a)
    a.sendCustom(relayOut(new Uint8Array([1, 2, 3])))
    await until(() => frames().length === 1)
    expect(frames()[0]?.v).toBe(voice)
    expect(b.custom.join()).not.toContain('secret-key')
    a.close()
    b.close()
  })
})
