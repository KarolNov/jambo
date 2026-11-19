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
 * `value` on the step grid that starts at `min` (at 0 with no min), within range. Rounded, so
 * 0.1 + 0.2 is 0.3.
 */
export function onGrid(value: number, { min, max, step }: Omit<ScrubRange, 'pixelsPerStep'>) {
  const origin = Number.isFinite(min) ? min : 0
  const v = origin + Math.round((value - origin) / step) * step
  return Math.min(max, Math.max(min, Number(v.toFixed(6))))
}

/**
 * The value at pointer position `pos`: one step for each whole `pixelsPerStep` moved since the
 * anchor (part of a step doesn't count, either way), ten with Shift, within range. Past an end
 * the anchor moves to the pointer, so dragging back changes the value at once instead of first
 * winding back the overshoot.
 */
export function scrubMove(
  anchor: ScrubAnchor,
  pos: number,
  shift: boolean,
  range: ScrubRange,
): { value: number; anchor: ScrubAnchor } {
  const steps = Math.trunc((pos - anchor.at) / range.pixelsPerStep) * (shift ? SHIFT_STEPS : 1)
  const raw = anchor.base + steps * range.step
  const value = onGrid(raw, range)
  const over = raw < range.min || raw > range.max
  return { value, anchor: over ? { base: value, at: pos } : anchor }
}

/** How many steps each key moves a slider-like control; Home and End go to the ends. */
export const SLIDER_KEYS: Partial<Record<string, number>> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
  PageUp: SHIFT_STEPS,
  PageDown: -SHIFT_STEPS,
  Home: -Infinity,
  End: Infinity,
}

/**
 * The value a key moves to, onto the step grid first as the fader's keys do, with Shift for ten
 * steps; undefined for a key it doesn't handle.
 */
export function keyValue(
  e: Pick<KeyboardEvent, 'key' | 'shiftKey'>,
  value: number,
  range: Omit<ScrubRange, 'pixelsPerStep'>,
): number | undefined {
  const delta = SLIDER_KEYS[e.key]
  if (delta === undefined) return undefined
  if (!Number.isFinite(delta)) return delta > 0 ? range.max : range.min
  const steps = e.shiftKey && Math.abs(delta) === 1 ? delta * SHIFT_STEPS : delta
  return stepBy(value, steps, range.step, range.min, range.max)
}
