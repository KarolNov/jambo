import { describe, expect, it } from 'vitest'
import {
  SAMPLE_WINDOW,
  audioShift,
  audioToRoom,
  bestSample,
  heardAt,
  nextOffset,
  roomToAudio,
  sampleFrom,
} from '../shared/clock'

describe('sampleFrom', () => {
  it('assumes the room answered halfway through the round trip', () => {
    // Sent at 1000, room said 5060, back at 1100: the room is 4010 ms ahead.
    expect(sampleFrom(1000, 5060, 1100)).toEqual({ offset: 4010, rtt: 100 })
  })
})

describe('bestSample', () => {
  it('picks the sample with the lowest round trip', () => {
    const samples = [
      { offset: 10, rtt: 80 },
      { offset: 12, rtt: 20 },
      { offset: 30, rtt: 60 },
    ]
    expect(bestSample(samples)).toEqual({ offset: 12, rtt: 20 })
  })

  it('only looks at the last few samples', () => {
    const old = { offset: 99, rtt: 1 }
    const recent = Array.from({ length: SAMPLE_WINDOW }, (_, i) => ({ offset: i, rtt: 50 + i }))
    expect(bestSample([old, ...recent])).toEqual({ offset: 0, rtt: 50 })
  })

  it('has nothing to pick from no samples', () => {
    expect(bestSample([])).toBeUndefined()
  })
})

describe('nextOffset', () => {
  it('takes the first estimate as is', () => {
    expect(nextOffset(undefined, 42)).toBe(42)
  })

  it('ignores changes under 5 ms and takes larger ones', () => {
    expect(nextOffset(100, 104.9)).toBe(100)
    expect(nextOffset(100, 95.1)).toBe(100)
    expect(nextOffset(100, 106)).toBe(106)
  })
})

describe('heardAt', () => {
  it('maps a scheduled audio time to when it is heard, on the performance clock', () => {
    const heard = { contextTime: 10, performanceTime: 5000 }
    expect(heardAt(10.25, heard)).toBe(5250)
    expect(heardAt(9.9, heard)).toBeCloseTo(4900)
  })
})

describe('room ↔ audio mapping', () => {
  // performance.timeOrigin is 1_000_000 ms; the room is 500 ms ahead of this client.
  // Audio sample 2.0 s leaves the speakers at performance.now() = 3000 ms,
  // which is client time 1_003_000 and room time 1_003_500.
  const shift = audioShift({ contextTime: 2, performanceTime: 3000 }, 500, 1_000_000)

  it('maps the room time a sample is heard at to that sample', () => {
    expect(roomToAudio(1_003_500, shift)).toBeCloseTo(2, 9)
    expect(roomToAudio(1_004_500, shift)).toBeCloseTo(3, 9)
  })

  it('round-trips', () => {
    expect(audioToRoom(roomToAudio(1_234_567, shift), shift)).toBeCloseTo(1_234_567, 3)
  })

  it('keeps millisecond precision at present-day room times', () => {
    const now = 1_795_000_000_000
    const s = audioShift({ contextTime: 12.5, performanceTime: 100 }, -3, now - 100)
    expect(roomToAudio(now - 3 + 20, s) - 12.5).toBeCloseTo(0.02, 6)
  })
})

describe('two clients on one jam clock', () => {
  /**
   * The offset a client settles on from pinging the room: each trip has its own uneven delays
   * there and back, as on a real network, and the client keeps the best sample of the window.
   */
  function measureOffset(trueOffset: number, legs: readonly [number, number][]) {
    let offset: number | undefined
    const samples = []
    let clientNow = 10_000
    for (const [up, down] of legs) {
      const serverTime = clientNow + up + trueOffset
      samples.push(sampleFrom(clientNow, serverTime, clientNow + up + down))
      offset = nextOffset(offset, bestSample(samples)!.offset)
      clientNow += 1000
    }
    return offset!
  }

  // @scenario audio/looper: Same downbeat
  it('hear the same downbeat within 20 ms, whatever their own clocks and networks', () => {
    const downbeat = 1_795_000_000_000 // a bar start, in room ms
    const clients = [
      {
        timeOrigin: 1_794_999_000_000,
        trueOffset: 1250,
        // A fast, steady connection.
        legs: [
          [12, 14],
          [11, 30],
          [10, 12],
          [25, 11],
          [13, 13],
        ] as [number, number][],
        ctx: 3.2,
        latency: 0.012,
      },
      {
        timeOrigin: 1_794_990_000_000,
        trueOffset: -830,
        // A phone on a jittery connection, slower one way than the other.
        legs: [
          [90, 40],
          [160, 70],
          [55, 35],
          [200, 120],
          [70, 45],
        ] as [number, number][],
        ctx: 91.7,
        latency: 0.04,
      },
    ]
    const heardInRoom = clients.map((c) => {
      const measured = measureOffset(c.trueOffset, c.legs)
      const performanceTime = 600_000 // performance.now() when the clocks were paired
      // The context time leaving the speakers at that moment, after output latency.
      const heard = { contextTime: c.ctx - c.latency, performanceTime }
      const shift = audioShift(heard, measured, c.timeOrigin)
      const at = heardAt(roomToAudio(downbeat, shift), heard)
      // When that is on the room's clock, through this client's true offset.
      return at + c.timeOrigin + c.trueOffset
    })
    expect(Math.abs(heardInRoom[0]! - heardInRoom[1]!)).toBeLessThan(20)
    for (const t of heardInRoom) expect(Math.abs(t - downbeat)).toBeLessThan(20)
  })
})
