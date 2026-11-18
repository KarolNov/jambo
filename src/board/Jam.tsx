import { Provider, useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import { JamClock } from '../audio/clock'
import { Engine } from '../audio/engine'
import { SampleLoader } from '../audio/samples'
import { Console } from './console/Console'
import { type ConnectionStatus, onStatus, openJam } from './doc'
import { identity } from './identity'
import { bpmAtom, padsAtom, soundsAtom, tracksAtom } from './model'
import { joinPresence } from './presence'
import { Me, takeSeat } from './seat'
import { makeBoard, type Session, SessionContext } from './session'

/** One jam: its doc, connection and audio engine, for as long as the page shows it. */
export function Jam({ slug }: { slug: string }) {
  const [session, setSession] = useState<Session>()
  const [status, setStatus] = useState<ConnectionStatus>('connecting')

  useEffect(() => {
    const jam = openJam(slug)
    const clock = new JamClock(jam.provider)
    const engine = new Engine(clock, new SampleLoader(slug))
    const me = new Me(identity())
    setSession({ jam, engine, me, board: makeBoard(jam, me) })
    const stop = onStatus(jam.provider, setStatus)
    const unseat = takeSeat(jam.provider, me)
    const leave = joinPresence(jam.awareness, me)
    return () => {
      leave()
      unseat()
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
        <Console slug={slug} status={status} />
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
