/**
 * Renders the real jam UI (Console, Deck, Pads, Mixer, Uploads) around a seeded board doc, with
 * no server: the doc lives in a duratom store as in a jam, the provider never connects, and every
 * request goes to a `fetch` the test controls.
 */
import { docAtom } from 'duratom'
import { createStore, Provider } from 'jotai'
import type { ReactNode } from 'react'
import { vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type YProvider from 'y-partyserver/provider'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { apply, newId, seedBoard, type Sound, type Track } from '../../shared/board'
import { pong } from '../../shared/clock'
import type { ColorName } from '../../shared/colors'
import { JamClock } from '../../src/audio/clock'
import { Engine } from '../../src/audio/engine'
import { SampleLoader } from '../../src/audio/samples'
import type { JamSession } from '../../src/board/doc'
import { EngineFeed } from '../../src/board/Jam'
import { Me } from '../../src/board/seat'
import { makeBoard, type Session, SessionContext } from '../../src/board/session'
import { useThemedPage } from '../../src/theme/theme'

export const SLUG = 'funky-otter-k7q2'

/** Who listens for each provider event, so a test can play the room's part. */
const listeners = new WeakMap<YProvider, Map<string, Set<(arg: unknown) => void>>>()

/** A y-partyserver provider that never connects: the board stays local to the test. */
export function offlineProvider(): YProvider {
  const on = new Map<string, Set<(arg: unknown) => void>>()
  const provider = {
    wsconnected: false,
    wsconnecting: false,
    sendMessage: () => {},
    on: (event: string, fn: (arg: unknown) => void) => {
      if (!on.has(event)) on.set(event, new Set())
      on.get(event)!.add(fn)
    },
    off: (event: string, fn: (arg: unknown) => void) => on.get(event)?.delete(fn),
    destroy: () => {},
  } as unknown as YProvider
  listeners.set(provider, on)
  return provider
}

/** Agrees the session's clock with the jam, as the room's first pong would: room time = client time. */
export function agreeClock({ jam }: Session) {
  const now = performance.timeOrigin + performance.now()
  for (const fn of listeners.get(jam.provider)?.get('custom-message') ?? []) fn(pong(now, now))
}

/** What the jam's server would answer, by default: the sound budget open, uploads not found. */
export type Routes = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined

/** Mocks `fetch` for the page: `routes` first, then the defaults. Returns the spy. */
export function mockServer(routes: Routes = () => undefined) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const answer = await routes(url, init)
    if (answer) return answer
    if (url.endsWith('/api/sounds/status')) return Response.json({ uploads: 'open', reads: 'open' })
    return new Response('Not found', { status: 404 })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

/** A jam's session as `Jam` makes it, over a seeded doc and an offline provider. */
export function makeSession(name = 'Misty Yak', color: ColorName = 'sky'): Session {
  const doc = new Y.Doc()
  seedBoard(doc)
  const store = createStore()
  store.set(docAtom, doc)
  const provider = offlineProvider()
  const awareness = new Awareness(doc)
  const jam: JamSession = {
    doc,
    store,
    provider,
    awareness,
    destroy: () => {
      awareness.destroy()
      doc.destroy()
    },
  }
  const clock = new JamClock(provider)
  const engine = new Engine(clock, new SampleLoader(SLUG))
  const me = new Me({ id: 'me-id', key: 'me-key', name, color })
  return { jam, engine, me, board: makeBoard(jam, me) }
}

/** Themes the page as App does, so the controls get their tokens. */
export function Themed({ children }: { children: ReactNode }) {
  useThemedPage()
  return <>{children}</>
}

/** Renders `ui` inside `session`, with the engine fed from the doc, as `Jam` does. */
export async function renderJam(ui: ReactNode, session = makeSession()) {
  const screen = await render(
    <Themed>
      <SessionContext.Provider value={session}>
        <Provider store={session.jam.store}>
          <EngineFeed engine={session.engine} />
          {ui}
        </Provider>
      </SessionContext.Provider>
    </Themed>,
  )
  return { screen, session }
}

/** Ends a session as `Jam` does on unmount. */
export function endSession({ engine, jam }: Session) {
  engine.dispose()
  jam.destroy()
}

const room = { kind: 'system', id: 'room' } as const

/** An upload's details as the room lists them. */
export const upload = (over: Partial<Sound> = {}): Sound => ({
  name: 'Vox',
  author: 'misty-id',
  authorName: 'Misty Yak',
  color: 'coral',
  durationMs: 1200,
  bytes: 105_884,
  createdAt: 1_700_000_000_000,
  ...over,
})

/** Lists uploads on the board as the room does (only the room may add sounds). */
export function addUploads(session: Session, sounds: [id: string, sound: Sound][]) {
  const results = apply(
    session.jam.doc,
    sounds.map(([id, sound]) => ({ op: 'addSound', id, sound })),
    room,
  )
  if (!results.every((r) => r.ok)) throw new Error(JSON.stringify(results))
}

/** An upload id for the `n`th test upload: `u-` and 12 base32 characters. */
export const uploadId = (n: number) => `u-testsoundx${B32[(n >> 5) & 31]}${B32[n & 31]}`
const B32 = 'abcdefghijklmnopqrstuvwxyz234567'

/** Adds a one-bar track through the board SDK, returning its id. */
export function addTrack(session: Session, over: Partial<Track> = {}) {
  const id = newId()
  const r = session.board.addTrack(id, {
    name: 'Misty Yak 1',
    author: session.me.id,
    color: 'sky',
    bars: 1,
    hits: [{ padId: 'r0c0', beat: 0 }],
    startBar: 0,
    gain: 1,
    mute: false,
    quantize: 0,
    effects: [],
    ...over,
  })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return id
}
