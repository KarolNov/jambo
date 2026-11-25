/**
 * The engine's sound, rendered offline: each test builds an Engine on an OfflineAudioContext,
 * schedules a stretch of the jam with `scheduleWindow` (and live hits with `hitPad`), renders it,
 * and reads the channels.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Master, Track } from '../../shared/board'
import { barMs, beatSeconds, repeatStamp } from '../../shared/looper'
import { JamClock } from '../../src/audio/clock'
import { FILTER_PEAK_MAX, filterSweep } from '../../src/audio/knobs'
import { Engine, type RecorderState } from '../../src/audio/engine'
import { MASTER_SOUND_DEFAULTS, MasterChain, type MasterSound } from '../../src/audio/master'
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
    master: master && { ...MASTER_SOUND_DEFAULTS, ...master },
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
async function throughChain(
  left: Float32Array,
  right: Float32Array,
  sound: MasterSound,
  /** Changes made while it renders: at each time (seconds), what to do to the chain. */
  changes: [number, (chain: MasterChain) => void][] = [],
) {
  const ctx = new OfflineAudioContext(2, left.length, RATE)
  const input = ctx.createBuffer(2, left.length, RATE)
  input.copyToChannel(left as Float32Array<ArrayBuffer>, 0)
  input.copyToChannel(right as Float32Array<ArrayBuffer>, 1)
  const chain = await MasterChain.create(ctx, ctx.destination)
  chain.set(sound, true)
  for (const [at, change] of changes)
    void ctx.suspend(at).then(() => {
      change(chain)
      void ctx.resume()
    })
  const src = ctx.createBufferSource()
  src.buffer = input
  src.connect(chain.input)
  src.start()
  const out = await ctx.startRendering()
  return [out.getChannelData(0), out.getChannelData(1)] as const
}

