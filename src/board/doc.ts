import { docAtom } from 'duratom'
import { createStore } from 'jotai'
import YProvider from 'y-partyserver/provider'
import * as Y from 'yjs'
import { BOARD_PARTY } from '../../shared/parties'

export type ConnectionStatus = 'connecting' | 'connected' | 'offline'

export interface JamSession {
  doc: Y.Doc
  store: ReturnType<typeof createStore>
  provider: YProvider
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
    destroy: () => {
      provider.destroy()
      doc.destroy()
    },
  }
}

/** Subscribes to the provider's connection status. Returns an unsubscribe function. */
export function onStatus(provider: YProvider, listener: (status: ConnectionStatus) => void) {
  const handle = ({ status }: { status: 'connecting' | 'connected' | 'disconnected' }) =>
    listener(status === 'disconnected' ? 'offline' : status)
  provider.on('status', handle)
  listener(provider.wsconnected ? 'connected' : provider.wsconnecting ? 'connecting' : 'offline')
  return () => provider.off('status', handle)
}
