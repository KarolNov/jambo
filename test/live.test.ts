import { describe, expect, it } from 'vitest'
import { roomToAudio } from '../shared/clock'
import {
  encodeFrame,
  fromBase64,
  LIVE,
  type LiveFrame,
  liveDelayMs,
  livePlayAt,
  liveStamp,
  parseFrame,
  parseRelayMessage,
  relayIn,
  relayOut,
  toBase64,
} from '../shared/live'
import { barMs } from '../shared/looper'
import { DECODE_MS, JitterBuffer, LEAD_MS } from '../src/audio/live/jitter'
import { LiveVoices, relaysFake, VOICE_IDLE_MS } from '../worker/live'

const frame = (seq: number, stamp: number, bpm = 100): LiveFrame => ({
  seq,
  stamp,
  bpm,
  payload: new Uint8Array([seq & 255, 1, 2, 3]),
})

describe('live frames', () => {
  it('round-trip through bytes', () => {
    const f = {
      seq: 70_000,
      stamp: 1_790_000_000_123.25,
      bpm: 128,
      payload: new Uint8Array([9, 8]),
    }
    expect(parseFrame(encodeFrame(f))).toEqual(f)
  })

  it('refuse bytes that are not a frame', () => {
    const bytes = encodeFrame(frame(1, 1000))
    expect(parseFrame(bytes.slice(0, 15))).toBeUndefined()
    const other = bytes.slice()
    other[0] = 2
    expect(parseFrame(other)).toBeUndefined()
    expect(parseFrame(encodeFrame({ ...frame(1, 1000), bpm: 300 }))).toBeUndefined()
    expect(
      parseFrame(encodeFrame({ ...frame(1, 1000), payload: new Uint8Array(LIVE.maxPayload + 1) })),
    ).toBeUndefined()
  })

  it('travel as base64 through the fake relay', () => {
    for (const n of [0, 1, 2, 3, 4, 95])
      expect(fromBase64(toBase64(new Uint8Array(n).map((_, i) => i * 37)))).toEqual(
        new Uint8Array(n).map((_, i) => i * 37),
      )
    expect(toBase64(new Uint8Array([104, 105]))).toBe('aGk=')
    expect(fromBase64('not base64!')).toBeUndefined()
    const sent = parseRelayMessage(relayOut(encodeFrame(frame(3, 5000))))!
    expect(sent.v).toBeUndefined()
    const relayed = parseRelayMessage(relayIn('misty', sent.f))!
    expect(relayed.v).toBe('misty')
    expect(parseFrame(fromBase64(relayed.f)!)).toEqual(frame(3, 5000))
    expect(parseRelayMessage('{"t":"ping","c":1}')).toBeUndefined()
    expect(parseRelayMessage(relayIn('x', 'A'.repeat(5000)))).toBeUndefined()
  })

  it('are relayed by local Workers only', () => {
    expect(relaysFake('http://localhost:5199/parties/board/x')).toBe(true)
    expect(relaysFake('http://127.0.0.1:8787/parties/board/x')).toBe(true)
    expect(relaysFake('https://jambo.example.com/parties/board/x')).toBe(false)
  })
})

describe('stamping', () => {
  // Room ms → audio s: audio = room / 1000 + shift.
  const shift = -1_790_000_000 + 12.5

  it('stamps a frame with the room time the singer heard as they sang it', () => {
    // Heard at room 1_790_000_002_000, sung against it; it reaches the context a round trip later.
    const heard = 1_790_000_002_000
    const roundTrip = 0.04
    const capturedAt = roomToAudio(heard, shift) + roundTrip
    expect(liveStamp(capturedAt, roundTrip, shift)).toBeCloseTo(heard, 6)
  })

  it('plays a frame one bar after its stamp, on the listener’s own shift', () => {
    const stamp = 1_790_000_002_000
    const listener = shift + 0.3
    expect(livePlayAt(stamp, 100, listener)).toBeCloseTo(roomToAudio(stamp + 2400, listener), 9)
    expect(liveDelayMs(100)).toBe(barMs(100))
    expect(liveDelayMs(240)).toBe(1000)
  })

  it('lands a note sung on beat 2 on beat 2 of the next bar', () => {
    const bpm = 100
    const beat = barMs(bpm) / 4
    const bar = 1_790_000_000_000 - (1_790_000_000_000 % barMs(bpm))
    const sungOn = bar + beat
    const singer = -1_790_000_000 + 3
    const roundTrip = 0.025
    const stamp = liveStamp(roomToAudio(sungOn, singer) + roundTrip, roundTrip, singer)
    const listener = -1_790_000_000 - 7
    const at = livePlayAt(stamp, bpm, listener)
    expect((at - listener) * 1000).toBeCloseTo(bar + barMs(bpm) + beat, 3)
  })
})

