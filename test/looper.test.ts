import { describe, expect, it } from 'vitest'
import {
  barStart,
  finishTake,
  hitsInWindow,
  ceilNear,
  nextGridLine,
  nextJamBar,
  jamBeatMs,
  playBeat,
  repeatLine,
  repeatSlice,
  repeatStamp,
  swingDelay,
  trackStart,
} from '../shared/looper'

const h = (beat: number, padId = 'r0c0') => ({ padId, beat })

describe('finishTake', () => {
  it('keeps sound hits as sound hits, moved onto the first beat like pad hits', () => {
    expect(finishTake([{ soundId: 'u-abcdefgh2345', beat: -0.1 }, h(1)], 4)).toEqual({
      bars: 1,
      hits: [{ soundId: 'u-abcdefgh2345', beat: 0 }, h(1)],
    })
  })

  // @scenario audio/looper: Stop mid-bar
  it('rounds a take stopped mid-bar up to whole bars', () => {
    expect(finishTake([h(0)], 2.3 * 4)?.bars).toBe(3)
  })

  // @scenario audio/looper: Slightly late stop
  it('treats a stop just after a bar line as on it', () => {
    expect(finishTake([h(0)], 2.05 * 4)?.bars).toBe(2)
  })

  it('is at least one bar', () => {
    expect(finishTake([h(0.5)], 0.4)?.bars).toBe(1)
  })

  // @scenario audio/looper: Nothing played
  it('discards an empty take', () => {
    expect(finishTake([], 8)).toBeNull()
  })

  // @scenario audio/looper: Slightly early first hit
  it('keeps hits a hair early as the first beat and drops ones outside the loop', () => {
    expect(finishTake([h(-0.1), h(-1), h(3.9), h(4.2)], 4.1)?.hits).toEqual([h(0), h(3.9)])
  })
})

