import { useEffect } from 'react'
import { useSwatch } from '../colors'
import type { ConnectionStatus } from '../doc'
import { useSession } from '../session'
import { Debug } from '../Debug'
import { Deck } from './Deck'
import { Header } from './Header'
import { Mixer } from './Mixer'
import { Unlock } from './Pads'
import './console.css'

const DEBUG = new URLSearchParams(window.location.search).has('debug')

/** The jam page as one soft console: header, deck (pads, readout, transport), then the mixer. */
export function Console({ slug, status }: { slug: string; status: ConnectionStatus }) {
  useFocusColor()
  return (
    <main className="console">
      <Header slug={slug} status={status} />
      {DEBUG && <Debug />}
      {/* Under the header on phones; wider screens show it in the header. */}
      <Unlock className="console-unlock-page" />
      <Deck slug={slug} />
      <Mixer />
    </main>
  )
}

/** Keyboard focus rings in your colour while you are in the jam (set on <html>, so menus get it too). */
function useFocusColor() {
  const { me } = useSession()
  const color = useSwatch()(me.color)
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--focus', color)
    return () => {
      root.removeProperty('--focus')
    }
  }, [color])
}