describe('jitter buffer', () => {
  const bar = liveDelayMs(100)
  const since = 10_000

  it('hands frames on in stamp order, shortly before they play', () => {
    const j = new JitterBuffer(since)
    const now = since + 100
    for (const s of [40, 0, 20, 60])
      expect(j.push(frame(s / 20, since + s), now, 100)).toBe('queued')
    expect(j.due(now, 100)).toEqual([])
    const due = j.due(since + bar - LEAD_MS + 40, 100)
    expect(due.map((f) => f.stamp - since)).toEqual([0, 20, 40])
    expect(j.size).toBe(1)
  })

  it('drops a frame more than a bar old when it arrives', () => {
    const j = new JitterBuffer(since)
    const stamp = since + 500
    expect(j.push(frame(1, stamp), stamp + bar - DECODE_MS + 1, 100)).toBe('late')
    expect(j.push(frame(2, stamp + 20), stamp + bar - 100, 100)).toBe('queued')
    expect(j.dropped).toBe(1)
  })

  it('drops frames sung before listening began', () => {
    const j = new JitterBuffer(since)
    expect(j.push(frame(1, since - 20), since, 100)).toBe('before')
  })

  it('drops frames sung at another tempo', () => {
    const j = new JitterBuffer(since)
    expect(j.push(frame(1, since + 20, 120), since + 30, 100)).toBe('tempo')
    expect(j.push(frame(2, since + 40), since + 50, 100)).toBe('queued')
    // The tempo changed while it waited.
    expect(j.due(since + 40 + barMs(120) - LEAD_MS, 120)).toEqual([])
    expect(j.dropped).toBe(2)
  })

  it('drops a frame that arrives after a later one has been handed on', () => {
    const j = new JitterBuffer(since)
    j.push(frame(2, since + 40), since + 50, 100)
    expect(j.due(since + 40 + bar - LEAD_MS, 100)).toHaveLength(1)
    expect(j.push(frame(1, since + 20), since + 60, 100)).toBe('late')
  })

  it('ignores a frame that arrives twice', () => {
    const j = new JitterBuffer(since)
    expect(j.push(frame(1, since + 20), since + 30, 100)).toBe('queued')
    expect(j.push(frame(1, since + 20), since + 31, 100)).toBe('duplicate')
    expect(j.size).toBe(1)
  })

  it('drops frames whose time passed while they waited', () => {
    const j = new JitterBuffer(since)
    j.push(frame(1, since + 20), since + 30, 100)
    j.push(frame(2, since + 40), since + 30, 100)
    // Nothing drained for a while (a stalled tab): the first is too late, the second still on time.
    const due = j.due(since + 20 + bar, 100)
    expect(due.map((f) => f.seq)).toEqual([2])
    expect(j.dropped).toBe(1)
  })
})

describe("the room's live voices", () => {
  it('admits at most LIVE.maxVoices at once, and another once one stops', () => {
    const v = new LiveVoices()
    for (const id of ['a', 'b', 'c']) expect(v.admit(id, 0)).toBe(true)
    expect(v.admit('d', 10)).toBe(false)
    expect(v.admit('a', 20)).toBe(true)
    // b and c go quiet; a keeps singing.
    expect(v.admit('a', VOICE_IDLE_MS)).toBe(true)
    expect(v.admit('d', VOICE_IDLE_MS + 21)).toBe(true)
  })

  it('stops a voice after LIVE.maxMs, until it has been quiet and starts again', () => {
    const v = new LiveVoices()
    let t = 0
    for (; t <= LIVE.maxMs; t += 1_000) expect(v.admit('a', t)).toBe(true)
    expect(v.admit('a', t)).toBe(false)
    expect(v.admit('a', t + VOICE_IDLE_MS + 1)).toBe(true)
  })
})
