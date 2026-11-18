/**
 * PROTOTYPE (neumorphism, throwaway): pads, sound editing, header and helpers for the console.
 * Lives on the `prototype/neumorphism` branch only; see ./Neumo.tsx.
 */
import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BEATS_PER_BAR } from '../../../shared/board'
import { type ColorName, colorLabel } from '../../../shared/colors'
import { SOUND_IDS, SOUNDS, soundName } from '../../../shared/sounds'
import type { ConnectionStatus } from '../doc'
import { padsAtom, soundsAtom, tracksAtom } from '../model'
import { isTyping } from '../Pads'
import { usePeople } from '../presence'
import { useSession } from '../session'
import {
  PausedNotice,
  refreshBudget,
  UploadDialog,
  UploadsList,
  type UploadTarget,
  useBudget,
  useFilePicker,
  useSampleState,
} from '../Uploads'
import { Button, type Group, IconButton, OptionList, Popover } from '../../ui'
import { ThemeToggle } from '../../theme/ThemeToggle'
import { useSwatch } from '../colors'

export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Live',
  connecting: 'Connecting…',
  offline: 'Offline',
}

/** Who uploaded a sound, for its dot's tooltip. */
function useUploader(): (sound: { author: string; color: ColorName }) => string {
  const { me } = useSession()
  return (s) => (s.author === me.id ? 'Uploaded by you' : `Uploaded by ${colorLabel(s.color)}`)
}

const CATEGORIES = [...new Set(SOUNDS.map((s) => s.category))]
const UPLOAD_OPTION = '__upload'

/**
 * Calls `flash(padId, color)` whenever a playing loop passes one of its hits, worked out from
 * each track's playhead (the engine has no hit event yet).
 */
