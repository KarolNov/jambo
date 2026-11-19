import type { KeyboardEvent } from 'react'
import { stepBy } from './fader'

/** The step math of scrubbing and knobs, kept apart from useScrub so it can be tested on its own. */

/** The range a scrub moves through: `step` per `pixelsPerStep` of drag, kept within min–max. */
export type ScrubRange = { min: number; max: number; step: number; pixelsPerStep: number }

/** Where the step count is measured from: the value and the pointer's position at that point. */
export type ScrubAnchor = { base: number; at: number }

/** Shift moves this many steps at a time, as it does for the tempo field's arrows. */
export const SHIFT_STEPS = 10

/**
 * The value at pointer position `pos`: one step for each whole `pixelsPerStep` moved since the
 * anchor (part of a step doesn't count, either way), ten with Shift, onto the step grid as the
 * fader's keys do, within range. Past an end the anchor moves to the pointer, so dragging back
 * changes the value at once instead of first winding back the overshoot.
 */
export function scrubMove(
  anchor: ScrubAnchor,
  pos: number,
  shift: boolean,
  range: ScrubRange,
): { value: number; anchor: ScrubAnchor } {
  const steps = Math.trunc((pos - anchor.at) / range.pixelsPerStep) * (shift ? SHIFT_STEPS : 1)
  // Less than a step moved: the value stays as it is, even off the grid.
  if (steps === 0) return { value: anchor.base, anchor }
  const value = stepBy(anchor.base, steps, range.step, range.min, range.max)
  const raw = anchor.base + steps * range.step
  const over = raw < range.min || raw > range.max
  return { value, anchor: over ? { base: value, at: pos } : anchor }
}

/** Which way each key moves a slider-like control, and how far: a step, a page, or to the end. */
export const SLIDER_KEYS: Partial<
  Record<string, readonly [sign: 1 | -1, size: 'step' | 'page' | 'end']>
> = {
  ArrowRight: [1, 'step'],
  ArrowUp: [1, 'step'],
  ArrowLeft: [-1, 'step'],
  ArrowDown: [-1, 'step'],
  PageUp: [1, 'page'],
  PageDown: [-1, 'page'],
  Home: [-1, 'end'],
  End: [1, 'end'],
}

/**
 * The value a key moves to, onto the step grid first as the fader's keys do: a step per arrow
 * (ten with Shift), `page` steps per Page key; undefined for a key it doesn't handle.
 */
export function keyValue(
  e: Pick<KeyboardEvent, 'key' | 'shiftKey'>,
  value: number,
  range: Omit<ScrubRange, 'pixelsPerStep'>,
  page = SHIFT_STEPS,
): number | undefined {
  const key = SLIDER_KEYS[e.key]
  if (!key) return undefined
  const [sign, size] = key
  if (size === 'end') return sign > 0 ? range.max : range.min
  const steps = size === 'page' ? page : e.shiftKey ? SHIFT_STEPS : 1
  return stepBy(value, sign * steps, range.step, range.min, range.max)
}
