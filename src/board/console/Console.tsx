import type { ConnectionStatus } from '../doc'
import { Debug } from '../Debug'
import { Deck } from './Deck'
import { Header } from './Header'
import { Mixer } from './Mixer'
import { Unlock } from './Pads'
import './console.css'

const DEBUG = new URLSearchParams(window.location.search).has('debug')

/** The jam page as one soft console: header, deck (pads, readout, transport), then the mixer. */
export function Console({ slug, status }: { slug: string; status: ConnectionStatus }) {
  return (
    <main className="console">
      <Header slug={slug} status={status} />
      {DEBUG && <Debug />}
      <Unlock />
      <Deck slug={slug} />
      <Mixer />
    </main>
  )
}