function useLoopHits(flash: (padId: string, color: ColorName) => void) {
  const { engine } = useSession()
  const tracks = useAtomValue(tracksAtom)
  const latest = useRef({ tracks, flash })
  latest.current = { tracks, flash }
  useEffect(() => {
    const last = new Map<string, number>()
    let frame = 0
    const step = () => {
      for (const [id, t] of latest.current.tracks) {
        const pos = engine.position(id)
        if (pos === undefined || t.mute) {
          last.delete(id)
          continue
        }
        const beat = pos * t.bars * BEATS_PER_BAR
        const prev = last.get(id)
        if (prev !== undefined && prev !== beat)
          for (const h of t.hits) {
            const passed =
              prev < beat ? h.beat > prev && h.beat <= beat : h.beat > prev || h.beat <= beat
            if (passed) latest.current.flash(h.padId, t.color)
          }
        last.set(id, beat)
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [engine])
}

/** Sets `--p` (0–1, the loop's position) and `data-playing` on `ref`, every frame. */
export function usePlayhead(trackId: string, ref: React.RefObject<HTMLElement | null>) {
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

/** Every sound a pad can take: the kit by category, the jam's uploads, then "Upload a sound…". */
function useSoundGroups(canUpload: boolean): Group[] {
  const sounds = useAtomValue(soundsAtom)
  const uploadsOpen = useBudget().uploads === 'open'
  const uploader = useUploader()
  const shade = useSwatch()
  return [
    ...CATEGORIES.map((c) => ({
      label: c[0]!.toUpperCase() + c.slice(1),
      options: SOUNDS.filter((s) => s.category === c).map((s) => ({ value: s.id, label: s.name })),
    })),
    ...(sounds.size > 0
      ? [
          {
            label: 'Uploads',
            options: [...sounds].map(([id, s]) => ({
              value: id,
              label: s.name,
              note: `${(s.durationMs / 1000).toFixed(1)} s`,
              dot: { color: shade(s.color), title: uploader(s) },
            })),
          },
        ]
      : []),
    {
      options: [
        {
          value: UPLOAD_OPTION,
          label: uploadsOpen ? 'Upload a sound…' : 'Uploads paused',
          disabled: !uploadsOpen || !canUpload,
        },
      ],
    },
  ]
}

/**
 * The 4×4 pads. Playing: click or key; your hits push the pad in, loop hits light it in the
 * loop's colour. Editing: click a pad to pick its sound from a popover.
 */
export function PadGrid({
  editing = false,
  onUpload,
}: {
  editing?: boolean
  /** Picked "Upload a sound…" for a pad; undefined while an upload is already open. */
  onUpload?: (padId: string) => void
}) {
  const { engine, me, board } = useSession()
  const pads = useAtomValue(padsAtom)
  const sounds = useAtomValue(soundsAtom)
  const els = useRef(new Map<string, HTMLButtonElement>())
  const timers = useRef(new Map<string, number>())
  const [picking, setPicking] = useState<{ padId: string; anchor: HTMLElement }>()
  const groups = useSoundGroups(!!onUpload)
  useEffect(() => setPicking(undefined), [editing])

  const shade = useSwatch()
  const flash = (padId: string, color: ColorName, cls: string) => {
    const el = els.current.get(padId)
    if (!el) return
    el.style.setProperty('--glow', shade(color))
    el.classList.remove(cls)
    void el.offsetWidth // restart the transition
    el.classList.add(cls)
    clearTimeout(timers.current.get(padId + cls))
    timers.current.set(
      padId + cls,
      window.setTimeout(() => el.classList.remove(cls), cls === 'pressed' ? 110 : 160),
    )
  }
  useLoopHits((padId, color) => flash(padId, color, 'glow'))

  const hit = (padId: string) => {
    if (!engine.ready) void engine.unlock()
    engine.hitPad(padId)
    flash(padId, me.color, 'pressed')
  }

  useEffect(() => {
    const byKey = new Map([...pads].map(([id, p]) => [p.key, id]))
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      const id = byKey.get(e.key.toLowerCase())
      if (id) {
        e.preventDefault()
        hit(id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const known = (id: string) => SOUND_IDS.has(id) || sounds.has(id)
  const grid = [...pads].sort(([, a], [, b]) => a.row - b.row || a.col - b.col)
  const picked = picking && pads.get(picking.padId)
  return (
    <div className={`n-pads ${editing ? 'is-editing' : ''}`} role="group" aria-label="Pads">
      {grid.map(([id, pad]) => (
        <button
          key={id}
          type="button"
          ref={(el) => {
            if (el) els.current.set(id, el)
            else els.current.delete(id)
          }}
          className="n-pad"
          style={{ gridRow: pad.row + 1, gridColumn: pad.col + 1 }}
          onPointerDown={editing ? undefined : () => hit(id)}
          onClick={
            editing
              ? (e) => {
                  const anchor = e.currentTarget
                  setPicking((p) => (p?.padId === id ? undefined : { padId: id, anchor }))
                }
              : undefined
          }
          aria-haspopup={editing ? 'listbox' : undefined}
          aria-expanded={editing ? picking?.padId === id : undefined}
          aria-keyshortcuts={editing ? undefined : pad.key}
        >
          <span className="n-pad-key">{pad.key.toUpperCase()}</span>
          <PadSound soundId={pad.soundId} />
          {editing && <span className="n-pad-edit" aria-hidden />}
        </button>
      ))}
      {picking && picked && (
        <Popover anchor={picking.anchor} onClose={() => setPicking(undefined)}>
          <OptionList
            groups={groups}
            value={known(picked.soundId) ? picked.soundId : ''}
            label={`Sound for pad ${picked.key.toUpperCase()}`}
            onSelect={(v) => {
              const { padId, anchor } = picking
              setPicking(undefined)
              anchor.focus()
              if (v === UPLOAD_OPTION) onUpload?.(padId)
              else board.pad(padId).assign(v)
            }}
          />
        </Popover>
      )}
    </div>
  )
}

/** A pad's sound name: the kit's, or an upload's (dimmed while loading, flagged if missing). */
function PadSound({ soundId }: { soundId: string }) {
  const sounds = useAtomValue(soundsAtom)
  const upload = sounds.get(soundId)
  const state = useSampleState(soundId)
  const uploader = useUploader()
  const shade = useSwatch()
  if (!upload) return <span className="n-pad-sound">{soundName(soundId) ?? 'Empty'}</span>
  return (
    <span className={`n-pad-sound n-pad-sound-${state ?? 'loading'}`}>
      <span
        className="ui-dot"
        style={{ background: shade(upload.color) }}
        title={uploader(upload)}
        aria-label={uploader(upload)}
      />
      {upload.name}
      {state === 'missing' && ' (missing)'}
    </span>
  )
}

/**
 * Pads plus the real upload flow: the upload dialog and, while editing, the jam's uploads list.
 * `editing` is owned by the page so it can place the toggle.
 */
export function SoundEditor({ slug, editing }: { slug: string; editing: boolean }) {
  const sounds = useAtomValue(soundsAtom)
  const [pending, setPending] = useState<{ file: File; target: UploadTarget }>()
  const target = useRef<UploadTarget>({ kind: 'list' })
  const picker = useFilePicker((file) => setPending({ file, target: target.current }))
  const pick = (t: UploadTarget) => {
    if (pending) return
    target.current = t
    picker.open()
  }
  useEffect(() => {
    void refreshBudget()
  }, [editing])
  return (
    <div className="n-sound-editor">
      <PadGrid
        editing={editing}
        onUpload={pending ? undefined : (padId) => pick({ kind: 'pad', padId })}
      />
      {picker.element}
      {pending && (
        <UploadDialog
          key={pending.file.name + pending.file.lastModified}
          slug={slug}
          file={pending.file}
          target={pending.target}
          onClose={() => setPending(undefined)}
        />
      )}
      {editing && <UploadsList slug={slug} onPick={pick} uploading={!!pending} />}
      {!editing && sounds.size > 0 && <PausedNotice uploads={false} />}
    </div>
  )
}

/** A prompt to unlock audio, until it is. */
export function Unlock() {
  const { engine } = useSession()
  const ready = useSyncExternalStore(
    (l) => engine.subscribe(l),
    () => engine.ready,
  )
  if (ready) return null
  return (
    <Button tone="primary" className="n-unlock" onClick={() => void engine.unlock()}>
      Tap to start audio
    </Button>
  )
}

/** Logo, link, people and connection. */
export function Header({ slug, status }: { slug: string; status: ConnectionStatus }) {
  const { jam, me } = useSession()
  const people = usePeople(jam.awareness, me)
  const shade = useSwatch()
  const [copied, setCopied] = useState(false)
  return (
    <header className="n-header">
      <a className="n-logo" href="/">
        jambo
      </a>
      <span className="n-slug">{slug}</span>
      <IconButton
        className="n-share"
        label={copied ? 'Link copied' : 'Share this jam'}
        title="Share this jam"
        onClick={async () => {
          const url = window.location.href.replace(/\?.*$/, '')
          // The system share sheet where there is one (phones, Safari); otherwise copy the link.
          if (navigator.share) {
            try {
              await navigator.share({ title: `jambo · ${slug}`, url })
              return
            } catch (e) {
              if ((e as Error).name === 'AbortError') return
            }
          }
          await navigator.clipboard.writeText(url)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" />
          <path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 17.5 10H16" />
        </svg>
        {copied && (
          <span className="n-share-tip" role="status">
            Link copied
          </span>
        )}
      </IconButton>
      <ul className="n-people" aria-label="Who's here">
        {people.map((p) => (
          <li
            key={p.id}
            title={p.id === me.id ? `${colorLabel(p.color)} (you)` : colorLabel(p.color)}
          >
            <span className="n-person" style={{ background: shade(p.color) }} />
            <span className="n-person-name">
              {colorLabel(p.color)}
              {p.id === me.id && ' (you)'}
            </span>
          </li>
        ))}
      </ul>
      <span className={`n-status n-status-${status}`} role="status">
        {STATUS_LABEL[status]}
      </span>
      <ThemeToggle />
    </header>
  )
}
