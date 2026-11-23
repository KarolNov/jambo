import type { BrowserCommand } from 'vitest/node'

/**
 * Real mouse input for browser tests, through Playwright: a held press, moves and a release.
 * `userEvent` has clicks and drag-and-drop but no held press, and a scrub or knob drag needs one
 * (it captures the pointer, which synthetic events can't). Coordinates are the top page's.
 */

/** Presses the mouse on the middle of the element `selector` matches; returns where. */
const mouseDown: BrowserCommand<[selector: string]> = async ({ page, iframe }, selector) => {
  const box = await iframe.locator(selector).boundingBox()
  if (!box) throw new Error(`Nothing to press at ${selector}`)
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  return at
}

/** Moves the mouse to (x, y) in `steps` moves. */
const mouseMove: BrowserCommand<[x: number, y: number, steps?: number]> = async (
  { page },
  x,
  y,
  steps = 5,
) => {
  await page.mouse.move(x, y, { steps })
}

const mouseUp: BrowserCommand<[]> = async ({ page }) => {
  await page.mouse.up()
}

export const commands = { mouseDown, mouseMove, mouseUp }
