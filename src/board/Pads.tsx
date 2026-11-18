import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { SOUND_IDS, SOUNDS, soundName } from '../../shared/sounds'
import { padsAtom, soundsAtom } from './model'
import { useSession } from './session'
import {
  PausedNotice,
  refreshBudget,
  useBudget,
  UploadDialog,
  UploadsList,
  type UploadTarget,
  useFilePicker,
  useSampleState,
} from './Uploads'

const CATEGORIES = [...new Set(SOUNDS.map((s) => s.category))]
const UPLOAD_OPTION = '__upload'

/**
 * The 4×4 mini board: click or press a pad's key to play it; edit mode assigns sounds from the
 * kit or the jam's uploads, and uploads new ones.
 */
export function Pads({ slug }: { slug: string }) {
  const { engine, board } = useSession()
  const pads = useAtomValue(padsAtom)
  const sounds = useAtomValue(soundsAtom)
  const [editing, setEditing] = useState(false)
  const [lit, setLit] = useState<string>()
  const [pending, setPending] = useState<{ file: File; target: UploadTarget }>()
  // Where the next picked file goes. A ref, so the picker opens within the click (Safari needs that).
  const target = useRef<UploadTarget>({ kind: 'list' })
  const picker = useFilePicker((file) => setPending({ file, target: target.current }))
  const pick = (t: UploadTarget) => {
    target.current = t
    picker.open()
  }
  const uploadsOpen = useBudget().uploads === 'open'
  // Check the app's sound budget on opening the jam and on each switch into Change sounds.
  useEffect(() => {
    void refreshBudget()
  }, [editing])
  const known = (id: string) => SOUND_IDS.has(id) || sounds.has(id)

  const hit = (padId: string) => {
    if (!engine.ready) void engine.unlock()
    engine.hitPad(padId)
    setLit(padId)
    setTimeout(() => setLit((l) => (l === padId ? undefined : l)), 120)
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

  const grid = [...pads].sort(([, a], [, b]) => a.row - b.row || a.col - b.col)

  return (
    <div className="pads-wrap">
      <div className="pads" role="group" aria-label="Pads">
        {grid.map(([id, pad]) => (
          <div
            key={id}
            className={`pad ${lit === id ? 'lit' : ''}`}
            style={{ gridRow: pad.row + 1, gridColumn: pad.col + 1 }}
          >
            {editing ? (
              <select
                aria-label={`Sound for pad ${pad.key.toUpperCase()}`}
                value={known(pad.soundId) ? pad.soundId : ''}
                onChange={(e) => {
                  if (e.target.value === UPLOAD_OPTION) return pick({ kind: 'pad', padId: id })
                  const r = board.pad(id).assign(e.target.value)
                  if (!r.ok) console.warn(r.issues)
                }}
              >
                {!known(pad.soundId) && <option value="">(empty)</option>}
                {CATEGORIES.map((c) => (
                  <optgroup key={c} label={c[0]!.toUpperCase() + c.slice(1)}>
                    {SOUNDS.filter((s) => s.category === c).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {sounds.size > 0 && (
                  <optgroup label="Uploads">
                    {[...sounds].map(([sid, s]) => (
                      <option key={sid} value={sid}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value={UPLOAD_OPTION} disabled={!uploadsOpen}>
                  {uploadsOpen ? 'Upload a sound…' : 'Uploads paused'}
                </option>
              </select>
            ) : (
              <button type="button" onPointerDown={() => hit(id)}>
                <span className="pad-key">{pad.key.toUpperCase()}</span>
                <PadSound soundId={pad.soundId} />
              </button>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="link" onClick={() => setEditing((e) => !e)}>
        {editing ? 'Done' : 'Change sounds'}
      </button>
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
      {editing && <UploadsList slug={slug} onPick={pick} />}
      {!editing && sounds.size > 0 && <PausedNotice uploads={false} />}
    </div>
  )
}

/** A pad's sound name: the kit's, or an upload's (marked while loading or missing), else Empty. */
function PadSound({ soundId }: { soundId: string }) {
  const sounds = useAtomValue(soundsAtom)
  const upload = sounds.get(soundId)
  const state = useSampleState(soundId)
  if (!upload) return <span className="pad-sound">{soundName(soundId) ?? 'Empty'}</span>
  return (
    <span className={`pad-sound ${state === 'ready' ? '' : `pad-sound-${state ?? 'loading'}`}`}>
      {upload.name}
      {state === 'loading' && <span className="sr-only"> (loading)</span>}
      {state === 'missing' && <span className="pad-flag"> (missing)</span>}
    </span>
  )
}

export const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
