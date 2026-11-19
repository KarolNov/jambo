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
  useYourColor()
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

/**
 * Your colour as the jam's accent while you are in it: focus rings (on <html>), and hovers, lit
 * switches and the other `--accent-2` tints (on <body>, since the theme sets its tokens on <html>).
 * Both reach the menus, which open in <body>.
 */
function useYourColor() {
  const { me } = useSession()
  const color = useSwatch()(me.color)
  useEffect(() => {
    const root = document.documentElement.style
    const body = document.body.style
    root.setProperty('--focus', color)
    body.setProperty('--accent-2', color)
    return () => {
      root.removeProperty('--focus')
      body.removeProperty('--accent-2')
    }
  }, [color])
}
