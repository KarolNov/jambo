import { useRef, useState } from 'react'
import { BPM } from '../../../shared/board'
import type { RecorderState } from '../../audio/engine'
import { Button, IconButton, Switch } from '../../ui'
import { useTransport } from '../useTransport'
import { SoundEditor } from './Pads'
import './deck.css'

/** The deck: the pads beside the tempo readout, the transport, and Change sounds. */
export function Deck({ slug }: { slug: string }) {
  const [editing, setEditing] = useState(false)
  const transport = useTransport()
  return (
    <div className="console-deck">
      <SoundEditor slug={slug} editing={editing} />
      <div className="console-side">
        <Readout bpm={transport.bpm} phase={transport.state.phase} synced={transport.synced} />
        <Transport {...transport} />
        <Button
          tone={editing ? 'primary' : 'default'}
          aria-pressed={editing}
          onClick={() => setEditing((e) => !e)}
        >
          {editing ? 'Done' : 'Change sounds'}
        </Button>
        {editing && <p className="console-hint">Click a pad to change its sound.</p>}
      </div>
    </div>
  )
}

const PHASE: Record<RecorderState['phase'], string> = {
  idle: 'Ready',
  waiting: 'Waiting for the bar',
  'count-in': 'Count-in',
  recording: 'Recording',
}

/** The tempo, large, and what the recorder is doing. */
function Readout({
  bpm,
  phase,
  synced,
}: {
  bpm: number
  phase: RecorderState['phase']
  synced: boolean
}) {
  return (
    <div className="console-readout" aria-hidden>
      <span className="console-bpm">{bpm}</span>
      <span className="console-bpm-unit">BPM</span>
      <span className={`console-phase console-phase-${phase}`}>
        {phase === 'idle' && !synced ? 'Syncing' : PHASE[phase]}
      </span>
    </div>
  )
}

const RECORD_LABEL: Record<RecorderState['phase'], string> = {
  idle: 'Record',
  waiting: 'Waiting for the bar… (stop)',
  'count-in': 'Count-in… (stop)',
  recording: 'Stop',
}

/** Record / stop (Space too), the tempo stepper, and the metronome switch. */
function Transport({
  bpm,
  state,
  synced,
  locked,
  metronome,
  message,
  toggle,
  setTempo: applyTempo,
  setMetronome,
}: ReturnType<typeof useTransport>) {
  // The tempo being typed; it is applied on Enter or when the field loses focus.
  const [draft, setDraft] = useState<string>()
  // Set on Escape, so the blur that follows doesn't apply the draft.
  const cancelled = useRef(false)
  const setTempo = (value: number) => {
    setDraft(undefined)
    applyTempo(value)
  }
  const syncing = state.phase === 'idle' && !synced

  return (
    <div className="console-transport">
      <Button
        tone="danger"
        size="lg"
        className="console-record"
        data-phase={state.phase}
        aria-busy={syncing}
        aria-keyshortcuts="Space"
        onClick={() => void toggle()}
      >
        <span className="console-record-dot" aria-hidden />
        {syncing ? 'Syncing…' : RECORD_LABEL[state.phase]}
      </Button>
      <div className="console-tempo-row">
        <div
          className="console-tempo"
          title={locked ? 'Tempo is locked while the jam has loops' : undefined}
        >
          <IconButton
            label="Slower"
            disabled={locked || bpm <= BPM.min}
            onClick={() => setTempo(bpm - 1)}
          >
            −
          </IconButton>
          <input
            className="console-tempo-field"
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
          <IconButton
            label="Faster"
            disabled={locked || bpm >= BPM.max}
            onClick={() => setTempo(bpm + 1)}
          >
            +
          </IconButton>
          <span>BPM {locked && <span aria-label="locked">🔒</span>}</span>
        </div>
        <Switch checked={metronome} onChange={setMetronome}>
          Click
        </Switch>
      </div>
      {message && (
        <p className="console-message" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
