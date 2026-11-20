/** Which folder tabs fit their strip, the rest going behind a "+N" tab. Pure, so it can be tested. */

/** The space between tabs, and before the "+N" tab. */
export const TAB_GAP = 6

/**
 * The indexes of the tabs to show, in order, given each tab's `widths`, the `selected` index, the
 * strip's `available` width and the "+N" tab's width `more`. All of them when they fit; otherwise
 * as many of the first ones as fit beside "+N", with the selected tab always among them (in place
 * of the last one that fits, when it is further along). At least the selected tab.
 */
export function visibleTabs(
  widths: readonly number[],
  selected: number,
  available: number,
  more: number,
  gap = TAB_GAP,
): number[] {
  const n = widths.length
  const width = (shown: number[]) =>
    shown.reduce((sum, i) => sum + widths[i]!, 0) + gap * (shown.length - 1)
  const all = widths.map((_, i) => i)
  if (n === 0 || width(all) <= available) return all
  for (let k = n - 1; k >= 1; k--) {
    const first = all.slice(0, k)
    const shown = first.includes(selected) ? first : [...first.slice(0, k - 1), selected]
    if (width(shown) + gap + more <= available) return shown
  }
  return [selected]
}
