/**
 * The jam as a soft "console": header, deck (src/board/console) and, still in prototype form here,
 * the mixer tray of loop rows. Open a jam with `?variant` on the dev server.
 */
import { useAtomValue } from 'jotai'
import { useRef } from 'react'
import { QUANTIZE, type Track } from '../../../shared/board'
import { useThemedPage } from '../../theme/theme'
import { Button, IconButton, Range, Select } from '../../ui'
import { useSwatch } from '../colors'
import { Deck } from '../console/Deck'
import { Header } from '../console/Header'
import { Unlock } from '../console/Pads'
import type { ConnectionStatus } from '../doc'
import { tracksAtom } from '../model'
import { useSession } from '../session'
import { usePlayhead } from './shared'
import './neumo.css'

export default function Neumo({ slug, status }: { slug: string; status: ConnectionStatus }) {
  useThemedPage()
  const tracks = useAtomValue(tracksAtom)
  return (
    <div className="neumo neumo-b">
      <main className="b-page">
        <Header slug={slug} status={status} />
        <Unlock />
        <Deck slug={slug} />
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
  const shade = useSwatch()
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
      <Range
        className="b-fader"
        label={`Level of ${track.name}`}
        color={shade(track.color)}
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
      <Button
        size="sm"
        className="b-mute"
        aria-pressed={track.mute}
        onClick={() => set({ mute: !track.mute })}
      >
        {track.mute ? 'Muted' : 'Mute'}
      </Button>
      <IconButton tone="quiet" label="Remove loop" onClick={() => board.track(id).remove()}>
        ✕
      </IconButton>
    </div>
  )
}
