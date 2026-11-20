/** How folder tabs fit their strip. Pure, so it can be tested. */

/** The space between tabs while they fit. */
export const TAB_GAP = 8

/**
 * The step from one tab's right edge to the next one's left edge: `gap` while the tabs fit in
 * `available`, then less, then negative so neighbours overlap just enough to fit, but by no more
 * than `maxOverlap` (a tab's side padding, so no label is covered; past that the strip scrolls).
 */
export function tabStep(
  widths: readonly number[],
  available: number,
  maxOverlap: number,
  gap = TAB_GAP,
): number {
  const joints = widths.length - 1
  if (joints < 1) return gap
  const needed = widths.reduce((a, b) => a + b, 0)
  const step = (available - needed) / joints
  if (step >= gap) return gap
  return Math.max(step, -maxOverlap)
}
