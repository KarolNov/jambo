import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BPM, newId } from '../../shared/board'
import { colorLabel } from '../../shared/colors'
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
  const metronome = useSyncExternalStore(
    (l) => engine.subscribe(l),
    () => engine.metronome,
  )
  const synced = useSyncExternalStore(
    (l) => engine.subscribe(l),
    () => engine.synced,
  )
  // The tempo being typed; it is applied on Enter or when the field loses focus.
  const [draft, setDraft] = useState<string>()
  // Set on Escape, so the blur that follows doesn't apply the draft.
  const cancelled = useRef(false)
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
    setDraft(undefined)
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

  const label =
    state.phase === 'idle' && !synced
      ? 'Syncing…'
      : {
          idle: '● Record',
          waiting: 'Waiting for the bar… (stop)',
          'count-in': 'Count-in… (stop)',
          recording: '■ Stop',
        }[state.phase]

  return (
    <div className="transport">
      <button
        type="button"
        className={`record record-${state.phase === 'waiting' ? 'count-in' : state.phase}`}
        aria-busy={state.phase === 'idle' && !synced}
        onClick={() => void toggle()}
        aria-keyshortcuts="Space"
      >
        {label}
      </button>
      <div className="tempo" title={locked ? 'Tempo is locked while the jam has loops' : undefined}>
        <button
          type="button"
          aria-label="Slower"
          disabled={locked || bpm <= BPM.min}
          onClick={() => setTempo(bpm - 1)}
        >
          −
        </button>
        <input
          aria-label="Tempo in BPM"
          inputMode="numeric"
          value={draft ?? String(bpm)}
          disabled={locked}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              cancelled.current = true
              setDraft(undefined)
              e.currentTarget.blur()
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              setTempo(bpm + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1))
            }
          }}
          onBlur={() => {
            if (cancelled.current || !draft) {
              cancelled.current = false
              setDraft(undefined)
            } else setTempo(Number(draft))
          }}
        />
        <button
          type="button"
          aria-label="Faster"
          disabled={locked || bpm >= BPM.max}
          onClick={() => setTempo(bpm + 1)}
        >
          +
        </button>
        <span>BPM {locked && <span aria-label="locked">🔒</span>}</span>
      </div>
      <label className="metronome">
        <input
          type="checkbox"
          checked={metronome}
          onChange={(e) => engine.setMetronome(e.target.checked)}
        />
        Click
      </label>
      {message && <span className="message">{message}</span>}
    </div>
  )
}
