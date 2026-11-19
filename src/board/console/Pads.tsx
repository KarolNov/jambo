import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ColorName } from '../../../shared/colors'
import { SOUND_IDS, SOUNDS, soundName } from '../../../shared/sounds'
import { Button, type Group, OptionList, Pad, type PadProps, Popover } from '../../ui'
import { useSwatch } from '../colors'
import { padsAtom, soundsAtom, tracksAtom } from '../model'
import { isTyping } from '../typing'
import { useSession } from '../session'
import { uploadedBy } from './people'
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
import './pads.css'

const CATEGORIES = [...new Set(SOUNDS.map((s) => s.category))]
const UPLOAD_OPTION = '__upload'

/** How long a pad stays pushed in after your press, and lit after a loop hit, in ms. */
const PRESS_MS = 110
const GLOW_MS = 160

/** Who uploaded a sound, for its dot's tooltip. */
function useUploader(): (sound: {
  author: string
  authorName?: string
  color: ColorName
}) => string {
  const { me } = useSession()
  return (s) => uploadedBy(s, me.id)
}

/** Every sound a pad can take: the kit by category, the jam's uploads, then "Upload a sound…". */
function useSoundGroups(canUpload: boolean): Group[] {
  const sounds = useAtomValue(soundsAtom)
  const uploadsOpen = useBudget().uploads === 'open'
  const uploader = useUploader()
  const swatch = useSwatch()
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
              dot: { color: swatch(s.color), title: uploader(s) },
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
 * The 4×4 pads. Playing: click or key; your press pushes the pad in, and a loop's hit lights it
 * in the loop's colour as it is heard. Editing: click a pad to pick its sound from a menu.
 */
function PadGrid({
  editing,
  onUpload,
}: {
  editing: boolean
  /** Picked "Upload a sound…" for a pad; undefined while an upload is already open. */
  onUpload?: (padId: string) => void
}) {
  const { engine, me, board } = useSession()
  const pads = useAtomValue(padsAtom)
  const sounds = useAtomValue(soundsAtom)
  const tracks = useAtomValue(tracksAtom)
  const swatch = useSwatch()
  const els = useRef(new Map<string, HTMLButtonElement>())
  const timers = useRef(new Map<string, number>())
  const [picking, setPicking] = useState<{ padId: string; anchor: HTMLElement }>()
  const groups = useSoundGroups(!!onUpload)
  useEffect(() => setPicking(undefined), [editing])

  /** Sets `cls` on a pad for a moment, restarting it if it is already on. Straight on the DOM: hits come fast. */
  const flash = (padId: string, color: ColorName, cls: 'pressed' | 'glow') => {
    const el = els.current.get(padId)
    if (!el) return
    el.style.setProperty('--glow', swatch(color))
    el.classList.remove(cls)
    void el.offsetWidth // restart the fade
    el.classList.add(cls)
    clearTimeout(timers.current.get(padId + cls))
    timers.current.set(
      padId + cls,
      window.setTimeout(() => el.classList.remove(cls), cls === 'pressed' ? PRESS_MS : GLOW_MS),
    )
  }

  // Loop hits, from the engine as they are heard; your own presses light the pad below.
  const latest = useRef({ tracks, flash })
  latest.current = { tracks, flash }
  useEffect(
    () =>
      engine.onHit(({ padId, trackId }) => {
        const track = trackId && latest.current.tracks.get(trackId)
        if (track) latest.current.flash(padId, track.color, 'glow')
      }),
    [engine],
  )
  useEffect(() => {
    const t = timers.current
    return () => t.forEach((id) => clearTimeout(id))
  }, [])

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
    <div className={`console-pads ${editing ? 'is-editing' : ''}`} role="group" aria-label="Pads">
      {grid.map(([id, pad]) => (
        <ConsolePad
          key={id}
          ref={(el) => {
            if (el) els.current.set(id, el)
            else els.current.delete(id)
          }}
          keyLabel={pad.key}
          soundId={pad.soundId}
          editing={editing}
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
        />
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

/** A pad showing its sound: the kit's name, or an upload's with its uploader's dot and state. */
function ConsolePad({
  soundId,
  ...rest
}: Omit<PadProps, 'name' | 'dot' | 'status'> & { soundId: string }) {
  const sounds = useAtomValue(soundsAtom)
  const upload = sounds.get(soundId)
  const state = useSampleState(soundId)
  const uploader = useUploader()
  const swatch = useSwatch()
  if (!upload) return <Pad name={soundName(soundId) ?? 'Empty'} {...rest} />
  return (
    <Pad
      name={upload.name}
      dot={{ color: swatch(upload.color), title: uploader(upload) }}
      status={state ?? 'loading'}
      {...rest}
    />
  )
}

/**
 * The pads plus the upload flow: the upload dialog and, while editing, the jam's uploads list.
 * `editing` is owned by the deck so it can place the toggle.
 */
export function SoundEditor({ slug, editing }: { slug: string; editing: boolean }) {
  const sounds = useAtomValue(soundsAtom)
  const [pending, setPending] = useState<{ file: File; target: UploadTarget }>()
  // Where the next picked file goes. A ref, so the picker opens within the click (Safari needs that).
  const target = useRef<UploadTarget>({ kind: 'list' })
  const picker = useFilePicker((file) => setPending({ file, target: target.current }))
  const pick = (t: UploadTarget) => {
    // One upload at a time: a new pick would unmount a dialog whose upload is still running.
    if (pending) return
    target.current = t
    picker.open()
  }
  // Check the app's sound budget on opening the jam and on each switch into Change sounds.
  useEffect(() => {
    void refreshBudget()
  }, [editing])
  return (
    <div className="console-sounds">
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

/** A prompt to start audio, until it is: browsers only allow it from a click or key. */
export function Unlock() {
  const { engine } = useSession()
  const ready = useSyncExternalStore(
    (l) => engine.subscribe(l),
    () => engine.ready,
  )
  if (ready) return null
  return (
    <Button tone="primary" className="console-unlock" onClick={() => void engine.unlock()}>
      Tap to start audio
    </Button>
  )
}