describe('playBeat', () => {
  // @scenario audio/looper: Slightly late hit
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

  // @scenario audio/looper: Not snapped
  it('plays a sound hit at its stored beat, unsnapped, while pad hits snap', () => {
    const t = {
      bars: 1,
      hits: [h(1.06), { soundId: 'u-abcdefgh2345', beat: 1.06 }],
      quantize: 0.25,
    }
    const [pad, clip] = hitsInWindow(t, 0, 120, 0, 2).sort((a, b) => a.beat - b.beat)
    expect(pad).toEqual({ padId: 'r0c0', time: 0.5, beat: 1 })
    expect(clip).toMatchObject({ soundId: 'u-abcdefgh2345', beat: 1.06 })
    expect(clip!.time).toBeCloseTo(0.53)
  })

  // @scenario audio/looper: Cut at the loop's end
  it("cuts a sound hit at its cycle's end", () => {
    const t = { bars: 1, hits: [{ soundId: 'clap', beat: 3 }], quantize: 0.25 }
    // 100 bpm: a bar is 2.4 s; the track starts at 10 s.
    expect(hitsInWindow(t, 10, 100, 10, 15)).toEqual([
      { soundId: 'clap', until: 12.4, time: 11.8, beat: 3 },
      { soundId: 'clap', until: 14.8, time: 14.2, beat: 3 },
    ])
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

  // @scenario audio/looper: Nothing looping
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

  // @scenario audio/looper: A track joins
  it('plays a track added mid-bar from its current point, on the shared bar grid', () => {
    // 120 BPM: a bar is 2 s. A two-bar loop has played since bar 3; a one-bar loop begun at bar 5
    // reaches this client at 11 s, halfway through bar 5.
    const two = { bars: 2, hits: [h(0)], quantize: 0.25, startBar: 3 }
    const one = { bars: 1, hits: [h(0), h(3)], quantize: 0.25, startBar: 5 }
    const at = (t: typeof two) =>
      hitsInWindow(t, trackStart(t, 120) / 1000, 120, 11, 18).map((x) => x.time)
    // It picks up at beat 3 of the bar it is in, without waiting for the next bar.
    expect(at(one)).toEqual([11.5, 12, 13.5, 14, 15.5, 16, 17.5])
    // Its downbeats fall twice for each of the two-bar loop's.
    expect(at(two)).toEqual([14])
    expect(at(one).filter((t) => (t - 10) % 2 === 0)).toEqual([12, 14, 16])
  })

  // @scenario audio/looper: Join a playing jam
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

describe('nextGridLine', () => {
  it("finds the jam's next 1/16, or the time itself on one", () => {
    // At 120 BPM a sixteenth is 125 ms.
    expect(nextGridLine(1000, 120)).toBe(1000)
    expect(nextGridLine(1001, 120)).toBe(1125)
    expect(nextGridLine(1124, 120)).toBe(1125)
  })

  it('takes other grids, and agrees at present-day room times', () => {
    expect(nextGridLine(1, 120, 1)).toBe(500)
    const line = 1_750_000_000_000
    expect(nextGridLine(line, 120)).toBe(line)
  })
})

describe('swingDelay', () => {
  // @scenario audio/master: Swung hats
  it('delays every off-beat 16th by half a 16th at swing 1, and by less below it', () => {
    expect([0, 0.25, 0.5, 0.75, 1, 1.25].map((b) => swingDelay(b, 1))).toEqual([
      0, 0.125, 0, 0.125, 0, 0.125,
    ])
    expect(swingDelay(0.75, 0.5)).toBe(0.0625)
    // At 120 BPM that is 62.5 ms.
    expect(jamBeatMs(swingDelay(0.25, 1), 120)).toBe(62.5)
  })

  // @scenario audio/master: Downbeats stay
  it('leaves beats, eighths, hits between 16ths, and everything at swing 0 where they are', () => {
    expect(swingDelay(1, 1)).toBe(0)
    expect(swingDelay(1.5, 1)).toBe(0)
    expect(swingDelay(0.3, 1)).toBe(0)
    expect(swingDelay(0.125, 1)).toBe(0)
    expect(swingDelay(0.25, 0)).toBe(0)
  })
})

describe('repeat grid', () => {
  it('picks a 1/4, 1/8, 1/16 or 1/32 slice in four equal zones of x', () => {
    expect([0, 0.24, 0.25, 0.5, 0.74, 0.75, 1].map(repeatSlice)).toEqual([
      1, 1, 0.5, 0.25, 0.25, 0.125, 0.125,
    ])
  })

  it("finds the slice's next grid line in jam beats, never finer than a 16th", () => {
    // 120 BPM: a beat is 500 ms. Room time 1250 ms is jam beat 2.5.
    expect(repeatLine(1250, 120, 1)).toBe(3)
    expect(repeatLine(1250, 120, 0.5)).toBe(2.5)
    expect(repeatLine(1300, 120, 0.125)).toBe(2.75)
    expect(repeatLine(1300, 120)).toBe(2.75)
    // A line counts as itself, even at room times since the epoch.
    const beat = 3_500_000_123.5
    expect(repeatLine(jamBeatMs(beat, 120), 120, 0.5)).toBe(beat)
  })

  it('stamps engaging, a new slice zone and letting go, but not a change of level', () => {
    const now = 1300 // jam beat 2.6 at 120 BPM
    expect(repeatStamp({ x: 0, y: 0 }, { x: 0.1, y: 1 }, now, 120)).toBe(3)
    expect(repeatStamp({ x: 0.1, y: 1 }, { x: 0.3, y: 1 }, now, 120)).toBe(3)
    expect(repeatStamp({ x: 0.1, y: 1 }, { x: 0.2, y: 0.5 }, now, 120)).toBeUndefined()
    expect(repeatStamp({ x: 0.1, y: 1 }, { x: 0.1, y: 0 }, now, 120)).toBe(2.75)
    expect(repeatStamp({ x: 0, y: 0 }, { x: 0.9, y: 0 }, now, 120)).toBeUndefined()
  })
})
