import type { ColorName } from '../../shared/colors'
import { SWATCHES, type Theme } from '../theme/palette'
import { useTheme } from '../theme/theme'

/** The CSS colour to paint a collaborator colour with in `theme` (dark: today's board). */
export const swatch = (c: ColorName, theme: Theme = 'dark') => SWATCHES[c][theme]

/** Paints collaborator colours for the theme being shown. */
export function useSwatch(): (c: ColorName) => string {
  const theme = useTheme()
  return (c) => swatch(c, theme)
}
