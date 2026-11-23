/**
 * The engine's sound, rendered offline: each test builds an Engine on an OfflineAudioContext,
 * schedules a stretch of the jam with `scheduleWindow` (and live hits with `hitPad`), renders it,
 * and reads the channels.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../../shared/board'
import { barMs, beatSeconds } from '../../shared/looper'
import { JamClock } from '../../src/audio/clock'
import { Engine, type RecorderState } from '../../src/audio/engine'
import { SampleLoader } from '../../src/audio/samples'
import { agree, emit, mockServer, offlineProvider, SLUG } from './jam'

const RATE = 48_000
const PAD = 'r0c0'
/** Room ms map straight onto the render's timeline. */
const SHIFT = 0
const IDLE: RecorderState = { phase: 'idle' }

const engines: Engine[] = []

beforeEach(() => {
  mockServer()
})

afterEach(() => {
  for (const e of engines.splice(0)) e.dispose()
  vi.unstubAllGlobals()
})

const track = (over: Partial<Track> = {}): Track => ({
  name: 'Misty Yak 1',
  author: 'me-id',
  color: 'sky',
  bars: 1,
  hits: [{ padId: PAD, beat: 0 }],
  startBar: 0,
  gain: 1,
  mute: false,
  quantize: 0,
  effects: [],
  ...over,
})

/**
 * A started engine on a stereo OfflineAudioContext `seconds` long, at `bpm`, with `PAD` on
 * `sound` and `tracks` looping.
 */
async function offline({
  seconds,
  bpm = 100,
  sound = 'kick',
  tracks = [],
  metronome = true,
}: {
  seconds: number
  bpm?: number
  sound?: string
  tracks?: Track[]
  metronome?: boolean
}) {
  const ctx = new OfflineAudioContext(2, Math.ceil(RATE * seconds), RATE)
  const engine = new Engine(new JamClock(offlineProvider()), new SampleLoader(SLUG), () => ctx)
  engines.push(engine)
  engine.metronome = metronome
  engine.update({
    bpm,
    pads: new Map([[PAD, sound]]),
    tracks: new Map(tracks.map((t, i) => [`t${i}`, t])),
    uploads: new Set(),
  })
  await engine.unlock()
  expect(engine.ready).toBe(true)
  return { ctx, engine }
}

/** Schedules room window [0, seconds) for `recorder` and renders it. */
async function render(
  { ctx, engine }: { ctx: OfflineAudioContext; engine: Engine },
  recorder: RecorderState = IDLE,
) {
  engine.scheduleWindow(0, (ctx.length / RATE) * 1000, SHIFT, recorder)
  const out = await ctx.startRendering()
  return [out.getChannelData(0), out.getChannelData(1)] as const
}

const slice = (data: Float32Array, from: number, to: number) =>
  data.subarray(Math.round(from * RATE), Math.round(to * RATE))

/** The loudest sample between `from` and `to` seconds. */
const peak = (data: Float32Array, from = 0, to = data.length / RATE) =>
  slice(data, from, to).reduce((m, x) => Math.max(m, Math.abs(x)), 0)

/** Seconds of the first sample louder than `threshold` at or after `from`, or undefined. */
const onset = (data: Float32Array, from: number, threshold = 0.01) => {
  const start = Math.round(from * RATE)
  for (let i = start; i < data.length; i++) if (Math.abs(data[i]!) > threshold) return i / RATE
  return undefined
}

describe('pan', () => {
  // @scenario audio/looper: Hard left
  it('plays a track panned to -1 only from the left channel', async () => {
    const bar = barMs(100) / 1000
    const [left, right] = await render(
      await offline({ seconds: bar, tracks: [track({ pan: -1 })] }),
    )
    expect(peak(left)).toBeGreaterThan(0.1)
    expect(peak(right)).toBeLessThan(1e-4)

    // The same track at centre reaches both channels, so silence on the right is the pan's doing.
    const [, centreRight] = await render(await offline({ seconds: bar, tracks: [track()] }))
    expect(peak(centreRight)).toBeGreaterThan(0.1)
  })
})

describe('reverb', () => {
  // @scenario audio/looper: Live pads stay dry
  it("plays a live snare dry while the track's snare keeps its reverb tail", async () => {
    // At 60 BPM a bar is 4 s: the track's snare at 0 s has rung out (2.5 s of room) by the live one at 4 s.
    const bpm = 60
    const live = 4
    const audio = await offline({
      seconds: 6,
      bpm,
      sound: 'snare',
      // Two bars, so the loop doesn't come round again inside the render.
      tracks: [track({ bars: 2, reverb: 1 })],
    })
    void audio.ctx.suspend(live).then(() => {
      audio.engine.hitPad(PAD)
      void audio.ctx.resume()
    })
    const [left, right] = await render(audio)

    for (const channel of [left, right]) {
      // Both snares sound; the dry snare is 0.3 s long.
      expect(peak(channel, 0, 0.3)).toBeGreaterThan(0.1)
      expect(peak(channel, live, live + 0.3)).toBeGreaterThan(0.1)
      // The track's hit rings on in the room after the dry sound ends...
      expect(peak(channel, 0.5, 1.5)).toBeGreaterThan(0.01)
      // ...and the live hit stops with it.
      expect(peak(channel, live + 0.5, live + 1.5)).toBeLessThan(1e-4)
    }
  })
})

