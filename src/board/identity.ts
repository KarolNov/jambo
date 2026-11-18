/** An anonymous, per-browser identity: an id and a colour that mark this person's tracks. */
const COLORS = [
  ['Teal', '#2ab7ca'],
  ['Coral', '#ff6b6b'],
  ['Amber', '#f5a524'],
  ['Lime', '#8bd346'],
  ['Violet', '#a78bfa'],
  ['Pink', '#ff6b9d'],
  ['Sky', '#5bb4f5'],
  ['Mint', '#4fd1a5'],
] as const

export interface Identity {
  id: string
  colorName: string
  color: string
}

const KEY = 'jambo.identity'

export function identity(): Identity {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Identity | null
    if (saved?.id && saved.color && saved.colorName) return saved
  } catch {
    // Storage blocked or corrupt: fall through to a fresh identity for this page.
  }
  const [colorName, color] = COLORS[Math.floor(Math.random() * COLORS.length)]!
  const fresh = { id: crypto.randomUUID(), colorName, color }
  try {
    localStorage.setItem(KEY, JSON.stringify(fresh))
  } catch {
    // Not persisted; this browser gets a new identity next time.
  }
  return fresh
}
