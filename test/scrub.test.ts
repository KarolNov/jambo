import { describe, expect, it } from 'vitest'
import { stepBy } from '../src/ui/fader'
import { keyValue, liveDrag, type ScrubRange, scrubMove } from '../src/ui/scrubSteps'

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
  it('leaves an off-grid value alone for less than a step', () => {
    expect(scrubMove({ base: 0.505, at: 0 }, 1, false, level).value).toBe(0.505)
  })

  it('steps evenly onto the grid from an off-grid value', () => {
    expect(scrubMove({ base: 0.505, at: 0 }, 2, false, level).value).toBe(0.51)
    expect(scrubMove({ base: 0.505, at: 0 }, -2, false, level).value).toBe(0.5)
  })

  it('starts the grid at 0 without a min', () => {
    expect(stepBy(2.6, 1, 1, -Infinity, Infinity)).toBe(3)
    expect(stepBy(2.6, -1, 1, -Infinity, Infinity)).toBe(2)
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

  it('moves a page of the given size', () => {
    expect(keyValue(key('PageUp'), 0.5, level, 5)).toBe(0.55)
  })

  it('ignores other keys', () => {
    expect(keyValue(key('a'), 0.5, level)).toBeUndefined()
  })
})

describe('a live drag', () => {
  /**
   * Frames that run only when `tick` is called, a log of what was applied, and the board: what
   * is applied lands there, and `peer` changes it as someone else would.
   */
  function setup(start: number) {
    const queued = new Map<number, () => void>()
    let next = 1
    const applied: number[] = []
    let board = start
    const drag = liveDrag(
      start,
      (v) => {
        applied.push(v)
        board = v
      },
      () => board,
      {
        request: (run) => (queued.set(next, run), next++),
        cancel: (id) => queued.delete(id),
      },
    )
    const tick = () => {
      const runs = [...queued.values()]
      queued.clear()
      for (const run of runs) run()
    }
    const peer = (v: number) => {
      board = v
    }
    return { drag, applied, tick, peer, board: () => board }
  }

  it('applies at most one value a frame, the latest', () => {
    const { drag, applied, tick } = setup(0)
    drag.move(0.1)
    drag.move(0.2)
    drag.move(0.3)
    expect(applied).toEqual([])
    tick()
    drag.move(0.4)
    tick()
    tick()
    expect(applied).toEqual([0.3, 0.4])
  })

  it('applies the last value on release if its frame had not come yet', () => {
    const { drag, applied, tick } = setup(0)
    drag.move(0.2)
    tick()
    drag.move(0.6)
    drag.end(true)
    tick()
    expect(applied).toEqual([0.2, 0.6])
  })

  it('applies nothing more on release when the last value already went', () => {
    const { drag, applied, tick } = setup(0)
    drag.move(0.6)
    tick()
    drag.end(true)
    expect(applied).toEqual([0.6])
  })

  it('puts the start value back when cancelled after applying', () => {
    const { drag, applied, tick } = setup(0.5)
    drag.move(0.7)
    tick()
    drag.move(0.8)
    drag.end(false)
    tick()
    expect(applied).toEqual([0.7, 0.5])
  })

  it('changes nothing when cancelled before anything was applied', () => {
    const { drag, applied, tick } = setup(0.5)
    drag.move(0.7)
    drag.end(false)
    tick()
    expect(applied).toEqual([])
  })

  it('applies nothing on release when it never moved', () => {
    const { drag, applied, peer } = setup(0.5)
    peer(0.9)
    drag.end(true)
    expect(applied).toEqual([])
  })

  it('applies the released value over a peer change', () => {
    const { drag, applied, tick, peer, board } = setup(0)
    drag.move(0.5)
    tick()
    peer(0.9)
    drag.end(true)
    expect(applied).toEqual([0.5, 0.5])
    expect(board()).toBe(0.5)
  })

  it('leaves a peer change in place when cancelled', () => {
    const { drag, applied, tick, peer, board } = setup(0.2)
    drag.move(0.5)
    tick()
    peer(0.9)
    drag.end(false)
    expect(applied).toEqual([0.5])
    expect(board()).toBe(0.9)
  })

  it('applies nothing more once dropped', () => {
    const { drag, applied, tick } = setup(0)
    drag.move(0.3)
    tick()
    drag.move(0.6)
    drag.drop()
    tick()
    expect(applied).toEqual([0.3])
  })
})
