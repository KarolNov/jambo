import { z } from 'zod'

/**
 * Collaborator colours, by name. The board doc and presence store the name; each UI decides what
 * a name looks like (src/board/colors.ts), so a theme can show it differently.
 */
export const COLOR_NAMES = [
  'teal',
  'coral',
  'amber',
  'lime',
  'violet',
  'pink',
  'sky',
  'mint',
] as const
export type ColorName = (typeof COLOR_NAMES)[number]

/** The hex each colour was stored as before names: older jams still hold these. */
const LEGACY_HEX: Record<string, ColorName> = {
  '#2ab7ca': 'teal',
  '#ff6b6b': 'coral',
  '#f5a524': 'amber',
  '#8bd346': 'lime',
  '#a78bfa': 'violet',
  '#ff6b9d': 'pink',
  '#5bb4f5': 'sky',
  '#4fd1a5': 'mint',
}

/** A colour name, or a legacy hex read as its name; undefined for anything else. */
export function toColorName(value: unknown): ColorName | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.toLowerCase()
  return (COLOR_NAMES as readonly string[]).includes(v) ? (v as ColorName) : LEGACY_HEX[v]
}

/** A collaborator colour in the doc: one of the names. Legacy hexes read as their names. */
export const Color = z.preprocess((v) => toColorName(v) ?? v, z.enum(COLOR_NAMES))

/** How a colour is named to people: "Teal". */
export const colorLabel = (c: ColorName) => c[0]!.toUpperCase() + c.slice(1)
