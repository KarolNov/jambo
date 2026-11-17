import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { BEATS_PER_BAR, QUANTIZE, type Track } from '../../shared/board'
import { tracksAtom } from './model'
import { useSession } from './session'

/** Every loop in the jam, with controls anyone can use. */
export function Tracks() {
  const tracks = useAtomValue(tracksAtom)
  if (tracks.size === 0) {
    return <p className="empty">No loops yet. Hit record (or Space), play some pads, then stop.</p>
  }
  return (
    <ol className="tracks">
      {[...tracks].map(([id, track]) => (
        <TrackRow key={id} id={id} track={track} />
      ))}
    </ol>
  )
}

const QUANTIZE_LABEL: Record<number, string> = {
  0: 'Off',
  0.125: '1/32',
  0.25: '1/16',
  0.5: '1/8',
  1: '1/4',
}

function TrackRow({ id, track }: { id: string; track: Track }) {
  const { board, engine } = useSession()
  const [draft, setDraft] = useState<string>()
  const [error, setError] = useState<string>()
  const head = useRef<HTMLDivElement>(null)

  // The playhead follows the engine's clock without re-rendering the row.
  useEffect(() => {
    let frame = 0
    const step = () => {
      const pos = engine.position(id)
      if (head.current) {
        head.current.style.opacity = pos === undefined ? '0' : '1'
        head.current.style.left = `${(pos ?? 0) * 100}%`
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [engine, id])

  const set = (patch: Parameters<ReturnType<typeof board.track>['set']>[0]) => {
    const r = board.track(id).set(patch)
    setError(r.ok ? undefined : r.issues[0]?.message)
    return r.ok
  }

  const length = track.bars * BEATS_PER_BAR

  return (
    <li className={`track ${track.mute ? 'muted' : ''}`} style={{ borderLeftColor: track.color }}>
      <div className="track-top">
        <input
          className="track-name"
          aria-label="Loop name"
          aria-invalid={!!error}
          value={draft ?? track.name}
          onChange={(e) => {
            setDraft(e.target.value)
            if (set({ name: e.target.value })) setDraft(undefined)
          }}
          onBlur={() => {
            setDraft(undefined)
            setError(undefined)
          }}
        />
        <span className="bars">
          {track.bars} bar{track.bars > 1 ? 's' : ''}
        </span>
        <button type="button" aria-pressed={track.mute} onClick={() => set({ mute: !track.mute })}>
          {track.mute ? 'Unmute' : 'Mute'}
        </button>
        <button type="button" aria-label="Remove loop" onClick={() => board.track(id).remove()}>
          ✕
        </button>
      </div>
      <div className="strip" aria-hidden>
        {Array.from({ length: track.bars }, (_, b) => (
          <span key={b} className="bar-line" style={{ left: `${(b / track.bars) * 100}%` }} />
        ))}
        {track.hits.map((h, i) => (
          <span
            key={i}
            className="hit"
            style={{ left: `${(h.beat / length) * 100}%`, background: track.color }}
          />
        ))}
        <div ref={head} className="playhead" />
      </div>
      <div className="track-bottom">
        <label>
          Level
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={track.gain}
            onChange={(e) => set({ gain: Number(e.target.value) })}
          />
        </label>
        <label>
          Snap
          <select
            value={track.quantize}
            onChange={(e) => set({ quantize: Number(e.target.value) })}
          >
            {QUANTIZE.map((q) => (
              <option key={q} value={q}>
                {QUANTIZE_LABEL[q]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <span className="error">{error}</span>}
    </li>
  )
}
