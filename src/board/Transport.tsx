import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import { BPM, newId } from '../../shared/board'
import { bpmAtom, tracksAtom } from './model'
import { isTyping } from './Pads'
import { useSession } from './session'
import { useRecorderState } from './useEngineState'

/** Tempo, record / stop, metronome. Space toggles recording. */
export function Transport() {
  const { engine, board, me } = useSession()
  const bpm = useAtomValue(bpmAtom)
  const tracks = useAtomValue(tracksAtom)
  const state = useRecorderState()
  const [message, setMessage] = useState<string>()
  const [metronome, setMetronome] = useState(engine.metronome)
  const locked = tracks.size > 0

  const toggle = async () => {
    if (!engine.ready) await engine.unlock()
    if (engine.state.phase === 'idle') {
      setMessage(undefined)
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
    engine.claim(id, take.startAt)
    const r = board.addTrack(id, {
      name: `${me.colorName} ${mine + 1}`,
      author: me.id,
      color: me.color,
      bars: take.bars,
      hits: take.hits,
      gain: 1,
      mute: false,
      quantize: 0.25,
      effects: [],
    })
    setMessage(r.ok ? undefined : r.issues[0]?.message)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTyping(e.target)) return
      e.preventDefault()
      void toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const setTempo = (value: number) => {
    const r = board.tempo(value)
    setMessage(r.ok ? undefined : r.issues[0]?.message)
  }

  const label = { idle: '● Record', 'count-in': 'Count-in… (stop)', recording: '■ Stop' }[
    state.phase
  ]

  return (
    <div className="transport">
      <button
        type="button"
        className={`record record-${state.phase}`}
        onClick={() => void toggle()}
        aria-keyshortcuts="Space"
      >
        {label}
      </button>
      <label
        className="tempo"
        title={locked ? 'Tempo is locked while the jam has tracks' : undefined}
      >
        <input
          type="number"
          min={BPM.min}
          max={BPM.max}
          value={bpm}
          disabled={locked}
          onChange={(e) => setTempo(Number(e.target.value))}
        />
        BPM {locked && <span aria-label="locked">🔒</span>}
      </label>
      <label className="metronome">
        <input
          type="checkbox"
          checked={metronome}
          onChange={(e) => {
            engine.metronome = e.target.checked
            setMetronome(e.target.checked)
          }}
        />
        Click
      </label>
      {message && <span className="message">{message}</span>}
    </div>
  )
}
