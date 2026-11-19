import { useAtomValue } from 'jotai'
import { type CSSProperties, type RefObject, useEffect, useRef, useState } from 'react'
import { BEATS_PER_BAR, type Track } from '../../../shared/board'
import { Button, IconButton, Range, Select } from '../../ui'
import { useSwatch } from '../colors'
import { tracksAtom } from '../model'
import { useSession } from '../session'
import { AiMark } from './AiMark'
import { beatPosition, loopSummary, SNAP_OPTIONS } from './loops'
import { byAgent } from './people'
import './mixer.css'

const SNAP_GROUPS = [{ options: SNAP_OPTIONS }]
/** The level fader's tick marks, every 0.25; it sticks at unity (1.0). */
const LEVEL_MARKS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]
const percent = (v: number) => `${Math.round(v * 100)}%`

/** The mixer tray: every loop in the jam as a row anyone can play with. */
export function Mixer() {
  const tracks = useAtomValue(tracksAtom)
  return (
    <section className="console-mixer" aria-label="Loops">
      {tracks.size === 0 ? (
        <p className="console-mixer-empty">
          The mixer fills up as you record. Space to record, Space to stop.
        </p>
      ) : (
        <ol className="console-channels">
          {[...tracks].map(([id, track]) => (
            <Channel key={id} id={id} track={track} />
          ))}
        </ol>
      )}
    </section>
  )
}

/** One loop: progress ring · name and length · pattern · level · snap · mute · remove. */
function Channel({ id, track }: { id: string; track: Track }) {
  const { board } = useSession()
  const [draft, setDraft] = useState<string>()
  const [error, setError] = useState<string>()
  const row = useRef<HTMLLIElement>(null)
  usePlayhead(id, row)
  const swatch = useSwatch()

  const set = (patch: Parameters<ReturnType<typeof board.track>['set']>[0]) => {
    const r = board.track(id).set(patch)
    setError(r.ok ? undefined : r.issues[0]?.message)
  }

  const beats = track.bars * BEATS_PER_BAR
  return (
    <li
      ref={row}
      className={`console-channel ${track.mute ? 'is-muted' : ''}`}
      style={{ '--c': swatch(track.color) } as CSSProperties}
    >
      <div className="console-ring" aria-hidden />
      <div className="console-channel-title">
        <div className="console-channel-head">
          <input
            className="console-channel-name"
            aria-label="Loop name"
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            value={draft ?? track.name}
            onChange={(e) => {
              // Keep the typed text until blur: the stored name reads back trimmed.
              setDraft(e.target.value)
              set({ name: e.target.value })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            onBlur={() => {
              setDraft(undefined)
              setError(undefined)
            }}
          />
          {byAgent(track) && <AiMark title="Added by an AI agent" />}
        </div>
        <span className="console-channel-size">{loopSummary(track.bars, track.hits.length)}</span>
      </div>
      <div className="console-pattern" aria-hidden>
        {Array.from({ length: beats }, (_, b) => (
          <span
            key={b}
            className={`console-beat ${b % BEATS_PER_BAR === 0 ? 'is-bar' : ''}`}
            style={{ left: beatPosition(b, track.bars) }}
          />
        ))}
        {track.hits.map((h, i) => (
          <span
            key={i}
            className="console-hit"
            style={{ left: beatPosition(h.beat, track.bars) }}
          />
        ))}
        <span className="console-head" />
      </div>
      <Range
        className="console-fader"
        label={`Level of ${track.name}`}
        color={swatch(track.color)}
        min={0}
        max={1.5}
        keyStep={0.05}
        marks={LEVEL_MARKS}
        detent={1}
        format={percent}
        value={track.gain}
        onChange={(gain) => set({ gain })}
      />
      <div className="console-snap">
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
        className="console-mute"
        aria-pressed={track.mute}
        onClick={() => set({ mute: !track.mute })}
      >
        {track.mute ? 'Muted' : 'Mute'}
      </Button>
      <IconButton
        tone="quiet"
        className="console-remove"
        label={`Remove ${track.name}`}
        onClick={() => board.track(id).remove()}
      >
        ✕
      </IconButton>
      {error && (
        <p id={`${id}-error`} className="console-channel-error" role="alert">
          {error}
        </p>
      )}
    </li>
  )
}

/**
 * Sets `--p` (0–1, how far the loop has played) and `data-playing` on `ref` every frame, so the
 * ring and playhead follow the engine's clock without re-rendering the row.
 */
function usePlayhead(trackId: string, ref: RefObject<HTMLElement | null>) {
  const { engine } = useSession()
  useEffect(() => {
    let frame = 0
    const step = () => {
      const pos = engine.position(trackId)
      const el = ref.current
      if (el) {
        el.style.setProperty('--p', String(pos ?? 0))
        el.dataset.playing = pos === undefined ? 'false' : 'true'
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [engine, trackId, ref])
}
