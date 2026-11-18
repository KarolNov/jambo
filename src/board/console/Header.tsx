import { useEffect, useRef, useState } from 'react'
import { ThemeToggle } from '../../theme/ThemeToggle'
import { IconButton } from '../../ui'
import { useSwatch } from '../colors'
import type { ConnectionStatus } from '../doc'
import { usePeople } from '../presence'
import { useSeat } from '../seat'
import { useSession } from '../session'
import { namesPeople, personName } from './people'
import { jamLink, shareLink, type ShareResult } from './share'
import './header.css'

const STATUS: Record<ConnectionStatus, { label: string; title?: string }> = {
  connected: { label: 'Live' },
  connecting: { label: 'Connecting…' },
  offline: { label: 'Offline', title: 'Offline: your edits will sync when you are back' },
}

const TIPS: Partial<Record<ShareResult, string>> = {
  copied: 'Link copied',
  failed: "Couldn't copy the link",
}

/** The console's header: logo, the jam's name and share button, who's here, connection, theme. */
export function Header({ slug, status }: { slug: string; status: ConnectionStatus }) {
  return (
    <header className="console-header">
      <a className="console-logo" href="/">
        jambo
      </a>
      <span className="console-slug">{slug}</span>
      <ShareButton slug={slug} />
      <div className="console-header-end">
        <People />
        <span
          className={`console-status console-status-${status}`}
          role="status"
          title={STATUS[status].title}
        >
          {STATUS[status].label}
        </span>
        <ThemeToggle />
      </div>
    </header>
  )
}

/** Shares the jam's link, and says so when it was copied or couldn't be. */
function ShareButton({ slug }: { slug: string }) {
  const [tip, setTip] = useState<string>()
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])

  const share = async () => {
    const result = await shareLink(jamLink(window.location.origin, slug), `jambo · ${slug}`, {
      share: navigator.share?.bind(navigator),
      copy: navigator.clipboard?.writeText.bind(navigator.clipboard),
    })
    const text = TIPS[result]
    if (!text) return
    setTip(text)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setTip(undefined), 1800)
  }

  return (
    <IconButton className="console-share" label="Share this jam" onClick={() => void share()}>
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" />
        <path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 17.5 10H16" />
      </svg>
      {tip && (
        <span className="console-share-tip" role="status">
          {tip}
        </span>
      )}
    </IconButton>
  )
}

/** Everyone in the jam as a dot in their colour, you first; named while there are few. */
function People() {
  const { jam, me } = useSession()
  useSeat(me) // your own entry reads `me`, so re-render when the room seats you
  const people = usePeople(jam.awareness, me)
  const swatch = useSwatch()
  const named = namesPeople(people.length)
  return (
    <ul className={`console-people ${named ? '' : 'is-crowded'}`} aria-label="Who's here">
      {people.map((p) => {
        const name = personName(p, me.id)
        return (
          <li key={p.id} title={name}>
            <span className="console-person" style={{ background: swatch(p.color) }} aria-hidden />
            <span className="console-person-name">{name}</span>
          </li>
        )
      })}
    </ul>
  )
}
