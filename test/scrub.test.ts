import { describe, expect, it } from 'vitest'
import { keyValue, onGrid, type ScrubRange, scrubMove } from '../src/ui/scrubSteps'

const tempo: ScrubRange = { min: 40, max: 240, step: 1, pixelsPerStep: 4 }
const level: ScrubRange = { min: 0, max: 1, step: 0.01, pixelsPerStep: 2 }

describe('scrub steps', () => {
  it('raises the value one step per few pixels to the right', () => {
    expect(scrubMove({ base: 100, at: 0 }, 40, false, tempo).value).toBe(110)
    expect(scrubMove({ base: 100, at: 0 }, -40, false, tempo).value).toBe(90)
  })

  it('counts only whole steps, either way', () => {
    expect(scrubMove({ base: 100, at: 0 }, 3, false, tempo).value).toBe(100)
    expect(scrubMove({ base: 100, at: 0 }, -3, false, tempo).value).toBe(100)
    expect(scrubMove({ base: 100, at: 0 }, 7, false, tempo).value).toBe(101)
  })

  it('moves ten steps at a time with Shift', () => {
    expect(scrubMove({ base: 100, at: 0 }, 8, true, tempo).value).toBe(120)
  })

  it('lands on the step grid without float noise', () => {
    expect(scrubMove({ base: 0.1, at: 0 }, 40, false, level).value).toBe(0.3)
    expect(scrubMove({ base: 0.5, at: 0 }, -2, false, level).value).toBe(0.49)
  })

  it('stays within range and moves the anchor at an end', () => {
    const past = scrubMove({ base: 230, at: 0 }, 400, false, tempo)
    expect(past.value).toBe(240)
    expect(past.anchor).toEqual({ base: 240, at: 400 })
    // Dragging back lowers it at once, without winding back the overshoot.
    expect(scrubMove(past.anchor, 396, false, tempo).value).toBe(239)
  })

  it('keeps the anchor while within range', () => {
    const anchor = { base: 100, at: 0 }
    expect(scrubMove(anchor, 40, false, tempo).anchor).toBe(anchor)
  })
})

describe('scrub grid', () => {
  it('rounds onto the grid from min, within range', () => {
    expect(onGrid(0.1 + 0.2, level)).toBe(0.3)
    expect(onGrid(41.4, tempo)).toBe(41)
    expect(onGrid(300, tempo)).toBe(240)
  })

  it('starts the grid at 0 without a min', () => {
    expect(onGrid(2.6, { min: -Infinity, max: Infinity, step: 1 })).toBe(3)
  })
})

describe('slider keys', () => {
  const key = (k: string, shiftKey = false) => ({ key: k, shiftKey })

  it('steps with the arrows, ten with Shift or Page keys', () => {
    expect(keyValue(key('ArrowUp'), 0.5, level)).toBe(0.51)
    expect(keyValue(key('ArrowLeft'), 0.5, level)).toBe(0.49)
    expect(keyValue(key('ArrowRight', true), 0.5, level)).toBe(0.6)
    expect(keyValue(key('PageDown'), 0.5, level)).toBe(0.4)
  })

  it('goes to the ends with Home and End, and stays within range', () => {
    expect(keyValue(key('Home'), 0.5, level)).toBe(0)
    expect(keyValue(key('End'), 0.5, level)).toBe(1)
    expect(keyValue(key('PageUp'), 0.95, level)).toBe(1)
  })

  it('ignores other keys', () => {
    expect(keyValue(key('a'), 0.5, level)).toBeUndefined()
  })
})
