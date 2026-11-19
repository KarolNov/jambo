import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { type CSSProperties, type RefObject, useEffect, useRef, useState } from 'react'
import {
  BEATS_PER_BAR,
  SOUND_KNOB_NAMES,
  SOUND_KNOBS,
  soundOf,
  type Track,
} from '../../../shared/board'
import { Button, type Holder, IconButton, Knob, Range, Select } from '../../ui'
import { useSwatch } from '../colors'
import { tracksAtom } from '../model'
import { controlKey, holdControl, type Person, useHolders } from '../presence'
import { useSession } from '../session'
import { AiMark } from './AiMark'
import { beatPosition, loopSummary, SNAP_OPTIONS, SOUND_READOUTS, soundChanged } from './loops'
import { byAgent, personName } from './people'
import './mixer.css'

const SNAP_GROUPS = [{ options: SNAP_OPTIONS }]
/** The level fader's tick marks, every 0.25; it sticks at unity (1.0). */
const LEVEL_MARKS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]
const percent = (v: number) => `${Math.round(v * 100)}%`
/** Loops whose Effects strip is open: an atom, so it survives the mixer remounting. */
const openStripsAtom = atom<ReadonlySet<string>>(new Set<string>())

/** What a live control takes to show who else is turning it, and to say when you are. */
type Shared = { heldBy?: Holder; onDragChange: (dragging: boolean) => void }

/** The mixer tray: every loop in the jam as a row anyone can play with. */
export function Mixer() {
  const tracks = useAtomValue(tracksAtom)
  const { jam, me } = useSession()
  const holders = useHolders(jam.awareness, me.id)
  // Forget the strips of loops that are gone (removed, or another jam's).
  const setOpenStrips = useSetAtom(openStripsAtom)
  useEffect(() => {
    setOpenStrips((open) =>
      [...open].every((id) => tracks.has(id))
        ? open
        : new Set([...open].filter((id) => tracks.has(id))),
    )
  }, [tracks, setOpenStrips])
  return (
    <section className="console-mixer" aria-label="Loops">
      {tracks.size === 0 ? (
        <p className="console-mixer-empty">
          The mixer fills up as you record. Space to record, Space to stop.
        </p>
      ) : (
        <ol className="console-channels">
          {[...tracks].map(([id, track]) => (
            <Channel key={id} id={id} track={track} holders={holders} />
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * One loop: progress ring · name and length · pattern · level · snap · Effects · mute · remove,
 * then its Effects strip when open. The level and sound knobs show who else is moving them.
 */
function Channel({
  id,
  track,
  holders,
}: {
  id: string
  track: Track
  holders: ReadonlyMap<string, Person>
}) {
  const { board, jam, me } = useSession()
  const [draft, setDraft] = useState<string>()
  const [error, setError] = useState<string>()
  const row = useRef<HTMLLIElement>(null)
  usePlayhead(id, row)
  const swatch = useSwatch()
  const [openStrips, setOpenStrips] = useAtom(openStripsAtom)
  const open = openStrips.has(id)
  const toggle = () =>
    setOpenStrips((was) => {
      const next = new Set(was)
      if (open) next.delete(id)
      else next.add(id)
      return next
    })
  const changed = soundChanged(track)
  const shared = (control: string): Shared => {
    const key = controlKey(id, control)
    const p = holders.get(key)
    return {
      heldBy: p && { name: personName(p, me.id), color: swatch(p.color) },
      onDragChange: (dragging) => holdControl(jam.awareness, key, dragging),
    }
  }

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
        {...shared('gain')}
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
        className="console-effects-toggle"
        aria-expanded={open}
        aria-controls={open ? `${id}-effects` : undefined}
        aria-label={changed ? 'Effects, changed' : 'Effects'}
        onClick={toggle}
      >
        Effects
        <span className={`console-effects-dot ${changed ? 'is-on' : ''}`} aria-hidden />
      </Button>
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
      {open && (
        <EffectsStrip id={id} track={track} color={swatch(track.color)} set={set} shared={shared} />
      )}
      {error && (
        <p id={`${id}-error`} className="console-channel-error" role="alert">
          {error}
        </p>
      )}
    </li>
  )
}

/** A loop's five sound knobs, live for everyone, each with its name and reading under it. */
function EffectsStrip({
  id,
  track,
  color,
  set,
  shared,
}: {
  id: string
  track: Track
  color: string
  set: (patch: Partial<Record<keyof typeof SOUND_KNOBS, number>>) => void
  shared: (control: string) => Shared
}) {
  const sound = soundOf(track)
  return (
    <div
      id={`${id}-effects`}
      className="console-effects"
      role="group"
      aria-label={`Effects of ${track.name}`}
    >
      {SOUND_KNOB_NAMES.map((k) => {
        const { min, max, step, default: home } = SOUND_KNOBS[k]
        const { label, format } = SOUND_READOUTS[k]
        return (
          <div key={k} className="console-effects-knob">
            <Knob
              live
              fill="segmented"
              label={`${label} of ${track.name}`}
              color={color}
              min={min}
              max={max}
              step={step}
              defaultValue={home}
              format={format}
              value={sound[k]}
              onChange={(v) => set({ [k]: v })}
              {...shared(k)}
            />
            <span className="console-effects-name" aria-hidden>
              {label}
            </span>
            <span className="console-effects-value" aria-hidden>
              {format(sound[k])}
            </span>
          </div>
        )
      })}
    </div>
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