describe('metronome', () => {
  const bpm = 100
  const bar = barMs(bpm)
  const beat = beatSeconds(bpm)
  /** A take whose count-in is the render's first bar and which records from the second. */
  const take: RecorderState = {
    phase: 'recording',
    countStart: 0,
    recordStart: bar,
    recordBar: 1,
  }
  // A kick every beat for two bars.
  const loop = track({ hits: [0, 1, 2, 3].map((b) => ({ padId: PAD, beat: b })) })

  // @scenario audio/looper: Loops without clicks
  it('adds no click to playing loops while nobody here is recording', async () => {
    const seconds = (2 * bar) / 1000
    const idle = await render(await offline({ seconds, tracks: [loop], metronome: true }))
    // No metronome at all: what the loops alone sound like.
    const loopsOnly = await render(await offline({ seconds, tracks: [loop], metronome: false }))
    for (const ch of [0, 1]) expect(idle[ch]).toEqual(loopsOnly[ch])

    // While recording the same metronome is heard over the same loops, so a click would show.
    const recording = await render(await offline({ seconds, tracks: [loop] }), take)
    expect(recording[0]).not.toEqual(loopsOnly[0])
  })

  // @scenario audio/looper: Metronome off
  it('clicks only through the count-in when the metronome is off', async () => {
    const seconds = (2 * bar) / 1000
    const [off] = await render(await offline({ seconds, metronome: false }), take)

    // The count-in bar clicks on each of its four beats...
    for (let n = 0; n < 4; n++) {
      const at = onset(off, n * beat)
      expect(at, `beat ${n}`).toBeDefined()
      expect(Math.abs(at! - n * beat), `beat ${n}`).toBeLessThan(0.002)
    }
    // ...and the take after it is silent.
    expect(peak(off, bar / 1000)).toBeLessThan(1e-4)

    // With the metronome on, the same take clicks on through its first bar.
    const [on] = await render(await offline({ seconds }), take)
    for (let n = 4; n < 8; n++) {
      const at = onset(on, n * beat)
      expect(Math.abs(at! - n * beat), `beat ${n}`).toBeLessThan(0.002)
    }
  })
})

describe('mute', () => {
  // @scenario audio/looper: Mute silences the tail's source
  it('adds no new echoes once muted, and lets the echoes already sounding fade out', async () => {
    const bpm = 100
    const bar = barMs(bpm) / 1000
    const seconds = 2 * bar
    const muteAt = 1
    const echoing = track({ echo: 1 })
    const playing = await render(
      await offline({ seconds, bpm, tracks: [echoing], metronome: false }),
    )

    const audio = await offline({ seconds, bpm, tracks: [echoing], metronome: false })
    const muting = audio.ctx.suspend(muteAt).then(() => {
      try {
        audio.engine.update({
          bpm,
          pads: new Map([[PAD, 'kick']]),
          tracks: new Map([['t0', { ...echoing, mute: true }]]),
          uploads: new Set(),
        })
      } finally {
        void audio.ctx.resume()
      }
    })
    const [muted] = await Promise.all([render(audio), muting])

    for (const ch of [0, 1]) {
      // Until the mute, the same sound.
      expect(peak(muted[ch]!, 0, muteAt)).toBeCloseTo(peak(playing[ch]!, 0, muteAt), 3)
      // The echoes in flight ring on after it...
      const tail = peak(muted[ch]!, muteAt + 0.05, bar)
      expect(tail).toBeGreaterThan(0.005)
      // ...the loop's next hit, and the echoes it would start, never come...
      expect(peak(muted[ch]!, bar, bar + 0.3)).toBeLessThan(peak(playing[ch]!, bar, bar + 0.3) / 4)
      // ...and what is left fades.
      expect(peak(muted[ch]!, seconds - 0.5, seconds)).toBeLessThan(tail)
    }
  })
})

describe('jam clock', () => {
  // @scenario audio/looper: Offline
  it('keeps the agreed clock, and so the downbeat, when the connection drops', async () => {
    const provider = offlineProvider()
    const clock = new JamClock(provider)
    try {
      const engine = new Engine(clock, new SampleLoader(SLUG))
      engines.push(engine)
      agree(provider)
      expect(engine.synced).toBe(true)
      const offset = clock.offset

      // Dropped, then back: the clock keeps its offset until the room answers a new ping.
      emit(provider, 'status', { status: 'disconnected' })
      expect(engine.synced).toBe(true)
      expect(clock.offset).toBe(offset)
      emit(provider, 'status', { status: 'connected' })
      await new Promise((r) => setTimeout(r, 50))
      expect(engine.synced).toBe(true)
      expect(clock.offset).toBe(offset)
      // Room time still runs on the same offset, so the next bar line lands where it did.
      const client = performance.timeOrigin + performance.now()
      expect(clock.now()! - client).toBeCloseTo(offset!, 0)
    } finally {
      clock.dispose()
    }
  })
})
