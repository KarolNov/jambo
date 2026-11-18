/**
 * PROTOTYPE (neumorphism, throwaway): the jam as a soft "console". The whole page is one soft
 * surface: pads and a readout on the deck, loops as rows in an inset mixer tray.
 *
 * Open a jam with `?variant` (any value) on the dev server; `?theme=light|dark` picks the theme.
 * Same live board, audio and SDK writes as the real page.
 */
import { useAtomValue } from 'jotai'
import { useRef, useState } from 'react'
import { QUANTIZE, type Track } from '../../../shared/board'
import type { ConnectionStatus } from '../doc'
import { bpmAtom, tracksAtom } from '../model'
import { useSession } from '../session'
import { Transport } from '../Transport'
import { useRecorderState } from '../useEngineState'
import { Select } from './Menu'
import { Header, SoundEditor, Unlock, usePlayhead, useShade } from './shared'
import { useTheme } from './Switcher'
import './neumo.css'

export default function Neumo({ slug, status }: { slug: string; status: ConnectionStatus }) {
  const theme = useTheme()
  const tracks = useAtomValue(tracksAtom)
  const bpm = useAtomValue(bpmAtom)
  const state = useRecorderState()
  const [editing, setEditing] = useState(false)
  return (
    <div className="neumo neumo-b" data-theme={theme}>
      <main className="b-page">
        <Header slug={slug} status={status} />
        <Unlock />
        <div className="b-deck">
          <SoundEditor slug={slug} editing={editing} />
          <div className="b-side">
            <div className="b-readout" aria-hidden>
              <span className="b-bpm">{bpm}</span>
              <span className="n-muted">BPM</span>
              <span className={`b-phase b-phase-${state.phase}`}>{state.phase}</span>
            </div>
            <Transport />
            <button
              type="button"
              className="b-edit"
              aria-pressed={editing}
              onClick={() => setEditing((e) => !e)}
            >
              {editing ? 'Done' : 'Change sounds'}
            </button>
            {editing && <p className="b-edit-hint n-muted">Click a pad to change its sound.</p>}
          </div>
        </div>
        <section className="b-mixer" aria-label="Loops">
          {tracks.size === 0 ? (
            <p className="b-empty n-muted">
              The mixer fills up as you record. Space to record, Space to stop.
            </p>
          ) : (
            [...tracks].map(([id, t]) => <Channel key={id} id={id} track={t} />)
          )}
        </section>
      </main>
    </div>
  )
}

const SNAP_LABEL: Record<number, string> = {
  0: 'Off',
  0.125: '1/32',
  0.25: '1/16',
  0.5: '1/8',
  1: '1/4',
}
const SNAP_GROUPS = [
  { options: QUANTIZE.map((q) => ({ value: String(q), label: SNAP_LABEL[q]! })) },
]

/** One loop: progress ring · name · pattern · level · snap · mute · remove. */
function Channel({ id, track }: { id: string; track: Track }) {
  const { board } = useSession()
  const set = (patch: Parameters<ReturnType<typeof board.track>['set']>[0]) =>
    board.track(id).set(patch)
  const row = useRef<HTMLDivElement>(null)
  usePlayhead(id, row)
  const shade = useShade()
  const beats = track.bars * 4
  return (
    <div
      ref={row}
      className={`b-channel ${track.mute ? 'is-muted' : ''}`}
      style={{ '--c': shade(track.color) } as React.CSSProperties}
    >
      <div className="b-ring" aria-hidden />
      <div className="b-title">
        <span className="b-name">{track.name}</span>
        <span className="b-bars">
          {track.bars} bar{track.bars > 1 ? 's' : ''} · {track.hits.length} hits
        </span>
      </div>
      <div className="b-pattern" aria-hidden>
        {Array.from({ length: beats }, (_, b) => (
          <span key={b} className="b-beat" style={{ left: `${(b / beats) * 100}%` }} />
        ))}
        {track.hits.map((h, i) => (
          <span key={i} className="b-hit" style={{ left: `${(h.beat / beats) * 100}%` }} />
        ))}
        <span className="b-head" />
      </div>
      <input
        type="range"
        className="b-fader"
        aria-label={`Level of ${track.name}`}
        min={0}
        max={1.5}
        step={0.05}
        value={track.gain}
        onChange={(e) => set({ gain: Number(e.target.value) })}
      />
      <div className="b-snap">
        <span aria-hidden>Snap</span>
        <Select
          label={`Snap of ${track.name}`}
          value={String(track.quantize)}
          groups={SNAP_GROUPS}
          onChange={(v) => set({ quantize: Number(v) })}
        />
      </div>
      <button
        type="button"
        className="b-mute"
        aria-pressed={track.mute}
        onClick={() => set({ mute: !track.mute })}
      >
        {track.mute ? 'Muted' : 'Mute'}
      </button>
      <button
        type="button"
        className="b-remove"
        aria-label="Remove loop"
        onClick={() => board.track(id).remove()}
      >
        ✕
      </button>
    </div>
  )
}
