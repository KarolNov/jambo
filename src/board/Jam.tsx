import { Provider, useAtomValue } from 'jotai'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Engine } from '../audio/engine'
import { type ConnectionStatus, onStatus, openJam } from './doc'
import { identity } from './identity'
import { bpmAtom, padsAtom, tracksAtom } from './model'
import { Pads } from './Pads'
import { makeBoard, type Session, SessionContext, useSession } from './session'
import { Tracks } from './Tracks'
import { Transport } from './Transport'

/** One jam: its doc, connection and audio engine, for as long as the page shows it. */
export function Jam({ slug }: { slug: string }) {
  const [session, setSession] = useState<Session>()
  const [status, setStatus] = useState<ConnectionStatus>('connecting')

  useEffect(() => {
    const jam = openJam(slug)
    const engine = new Engine()
    const me = identity()
    setSession({ jam, engine, me, board: makeBoard(jam, me) })
    const stop = onStatus(jam.provider, setStatus)
    return () => {
      stop()
      engine.dispose()
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
  useEffect(() => {
    engine.update({ bpm, pads: new Map([...pads].map(([id, p]) => [id, p.soundId])), tracks })
  }, [engine, bpm, pads, tracks])
  return null
}

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
        <span className="me" style={{ color: me.color }}>
          ● {me.colorName}
        </span>
        <span className={`status status-${status}`} role="status">
          {STATUS_LABEL[status]}
        </span>
      </header>

      {!ready && (
        <button type="button" className="unlock" onClick={() => void engine.unlock()}>
          Tap to start audio
        </button>
      )}

      <div className="looper">
        <section className="left">
          <Transport />
          <Pads />
        </section>
        <section className="right">
          <Tracks />
        </section>
      </div>
    </main>
  )
}
