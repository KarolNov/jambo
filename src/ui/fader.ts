/** The mixer fader's math, kept apart from the component so it can be tested on its own. */

/** How close a drag must land to a detent to stick to it. */
export const DETENT_RANGE = 0.04

/** The number of lights in the fader's LED strip. */
export const LEDS = 24

/** `value` snapped to `detent` when it lands within {@link DETENT_RANGE} of it. */
export function snap(value: number, detent?: number): number {
  return detent !== undefined && Math.abs(value - detent) < DETENT_RANGE ? detent : value
}

/** Where `value` sits between `min` and `max`, from 0 to 1. */
export function fraction(value: number, min: number, max: number): number {
  return max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0
}

/** How much of the LED strip is lit for fraction `f`: whole lights only, a light on from its middle. */
export function litFraction(f: number): number {
  return Math.floor(f * LEDS + 0.5) / LEDS
}

/**
 * The value `delta` key presses move to: onto the keyStep grid first (0.98 up is 1, down 0.95),
 * then whole steps, so 0.95 + 0.05 is exactly 1. The grid starts at `min`, as the native input's
 * does (at 0 with no min). Kept within range.
 */
export function stepBy(
  value: number,
  delta: number,
  keyStep: number,
  min: number,
  max: number,
): number {
  const origin = Number.isFinite(min) ? min : 0
  const q = Math.round(((value - origin) / keyStep) * 1e6) / 1e6
  const next = origin + ((delta > 0 ? Math.floor(q) : Math.ceil(q)) + delta) * keyStep
  return Math.min(max, Math.max(min, Number(next.toFixed(6))))
}
