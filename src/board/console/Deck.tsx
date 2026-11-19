import { useState } from 'react'
import { BPM } from '../../../shared/board'
import type { RecorderState } from '../../audio/engine'
import { Button, IconButton, ScrubField, Switch } from '../../ui'
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
  setTempo,
  setMetronome,
}: ReturnType<typeof useTransport>) {
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
          {/* The BPM label scrubs the tempo; it applies once, on release, for everyone. */}
          <ScrubField
            label="BPM"
            aria-label="Tempo in BPM"
            value={bpm}
            onChange={setTempo}
            min={BPM.min}
            max={BPM.max}
            maxLength={3}
            disabled={locked}
            start={
              <IconButton
                label="Slower"
                disabled={locked || bpm <= BPM.min}
                onClick={() => setTempo(bpm - 1)}
              >
                −
              </IconButton>
            }
            end={
              <IconButton
                label="Faster"
                disabled={locked || bpm >= BPM.max}
                onClick={() => setTempo(bpm + 1)}
              >
                +
              </IconButton>
            }
          />
          {locked && <span aria-label="locked">🔒</span>}
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
