import { useRef, useState } from 'react'
import { BPM } from '../../shared/board'
import { useTransport } from './useTransport'

/** Tempo, record / stop, metronome. Space toggles recording. */
export function Transport() {
  const {
    bpm,
    state,
    synced,
    locked,
    metronome,
    message,
    toggle,
    setTempo: applyTempo,
    setMetronome,
  } = useTransport()
  // The tempo being typed; it is applied on Enter or when the field loses focus.
  const [draft, setDraft] = useState<string>()
  // Set on Escape, so the blur that follows doesn't apply the draft.
  const cancelled = useRef(false)

  const setTempo = (value: number) => {
    setDraft(undefined)
    applyTempo(value)
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
          onChange={(e) => setMetronome(e.target.checked)}
        />
        Click
      </label>
      {message && <span className="message">{message}</span>}
    </div>
  )
}
