import type { ColorName } from '../../shared/colors'

/** What each collaborator colour looks like on the board's dark theme. */
const SWATCHES: Record<ColorName, string> = {
  teal: '#2ab7ca',
  coral: '#ff6b6b',
  amber: '#f5a524',
  lime: '#8bd346',
  violet: '#a78bfa',
  pink: '#ff6b9d',
  sky: '#5bb4f5',
  mint: '#4fd1a5',
}

/** The CSS colour to paint a collaborator colour with. */
export const swatch = (c: ColorName) => SWATCHES[c]
