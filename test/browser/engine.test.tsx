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
import { MasterChain, type MasterSound } from '../../src/audio/master'
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
  master,
}: {
  seconds: number
  bpm?: number
  sound?: string
  tracks?: Track[]
  metronome?: boolean
  master?: Partial<MasterSound>
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
    master: master && { tone: 0, drive: 0, width: 0, ...master },
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

/** How bright a stretch sounds: the energy of its sample-to-sample changes, which highs dominate. */
const brightness = (data: Float32Array) => {
  let sum = 0
  for (let i = 1; i < data.length; i++) sum += (data[i]! - data[i - 1]!) ** 2
  return sum
}

const rms = (data: Float32Array) =>
  Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / Math.max(1, data.length))

/**
 * `left` and `right` played through a lone master chain set to `sound`, rendered offline.
 */
async function throughChain(left: Float32Array, right: Float32Array, sound: MasterSound) {
  const ctx = new OfflineAudioContext(2, left.length, RATE)
  const input = ctx.createBuffer(2, left.length, RATE)
  input.copyToChannel(left as Float32Array<ArrayBuffer>, 0)
  input.copyToChannel(right as Float32Array<ArrayBuffer>, 1)
  const chain = new MasterChain(ctx, ctx.destination)
  chain.set(sound, true)
  const src = ctx.createBufferSource()
  src.buffer = input
  src.connect(chain.input)
  src.start()
  const out = await ctx.startRendering()
  return [out.getChannelData(0), out.getChannelData(1)] as const
}

const DEFAULTS: MasterSound = { tone: 0, drive: 0, width: 0 }

describe('master', () => {
  /** A quarter second of noise, different in each ear: loud, bright and wide. */
  const noise = (seed: number) => {
    const out = new Float32Array(RATE / 4)
    for (let i = 0; i < out.length; i++) {
      seed = (seed * 16807) % 2147483647
      out[i] = (seed / 2147483647) * 2 - 1
    }
    return out
  }

  it('passes the mix through unchanged at its defaults', async () => {
    const left = noise(3)
    const right = noise(11)
    const [outLeft, outRight] = await throughChain(left, right, DEFAULTS)
    for (let i = 0; i < left.length; i++) {
      expect(Math.abs(outLeft[i]! - left[i]!), `left ${i}`).toBeLessThan(1e-5)
      expect(Math.abs(outRight[i]! - right[i]!), `right ${i}`).toBeLessThan(1e-5)
    }
  })

  // @scenario audio/master: Older jam
  it('plays a jam without master settings as one at the defaults', async () => {
    const seconds = barMs(100) / 1000
    const tracks = [track({ pan: -0.5, reverb: 0.5 })]
    const without = await render(await offline({ seconds, tracks, sound: 'hat' }))
    const defaults = await render(await offline({ seconds, tracks, sound: 'hat', master: {} }))
    for (const ch of [0, 1]) expect(defaults[ch]).toEqual(without[ch])
  })

  // @scenario audio/master: Darken everything
  it('darkens every loop with master tone below 0, and thins them above it', async () => {
    const seconds = barMs(100) / 1000
    const tracks = [track(), track({ hits: [{ padId: PAD, beat: 2 }] })]
    const [flat] = await render(await offline({ seconds, tracks, sound: 'hat' }))
    const [dark] = await render(
      await offline({ seconds, tracks, sound: 'hat', master: { tone: -0.6 } }),
    )
    expect(brightness(dark)).toBeLessThan(brightness(flat) / 4)
    // Both loops still sound, darker.
    const beat = beatSeconds(100)
    expect(peak(dark, 0, 0.1)).toBeGreaterThan(0)
    expect(peak(dark, 2 * beat, 2 * beat + 0.1)).toBeGreaterThan(0)

    const kick = await render(await offline({ seconds, tracks, master: {} }))
    const thin = await render(await offline({ seconds, tracks, master: { tone: 0.8 } }))
    // A high-pass takes the kick's weight away.
    expect(rms(thin[0])).toBeLessThan(rms(kick[0]) / 2)
  })

  it('darkens pads played live too', async () => {
    const seconds = 0.5
    const live = async (tone: number) => {
      const audio = await offline({ seconds, sound: 'hat', master: { tone } })
      void audio.ctx.suspend(0.1).then(() => {
        audio.engine.hitPad(PAD)
        void audio.ctx.resume()
      })
      return await render(audio)
    }
    const [flat, flatRight] = await live(0)
    expect(peak(flat)).toBeGreaterThan(0.05)
    // A mono pad on its own still plays from both speakers.
    for (let i = 0; i < flat.length; i++)
      expect(Math.abs(flat[i]! - flatRight[i]!), `sample ${i}`).toBeLessThan(1e-5)
    expect(brightness((await live(-0.6))[0])).toBeLessThan(brightness(flat) / 4)
  })

  // @scenario audio/master: Clicks stay dry
  it('leaves the count-in and the metronome dry', async () => {
    const bar = barMs(100)
    const take: RecorderState = {
      phase: 'recording',
      countStart: 0,
      recordStart: bar,
      recordBar: 1,
    }
    const seconds = (2 * bar) / 1000
    const dry = await render(await offline({ seconds }), take)
    const wet = await render(
      await offline({ seconds, master: { tone: -1, drive: 1, width: -1 } }),
      take,
    )
    for (const ch of [0, 1]) expect(wet[ch]).toEqual(dry[ch])
  })

  // @scenario audio/master: Width to mono
  it('plays a loop panned hard left equally from both speakers at width -1', async () => {
    const seconds = barMs(100) / 1000
    const [left, right] = await render(
      await offline({ seconds, tracks: [track({ pan: -1 })], master: { width: -1 } }),
    )
    expect(peak(left)).toBeGreaterThan(0.05)
    for (let i = 0; i < left.length; i++)
      expect(Math.abs(left[i]! - right[i]!), `sample ${i}`).toBeLessThan(1e-5)
  })

  it('widens the mix above width 0, leaving its middle alone', async () => {
    const left = noise(3)
    const right = noise(11)
    const side = (l: Float32Array, r: Float32Array) => rms(l.map((x, i) => x - r[i]!))
    const mid = (l: Float32Array, r: Float32Array) => rms(l.map((x, i) => x + r[i]!))
    const [wideLeft, wideRight] = await throughChain(left, right, { ...DEFAULTS, width: 1 })
    expect(side(wideLeft, wideRight)).toBeCloseTo(2 * side(left, right), 2)
    expect(mid(wideLeft, wideRight)).toBeCloseTo(mid(left, right), 2)
  })

  it('saturates and evens the mix with drive', async () => {
    // A sine at 0.9: its peaks are √2 times its loudness. Drive rounds them off.
    const sine = new Float32Array(RATE / 2).map(
      (_, i) => 0.9 * Math.sin((2 * Math.PI * 220 * i) / RATE),
    )
    const crest = (data: Float32Array) => peak(data) / rms(data)
    const [clean] = await throughChain(sine, sine, DEFAULTS)
    expect(crest(clean)).toBeCloseTo(Math.SQRT2, 2)
    // After the compressor settles.
    const [driven] = await throughChain(sine, sine, { ...DEFAULTS, drive: 0.4 })
    const settled = driven.subarray(RATE / 4)
    expect(crest(settled)).toBeLessThan(1.3)
    // ...and leaves it about as loud, not quieter.
    expect(rms(settled)).toBeGreaterThan(rms(clean) * 0.7)
  })
})
