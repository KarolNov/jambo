import { Provider, useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import { JamClock } from '../audio/clock'
import { Engine } from '../audio/engine'
import { FakeTransport } from '../audio/live/fake'
import { Live } from '../audio/live/live'
import { LiveSlot } from '../audio/live/slot'
import { SampleLoader } from '../audio/samples'
import { Console } from './console/Console'
import { type ConnectionStatus, onStatus, openJam } from './doc'
import { identity } from './identity'
import { bpmAtom, masterAtom, padsAtom, soundsAtom, tracksAtom } from './model'
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
    // Only the fake transport so far: the room relays it in local dev and e2e, nowhere else.
    const slot = new LiveSlot(jam.provider)
    const live = new Live(engine, new FakeTransport(jam.provider), slot)
    const me = new Me(identity())
    setSession({ jam, engine, me, board: makeBoard(jam, me), live })
    const stop = onStatus(jam.provider, setStatus)
    const unseat = takeSeat(jam.provider, me)
    const leave = joinPresence(jam.awareness, me)
    return () => {
      leave()
      unseat()
      stop()
      live.dispose()
      slot.dispose()
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

/** Keeps the audio engine in step with the board doc. Exported for tests. */
export function EngineFeed({ engine }: { engine: Engine }) {
  const bpm = useAtomValue(bpmAtom)
  const pads = useAtomValue(padsAtom)
  const tracks = useAtomValue(tracksAtom)
  const sounds = useAtomValue(soundsAtom)
  const master = useAtomValue(masterAtom)
  const { tone, drive, width, swing } = master
  // By value: the atom gives a new object on every read.
  const { x: filterX, y: filterY } = master.filter
  const { x: throwX, y: throwY } = master.throw
  const { x: lofiX, y: lofiY } = master.lofi
  const { x: repeatX, y: repeatY, startBeat } = master.repeat
  useEffect(() => {
    engine.update({
      bpm,
      pads: new Map([...pads].map(([id, p]) => [id, p.soundId])),
      tracks,
      uploads: new Set(sounds.keys()),
      master: {
        tone,
        drive,
        width,
        filter: { x: filterX, y: filterY },
        throw: { x: throwX, y: throwY },
        lofi: { x: lofiX, y: lofiY },
        swing,
        repeat: { x: repeatX, y: repeatY, startBeat },
      },
    })
  }, [
    engine,
    bpm,
    pads,
    tracks,
    sounds,
    tone,
    drive,
    width,
    filterX,
    filterY,
    throwX,
    throwY,
    lofiX,
    lofiY,
    swing,
    repeatX,
    repeatY,
    startBeat,
  ])
  return null
}
