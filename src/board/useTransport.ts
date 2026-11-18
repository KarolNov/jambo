import { useAtomValue } from 'jotai'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { BPM, newId } from '../../shared/board'
import { colorLabel } from '../../shared/colors'
import { bpmAtom, tracksAtom } from './model'
import { isTyping } from './typing'
import { useSession } from './session'
import { useRecorderState } from './useEngineState'

/**
 * The transport's state and actions, shared by every transport UI: record / stop (Space too),
 * tempo and the metronome. Stopping a take adds it to the board as a new track.
 */
export function useTransport() {
  const { engine, board, me } = useSession()
  const bpm = useAtomValue(bpmAtom)
  const tracks = useAtomValue(tracksAtom)
  const state = useRecorderState()
  const [message, setMessage] = useState<string>()
  const metronome = useSyncExternalStore(
    (l) => engine.subscribe(l),
    () => engine.metronome,
  )
  const synced = useSyncExternalStore(
    (l) => engine.subscribe(l),
    () => engine.synced,
  )
  /** Tempo can't change while the jam has loops, or during a take. */
  const locked = tracks.size > 0 || state.phase !== 'idle'

  const toggle = async () => {
    if (!engine.ready) await engine.unlock()
    if (engine.state.phase === 'idle') {
      setMessage(undefined)
      // Takes go on the jam's grid; record() waits until this client's clock agrees with the jam.
      engine.record()
      return
    }
    const take = engine.stop()
    if (!take) {
      setMessage('Nothing recorded')
      return
    }
    const id = newId()
    const mine = [...tracks.values()].filter((t) => t.author === me.id).length
    engine.claim(id)
    const r = board.addTrack(id, {
      name: `${colorLabel(me.color)} ${mine + 1}`,
      author: me.id,
      color: me.color,
      bars: take.bars,
      hits: take.hits,
      startBar: take.startBar,
      gain: 1,
      mute: false,
      quantize: 0.25,
      effects: [],
    })
    setMessage(r.ok ? undefined : r.issues[0]?.message)
  }

  // Space toggles recording, except while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTyping(e.target)) return
      e.preventDefault()
      void toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /** Sets the tempo, clamped to the allowed range; says so when it clamps or is refused. */
  const setTempo = (value: number) => {
    if (!Number.isFinite(value) || value === bpm) return
    const clamped = Math.round(Math.min(BPM.max, Math.max(BPM.min, value)))
    const r = board.tempo(clamped)
    setMessage(
      r.ok
        ? clamped !== value
          ? `Tempo is ${BPM.min}–${BPM.max} BPM`
          : undefined
        : r.issues[0]?.message,
    )
  }

  return {
    bpm,
    state,
    synced,
    locked,
    metronome,
    message,
    toggle,
    setTempo,
    setMetronome: (on: boolean) => engine.setMetronome(on),
  }
}
