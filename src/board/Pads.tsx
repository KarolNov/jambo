import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import { SOUND_IDS, SOUNDS, soundName } from '../../shared/sounds'
import { padsAtom } from './model'
import { useSession } from './session'

/** The 4×4 mini board: click or press a pad's key to play it; edit mode assigns sounds. */
export function Pads() {
  const { engine, board } = useSession()
  const pads = useAtomValue(padsAtom)
  const [editing, setEditing] = useState(false)
  const [lit, setLit] = useState<string>()

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
                value={SOUND_IDS.has(pad.soundId) ? pad.soundId : ''}
                onChange={(e) => {
                  const r = board.pad(id).assign(e.target.value)
                  if (!r.ok) console.warn(r.issues)
                }}
              >
                {!SOUND_IDS.has(pad.soundId) && <option value="">(empty)</option>}
                {SOUNDS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <button type="button" onPointerDown={() => hit(id)}>
                <span className="pad-key">{pad.key.toUpperCase()}</span>
                <span className="pad-sound">{soundName(pad.soundId) ?? 'Empty'}</span>
              </button>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="link" onClick={() => setEditing((e) => !e)}>
        {editing ? 'Done' : 'Change sounds'}
      </button>
    </div>
  )
}

export const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
