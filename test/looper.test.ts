import { describe, expect, it } from 'vitest'
import { finishTake, hitsInWindow, nextBar, playBeat } from '../shared/looper'

const h = (beat: number, padId = 'r0c0') => ({ padId, beat })

describe('finishTake', () => {
  it('rounds a take stopped mid-bar up to whole bars', () => {
    expect(finishTake([h(0)], 2.3 * 4)?.bars).toBe(3)
  })

  it('treats a stop just after a bar line as on it', () => {
    expect(finishTake([h(0)], 2.05 * 4)?.bars).toBe(2)
  })

  it('is at least one bar', () => {
    expect(finishTake([h(0.5)], 0.4)?.bars).toBe(1)
  })

  it('discards an empty take', () => {
    expect(finishTake([], 8)).toBeNull()
  })

  it('keeps hits a hair early as the first beat and drops ones outside the loop', () => {
    expect(finishTake([h(-0.1), h(-1), h(3.9), h(4.2)], 4.1)?.hits).toEqual([h(0), h(3.9)])
  })
})

describe('playBeat', () => {
  it('snaps a slightly late hit to the sixteenth grid', () => {
    expect(playBeat(1.06, 0.25, 4)).toBe(1)
  })

  it('leaves hits alone with quantize off', () => {
    expect(playBeat(1.06, 0, 4)).toBe(1.06)
  })

  it('wraps a hit snapped onto the loop end to its start', () => {
    expect(playBeat(3.95, 0.25, 4)).toBe(0)
  })
})

describe('hitsInWindow', () => {
  const track = { bars: 1, hits: [h(0), h(2)], quantize: 0.25 }
  // 120 bpm: a beat is 0.5s, a bar 2s.

  it('loops the hits cycle after cycle', () => {
    expect(hitsInWindow(track, 10, 120, 10, 14).map((x) => x.time)).toEqual([10, 11, 12, 13])
  })

  it('sounds nothing before the track starts', () => {
    expect(hitsInWindow(track, 10, 120, 0, 10)).toEqual([])
  })

  it('splits cleanly across windows', () => {
    const a = hitsInWindow(track, 10, 120, 10, 11)
    const b = hitsInWindow(track, 10, 120, 11, 12)
    expect([...a, ...b].map((x) => x.time)).toEqual([10, 11])
  })

  it('plays a one-bar track twice per loop of a two-bar track', () => {
    const two = { bars: 2, hits: [h(0)], quantize: 0.25 }
    const one = { bars: 1, hits: [h(0)], quantize: 0.25 }
    expect(hitsInWindow(two, 0, 120, 0, 4)).toHaveLength(1)
    expect(hitsInWindow(one, 0, 120, 0, 4)).toHaveLength(2)
  })
})

describe('nextBar', () => {
  it('finds the next bar line, or the time itself on a line', () => {
    expect(nextBar(1, 120, 2.5)).toBe(3)
    expect(nextBar(1, 120, 3)).toBe(3)
  })
})
