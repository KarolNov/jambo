import { COLOR_NAMES, type ColorName, toColorName } from '../../shared/colors'

/** An anonymous, per-browser identity: an id and a colour (by name) that mark this person's tracks. */
export interface Identity {
  id: string
  color: ColorName
}

const KEY = 'jambo.identity'

export function identity(): Identity {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      id?: unknown
      color?: unknown
    }
    // Identities saved before colour names hold a hex; read it as its name.
    const color = toColorName(saved?.color)
    if (typeof saved?.id === 'string' && color) return remember({ id: saved.id, color })
  } catch {
    // Storage blocked or corrupt: fall through to a fresh identity for this page.
  }
  const color = COLOR_NAMES[Math.floor(Math.random() * COLOR_NAMES.length)]!
  return remember({ id: crypto.randomUUID(), color })
}

function remember(identity: Identity): Identity {
  try {
    localStorage.setItem(KEY, JSON.stringify(identity))
  } catch {
    // Not persisted; this browser gets a new identity next time.
  }
  return identity
}
