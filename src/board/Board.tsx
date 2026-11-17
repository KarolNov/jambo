import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useState } from 'react'
import type { ConnectionStatus } from './doc'
import { newTrackId, tracks } from './model'

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Live',
  connecting: 'Connecting…',
  offline: 'Offline, edits will sync when back',
}

export function Board({ slug, status }: { slug: string; status: ConnectionStatus }) {
  const ids = useAtomValue(tracks.ids)
  const create = useSetAtom(tracks.create)
  const [copied, setCopied] = useState(false)

  const addTrack = () => {
    const result = create({ name: `Track ${ids.length + 1}` }, newTrackId())
    if (result.issues) console.warn(result.issues)
  }

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <main className="board">
      <header className="board-header">
        <a className="logo" href="/">
          jambo
        </a>
        <span className="slug">{slug}</span>
        <button type="button" onClick={copyLink}>
          {copied ? 'Link copied' : 'Copy link'}
        </button>
        <span className={`status status-${status}`} role="status">
          {STATUS_LABEL[status]}
        </span>
      </header>

      <ol className="tracks">
        {ids.map((id) => (
          <TrackRow key={id} id={id} />
        ))}
      </ol>
      {ids.length === 0 && <p className="empty">No tracks yet. Add one, then share the link.</p>}

      <button type="button" className="add" onClick={addTrack}>
        + Add track
      </button>
    </main>
  )
}

function TrackRow({ id }: { id: string }) {
  const [track, setTrack] = useAtom(tracks.item(id))
  const remove = useSetAtom(tracks.remove)
  // The text being typed; it differs from the doc only while it is invalid.
  const [draft, setDraft] = useState<string>()
  const [error, setError] = useState<string>()

  if (!track) return null
  if (track.issues) {
    return (
      <li className="track track-broken">
        Unreadable track
        <button type="button" onClick={() => remove(id)}>
          Remove
        </button>
      </li>
    )
  }

  const rename = (name: string) => {
    setDraft(name)
    const result = setTrack({ name })
    if (result.issues) {
      setError(result.issues[0]?.message ?? 'Invalid name')
    } else {
      setDraft(undefined)
      setError(undefined)
    }
  }

  return (
    <li className="track">
      <input
        aria-label="Track name"
        aria-invalid={!!error}
        value={draft ?? track.value.name}
        onChange={(e) => rename(e.target.value)}
        onBlur={() => {
          setDraft(undefined)
          setError(undefined)
        }}
      />
      <button type="button" aria-label="Remove track" onClick={() => remove(id)}>
        ✕
      </button>
      {error && <span className="error">{error}</span>}
    </li>
  )
}
