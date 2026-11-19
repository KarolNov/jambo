import { docAtom } from 'duratom'
import { createStore } from 'jotai'
import YProvider from 'y-partyserver/provider'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { BOARD_PARTY } from '../../shared/parties'
import { type ConnectionStatus, connectionStatus, type SocketStatus } from './connection'

export type { ConnectionStatus }

export interface JamSession {
  doc: Y.Doc
  store: ReturnType<typeof createStore>
  provider: YProvider
  /** Who is in the jam right now; relayed by the room, never stored. */
  awareness: Awareness
  destroy: () => void
}

/**
 * Opens a jam: one Y.Doc and one Jotai store per jam, with the doc in `docAtom` and connected to
 * the jam's Board Durable Object at /parties/board/:slug on this same host.
 */
export function openJam(slug: string): JamSession {
  const doc = new Y.Doc()
  const provider = new YProvider(window.location.host, slug, doc, { party: BOARD_PARTY })
  const store = createStore()
  store.set(docAtom, doc)
  return {
    doc,
    store,
    provider,
    awareness: provider.awareness,
    destroy: () => {
      provider.destroy()
      doc.destroy()
    },
  }
}

/**
 * Subscribes to the connection's status as the header shows it: the provider's socket, and
 * whether the browser has a network. Returns an unsubscribe function.
 */
export function onStatus(provider: YProvider, listener: (status: ConnectionStatus) => void) {
  let socket: SocketStatus = provider.wsconnected
    ? 'connected'
    : provider.wsconnecting
      ? 'connecting'
      : 'disconnected'
  let everConnected = socket === 'connected'
  const update = () => listener(connectionStatus(socket, everConnected, navigator.onLine))
  const handle = ({ status }: { status: SocketStatus }) => {
    socket = status
    everConnected ||= status === 'connected'
    update()
  }
  provider.on('status', handle)
  window.addEventListener('online', update)
  window.addEventListener('offline', update)
  update()
  return () => {
    provider.off('status', handle)
    window.removeEventListener('online', update)
    window.removeEventListener('offline', update)
  }
}
