import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { BPM } from '../../../shared/board'
import type { RecorderState } from '../../audio/engine'
import { PRESETS } from '../../audio/voice/presets'
import { Button, IconButton, ScrubField, Select, Switch } from '../../ui'
import { useSwatch } from '../colors'
import { useSession } from '../session'
import { CLIPS_FULL, useSing } from '../useSing'
import { useTransport } from '../useTransport'
import { SoundEditor } from './Pads'
import { TakeLane } from './TakeLane'
import './deck.css'

/** The deck: the pads beside the tempo readout, the transport, and Change sounds. */
export function Deck({ slug }: { slug: string }) {
  const [editing, setEditing] = useState(false)
  const transport = useTransport(slug)
  return (
    <div className="console-deck">
      <SoundEditor slug={slug} editing={editing} />
      <div className="console-side">
        <Readout
          bpm={transport.bpm}
          phase={transport.state.phase}
          synced={transport.synced}
          saving={transport.saving}
        />
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

const PRESET_GROUPS = [{ options: PRESETS.map((p) => ({ value: p.id, label: p.name })) }]

/**
 * Sing, next to Record: held (M on a keyboard, press-and-hold on touch) while a take records, it
 * sings a voice clip into the take through the preset picked beside it.
 */
function Sing({ phase }: { phase: RecorderState['phase'] }) {
  const sing = useSing(phase)
  const held = useRef(false)
  const press = () => {
    held.current = true
    sing.start()
  }
  const release = () => {
    if (!held.current) return
    held.current = false
    sing.end()
  }
  return (
    <div className="console-sing">
      <div className="console-sing-row">
        <Button
          className="console-sing-button"
          aria-pressed={sing.singing}
          aria-keyshortcuts="M"
          aria-describedby={sing.full ? 'console-sing-full' : undefined}
          disabled={!sing.enabled}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            press()
          }}
          onPointerUp={release}
          onPointerCancel={release}
          onLostPointerCapture={release}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.repeat) press()
          }}
          onKeyUp={(e) => {
            if (e.key === 'Enter') release()
          }}
          // A long press on touch would otherwise open the page's menu.
          onContextMenu={(e) => e.preventDefault()}
        >
          {sing.singing ? 'Singing…' : 'Sing (hold M)'}
        </Button>
        <Select
          label="Voice preset"
          value={sing.preset}
          groups={PRESET_GROUPS}
          onChange={sing.pickPreset}
        />
      </div>
      {sing.full && (
        <p id="console-sing-full" className="console-hint">
          {CLIPS_FULL}
        </p>
      )}
      {sing.error && !sing.full && (
        <p className="console-message" role="alert">
          {sing.error}
        </p>
      )}
    </div>
  )
}

const PHASE: Record<RecorderState['phase'], string> = {
  idle: 'Ready',
  waiting: 'Waiting for the bar',
  'count-in': 'Count-in',
  recording: 'Recording',
}

/** The tempo, large, and what the recorder is doing; during a take, the take as it is recorded. */
function Readout({
  bpm,
  phase,
  synced,
  saving,
}: {
  bpm: number
  phase: RecorderState['phase']
  synced: boolean
  saving: boolean
}) {
  const { me } = useSession()
  const swatch = useSwatch()
  if (phase !== 'idle')
    return (
      <div
        className="console-readout is-take"
        style={{ '--c': swatch(me.color) } as CSSProperties}
        aria-hidden
      >
        <TakeLane />
      </div>
    )
  return (
    <div className="console-readout" aria-hidden>
      <span className="console-bpm">{bpm}</span>
      <span className="console-bpm-unit">BPM</span>
      <span className={`console-phase console-phase-${phase}`}>
        {saving ? 'Saving the take' : phase === 'idle' && !synced ? 'Syncing' : PHASE[phase]}
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

/** Why the tempo can't change: the tip a tap on the locked tempo shows. */
const TEMPO_LOCKED = "Tempo is locked while the jam has loops, since they're all timed to it"

/** How long the tip stays up after a tap. */
const TIP_MS = 3000

/** A tip shown for a while after `show`, again from the start on each call. */
function useTip() {
  const [shown, setShown] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const show = () => {
    setShown(true)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setShown(false), TIP_MS)
  }
  return { shown, show }
}

/** Record / stop (Space too), Sing, the tempo stepper, and the metronome switch. */
function Transport({
  bpm,
  state,
  synced,
  locked,
  saving,
  metronome,
  message,
  toggle,
  setTempo,
  setMetronome,
}: ReturnType<typeof useTransport>) {
  const syncing = state.phase === 'idle' && !synced
  const tip = useTip()

  return (
    <div className="console-transport">
      <Button
        tone="danger"
        size="lg"
        className="console-record"
        data-phase={state.phase}
        aria-busy={syncing || saving}
        aria-keyshortcuts="Space"
        disabled={saving}
        onClick={() => void toggle()}
      >
        <span className="console-record-dot" aria-hidden />
        {saving ? 'Saving the take…' : syncing ? 'Syncing…' : RECORD_LABEL[state.phase]}
      </Button>
      <Sing phase={state.phase} />
      <div className="console-tempo-row">
        {/* Locked, a tap anywhere on the tempo (its disabled parts let taps through) or on the
            lock says why, on phones too. */}
        <div
          className={`console-tempo ${locked ? 'is-locked' : ''}`}
          onClick={locked ? tip.show : undefined}
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
              <>
                {locked && (
                  <button
                    type="button"
                    className="console-tempo-lock"
                    aria-label="Why is the tempo locked?"
                  >
                    🔒
                  </button>
                )}
                <IconButton
                  label="Slower"
                  disabled={locked || bpm <= BPM.min}
                  onClick={() => setTempo(bpm - 1)}
                >
                  −
                </IconButton>
              </>
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
          {locked && tip.shown && (
            <span className="console-tempo-tip" role="status">
              {TEMPO_LOCKED}
            </span>
          )}
        </div>
        <Switch checked={metronome} onChange={setMetronome}>
          Metronome
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
