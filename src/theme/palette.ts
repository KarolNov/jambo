import type { ColorName } from '../../shared/colors'

/** The soft console's two themes. */
export type Theme = 'light' | 'dark'
export const THEMES = ['light', 'dark'] as const

/**
 * The colour tokens of each theme. The page is one surface (`bg`) lit from the top left: `hi` is
 * the lit side of a shadow pair, `lo` the shaded side. Dark has its own pair, never an inverted
 * light one. `accent` marks record and destructive actions; `accent2` focus, selection and "open".
 * `flat` and `line` make the high-contrast plates that carry data (hit patterns, playheads).
 */
export const TOKENS: Record<Theme, Record<TokenName, string>> = {
  light: {
    bg: '#ebe4dc',
    hi: '#fffaf4',
    lo: '#c6baac',
    text: '#33291f',
    muted: '#6d5f50',
    accent: '#e0532c',
    accent2: '#1f8f80',
    flat: '#f6f1eb',
    line: '#d6cbbf',
  },
  dark: {
    bg: '#2a2621',
    hi: '#37322c',
    lo: '#1b1815',
    text: '#f2ebe2',
    muted: '#b3a593',
    accent: '#ff7a4f',
    accent2: '#4cc6b4',
    flat: '#221f1b',
    line: '#433d36',
  },
}
export type TokenName =
  | 'bg'
  | 'hi'
  | 'lo'
  | 'text'
  | 'muted'
  | 'accent'
  | 'accent2'
  | 'flat'
  | 'line'

/** The CSS custom property each token is published as: `accent2` → `--accent-2`. */
export const cssVar = (t: TokenName) => `--${t.replace(/(\d)$/, '-$1')}`

/**
 * What each collaborator colour looks like in each theme: bright on dark, a deeper shade of the
 * same hue on light, so dots, hits and rings keep at least 3:1 against the surface.
 */
export const SWATCHES: Record<ColorName, Record<Theme, string>> = {
  teal: { dark: '#2ab7ca', light: '#13808e' },
  coral: { dark: '#ff6b6b', light: '#d64545' },
  amber: { dark: '#f5a524', light: '#a86400' },
  lime: { dark: '#8bd346', light: '#4c8519' },
  violet: { dark: '#a78bfa', light: '#7650e0' },
  pink: { dark: '#ff6b9d', light: '#cc3870' },
  sky: { dark: '#5bb4f5', light: '#1d72c4' },
  mint: { dark: '#4fd1a5', light: '#17845e' },
}

/** The theme to show: the one this browser picked, else the system's. */
export function resolveTheme(saved: unknown, systemDark: boolean): Theme {
  return saved === 'light' || saved === 'dark' ? saved : systemDark ? 'dark' : 'light'
}

/** WCAG contrast ratio between two `#rrggbb` colours. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}
