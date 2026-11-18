import { Provider, useAtomValue } from 'jotai'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { JamClock } from '../audio/clock'
import { Engine } from '../audio/engine'
import { SampleLoader } from '../audio/samples'
import { Debug } from './Debug'
import { type ConnectionStatus, onStatus, openJam } from './doc'
import { identity } from './identity'
import { bpmAtom, padsAtom, soundsAtom, tracksAtom } from './model'
import { Pads } from './Pads'
import { joinPresence, usePeople } from './presence'
import { makeBoard, type Session, SessionContext, useSession } from './session'
import { Tracks } from './Tracks'
import { Transport } from './Transport'

/** One jam: its doc, connection and audio engine, for as long as the page shows it. */
export function Jam({ slug }: { slug: string }) {
  const [session, setSession] = useState<Session>()
  const [status, setStatus] = useState<ConnectionStatus>('connecting')

  useEffect(() => {
    const jam = openJam(slug)
    const clock = new JamClock(jam.provider)
    const engine = new Engine(clock, new SampleLoader(slug))
    const me = identity()
    setSession({ jam, engine, me, board: makeBoard(jam, me) })
    const stop = onStatus(jam.provider, setStatus)
    const leave = joinPresence(jam.awareness, me)
    return () => {
      leave()
      stop()
      engine.dispose()
      clock.dispose()
      jam.destroy()
    }
  }, [slug])

  if (!session) return null
  return (
    <SessionContext.Provider value={session}>
      <Provider store={session.jam.store}>
        <EngineFeed engine={session.engine} />
        <Looper slug={slug} status={status} />
      </Provider>
    </SessionContext.Provider>
  )
}

/** Keeps the audio engine in step with the board doc. */
function EngineFeed({ engine }: { engine: Engine }) {
  const bpm = useAtomValue(bpmAtom)
  const pads = useAtomValue(padsAtom)
  const tracks = useAtomValue(tracksAtom)
  const sounds = useAtomValue(soundsAtom)
  useEffect(() => {
    engine.update({
      bpm,
      pads: new Map([...pads].map(([id, p]) => [id, p.soundId])),
      tracks,
      uploads: new Set(sounds.keys()),
    })
  }, [engine, bpm, pads, tracks, sounds])
  return null
}

/** Who's here: one entry per person, you first. */
function Presence() {
  const { jam, me } = useSession()
  const people = usePeople(jam.awareness, me)
  return (
    <ul className="presence" aria-label="Who's here">
      {people.map((p) => (
        <li key={p.id} className={p.id === me.id ? 'me' : undefined} style={{ color: p.color }}>
          ● {p.colorName}
          {p.id === me.id && <span className="you"> (you)</span>}
        </li>
      ))}
    </ul>
  )
}

const DEBUG = new URLSearchParams(window.location.search).has('debug')

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Live',
  connecting: 'Connecting…',
  offline: 'Offline, edits will sync when back',
}

function Looper({ slug, status }: { slug: string; status: ConnectionStatus }) {
  const { engine, me } = useSession()
  const ready = useSyncExternalStore(
    (l) => engine.subscribe(l),
    () => engine.ready,
  )
  const [copied, setCopied] = useState(false)

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <main className="board">
      <header className="board-header">
        <a className="logo" href="/">
          jambo
        </a>
        <span className="slug">{slug}</span>
        <button type="button" onClick={copyLink}>
          {copied ? 'Link copied' : 'Copy link'}
        </button>
        <Presence />
        <span className={`status status-${status}`} role="status">
          {STATUS_LABEL[status]}
        </span>
      </header>

      {DEBUG && <Debug />}

      {!ready && (
        <button type="button" className="unlock" onClick={() => void engine.unlock()}>
          Tap to start audio
        </button>
      )}

      <div className="looper">
        <section className="left">
          <Transport />
          <Pads slug={slug} />
        </section>
        <section className="right">
          <Tracks />
        </section>
      </div>
    </main>
  )
}
