import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Pad } from '../../shared/board'
import {
  padKeyOrder,
  PAUSED_MESSAGES,
  type UploadStatus as Budget,
  UPLOADS,
} from '../../shared/sounds'
import type { SampleState } from '../audio/samples'
import {
  defaultName,
  prepareSample,
  type Prepared,
  removeSound,
  UploadError,
  uploadSound,
} from '../audio/upload'
import { padsAtom, soundsAtom } from './model'
import type { JamSession } from './doc'
import { useSession } from './session'

/** Where a new upload goes once it is listed: onto a pad, in place of another upload, or nowhere. */
export type UploadTarget =
  | { kind: 'pad'; padId: string }
  | { kind: 'replace'; soundId: string }
  | { kind: 'list' }

let budget: Budget = { uploads: 'open', reads: 'open' }
const budgetListeners = new Set<() => void>()

/** Asks the app whether its sound budget allows uploads and downloads right now. */
export async function refreshBudget() {
  try {
    const res = await fetch('/api/sounds/status')
    if (!res.ok) return
    budget = (await res.json()) as Budget
    for (const l of budgetListeners) l()
  } catch {
    // Offline: keep the last answer.
  }
}

/** The app's sound budget as last fetched; uploads are disabled while it is paused. */
export function useBudget(): Budget {
  return useSyncExternalStore(
    (l) => {
      budgetListeners.add(l)
      return () => budgetListeners.delete(l)
    },
    () => budget,
  )
}

/** Why uploads or downloads are paused, if they are. */
export function PausedNotice({ uploads = true }: { uploads?: boolean }) {
  const b = useBudget()
  const reasons = [
    ...(uploads && b.uploads !== 'open' ? [PAUSED_MESSAGES[b.uploads]] : []),
    ...(b.reads !== 'open' ? [PAUSED_MESSAGES.reads] : []),
  ]
  if (reasons.length === 0) return null
  return (
    <div className="paused" role="status">
      {reasons.map((r) => (
        <p key={r}>{r}</p>
      ))}
    </div>
  )
}

/** This client's loading state for an upload, kept current. */
export function useSampleState(id: string): SampleState | undefined {
  const { engine } = useSession()
  return useSyncExternalStore(
    (l) => engine.samples.subscribe(l),
    () => engine.samples.state(id),
  )
}

/** The keys of the pads on each sound, in keyboard order. */
export function padKeysBySound(pads: Map<string, Pad>): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const sorted = [...pads.values()].sort((a, b) => padKeyOrder(a.key) - padKeyOrder(b.key))
  for (const p of sorted) out.set(p.soundId, [...(out.get(p.soundId) ?? []), p.key.toUpperCase()])
  return out
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** Picks one audio file, then calls `onFile`. Render it and call `open` from a click. */
export function useFilePicker(onFile: (file: File) => void) {
  const input = useRef<HTMLInputElement>(null)
  const element = (
    <input
      ref={input}
      type="file"
      accept="audio/*,.wav,.mp3,.ogg,.m4a,.flac,.aac"
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (file) onFile(file)
      }}
    />
  )
  return { element, open: () => input.current?.click() }
}

/** Resolves once the board lists `id` as a readable sound, so pads can be assigned to it. */
function listed(store: JamSession['store'], id: string, timeout = 10_000): Promise<void> {
  if (store.get(soundsAtom).has(id)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const stop = store.sub(soundsAtom, () => {
      if (!store.get(soundsAtom).has(id)) return
      stop()
      clearTimeout(timer)
      resolve()
    })
    const timer = setTimeout(() => {
      stop()
      reject(new UploadError('The upload is stored but has not reached this board yet'))
    }, timeout)
  })
}

/** Removes an upload, waiting briefly for pad changes made here to reach the room first. */
async function removeWhenFree(slug: string, id: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await removeSound(slug, id)
    } catch (e) {
      // 409: the room still sees it on a pad, until the pad changes made here reach it.
      if (attempt >= 5 || !(e instanceof UploadError) || e.status !== 409) throw e
      await new Promise((r) => setTimeout(r, 300))
    }
  }
}

/**
 * Prepares a picked file, lets the person name it, uploads it, and puts it where it was asked
 * for. Shown inline under the pads while it runs.
 */
