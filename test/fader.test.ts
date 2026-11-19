import { describe, expect, it } from 'vitest'
import { fraction, LEDS, litFraction, snap, stepBy } from '../src/ui/fader'

describe('fader detent', () => {
  it('snaps a drag that lands within 0.04 of the detent', () => {
    expect(snap(0.98, 1)).toBe(1)
    expect(snap(1.03, 1)).toBe(1)
    expect(snap(0.96, 1)).toBe(0.96)
    expect(snap(1.05, 1)).toBe(1.05)
  })

  it('leaves the value alone without a detent', () => {
    expect(snap(0.98)).toBe(0.98)
  })
})

describe('fader keys', () => {
  it('steps on the key grid, landing exactly on unity', () => {
    expect(stepBy(0.95, 1, 0.05, 0, 1.5)).toBe(1)
    expect(stepBy(1, 1, 0.05, 0, 1.5)).toBe(1.05)
    expect(stepBy(1, -1, 0.05, 0, 1.5)).toBe(0.95)
  })

  it('moves an off-grid value onto the grid first', () => {
    expect(stepBy(0.98, 1, 0.05, 0, 1.5)).toBe(1)
    expect(stepBy(0.98, -1, 0.05, 0, 1.5)).toBe(0.95)
  })

  it('starts the grid at min', () => {
    expect(stepBy(0.02, 1, 0.05, 0.02, 1)).toBe(0.07)
    expect(stepBy(0.07, -1, 0.05, 0.02, 1)).toBe(0.02)
    expect(stepBy(0.5, 5, 0.05, 0, 1.5)).toBe(0.75)
  })

  it('stays within range', () => {
    expect(stepBy(1.5, 1, 0.05, 0, 1.5)).toBe(1.5)
    expect(stepBy(0, -1, 0.05, 0, 1.5)).toBe(0)
  })
})

describe('fader lights', () => {
  it('places the value between min and max', () => {
    expect(fraction(0.75, 0, 1.5)).toBe(0.5)
    expect(fraction(2, 0, 1.5)).toBe(1)
    expect(fraction(-1, 0, 1.5)).toBe(0)
  })

  it('lights whole LEDs, each from its middle', () => {
    expect(litFraction(0)).toBe(0)
    expect(litFraction(1)).toBe(1)
    expect(litFraction(0.5 / LEDS)).toBe(1 / LEDS)
    expect(litFraction(0.49 / LEDS)).toBe(0)
  })
})