const DEFAULTS = MASTER_SOUND_DEFAULTS

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
  /** A quarter second of a sine at `hz`. */
  const sine = (hz: number, level = 0.5) =>
    new Float32Array(RATE / 4).map((_, i) => level * Math.sin((2 * Math.PI * hz * i) / RATE))
  /** The loudest sample after the first tenth, once a filter has settled. */
  const steadyPeak = (data: Float32Array) =>
    data.subarray(data.length / 10).reduce((m, v) => Math.max(m, Math.abs(v)), 0)

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
      await offline({
        seconds,
        master: {
          tone: -1,
          drive: 1,
          width: -1,
          filter: { x: -1, y: 1 },
          throw: { x: 0.5, y: 1 },
          lofi: { x: 1, y: 1 },
        },
      }),
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

  it('passes the mix through unchanged with the filter open, whatever its resonance', async () => {
    const left = noise(3)
    const right = noise(11)
    const [outLeft, outRight] = await throughChain(left, right, {
      ...DEFAULTS,
      filter: { x: 0, y: 1 },
    })
    for (let i = 0; i < left.length; i++) {
      expect(Math.abs(outLeft[i]! - left[i]!), `left ${i}`).toBeLessThan(1e-5)
      expect(Math.abs(outRight[i]! - right[i]!), `right ${i}`).toBeLessThan(1e-5)
    }
  })

  // @scenario audio/master: Sweep down
  it('darkens the whole mix steadily as the filter goes from x 0 to x -1', async () => {
    const seconds = barMs(100) / 1000
    const tracks = [track(), track({ hits: [{ padId: PAD, beat: 2 }] })]
    const at = async (x: number) =>
      brightness(
        (
          await render(
            await offline({ seconds, tracks, sound: 'hat', master: { filter: { x, y: 0 } } }),
          )
        )[0],
      )
    const sweep = [await at(0), await at(-0.33), await at(-0.66), await at(-1)]
    for (let i = 1; i < sweep.length; i++) expect(sweep[i]).toBeLessThan(sweep[i - 1]!)
    expect(sweep[3]).toBeLessThan(sweep[0]! / 4)
  })

  it('thins the mix with the filter above x 0, and rings with resonance', async () => {
    const left = noise(3)
    const right = noise(11)
    const [open] = await throughChain(left, right, DEFAULTS)
    const [thin] = await throughChain(left, right, { ...DEFAULTS, filter: { x: 0.6, y: 0 } })
    // Brightness for its loudness: a high-pass leaves less, and what it leaves is higher.
    const tilt = (data: Float32Array) => brightness(data) / (rms(data) ** 2 * data.length)
    expect(rms(thin)).toBeLessThan(rms(open))
    expect(tilt(thin)).toBeGreaterThan(tilt(open))
    // Strong resonance stacks energy at the cutoff: a tone there stands out over one below it.
    const cutoff = filterSweep(-0.5, 1, RATE / 2).frequency
    const stands = async (y: number) => {
      const filter = { x: -0.5, y }
      const [at] = await throughChain(sine(cutoff), sine(cutoff), { ...DEFAULTS, filter })
      const [below] = await throughChain(sine(cutoff / 4), sine(cutoff / 4), {
        ...DEFAULTS,
        filter,
      })
      return steadyPeak(at) / steadyPeak(below)
    }
    expect(await stands(1)).toBeGreaterThan((await stands(0)) * 3)
  })

  it("keeps a loud mix's peaks within 6 dB at full resonance", async () => {
    // A loud tone right at the cutoff, where resonance lifts it most.
    for (const x of [-0.9, -0.5, 0.5]) {
      const cutoff = filterSweep(x, 1, RATE / 2).frequency
      const [l, r] = await throughChain(sine(cutoff, 0.45), sine(cutoff, 0.45), {
        ...DEFAULTS,
        filter: { x, y: 1 },
      })
      expect(steadyPeak(l), `x ${x}`).toBeLessThan(0.45 * FILTER_PEAK_MAX * 1.05)
      expect(steadyPeak(r), `x ${x}`).toBeLessThan(1)
    }
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

describe('throw', () => {
  /** A click at each of `times` (seconds), in both ears, in a buffer `seconds` long. */
  const clicks = (seconds: number, ...times: number[]) => {
    const out = new Float32Array(Math.round(RATE * seconds))
    for (const t of times) out[Math.round(t * RATE)] = 1
    return out
  }

  // @scenario audio/master: Throw a quarter note
  it('repeats the mix every quarter note at x 0.9, fading slowly', async () => {
    const input = clicks(2.2, 0)
    // The time at 120 BPM, as the engine sets it.
    const quarter = beatSeconds(120)
    const [out] = await throughChain(input, input, { ...DEFAULTS, throw: { x: 0.9, y: 0.8 } }, [
      [0, (c) => c.throwTime(quarter)],
    ])
    const repeats = [1, 2, 3, 4].map((n) => peak(out, n * quarter - 0.005, n * quarter + 0.005))
    // Nothing between the repeats.
    expect(peak(out, 0.01, quarter - 0.01)).toBeLessThan(1e-4)
    expect(repeats[0]).toBeGreaterThan(0.5)
    for (let n = 1; n < repeats.length; n++) {
      expect(repeats[n]).toBeLessThan(repeats[n - 1]!)
      // Slowly: each repeat keeps most of the one before it.
      expect(repeats[n]! / repeats[n - 1]!).toBeGreaterThan(0.6)
    }
  })

  it('picks an eighth, a dotted eighth or a quarter note by thirds of x, on the tempo', async () => {
    const bpm = 120
    for (const [x, beats] of [
      [0.1, 0.5],
      [0.5, 0.75],
      [0.9, 1],
    ] as const) {
      const audio = await offline({
        seconds: 1.5,
        bpm,
        tracks: [track()],
        metronome: false,
        master: { throw: { x, y: 1 } },
      })
      const [left] = await render(audio)
      const echo = beats * beatSeconds(bpm)
      // The kick is still ringing at the first echo; the echo makes it louder there than without.
      const [plain] = await render(
        await offline({ seconds: 1.5, bpm, tracks: [track()], metronome: false }),
      )
      expect(peak(left, echo, echo + 0.01), `x ${x}`).toBeGreaterThan(
        peak(plain, echo, echo + 0.01) + 0.1,
      )
    }
  })

  // @scenario audio/master: Tail after reset
  it('sends nothing new into the echo after a reset, and lets the tail ring out', async () => {
    const quarter = beatSeconds(120)
    // A click before the reset, and one after it whose echoes would land between the first's.
    const input = clicks(3, 0, 1.25)
    const [out] = await throughChain(input, input, { ...DEFAULTS, throw: { x: 0.9, y: 0.8 } }, [
      [0, (c) => c.throwTime(quarter)],
      [0.75, (c) => c.set({ ...DEFAULTS, throw: { x: 0, y: 0 } })],
    ])
    // The first click's tail keeps ringing past the reset...
    expect(peak(out, 1.5 - 0.005, 1.5 + 0.005)).toBeGreaterThan(0.2)
    expect(peak(out, 2 - 0.005, 2 + 0.005)).toBeGreaterThan(0.1)
    // ...while the second click plays dry and doesn't echo.
    expect(peak(out, 1.25 - 0.001, 1.25 + 0.001)).toBeCloseTo(1, 1)
    expect(peak(out, 1.75 - 0.005, 1.75 + 0.005)).toBeLessThan(1e-3)
  })

  // @scenario audio/master: Heard together
  it("moves the echo's time only at the jam's next 1/16", async () => {
    const bpm = 120
    const audio = await offline({
      seconds: 0.5,
      bpm,
      metronome: false,
      master: { throw: { x: 0.1, y: 1 } },
    })
    const { ctx, engine } = audio
    // The room's grid maps straight onto the render's timeline.
    engine['shift'] = SHIFT
    // The echo's time: its looped delay and the fixed one ahead of it.
    const time = () => {
      const chain = engine['chain']!
      return chain['throwDelay'].delayTime.value + chain['throwLatency']
    }
    const eighth = 0.5 * beatSeconds(bpm)
    const sixteenth = 0.25 * beatSeconds(bpm)
    const seen: Record<string, number> = {}
    const at = (t: number, read: () => void) =>
      void ctx.suspend(t).then(() => {
        read()
        void ctx.resume()
      })
    at(0.1, () => {
      seen.before = time()
      engine.update({
        bpm,
        pads: new Map(),
        tracks: new Map(),
        uploads: new Set(),
        master: { ...MASTER_SOUND_DEFAULTS, throw: { x: 0.9, y: 1 } },
      })
    })
    at(sixteenth - 0.005, () => (seen.justBefore = time()))
    at(sixteenth + 0.05, () => (seen.after = time()))
    await render(audio)
    expect(seen.before).toBeCloseTo(eighth)
    expect(seen.justBefore).toBeCloseTo(eighth)
    expect(seen.after).toBeCloseTo(2 * eighth, 3)
  })
})

describe('lofi', () => {
  const sine = new Float32Array(RATE / 4).map(
    (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / RATE),
  )

  it('passes the mix through unchanged at 0/0', async () => {
    const [out] = await throughChain(sine, sine, { ...DEFAULTS, lofi: { x: 0, y: 0 } })
    for (let i = 0; i < sine.length; i++)
      expect(Math.abs(out[i]! - sine[i]!), `${i}`).toBeLessThan(1e-6)
  })

  it('holds samples for a lower rate as x rises', async () => {
    const [out] = await throughChain(sine, sine, { ...DEFAULTS, lofi: { x: 1, y: 0 } })
    // At 4 kHz each sample is held for 12 of the context's: most neighbours are equal.
    let same = 0
    for (let i = 1; i < out.length; i++) if (out[i] === out[i - 1]) same++
    expect(same / out.length).toBeGreaterThan(0.85)
  })

  // @scenario audio/master: Crunch
  it('rounds samples to fewer levels as y rises', async () => {
    const levels = (data: Float32Array) => new Set(data).size
    const [clean] = await throughChain(sine, sine, DEFAULTS)
    const [crushed] = await throughChain(sine, sine, { ...DEFAULTS, lofi: { x: 0, y: 1 } })
    // 4 bits: 8 levels each side of 0, and the sine reaches half of them.
    expect(levels(crushed)).toBeLessThanOrEqual(10)
    expect(levels(clean)).toBeGreaterThan(100)
  })
})

describe('swing and repeat', () => {
  const BPM_120 = 120
  const BEAT_MS = beatSeconds(BPM_120) * 1000
  /** Pads `b0`..`b3`, one per beat of a one-bar loop, so a hit's pad says which beat it came from. */
  const BEAT_PADS = ['b0', 'b1', 'b2', 'b3']
  const perBeat = (startBar: number) =>
    track({ startBar, hits: BEAT_PADS.map((padId, beat) => ({ padId, beat })) })
  const OFF = { x: 0, y: 0, startBeat: 0 }

  /**
   * A started engine at 120 BPM whose loop hits are recorded rather than judged by ear: each as
   * its jam beat (room time over a beat, so engines on different shifts compare), pad and level.
   * Hits taken back by a repeat change are dropped. `shift` maps room ms onto its timeline.
   */
  async function recorded(
    tracks: Track[],
    shift: number,
    swing = 0,
    sound = 'kick',
    bpm = BPM_120,
  ) {
    const beatMs = beatSeconds(bpm) * 1000
    const { engine } = await offline({ seconds: 1, bpm, metronome: false })
    const hits: { beat: number; padId: string; level: number; stopped: boolean }[] = []
    const play = engine['play'].bind(engine)
    const padOf = new Map<string, string>(BEAT_PADS.map((p) => [p, p]))
    engine['play'] = (soundId, at, out, rate, level = 1, gate = {}) => {
      const source = play(sound, at, out, rate, level, gate)
      // Tails picked up mid-sound are counted apart from hits.
      if (!source || !soundId || (gate.offset ?? 0) > 0) return source
      const hit = { beat: ((at - shift) * 1000) / beatMs, padId: soundId, level, stopped: false }
      hits.push(hit)
      const stop = source.stop.bind(source)
      source.stop = (when?: number) => {
        hit.stopped = true
        stop(when)
      }
      return source
    }
    const feed = (repeat: Master['repeat']) =>
      engine.update({
        bpm,
        pads: padOf,
        tracks: new Map(tracks.map((t, i) => [`t${i}`, t])),
        uploads: new Set(),
        master: { ...MASTER_SOUND_DEFAULTS, swing, repeat },
      })
    feed(OFF)
    engine['shift'] = shift
    /** Schedules room window [from, to) in steps of `step` ms, as the lookahead would. */
    const schedule = (from: number, to: number, step = to - from) => {
      for (let a = from; a < to; a += step) {
        const b = Math.min(to, a + step)
        engine.scheduleWindow(a, b, shift, IDLE)
        engine['scheduledUntil'] = b
      }
    }
    const heard = () =>
      hits
        .filter((h) => !h.stopped)
        .map(({ beat, padId, level }) => ({ beat: Math.round(beat * 1e6) / 1e6, padId, level }))
        .sort((a, b) => a.beat - b.beat || a.padId.localeCompare(b.padId) || a.level - b.level)
    return { engine, feed, schedule, heard }
  }

  // @scenario audio/master: Swung hats
  it('plays every second 16th 62.5 ms late at swing 1 and 120 BPM, storing the same beats', async () => {
    const sixteenths = Array.from({ length: 16 }, (_, i) => ({ padId: 'b0', beat: i / 4 }))
    const t = track({ hits: sixteenths })
    const { schedule, heard } = await recorded([t], SHIFT, 1)
    schedule(0, barMs(BPM_120))
    const late = heard().map((h, i) => (h.beat - i / 4) * BEAT_MS)
    expect(late).toHaveLength(16)
    late.forEach((ms, i) => expect(ms, `16th ${i}`).toBeCloseTo(i % 2 ? 62.5 : 0, 6))
    expect(t.hits).toEqual(sixteenths)
  })

  // @scenario audio/master: Stutter a beat
  it("repeats beat 3's hits every beat from beat 3 when the 1/4 zone engages during beat 2", async () => {
    const bar = 1000
    const origin = bar * barMs(BPM_120)
    const { feed, schedule, heard } = await recorded([perBeat(bar)], -origin / 1000)
    const beat = (n: number) => origin + n * BEAT_MS
    schedule(beat(0), beat(1.5))
    // During beat 2 (1.5 beats in), someone drags Repeat to the 1/4 zone at y 1.
    const startBeat = repeatStamp(OFF, { x: 0.1, y: 1 }, beat(1.5), BPM_120)!
    expect(startBeat).toBe(bar * 4 + 2)
    feed({ x: 0.1, y: 1, startBeat })
    schedule(beat(1.5), beat(8))
    const pads = heard().map((h) => [h.beat - bar * 4, h.padId])
    expect(pads).toEqual([[0, 'b0'], [1, 'b1'], ...[2, 3, 4, 5, 6, 7].map((n) => [n, 'b2'])])
    expect(heard().every((h) => h.level === 1)).toBe(true)
  })

  // @scenario audio/master: Back to the loop
  it('returns to the loop where it would have been at the next 1/16 after y goes to 0', async () => {
    const { feed, schedule, heard } = await recorded([perBeat(0)], SHIFT)
    feed({ x: 0.1, y: 1, startBeat: 1 })
    schedule(0, 5.1 * BEAT_MS)
    const stop = repeatStamp({ x: 0.1, y: 1 }, { x: 0.1, y: 0 }, 5.1 * BEAT_MS, BPM_120)!
    expect(stop).toBe(5.25)
    feed({ x: 0.1, y: 0, startBeat: stop })
    schedule(5.1 * BEAT_MS, 8 * BEAT_MS)
    expect(heard().map((h) => [h.beat, h.padId])).toEqual([
      [0, 'b0'],
      ...[1, 2, 3, 4, 5].map((n) => [n, 'b1']),
      // On the bar grid: beat 6 of the jam is the loop's third beat.
      [6, 'b2'],
      [7, 'b3'],
    ])
  })

  it("plays the repeats at y and the loops at the rest, and repeats a 1/16 slice's hit", async () => {
    const sixteenths = [0, 0.25, 0.5, 0.75].map((beat, i) => ({ padId: BEAT_PADS[i]!, beat }))
    const { feed, schedule, heard } = await recorded([track({ hits: sixteenths })], SHIFT)
    // The 1/16 zone, from the loop's second 16th.
    feed({ x: 0.6, y: 0.25, startBeat: 0.25 })
    schedule(0, BEAT_MS)
    expect(heard()).toEqual([
      { beat: 0, padId: 'b0', level: 1 },
      { beat: 0.25, padId: 'b1', level: 0.25 },
      { beat: 0.25, padId: 'b1', level: 0.75 },
      { beat: 0.5, padId: 'b1', level: 0.25 },
      { beat: 0.5, padId: 'b2', level: 0.75 },
      { beat: 0.75, padId: 'b1', level: 0.25 },
      { beat: 0.75, padId: 'b3', level: 0.75 },
    ])
  })

  /** Renders a one-bar loop of `sound` on every beat at 100 BPM, with `repeat` from the start. */
  async function stutter(repeat: Master['repeat'] | undefined, sound = 'kick') {
    const audio = await offline({
      seconds: 4.8,
      sound,
      metronome: false,
      tracks: [track({ hits: [0, 1, 2, 3].map((beat) => ({ padId: PAD, beat })) })],
    })
    audio.engine.update({
      bpm: 100,
      pads: new Map([[PAD, sound]]),
      tracks: new Map([
        ['t0', track({ hits: [0, 1, 2, 3].map((beat) => ({ padId: PAD, beat })) })],
      ]),
      uploads: new Set(),
      master: { ...MASTER_SOUND_DEFAULTS, repeat: repeat ?? OFF },
    })
    audio.engine['shift'] = SHIFT
    const [left] = await render(audio)
    return left
  }

  it('cuts each repeat at its slice end, so 1/32 repeats of a long sound never pile up', async () => {
    for (const sound of ['kick', 'open-hat']) {
      const plain = peak(await stutter(undefined, sound), 1.2, 4.8)
      const repeated = await stutter({ x: 0.9, y: 1, startBeat: 1 }, sound)
      // No louder than one hit: without the cut, seven kicks overlapped at once.
      expect(plain, sound).toBeGreaterThan(0.2)
      expect(peak(repeated, 1.2, 4.8), sound).toBeLessThan(plain * 1.05)
    }
  })

  it('repeats what is still ringing when the slice falls between hits', async () => {
    // A 1/32 slice a 16th after the kick on beat 2: no hit in it, only the kick's tail.
    const tail = await stutter({ x: 0.9, y: 1, startBeat: 1.25 })
    const kick = peak(await stutter(undefined), 0, 0.6)
    const level = peak(tail, 1.5, 4.8)
    expect(level).toBeGreaterThan(0.01)
    expect(level).toBeLessThan(kick / 4)
  })

  it('switches slice on the stamped line even when it is the same as the move before', async () => {
    const bar = 1000
    const origin = bar * barMs(BPM_120)
    const { feed, schedule, heard } = await recorded([perBeat(bar)], -origin / 1000)
    const beat = (n: number) => origin + n * BEAT_MS
    // Engages 1/4 at 2.6 and moves to the 1/8 zone at 2.7: both land on beat 3.
    const on = repeatStamp(OFF, { x: 0.1, y: 1 }, beat(2.6), BPM_120)!
    const eighth = repeatStamp({ x: 0.1, y: 1 }, { x: 0.3, y: 1 }, beat(2.7), BPM_120)!
    expect(eighth).toBe(on)
    schedule(beat(0), beat(2.6))
    feed({ x: 0.1, y: 1, startBeat: on })
    // This client hears the second move late, after it has scheduled past the line.
    schedule(beat(2.6), beat(3.3))
    feed({ x: 0.3, y: 1, startBeat: eighth })
    schedule(beat(3.3), beat(8))
    expect(heard().map((h) => [h.beat - bar * 4, h.padId])).toEqual([
      [0, 'b0'],
      [1, 'b1'],
      [2, 'b2'],
      ...Array.from({ length: 10 }, (_, k) => [3 + k / 2, 'b3']),
    ])
  })

  it('lands a repeat on its line at room times since the epoch and an awkward tempo', async () => {
    const bpm = 97
    const beatMs = beatSeconds(bpm) * 1000
    // A bar around now: room times near 1.8e12 ms, where ms rounding is coarsest.
    const bar = Math.floor(Date.UTC(2026, 10, 25) / barMs(bpm))
    const origin = bar * barMs(bpm)
    const { feed, schedule, heard } = await recorded([perBeat(bar)], -origin / 1000, 0, 'kick', bpm)
    const beat = (n: number) => origin + n * beatMs
    schedule(beat(0), beat(1.5), 25)
    const startBeat = repeatStamp(OFF, { x: 0.1, y: 1 }, beat(1.5), bpm)!
    expect(startBeat).toBe(bar * 4 + 2)
    feed({ x: 0.1, y: 1, startBeat })
    schedule(beat(1.5), beat(8), 25)
    // The hit on the line is the slice's first repeat, heard once at full level, not a tail.
    const pads = heard().map((h) => [Math.round(h.beat - bar * 4), h.padId, h.level])
    expect(pads).toEqual([
      [0, 'b0', 1],
      [1, 'b1', 1],
      ...[2, 3, 4, 5, 6, 7].map((n) => [n, 'b2', 1]),
    ])
  })

  // @scenario audio/master: Same stutter
  it('schedules the same hits on two engines, whenever the change reaches each', async () => {
    const bar = 2000
    const origin = bar * barMs(BPM_120)
    const tracks = [
      perBeat(bar),
      track({
        startBar: bar,
        bars: 2,
        quantize: 0.25,
        hits: [0.27, 0.74, 2.5, 3.26, 5.1, 7.76].map((beat, i) => ({
          padId: BEAT_PADS[i % 4]!,
          beat,
        })),
      }),
    ]
    // Different clocks: one maps the room straight on, the other is 7.3 s into its own timeline.
    const a = await recorded(tracks, -origin / 1000, 0.6)
    const b = await recorded(tracks, -origin / 1000 + 7.3, 0.6)
    const beat = (n: number) => origin + n * BEAT_MS
    // One person moves Repeat three times: the 1/8 zone at y 1, the 1/32 zone at y 0.7, then off.
    const moves = [
      { at: 2.3, to: { x: 0.3, y: 1 } },
      { at: 2.9, to: { x: 0.9, y: 0.7 } },
      { at: 6.05, to: { x: 0.9, y: 0 } },
    ]
    let from = { x: 0, y: 0, startBeat: 0 }
    const stamped = moves.map(({ at, to }) => {
      const startBeat = repeatStamp(from, to, beat(at), BPM_120) ?? from.startBeat
      from = { ...to, startBeat }
      return { at, setting: from }
    })
    expect(stamped.map((m) => m.setting.startBeat - bar * 4)).toEqual([2.5, 3, 6.25])
    // A hears each move before scheduling past it, in one window per stretch.
    let until = beat(0)
    for (const { at, setting } of stamped) {
      a.schedule(until, beat(at))
      a.feed(setting)
      until = beat(at)
    }
    a.schedule(until, beat(12))
    // B schedules in 25 ms ticks with 120 ms of lookahead, and hears each move 40 ms late: before
    // its line, but after it has scheduled past it.
    let next = 0
    for (let now = beat(0); now < beat(12); now += 25) {
      const due = stamped[next]
      if (due && now >= beat(due.at) + 40) {
        expect(b.engine['scheduledUntil']).toBeGreaterThan(beat(due.setting.startBeat - bar * 4))
        b.feed(due.setting)
        next++
      }
      b.schedule(b.engine['scheduledUntil'] || now, now + 120, 25)
    }
    expect(next).toBe(3)
    // B's lookahead ran past where A stopped.
    expect(b.heard().filter((h) => h.beat < bar * 4 + 12)).toEqual(a.heard())

    // And what they both play: the 1/8 slice from 2.5 holds the second loop's beat-2.5 hit...
    const heard = a.heard().map((h) => ({ ...h, beat: Math.round((h.beat - bar * 4) * 1e6) / 1e6 }))
    const within = (from: number, to: number) => heard.filter((h) => h.beat >= from && h.beat < to)
    expect(within(2.5, 3)).toEqual([{ beat: 2.5, padId: 'b2', level: 1 }])
    // ...the 1/32 slice from 3 repeats the first loop's beat-3 hit at 0.7, with the loops at 0.3...
    const repeats = within(3, 6.25).filter((h) => h.level === 0.7)
    expect(repeats.map((h) => h.beat)).toEqual(Array.from({ length: 26 }, (_, k) => 3 + k / 8))
    expect(repeats.every((h) => h.padId === 'b3')).toBe(true)
    for (const h of within(3, 6.25).filter((h) => h.level !== 0.7)) expect(h.level).toBeCloseTo(0.3)
    // ...and from 6.25 the loops play as they were, swung where they land on an off-beat 16th.
    expect(within(6.25, 12)).toEqual([
      { beat: 7, padId: 'b3', level: 1 },
      { beat: 7.75 + 0.6 * 0.125, padId: 'b1', level: 1 },
      { beat: 8, padId: 'b0', level: 1 },
      { beat: 8.25 + 0.6 * 0.125, padId: 'b0', level: 1 },
      { beat: 8.75 + 0.6 * 0.125, padId: 'b1', level: 1 },
      { beat: 9, padId: 'b1', level: 1 },
      { beat: 10, padId: 'b2', level: 1 },
      { beat: 10.5, padId: 'b2', level: 1 },
      { beat: 11, padId: 'b3', level: 1 },
      { beat: 11.25 + 0.6 * 0.125, padId: 'b3', level: 1 },
    ])
  })
})