export function UploadDialog({
  slug,
  file,
  target,
  onClose,
}: {
  slug: string
  file: File
  target: UploadTarget
  onClose: () => void
}) {
  const { engine, board, jam, me } = useSession()
  const sounds = useAtomValue(soundsAtom)
  const [prepared, setPrepared] = useState<Prepared>()
  const [name, setName] = useState(() => defaultName(file.name))
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  // The upload this dialog already stored, so trying again after a later step fails doesn't store it twice.
  const uploaded = useRef<string>(undefined)

  useEffect(() => {
    let live = true
    prepareSample(file).then(
      (p) => live && setPrepared(p),
      (e: unknown) => live && setError(e instanceof UploadError ? e.message : 'Could not read it'),
    )
    return () => {
      live = false
    }
  }, [file])

  const replacing = target.kind === 'replace' ? sounds.get(target.soundId) : undefined
  // Replace stores the new sound before removing the old one, so it needs a free slot too.
  const full = !uploaded.current && sounds.size >= UPLOADS.perJam
  const paused = useBudget().uploads !== 'open'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!prepared || busy) return
    setBusy(true)
    setError(undefined)
    try {
      let id = uploaded.current
      if (!id) {
        id = (await uploadSound(slug, prepared, name, me)).id
        uploaded.current = id
        engine.samples.seed(id, prepared.wav.buffer)
      }
      await listed(jam.store, id)
      if (target.kind === 'pad') board.pad(target.padId).assign(id)
      if (target.kind === 'replace') {
        board.replaceSound(target.soundId, id)
        await removeWhenFree(slug, target.soundId)
      }
      onClose()
    } catch (err) {
      setError(err instanceof UploadError ? err.message : 'The upload failed')
      setBusy(false)
      // A refusal may mean the app's budget ran out: show it everywhere.
      void refreshBudget()
    }
  }

  return (
    <form className="upload-dialog" onSubmit={submit} aria-label="Upload a sound">
      <p className="upload-title">
        {replacing ? `Replace ${replacing.name}` : 'Upload a sound'}
        {prepared && <span className="muted"> · {seconds(prepared.durationMs)}</span>}
        {!prepared && !error && <span className="muted"> · preparing…</span>}
      </p>
      <label>
        Name{' '}
        <input
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          autoFocus
        />
      </label>
      {full && <p className="message">This jam already has {UPLOADS.perJam} sounds</p>}
      {error && (
        <p className="message" role="alert">
          {error}
        </p>
      )}
      {!error && <PausedNotice />}
      <div className="upload-actions">
        <button
          type="submit"
          disabled={!prepared || busy || full || (paused && !uploaded.current) || !name.trim()}
        >
          {busy ? 'Uploading…' : replacing ? 'Replace' : 'Upload'}
        </button>
        <button type="button" className="link" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** The jam's uploads, in Change sounds: what each is on, Replace…, and Remove when unused. */
export function UploadsList({
  slug,
  onPick,
  uploading,
}: {
  slug: string
  onPick: (target: UploadTarget) => void
  /** An upload dialog is open: finish or cancel it before picking another file. */
  uploading: boolean
}) {
  const sounds = useAtomValue(soundsAtom)
  const pads = useAtomValue(padsAtom)
  const onPads = padKeysBySound(pads)
  const [error, setError] = useState<string>()
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set())
  const paused = useBudget().uploads !== 'open'

  const remove = async (id: string) => {
    setRemoving((r) => new Set(r).add(id))
    setError(undefined)
    try {
      await removeSound(slug, id)
    } catch (e) {
      setError(e instanceof UploadError ? e.message : "Couldn't remove it")
    } finally {
      setRemoving((r) => {
        const next = new Set(r)
        next.delete(id)
        return next
      })
    }
  }

  return (
    <section className="uploads" aria-label="Uploaded sounds">
      <div className="uploads-head">
        <span>
          Uploads{' '}
          <span className="muted">
            {sounds.size}/{UPLOADS.perJam}
          </span>
        </span>
        <button
          type="button"
          className="link"
          disabled={sounds.size >= UPLOADS.perJam || paused || uploading}
          onClick={() => onPick({ kind: 'list' })}
        >
          Upload a sound…
        </button>
      </div>
      <PausedNotice />
      {sounds.size === 0 && !paused && (
        <p className="muted">
          Add your own samples: up to {UPLOADS.maxSeconds} s each, {UPLOADS.perJam} per jam.
        </p>
      )}
      <ul>
        {[...sounds].map(([id, s]) => {
          const keys = onPads.get(id) ?? []
          return (
            <li key={id}>
              <span className="upload-name">{s.name}</span>
              <span className="muted">{seconds(s.durationMs)}</span>
              <UploadStatus id={id} />
              {keys.length > 0 && <span className="muted">on {keys.join(', ')}</span>}
              <span className="upload-buttons">
                <button
                  type="button"
                  className="link"
                  disabled={sounds.size >= UPLOADS.perJam || paused || uploading}
                  onClick={() => onPick({ kind: 'replace', soundId: id })}
                >
                  Replace…
                </button>
                <button
                  type="button"
                  className="link"
                  disabled={keys.length > 0 || removing.has(id)}
                  title={
                    keys.length > 0
                      ? `On ${keys.length === 1 ? 'pad' : 'pads'} ${keys.join(', ')}: change ${keys.length === 1 ? 'it' : 'them'} first`
                      : undefined
                  }
                  onClick={() => void remove(id)}
                >
                  {removing.has(id) ? 'Removing…' : 'Remove'}
                </button>
              </span>
            </li>
          )
        })}
      </ul>
      {error && (
        <p className="message" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

function UploadStatus({ id }: { id: string }) {
  const state = useSampleState(id)
  if (state === 'loading') return <span className="muted">loading…</span>
  if (state === 'missing') return <span className="message">missing</span>
  return null
}
