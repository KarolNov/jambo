import { describe, expect, it } from 'vitest'
import {
  barStart,
  finishTake,
  hitsInWindow,
  ceilNear,
  nextJamBar,
  playBeat,
  trackStart,
} from '../shared/looper'

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

describe('jam grid', () => {
  // 120 bpm: a bar is 2000 ms of room time, bar 0 at the Unix epoch.
  it('numbers bars from the epoch', () => {
    expect(barStart(5, 120)).toBe(10_000)
  })

  it('finds the next bar, or the time itself on a bar line', () => {
    expect(nextJamBar(3000, 120)).toBe(2)
    expect(nextJamBar(4000, 120)).toBe(2)
    expect(nextJamBar(4001, 120)).toBe(3)
  })

  it('agrees at present-day room times', () => {
    const bar = 897_500_000
    expect(nextJamBar(barStart(bar, 120), 120)).toBe(bar)
    expect(nextJamBar(barStart(bar, 120) + 1, 120)).toBe(bar + 1)
  })

  it('keeps a bar line on its own bar at tempos whose bar is not a whole ms', () => {
    for (const bpm of [70, 97, 133])
      for (let bar = 750_000_000; bar < 750_000_500; bar++)
        expect(nextJamBar(barStart(bar, bpm), bpm)).toBe(bar)
  })

  it('rounds up, except within rounding error of a whole number', () => {
    expect(ceilNear(3.2)).toBe(4)
    expect(ceilNear(3_000_000_000 + 4.8e-7)).toBe(3_000_000_000)
  })

  it('starts a track on its take bar, or on bar 0 without one', () => {
    expect(trackStart({ startBar: 7 }, 120)).toBe(14_000)
    expect(trackStart({}, 120)).toBe(0)
  })

  it('puts two clients on the same downbeat for a track from any time they join', () => {
    const track = { bars: 2, hits: [h(0)], quantize: 0.25, startBar: 3 }
    const start = trackStart(track, 120) / 1000
    // Joining at 13.1 s and 17.9 s room time: both hear cycles on 6 + 4k seconds.
    const a = hitsInWindow(track, start, 120, 13.1, 23).map((x) => x.time)
    const b = hitsInWindow(track, start, 120, 17.9, 23).map((x) => x.time)
    expect(a).toEqual([14, 18, 22])
    expect(b).toEqual([18, 22])
  })
})
