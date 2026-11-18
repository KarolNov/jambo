import { COLOR_NAMES, type ColorName, toColorName } from '../../shared/colors'
import { randomName, toName } from '../../shared/names'

/**
 * An anonymous, per-browser identity: an id, and the usual name and colour this person asks for in
 * each jam (the room may seat them with others, see shared/seats.ts).
 */
export interface Identity {
  id: string
  name: string
  color: ColorName
}

const KEY = 'jambo.identity'

export function identity(): Identity {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      id?: unknown
      name?: unknown
      color?: unknown
    }
    // Identities saved before colour names hold a hex; read it as its name. Ones saved before
    // names get one now, kept from here on.
    const color = toColorName(saved?.color)
    const name = toName(saved?.name) ?? randomName()
    if (typeof saved?.id === 'string' && color) return remember({ id: saved.id, name, color })
  } catch {
    // Storage blocked or corrupt: fall through to a fresh identity for this page.
  }
  const color = COLOR_NAMES[Math.floor(Math.random() * COLOR_NAMES.length)]!
  return remember({ id: crypto.randomUUID(), name: randomName(), color })
}

function remember(identity: Identity): Identity {
  try {
    localStorage.setItem(KEY, JSON.stringify(identity))
  } catch {
    // Not persisted; this browser gets a new identity next time.
  }
  return identity
}
